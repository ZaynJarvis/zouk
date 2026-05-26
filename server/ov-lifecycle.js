// OpenViking lifecycle manager for zouk-managed agents.
//
// Handles auto-recall, auto-capture, auto-commit for agents that don't have
// native OV plugin support. Server-side orchestration — agents are unaware.
//
// Dependencies: OV API (via zouk's transparent proxy or direct).

const COMMIT_TOKEN_THRESHOLD = 20000;
const RECALL_LIMIT = 6;
const RECALL_SCORE_THRESHOLD = 0.35;
const RECALL_TOKEN_BUDGET = 2000;

function stripInjectedBlocks(text) {
  if (!text) return text;
  return text
    .replace(/<openviking-context[\s\S]*?<\/openviking-context>/gi, "")
    .replace(/<relevant-memories[\s\S]*?<\/relevant-memories>/gi, "")
    .replace(/<system-reminder[\s\S]*?<\/system-reminder>/gi, "")
    .trim();
}

function deriveSessionId(agentId, channelId) {
  return `zouk-${agentId}-${(channelId || "default").replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

function createOvLifecycleManager({ getAgentOvCreds, resolveOvUrl }) {

  async function ovFetch(agentId, path, opts = {}) {
    const creds = getAgentOvCreds(agentId);
    if (!creds?.apiKey) return null;
    const baseUrl = (creds.url || resolveOvUrl(agentId))?.replace(/\/+$/, "");
    if (!baseUrl) return null;

    const url = `${baseUrl}${path}`;
    const headers = {
      "Authorization": `Bearer ${creds.apiKey}`,
      "X-OpenViking-Account": creds.account || "",
      "X-OpenViking-User": creds.userId || "",
      "X-OpenViking-Agent": agentId,
      "Content-Type": "application/json",
      ...opts.headers,
    };

    try {
      const res = await fetch(url, { method: opts.method || "GET", headers, body: opts.body, signal: AbortSignal.timeout(opts.timeout || 10000) });
      if (!res.ok) return null;
      return await res.json();
    } catch (err) {
      console.warn(`[ov-lifecycle] ${agentId} ${path}: ${err.message}`);
      return null;
    }
  }

  return {
    // Auto-recall: search OV for context relevant to an incoming message.
    // Returns formatted context block or null.
    async autoRecall(agentId, messageContent) {
      if (!messageContent || messageContent.length < 3) return null;

      const body = JSON.stringify({
        query: messageContent.slice(0, 500),
        scope: ["user", "agent"],
        limit: RECALL_LIMIT,
        threshold: RECALL_SCORE_THRESHOLD,
      });
      const result = await ovFetch(agentId, "/api/v1/search/find", { method: "POST", body });
      if (!result?.result?.items?.length) return null;

      const items = result.result.items
        .filter((item) => item.score >= RECALL_SCORE_THRESHOLD)
        .slice(0, RECALL_LIMIT);
      if (items.length === 0) return null;

      let tokenBudget = RECALL_TOKEN_BUDGET;
      const lines = [];
      for (const item of items) {
        const content = item.abstract || item.uri;
        const tokens = Math.ceil(content.length / 4);
        if (tokenBudget <= 0) {
          lines.push(`- [${item.type || "memory"} ${Math.round(item.score * 100)}%] ${item.uri}`);
          continue;
        }
        tokenBudget -= tokens;
        lines.push(`- [${item.type || "memory"} ${Math.round(item.score * 100)}%] ${content}`);
      }

      return `<openviking-context source="auto-recall">\nRelevant context from OpenViking.\n${lines.join("\n")}\n</openviking-context>`;
    },

    // Auto-capture: log a conversation turn to OV session.
    async autoCapture(agentId, channelId, userMessage, agentResponse) {
      const sessionId = deriveSessionId(agentId, channelId);
      const cleanUser = stripInjectedBlocks(userMessage);
      const cleanAgent = stripInjectedBlocks(agentResponse);

      if (cleanUser) {
        await ovFetch(agentId, `/api/v1/sessions/${encodeURIComponent(sessionId)}/messages`, {
          method: "POST",
          body: JSON.stringify({ role: "user", content: cleanUser }),
          timeout: 15000,
        });
      }
      if (cleanAgent) {
        await ovFetch(agentId, `/api/v1/sessions/${encodeURIComponent(sessionId)}/messages`, {
          method: "POST",
          body: JSON.stringify({ role: "assistant", content: cleanAgent }),
          timeout: 15000,
        });
      }
    },

    // Auto-commit: commit OV session if pending tokens exceed threshold.
    async autoCommit(agentId, channelId) {
      const sessionId = deriveSessionId(agentId, channelId);
      const meta = await ovFetch(agentId, `/api/v1/sessions/${encodeURIComponent(sessionId)}?auto_create=true`);
      if (!meta?.result) return;
      const pending = meta.result.pending_tokens || 0;
      if (pending < COMMIT_TOKEN_THRESHOLD) return;

      console.log(`[ov-lifecycle] Committing session ${sessionId} for ${agentId} (${pending} pending tokens)`);
      await ovFetch(agentId, `/api/v1/sessions/${encodeURIComponent(sessionId)}/commit`, {
        method: "POST",
        body: JSON.stringify({}),
        timeout: 30000,
      });
    },

    // Session context: fetch archive overview for prompt injection on agent start.
    async getSessionContext(agentId, channelId, tokenBudget = 4000) {
      const sessionId = deriveSessionId(agentId, channelId);
      const result = await ovFetch(agentId, `/api/v1/sessions/${encodeURIComponent(sessionId)}/context?token_budget=${tokenBudget}`);
      if (!result?.result) return null;

      const { latest_archive_overview, pre_archive_abstracts } = result.result;
      if (!latest_archive_overview && (!pre_archive_abstracts || pre_archive_abstracts.length === 0)) return null;

      const parts = [];
      if (latest_archive_overview) parts.push(`<archive-overview>\n${latest_archive_overview}\n</archive-overview>`);
      if (pre_archive_abstracts?.length) {
        for (const abs of pre_archive_abstracts) {
          parts.push(`<archive-abstract>\n${abs}\n</archive-abstract>`);
        }
      }
      return `<session-archive>\n${parts.join("\n")}\n</session-archive>`;
    },

    // Commit all active sessions for an agent (on stop/idle).
    async commitAllSessions(agentId, channelIds) {
      for (const channelId of channelIds || []) {
        try {
          await this.autoCommit(agentId, channelId);
        } catch (err) {
          console.warn(`[ov-lifecycle] commitAllSessions ${agentId}/${channelId}: ${err.message}`);
        }
      }
    },

    stripInjectedBlocks,
    deriveSessionId,
  };
}

module.exports = { createOvLifecycleManager };
