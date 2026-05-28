// OpenViking lifecycle manager for zouk-managed agents.
//
// Handles auto-recall, auto-capture, auto-commit for agents that don't have
// their own OV plugin support. Server-side orchestration — agents are unaware.
//
// Dependencies: OV API (via zouk's transparent proxy or direct).

const COMMIT_TOKEN_THRESHOLD = 20000;
const RECALL_LIMIT = 6;
const RECALL_SCORE_THRESHOLD = 0.35;
const RECALL_TOKEN_BUDGET = 2000;
const STARTUP_PROFILE_BUDGET = 3000;
const STARTUP_LISTING_BUDGET = 2000;
const STARTUP_ARCHIVE_BUDGET = 4000;

function stripInjectedBlocks(text) {
  if (!text) return text;
  return text
    .replace(/<openviking-context[\s\S]*?<\/openviking-context>/gi, "")
    .replace(/<relevant-memories[\s\S]*?<\/relevant-memories>/gi, "")
    .replace(/<system-reminder[\s\S]*?<\/system-reminder>/gi, "")
    .trim();
}

function deriveSessionId(agentId) {
  return `zouk-${agentId}`;
}

function estimateTokens(text) {
  let count = 0;
  for (const ch of text) {
    count += ch.codePointAt(0) >= 0x3000 ? 1.5 : 0.25;
  }
  return Math.ceil(count);
}

// Format a channel tag for capture content prefix:
//   channel  → [#engineering]
//   dm       → [dm:@user-xpwo]
//   thread   → [#engineering:thr-abc]
function formatChannelTag(meta) {
  if (!meta?.channelName) return "";
  const isDm = meta.channelType === "dm";
  const base = isDm ? `dm:${meta.channelName.replace(/^dm:/, "")}` : `#${meta.channelName}`;
  const thread = meta.threadId ? `:${meta.threadId}` : "";
  return `[${base}${thread}]`;
}

function createOvLifecycleManager({ getAgentOvCreds, resolveOvUrl }) {

  async function ovFetch(agentId, path, opts = {}) {
    const creds = getAgentOvCreds(agentId);
    if (!creds?.apiKey) {
      console.warn(`[ov-lifecycle] ${agentId} skip ${path}: no apiKey`);
      return null;
    }
    const baseUrl = (creds.url || resolveOvUrl(agentId))?.replace(/\/+$/, "");
    if (!baseUrl) {
      console.warn(`[ov-lifecycle] ${agentId} skip ${path}: no baseUrl`);
      return null;
    }

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
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        console.warn(`[ov-lifecycle] ${agentId} ${path} → ${res.status}: ${body.slice(0, 200)}`);
        return null;
      }
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
      if (!messageContent || messageContent.length < 3) {
        console.log(`[ov-recall] ${agentId} skip (content len=${messageContent?.length || 0})`);
        return null;
      }

      // OV /api/v1/search/find: body = { query, target_uri?, limit, score_threshold }.
      // Response = { status, result: { memories, resources, skills, total } } where
      // each list entry is a MatchedContext { uri, context_type, abstract, score, ... }.
      // Omitting target_uri lets OV default-scope to the user's own namespace.
      const body = JSON.stringify({
        query: messageContent.slice(0, 500),
        limit: RECALL_LIMIT,
        score_threshold: RECALL_SCORE_THRESHOLD,
      });
      const result = await ovFetch(agentId, "/api/v1/search/find", { method: "POST", body });
      if (!result?.result) {
        console.log(`[ov-recall] ${agentId} 0 items (API ${result ? "ok-empty" : "fail"})`);
        return null;
      }

      const memories = Array.isArray(result.result.memories) ? result.result.memories : [];
      const resources = Array.isArray(result.result.resources) ? result.result.resources : [];
      const skills = Array.isArray(result.result.skills) ? result.result.skills : [];
      const all = [
        ...memories.map((m) => ({ ...m, _kind: "memory" })),
        ...resources.map((r) => ({ ...r, _kind: "resource" })),
        ...skills.map((s) => ({ ...s, _kind: "skill" })),
      ];
      const rawCount = all.length;
      if (rawCount === 0) {
        console.log(`[ov-recall] ${agentId} 0 items (API ok, total=${result.result.total || 0})`);
        return null;
      }

      const items = all
        .filter((item) => (item.score ?? 0) >= RECALL_SCORE_THRESHOLD)
        .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
        .slice(0, RECALL_LIMIT);
      if (items.length === 0) {
        const topScore = all.sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0]?.score?.toFixed(2);
        console.log(`[ov-recall] ${agentId} 0 items above ${RECALL_SCORE_THRESHOLD} (raw=${rawCount}, top=${topScore})`);
        return null;
      }
      console.log(`[ov-recall] ${agentId} ${items.length} items (raw=${rawCount}, top=${items[0].score.toFixed(2)})`);

      let tokenBudget = RECALL_TOKEN_BUDGET;
      const lines = [];
      for (const item of items) {
        const content = item.abstract || item.overview || item.uri;
        const tokens = Math.ceil(content.length / 4);
        const kind = item.context_type || item._kind || "memory";
        if (tokenBudget <= 0) {
          lines.push(`- [${kind} ${Math.round(item.score * 100)}%] ${item.uri}`);
          continue;
        }
        tokenBudget -= tokens;
        lines.push(`- [${kind} ${Math.round(item.score * 100)}%] ${content}`);
      }

      return `<openviking-context source="auto-recall">\nRelevant context from OpenViking.\n${lines.join("\n")}\n</openviking-context>`;
    },

    // Auto-capture: log a conversation turn to OV session.
    // `meta` carries the message context (channel + sender) so the captured
    // content is self-describing — agent at recall time can tell which
    // conversation/channel/sender a memory came from.
    async autoCapture(agentId, userMessage, agentResponse, meta = {}) {
      const sessionId = deriveSessionId(agentId);
      const cleanUser = stripInjectedBlocks(userMessage);
      const cleanAgent = stripInjectedBlocks(agentResponse);
      const channelTag = formatChannelTag(meta);

      if (cleanUser) {
        const sender = meta.senderName ? `@${meta.senderName}` : "user";
        const content = `${channelTag} ${sender}: ${cleanUser}`.trim();
        await ovFetch(agentId, `/api/v1/sessions/${encodeURIComponent(sessionId)}/messages`, {
          method: "POST",
          body: JSON.stringify({ role: "user", content }),
          timeout: 15000,
        });
      }
      if (cleanAgent) {
        const sender = meta.agentName ? `@${meta.agentName}` : "assistant";
        const content = `${channelTag} ${sender}: ${cleanAgent}`.trim();
        await ovFetch(agentId, `/api/v1/sessions/${encodeURIComponent(sessionId)}/messages`, {
          method: "POST",
          body: JSON.stringify({ role: "assistant", content }),
          timeout: 15000,
        });
      }
      // After every capture, fire-and-forget a threshold-gated commit so
      // long conversations archive incrementally without waiting for stop.
      this.autoCommit(agentId).catch(() => {});
    },

    // Auto-commit: commit OV session if pending tokens exceed threshold.
    async autoCommit(agentId) {
      const sessionId = deriveSessionId(agentId);
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
    async getSessionContext(agentId, tokenBudget = 4000) {
      const sessionId = deriveSessionId(agentId);
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

    // Startup context: profile + available memories + session archive.
    // Mirrors the CC plugin's SessionStart injection for managed agents.
    async getStartupContext(agentId) {
      const parts = [];
      // OV URIs are namespaced per user — must include the user_id segment.
      const userId = getAgentOvCreds(agentId)?.userId;
      if (!userId) return null;
      const userBase = `viking://user/${userId}`;
      const profileUri = `${userBase}/memories/profile.md`;

      // 1. User profile — OV REST shape: { status: "ok", result: <string> }
      const profile = await ovFetch(agentId, `/api/v1/content/read?uri=${encodeURIComponent(profileUri)}`, { timeout: 8000 });
      const profileText = typeof profile?.result === "string" ? profile.result : "";
      if (profileText) {
        const tokens = estimateTokens(profileText);
        if (tokens <= STARTUP_PROFILE_BUDGET) {
          parts.push(`<user-profile uri="${profileUri}">\n${profileText}\n</user-profile>`);
        } else {
          const lines = profileText.split("\n");
          const head = lines.slice(0, 8).join("\n");
          parts.push(`<user-profile uri="${profileUri}">\n${head}\n... [profile truncated]\n</user-profile>`);
        }
      }

      // 2. Available memories listing
      let budget = STARTUP_LISTING_BUDGET;
      const listingLines = [];
      for (const dir of ["preferences", "entities"]) {
        if (budget <= 0) break;
        const dirUri = `${userBase}/memories/${dir}/`;
        const listing = await ovFetch(agentId, `/api/v1/fs/ls?uri=${encodeURIComponent(dirUri)}&recursive=true`, { timeout: 8000 });
        const items = Array.isArray(listing?.result) ? listing.result : [];
        if (items.length === 0) continue;
        const dirLine = `  ${dirUri}`;
        listingLines.push(dirLine);
        budget -= estimateTokens(dirLine);
        let shown = 0;
        for (const entry of items) {
          if (budget <= 0) {
            const remaining = items.length - shown;
            if (remaining > 0) listingLines.push(`    ... +${remaining} more`);
            break;
          }
          const abstract = entry.abstract ? ` — ${entry.abstract.slice(0, 200)}` : "";
          const line = `    - ${entry.uri}${abstract}`;
          budget -= estimateTokens(line);
          listingLines.push(line);
          shown++;
        }
      }
      if (listingLines.length > 0) {
        parts.push(`<available-memories>\n${listingLines.join("\n")}\n</available-memories>`);
      }

      // 3. Session archive
      const archiveBlock = await this.getSessionContext(agentId, STARTUP_ARCHIVE_BUDGET);
      if (archiveBlock) parts.push(archiveBlock);

      if (parts.length === 0) return null;
      return `<openviking-context source="startup">\n${parts.join("\n")}\n</openviking-context>`;
    },

    // Force-commit the agent's session (on stop/idle). Unlike autoCommit
    // which gates on a token threshold for high-frequency writes, this
    // bypasses the threshold so a stopping agent always flushes pending
    // turns to an archive.
    async commitSession(agentId) {
      const sessionId = deriveSessionId(agentId);
      try {
        const res = await ovFetch(agentId, `/api/v1/sessions/${encodeURIComponent(sessionId)}/commit`, {
          method: "POST",
          body: JSON.stringify({}),
          timeout: 30000,
        });
        if (res) console.log(`[ov-lifecycle] force-committed session ${sessionId} for ${agentId}`);
      } catch (err) {
        console.warn(`[ov-lifecycle] commitSession ${agentId}: ${err.message}`);
      }
    },

    stripInjectedBlocks,
    deriveSessionId,
  };
}

module.exports = { createOvLifecycleManager };
