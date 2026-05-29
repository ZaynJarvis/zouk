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

// The chat send tool surfaces under several names depending on the driver's
// MCP prefix: `mcp__chat__send_message` (claude/codex/coco/…) or bare
// `send_message` (copilot). Normalize to the base name (last `__` segment)
// and match it — used to skip it during tool-call capture since its content
// is already recorded via the /send route.
const SEND_TOOL_BASENAMES = new Set(["send_message"]);
function isSendTool(toolName) {
  if (!toolName) return false;
  const base = String(toolName).split("__").pop();
  return SEND_TOOL_BASENAMES.has(base);
}

function estimateTokens(text) {
  let count = 0;
  for (const ch of text) {
    count += ch.codePointAt(0) >= 0x3000 ? 1.5 : 0.25;
  }
  return Math.ceil(count);
}

// Format the message header for the OV capture content. Mirrors the
// daemon's per-message prefix so that recalled memories read like the
// agent's own conversation log:
//   [target=#engineering msg=abcd1234 time=2026-05-20T15:49:20Z type=human]
//   [target=dm:@user-xpwo:thr-abc msg=... time=... type=agent]
function formatMessageHeader(meta) {
  if (!meta) return "";
  const fields = [];

  if (meta.channelName) {
    const isDm = meta.channelType === "dm";
    const base = isDm ? `dm:${meta.channelName.replace(/^dm:/, "")}` : `#${meta.channelName}`;
    const thread = meta.threadId ? `:${meta.threadId}` : "";
    fields.push(`target=${base}${thread}`);
  }
  if (meta.messageId) fields.push(`msg=${String(meta.messageId).slice(0, 8)}`);
  if (meta.timestamp) fields.push(`time=${meta.timestamp}`);
  if (meta.senderType) fields.push(`type=${meta.senderType}`);

  return fields.length ? `[${fields.join(" ")}]` : "";
}

const ovApi = require("./ov-api");

function createOvLifecycleManager({ getAgentOvCreds, resolveOvUrl }) {

  // Resolve agent creds in the shape ov-api expects, or null if the agent
  // isn't ready (no api key, no url). All lifecycle methods are best-effort
  // and silently return null/early on failure — they run inside the message
  // delivery hot path and must not throw upstream.
  function resolveCreds(agentId) {
    const c = getAgentOvCreds(agentId);
    if (!c?.apiKey) {
      console.warn(`[ov-lifecycle] ${agentId} skip: no apiKey`);
      return null;
    }
    const url = c.url || resolveOvUrl(agentId);
    if (!url) {
      console.warn(`[ov-lifecycle] ${agentId} skip: no url`);
      return null;
    }
    return { url, apiKey: c.apiKey, account: c.account, user: c.userId, agent: agentId };
  }

  async function safeCall(agentId, label, fn) {
    try {
      return await fn();
    } catch (err) {
      const status = err?.status ? ` (${err.status})` : "";
      console.warn(`[ov-lifecycle] ${agentId} ${label}${status}: ${err.message}`);
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
      const creds = resolveCreds(agentId);
      if (!creds) return null;

      const result = await safeCall(agentId, "search/find", () =>
        ovApi.searchFind(creds, {
          query: messageContent.slice(0, 500),
          limit: RECALL_LIMIT,
          scoreThreshold: RECALL_SCORE_THRESHOLD,
          timeout: 10000,
        })
      );
      if (!result) {
        console.log(`[ov-recall] ${agentId} 0 items (API fail)`);
        return null;
      }

      const all = [
        ...result.memories.map((m) => ({ ...m, _kind: "memory" })),
        ...result.resources.map((r) => ({ ...r, _kind: "resource" })),
        ...result.skills.map((s) => ({ ...s, _kind: "skill" })),
      ];
      const rawCount = all.length;
      if (rawCount === 0) {
        console.log(`[ov-recall] ${agentId} 0 items (API ok, total=${result.total})`);
        return null;
      }

      all.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
      const items = all
        .filter((item) => (item.score ?? 0) >= RECALL_SCORE_THRESHOLD)
        .slice(0, RECALL_LIMIT);
      if (items.length === 0) {
        console.log(`[ov-recall] ${agentId} 0 items above ${RECALL_SCORE_THRESHOLD} (raw=${rawCount}, top=${all[0]?.score?.toFixed(2)})`);
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
      const creds = resolveCreds(agentId);
      if (!creds) return;
      const sessionId = deriveSessionId(agentId);
      const cleanUser = stripInjectedBlocks(userMessage);
      const cleanAgent = stripInjectedBlocks(agentResponse);

      if (cleanUser) {
        const header = formatMessageHeader({ ...meta, senderType: meta.senderType || "human" });
        const sender = meta.senderName ? `@${meta.senderName}` : "user";
        const content = `${header} ${sender}: ${cleanUser}`.trim();
        await safeCall(agentId, "append user msg", () =>
          ovApi.appendSessionMessage(creds, sessionId, { role: "user", content, timeout: 15000 })
        );
      }
      if (cleanAgent) {
        const header = formatMessageHeader({ ...meta, senderType: meta.senderType || "agent" });
        const sender = meta.agentName ? `@${meta.agentName}` : "assistant";
        const content = `${header} ${sender}: ${cleanAgent}`.trim();
        await safeCall(agentId, "append assistant msg", () =>
          ovApi.appendSessionMessage(creds, sessionId, { role: "assistant", content, timeout: 15000 })
        );
      }
      // After every capture, fire-and-forget a threshold-gated commit so
      // long conversations archive incrementally without waiting for stop.
      this.autoCommit(agentId).catch(() => {});
    },

    // Capture the agent's tool calls into the OV session as assistant-role
    // messages. Called from the daemon-handler's agent:activity path with the
    // `kind:'tool'` trajectory entries. We record the tool name + truncated
    // input summary (daemon already caps it at ~200 chars) but NOT the result,
    // so the archived session reflects what the agent *did* between turns
    // without bloating memory with tool output. One append per activity batch
    // keeps HTTP overhead low and preserves ordering within the batch.
    //
    // The chat send tool is skipped: its payload is the message the agent
    // posts, which is already captured (with full content + channel tag) via
    // the /send route's autoCapture — recording the truncated tool input too
    // would just duplicate it.
    async captureToolCalls(agentId, toolEntries) {
      if (!Array.isArray(toolEntries) || toolEntries.length === 0) return;
      const filtered = toolEntries.filter((e) => !isSendTool(e.toolName));
      if (filtered.length === 0) return;
      const creds = resolveCreds(agentId);
      if (!creds) return;
      const sessionId = deriveSessionId(agentId);
      const lines = filtered.map((e) => {
        const name = e.toolName || "tool";
        const summary = (e.toolInputSummary || e.content || "").trim();
        return summary ? `[tool: ${name}] ${summary}` : `[tool: ${name}]`;
      });
      const content = lines.join("\n");
      if (!content) return;
      await safeCall(agentId, "append tool calls", () =>
        ovApi.appendSessionMessage(creds, sessionId, { role: "assistant", content, timeout: 15000 })
      );
    },

    // Auto-commit: commit OV session if pending tokens exceed threshold.
    async autoCommit(agentId) {
      const creds = resolveCreds(agentId);
      if (!creds) return;
      const sessionId = deriveSessionId(agentId);
      const session = await safeCall(agentId, "get session", () =>
        ovApi.getSession(creds, sessionId, { autoCreate: true, timeout: 10000 })
      );
      if (!session) return;
      const pending = session.pending_tokens || 0;
      if (pending < COMMIT_TOKEN_THRESHOLD) return;

      console.log(`[ov-lifecycle] Committing session ${sessionId} for ${agentId} (${pending} pending tokens)`);
      await safeCall(agentId, "commit (threshold)", () =>
        ovApi.commitSession(creds, sessionId, { timeout: 30000 })
      );
    },

    // Session context: fetch archive overview for prompt injection on agent start.
    async getSessionContext(agentId, tokenBudget = 4000) {
      const creds = resolveCreds(agentId);
      if (!creds) return null;
      const sessionId = deriveSessionId(agentId);
      const ctx = await safeCall(agentId, "session context", () =>
        ovApi.getSessionContext(creds, sessionId, tokenBudget, { timeout: 10000 })
      );
      if (!ctx) return null;

      const { latest_archive_overview, pre_archive_abstracts } = ctx;
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
      const creds = resolveCreds(agentId);
      if (!creds) return null;
      const userId = creds.user;
      if (!userId) return null;
      const parts = [];
      const userBase = `viking://user/${userId}`;
      const profileUri = `${userBase}/memories/profile.md`;

      // 1. User profile
      const profileText = await safeCall(agentId, "read profile", () =>
        ovApi.readContent(creds, profileUri, "l2", { timeout: 8000 })
      );
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
        const items = await safeCall(agentId, `ls ${dir}`, () =>
          ovApi.lsDir(creds, dirUri, { recursive: true, timeout: 8000 })
        );
        if (!items?.length) continue;
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
      const creds = resolveCreds(agentId);
      if (!creds) return;
      const sessionId = deriveSessionId(agentId);
      const ok = await safeCall(agentId, "force commit", async () => {
        await ovApi.commitSession(creds, sessionId, { timeout: 30000 });
        return true;
      });
      if (ok) console.log(`[ov-lifecycle] force-committed session ${sessionId} for ${agentId}`);
    },

    stripInjectedBlocks,
    deriveSessionId,
  };
}

module.exports = { createOvLifecycleManager };
