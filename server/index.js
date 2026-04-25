const express = require("express");
const http = require("http");
const { WebSocketServer } = require("ws");
const cors = require("cors");
const { v4: uuidv4 } = require("uuid");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { URL } = require("url");
const crypto = require("crypto");
const { OAuth2Client } = require("google-auth-library");
const db = require("./db");
const { createStore: createProfilePresetsStore, MAX_PRESETS: PROFILE_PRESET_MAX } = require("./profilePresets");
const { createStorage } = require("./storage");
const mockData = require("./mockData");

function gravatarUrl(email) {
  if (!email) return null;
  const hash = crypto.createHash("md5").update(email.trim().toLowerCase()).digest("hex");
  return `https://www.gravatar.com/avatar/${hash}?s=128&d=identicon`;
}

const PORT = process.env.PORT || 7777;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const googleClient = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;
const PUBLIC_URL = process.env.PUBLIC_URL || `http://localhost:${PORT}`;

// Email allowlist — union of two sources, both granting equal access:
//   1. `ALLOW` env (comma-separated emails, immutable without restart)
//   2. `email_allowlist` Supabase table (managed via Settings UI, hot-reloaded)
// When the union is non-empty, only listed addresses can mint sessions and
// guest mode is disabled. Empty union = unrestricted (default).
const ENV_ALLOW_EMAILS = new Set(
  (process.env.ALLOW || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
);
// email -> { addedAt, addedBy } (populated async from DB at startup)
const dbAllowEmails = new Map();

function allowlistActive() {
  return ENV_ALLOW_EMAILS.size > 0 || dbAllowEmails.size > 0;
}

function isEmailAllowed(email) {
  if (!allowlistActive()) return true;
  if (!email || typeof email !== "string") return false;
  const norm = email.trim().toLowerCase();
  return ENV_ALLOW_EMAILS.has(norm) || dbAllowEmails.has(norm);
}

function normalizeEmailInput(raw) {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return null;
  // Lightweight format check — full RFC validation is a rabbit hole; this
  // catches typos without false-rejecting real addresses.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return null;
  if (trimmed.length > 254) return null;
  return trimmed;
}

if (ENV_ALLOW_EMAILS.size > 0) {
  console.log(`[auth] Email allowlist seeded from ALLOW env (${ENV_ALLOW_EMAILS.size} address(es))`);
}

async function loadEmailAllowlistFromDb() {
  if (!db.enabled) return;
  try {
    const rows = await db.loadEmailAllowlist();
    if (!rows) return;
    dbAllowEmails.clear();
    for (const row of rows) {
      dbAllowEmails.set(row.email, { addedAt: row.addedAt, addedBy: row.addedBy });
    }
    if (rows.length > 0) {
      console.log(`[auth] Loaded ${rows.length} allowlist entry(ies) from Supabase`);
    }
  } catch (e) {
    console.warn("[auth] Failed to load email allowlist:", e.message);
  }
}
const CONFIG_DIR = path.join(__dirname, "..", "data");
const AGENT_CONFIGS_FILE = path.join(CONFIG_DIR, "agent-configs.json");
const MACHINE_KEYS_FILE = path.join(CONFIG_DIR, "machine-keys.json");
const SESSIONS_FILE = path.join(CONFIG_DIR, "sessions.json");
const AGENT_PROFILE_PRESETS_FILE = path.join(CONFIG_DIR, "agent-profile-presets.json");

// ─── Agent config persistence ────────────────────────────────────

if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });

function loadAgentConfigs() {
  try {
    if (fs.existsSync(AGENT_CONFIGS_FILE)) {
      const raw = JSON.parse(fs.readFileSync(AGENT_CONFIGS_FILE, "utf8"));
      // machineId is a required core field — drop any config without one.
      const filtered = Array.isArray(raw)
        ? raw.filter((c) => typeof c?.machineId === "string" && c.machineId.trim())
        : [];
      if (Array.isArray(raw) && filtered.length !== raw.length) {
        console.warn(`[config] Dropped ${raw.length - filtered.length} agent config(s) without machineId`);
      }
      return filtered;
    }
  } catch (e) {
    console.error("[config] Failed to load agent configs:", e.message);
  }
  return [];
}

function saveAgentConfigs(configs) {
  fs.writeFileSync(AGENT_CONFIGS_FILE, JSON.stringify(configs, null, 2), "utf8");
}

const agentConfigs = loadAgentConfigs(); // persistent agent configurations

// ─── Agent state helpers ─────────────────────────────────────────
// `agentConfigs` is the single source of truth for configuration fields
// (name, displayName, runtime, model, workDir).  `store.agents` only holds
// runtime state (status, machineId, sessionId).  These helpers ensure that
// every code path builds agent objects consistently.

/** Build a store.agents entry, always preferring agentConfigs values. */
function buildRuntimeAgent(agentId, runtimeOverrides = {}) {
  const cfg = agentConfigs.find((c) => c.id === agentId);
  return {
    name: cfg?.name || agentId,
    displayName: cfg?.displayName || cfg?.name || agentId,
    runtime: cfg?.runtime || runtimeOverrides.runtime || "unknown",
    model: cfg?.model || runtimeOverrides.model || "unknown",
    workDir: cfg?.workDir || runtimeOverrides.workDir,
    status: runtimeOverrides.status || "inactive",
    machineId: runtimeOverrides.machineId,
    sessionId: runtimeOverrides.sessionId,
  };
}

/** Build a full agent payload for broadcasting to the frontend.
 *  Always overlays config fields on top of runtime state so config
 *  edits are never masked by stale runtime copies. */
function agentPayload(agentId) {
  const a = store.agents[agentId];
  if (!a) return null;
  const cfg = agentConfigs.find((c) => c.id === agentId);
  const base = { id: agentId, ...a };
  if (!cfg) return base;
  return {
    ...base,
    name: cfg.name || a.name,
    displayName: cfg.displayName || cfg.name || a.displayName,
    runtime: cfg.runtime || a.runtime,
    model: cfg.model || a.model,
    workDir: cfg.workDir || a.workDir,
    picture: cfg.picture || a.picture || undefined,
  };
}

function hydrateAgentContextUsage(agentId) {
  if (!db.enabled || !store.agents[agentId] || store.agents[agentId].contextUsage) return;
  db.loadLatestContextUsage(agentId).then((contextUsage) => {
    if (!contextUsage || !store.agents[agentId] || store.agents[agentId].contextUsage) return;
    store.agents[agentId].contextUsage = contextUsage;
    broadcastToWeb({ type: "agent_started", agent: agentPayload(agentId) });
  }).catch((e) => {
    console.error(`[db] loadLatestContextUsage(${agentId}) failed:`, e.message);
  });
}

function hasWorkspaceFsCapability(ws) {
  const capabilities = Array.isArray(ws?._capabilities) ? ws._capabilities : [];
  return capabilities.some((cap) => (
    cap === "workspace_fs"
    || cap === "workdir_fs"
    || cap === "agent_workspace_fs"
  ));
}

function updateAgentWorkDir(agentId, workDir) {
  if (!workDir || typeof workDir !== "string") return false;
  const trimmed = workDir.trim();
  if (!trimmed) return false;

  let changed = false;
  if (store.agents[agentId] && store.agents[agentId].workDir !== trimmed) {
    store.agents[agentId].workDir = trimmed;
    changed = true;
  }

  const cfg = agentConfigs.find((c) => c.id === agentId);
  if (cfg && cfg.workDir !== trimmed) {
    cfg.workDir = trimmed;
    saveAgentConfigs(agentConfigs);
    db.saveAgentConfig(cfg).catch(e => console.warn("[config] saveAgentConfig error:", e.message));
    changed = true;
  }

  return changed;
}

// ─── Machine API key persistence ─────────────────────────────────

function loadMachineKeys() {
  try {
    if (fs.existsSync(MACHINE_KEYS_FILE)) {
      return JSON.parse(fs.readFileSync(MACHINE_KEYS_FILE, "utf8"));
    }
  } catch (e) {
    console.error("[config] Failed to load machine keys:", e.message);
  }
  return [];
}

function saveMachineKeys(keys) {
  fs.writeFileSync(MACHINE_KEYS_FILE, JSON.stringify(keys, null, 2), "utf8");
}

function generateApiKey() {
  return "sk_machine_" + crypto.randomBytes(32).toString("hex");
}

function validateApiKey(key) {
  if (!key) return false;
  // Default debug key — only accepted in non-production environments
  if (key === "1007" && !process.env.NODE_ENV?.startsWith("prod")) return true;
  // Allow "test" key in development
  if (key === "test" && !process.env.NODE_ENV?.startsWith("prod")) return true;
  return machineKeys.some((k) => k.rawKey === key && !k.revokedAt);
}

// Reserved usernames cannot be registered or renamed-to. The trigger API uses
// `system` as a synthetic sender, so we keep the name unambiguously off-limits
// to humans — that way @system mentions and the empty-frame avatar fallback
// can rely on "no human or agent owns this name".
const RESERVED_USER_NAMES = new Set(["system"]);
function isReservedName(name) {
  return RESERVED_USER_NAMES.has(String(name || "").trim().toLowerCase());
}

// Stable fingerprint for machine binding: SHA-256(hostname:os)
function computeMachineFingerprint(hostname, os) {
  const input = [hostname, os].filter(Boolean).join(':').toLowerCase();
  return crypto.createHash('sha256').update(input).digest('hex');
}

// Whether this is a debug/dev key (not subject to machine binding)
function isDebugKey(key) {
  return key === "1007" || key === "test";
}

function findMachineKeyRecord(apiKey) {
  return machineKeys.find((k) => k.rawKey === apiKey && !k.revokedAt) || null;
}

function resolveDaemonMachineId(apiKey) {
  const keyRecord = findMachineKeyRecord(apiKey);
  if (keyRecord?.id) return keyRecord.id;
  return uuidv4();
}

function isPersistentMachineId(machineId) {
  if (!machineId) return false;
  return machineKeys.some((k) => !k.revokedAt && k.id === machineId);
}

// machineId is immutable. An agent with no configured machineId is invalid
// (startup drops it) and a mismatched daemon adoption is always rejected.
function evaluateAgentMachineAffinity(agentId, ws) {
  const cfg = agentConfigs.find((c) => c.id === agentId);
  const configuredMachineId = typeof cfg?.machineId === "string" && cfg.machineId.trim()
    ? cfg.machineId.trim()
    : null;
  if (!configuredMachineId) return { allowed: false, expectedMachineId: null };
  if (configuredMachineId === ws._machineId) return { allowed: true };
  return { allowed: false, expectedMachineId: configuredMachineId };
}

const machineKeys = loadMachineKeys(); // persistent machine API keys

// ─── In-memory store ──────────────────────────────────────────────

const store = {
  channels: [
    { id: "ch-all", name: "all", description: "General channel", members: [] },
  ],
  messages: [], // { id, seq, channelId, channelName, channelType, threadId, senderName, senderType, content, createdAt, attachments, taskNumber, taskStatus, taskAssigneeId, taskAssigneeType }
  tasks: [], // { taskNumber, channelId, title, status, messageId, claimedByName, claimedByType, createdByName }
  agents: {}, // agentId -> { name, displayName, runtime, model, status, sessionId, ws }
  humans: [],
  agentReadSeq: {}, // agentId -> last seq delivered/read
  // channelAgents: channelId -> Map<agentId, { canRead, subscribed }>
  // Absence of (channelId, agentId) = agent is NOT a member of that channel.
  // subscribed controls WS-push wakeup; canRead controls /receive, /history, /search visibility.
  channelAgents: new Map(),
  seq: 0,
  taskSeq: 0,
};

// In-memory secondary indexes over store.messages. These exist purely so
// hot-path lookups (parent-of-thread, replies-of-thread) don't have to scan
// the whole array on every formatMessageForClient call. They are maintained
// in lockstep with store.messages via appendMessage / setStoreMessages, and
// must NEVER be mutated directly outside indexMessage / unindexMessage.
const messagesById = new Map();         // full id   -> msg
const messagesByShortId = new Map();    // id.slice(0,8) -> msg (parent lookup; threadId is always an 8-char shortid)
const repliesByThreadId = new Map();    // 8-char threadId -> Message[] (replies, push order = seq order)

// Sliding window cap. Without one, store.messages grew unbounded and
// every history fetch scaled with total accumulated traffic, not channel
// size. 5000 is well above the 800-message bootstrap so the eviction
// floor sits comfortably below the user-visible history horizon.
const MAX_IN_MEMORY_MESSAGES = parseInt(process.env.MAX_IN_MEMORY_MESSAGES || '5000', 10);

function indexMessage(msg) {
  if (!msg) return;
  messagesById.set(msg.id, msg);
  messagesByShortId.set(msg.id.slice(0, 8), msg);
  if (msg.threadId) {
    let arr = repliesByThreadId.get(msg.threadId);
    if (!arr) {
      arr = [];
      repliesByThreadId.set(msg.threadId, arr);
    }
    arr.push(msg);
  }
}

function unindexMessage(msg) {
  if (!msg) return;
  if (messagesById.get(msg.id) === msg) messagesById.delete(msg.id);
  // Only clear the short-id slot if it still points at this exact message —
  // a brand-new message could (astronomically rarely) share an 8-char prefix.
  const short = msg.id.slice(0, 8);
  if (messagesByShortId.get(short) === msg) messagesByShortId.delete(short);
  if (msg.threadId) {
    const arr = repliesByThreadId.get(msg.threadId);
    if (arr) {
      const idx = arr.indexOf(msg);
      if (idx >= 0) arr.splice(idx, 1);
      if (arr.length === 0) repliesByThreadId.delete(msg.threadId);
    }
  }
}

function rebuildMessageIndex() {
  messagesById.clear();
  messagesByShortId.clear();
  repliesByThreadId.clear();
  for (const msg of store.messages) indexMessage(msg);
}

// Wrapper for store.messages.push: keeps indexes in sync and enforces the
// sliding-window cap. All hot-path message inserts go through this.
function appendMessage(msg) {
  store.messages.push(msg);
  indexMessage(msg);
  while (store.messages.length > MAX_IN_MEMORY_MESSAGES) {
    const evicted = store.messages.shift();
    unindexMessage(evicted);
  }
}

// Replace the entire array (boot-from-DB path). Resets indexes after.
function setStoreMessages(msgs) {
  store.messages = msgs;
  rebuildMessageIndex();
}

function nextSeq() {
  return ++store.seq;
}
function nextTaskNum() {
  return ++store.taskSeq;
}
function shortId(id) {
  return id.substring(0, 8);
}
function now() {
  return new Date().toISOString();
}

function findOrCreateChannel(name, type = "channel") {
  let ch = store.channels.find((c) => c.name === name && (c.type || "channel") === (type || "channel"));
  if (!ch) {
    const idPrefix = type === "dm" ? "dm-" : "ch-";
    ch = {
      id: `${idPrefix}${uuidv4().substring(0, 8)}`,
      name,
      description: "",
      type: type || "channel",
      members: [],
    };
    store.channels.push(ch);
    db.saveChannel(ch);
    seedMembershipOnChannelCreate(ch);
  }
  return ch;
}

// ─── Channel ↔ Agent membership helpers ───────────────────────────
// membership row: { canRead: bool, subscribed: bool }
// Missing row = not a member.

function getMembership(channelId, agentId) {
  const ca = store.channelAgents.get(channelId);
  return ca ? ca.get(agentId) : undefined;
}

function setMembership(channelId, agentId, { canRead = true, subscribed = true } = {}) {
  let ca = store.channelAgents.get(channelId);
  if (!ca) {
    ca = new Map();
    store.channelAgents.set(channelId, ca);
  }
  const existing = ca.get(agentId);
  if (existing && existing.canRead === !!canRead && existing.subscribed === !!subscribed) return false;
  ca.set(agentId, { canRead: !!canRead, subscribed: !!subscribed });
  db.saveChannelAgent({ channelId, agentId, canRead: !!canRead, subscribed: !!subscribed });
  return true;
}

function removeMembership(channelId, agentId) {
  const ca = store.channelAgents.get(channelId);
  if (ca) {
    ca.delete(agentId);
    if (ca.size === 0) store.channelAgents.delete(channelId);
  }
  db.deleteChannelAgent(channelId, agentId);
}

function purgeAgentMemberships(agentId) {
  for (const ca of store.channelAgents.values()) {
    ca.delete(agentId);
  }
  // DB FK cascade handles row removal when agent_configs is deleted.
}

function purgeChannelMemberships(channelId) {
  store.channelAgents.delete(channelId);
  // DB FK cascade handles row removal when channels is deleted.
}

function subscribedAgentIdsFor(channelId) {
  const ca = store.channelAgents.get(channelId);
  if (!ca) return [];
  const out = [];
  for (const [agentId, row] of ca) {
    if (row.subscribed) out.push(agentId);
  }
  return out;
}

function agentCanRead(channelId, agentId) {
  const row = getMembership(channelId, agentId);
  return !!(row && row.canRead);
}

// Is a given stored message visible to an agent? DMs are gated by the
// canonical party list encoded in the channel name (`dm:a,b`) — the
// channel_agents table is bypassed to avoid seed/backfill races that
// leave an agent party without a membership row. Non-DM channels still
// consult the membership table. Unknown channels fail closed.
function messageVisibleToAgent(msg, agentId) {
  const ch = msg.channelId
    ? store.channels.find((c) => c.id === msg.channelId)
    : store.channels.find((c) => c.name === msg.channelName && (c.type || "channel") === (msg.channelType || "channel"));
  if (!ch) return false;
  if ((ch.type || "channel") === "dm") {
    const parties = dmChannelParties(ch.name) || [];
    const agentName = agentPayload(agentId)?.name
      || agentConfigs.find((c) => c.id === agentId)?.name;
    if (!agentName) return false;
    return parties.some((p) => String(p).toLowerCase() === String(agentName).toLowerCase());
  }
  return agentCanRead(ch.id, agentId);
}

// Seed membership when a channel is created.
//   DM: no rows — DM visibility/delivery is driven by the canonical party
//       list in the channel name, not channel_agents.
//   Regular channel: all active+configured agents are members by default.
//                    (Preserves legacy "broadcast to everyone" behavior; ops
//                    can unsubscribe later via the API.)
function seedMembershipOnChannelCreate(channel) {
  if ((channel.type || "channel") === "dm") return;
  for (const agentId of Object.keys(store.agents)) {
    setMembership(channel.id, agentId, { canRead: true, subscribed: true });
  }
  // Also seed configured agents that don't yet have a runtime entry, so the
  // membership carries across restarts.
  for (const cfg of agentConfigs) {
    if (!store.agents[cfg.id]) {
      setMembership(channel.id, cfg.id, { canRead: true, subscribed: true });
    }
  }
}

function agentIdByName(name) {
  if (!name) return null;
  const lowered = String(name).toLowerCase();
  for (const cfg of agentConfigs) {
    if ((cfg.name || "").toLowerCase() === lowered) return cfg.id;
    if ((cfg.displayName || "").toLowerCase() === lowered) return cfg.id;
  }
  for (const [id, a] of Object.entries(store.agents)) {
    if ((a.name || "").toLowerCase() === lowered) return id;
    if ((a.displayName || "").toLowerCase() === lowered) return id;
  }
  return null;
}

// Seed a newly-created/registered agent into all existing non-DM channels so
// they start out subscribed everywhere (legacy behavior). DMs are NOT seeded
// here — DMs only have 2 members by construction.
function seedAgentIntoRegularChannels(agentId) {
  for (const ch of store.channels) {
    if ((ch.type || "channel") === "dm") continue;
    if (!getMembership(ch.id, agentId)) {
      setMembership(ch.id, agentId, { canRead: true, subscribed: true });
    }
  }
}

// ─── Canonical DM channel helpers ─────────────────────────────────
// DMs use a canonical sorted-pair name: "dm:alice,zeus" so each pair
// of users shares exactly one channel regardless of who initiated.

function dmChannelName(a, b) {
  return `dm:${[a, b].sort().join(",")}`;
}

function dmChannelParties(channelName) {
  if (!channelName || !channelName.startsWith("dm:")) return null;
  return channelName.substring(3).split(",");
}

// Normalize an already-stored DM channel name so parties are sorted. Idempotent.
// Single-name rows (`dm:alice` — orphan from pre-canonical code) are returned
// as-is because we can't infer the other party without more context.
function canonicalizeDmChannelName(channelName) {
  const parties = dmChannelParties(channelName);
  if (!parties || parties.length < 2) return channelName;
  return `dm:${[...parties].sort().join(",")}`;
}

function dmPeerFrom(channelName, myName) {
  const parties = dmChannelParties(channelName);
  if (!parties || parties.length < 2) return channelName;
  return parties.find((p) => p !== myName) || parties[0];
}

function parseTarget(target, senderName) {
  // "#channel", "dm:@user", "#channel:shortid", "dm:@user:shortid",
  // or pre-canonicalized "dm:alice,zeus" / "dm:alice,zeus:shortid"
  if (!target) return { channelName: "all", channelType: "channel", threadId: null };
  if (target.startsWith("dm:")) {
    const parts = target.substring(3).split(":");
    const peer = parts[0].replace("@", "");
    let channelName;
    if (peer.includes(",")) {
      // Caller handed us a canonical-looking pair — sort to be safe.
      channelName = canonicalizeDmChannelName(`dm:${peer}`);
    } else if (senderName) {
      channelName = dmChannelName(senderName, peer);
    } else {
      channelName = `dm:${peer}`;
    }
    return { channelName, channelType: "dm", threadId: parts[1] || null, dmPeer: peer };
  }
  const parts = target.substring(1).split(":");
  return { channelName: parts[0], channelType: "channel", threadId: parts[1] || null };
}

function formatTarget(channelName, channelType, threadId) {
  if (channelType === "dm") {
    const parties = dmChannelParties(channelName);
    // For agents, format as dm:@peer; fall back to raw name
    const name = parties ? parties[0] : channelName;
    let t = `dm:@${name}`;
    if (threadId) t += `:${threadId}`;
    return t;
  }
  let t = `#${channelName}`;
  if (threadId) t += `:${threadId}`;
  return t;
}

function matchesTarget(msg, target, requesterName) {
  const { channelName, channelType, threadId } = parseTarget(target, requesterName);
  // For DM without requesterName, fall back to checking if canonical names overlap
  if (channelType === "dm" && !requesterName && msg.channelType === "dm") {
    const targetParts = target.startsWith("dm:") ? [target.substring(3).split(":")[0].replace("@", "")] : [];
    const msgParties = dmChannelParties(msg.channelName);
    if (targetParts.length && msgParties) {
      return msgParties.includes(targetParts[0])
        && (threadId ? msg.threadId === threadId : !msg.threadId);
    }
  }
  return msg.channelName === channelName
    && msg.channelType === channelType
    && (threadId ? msg.threadId === threadId : !msg.threadId);
}

const INLINE_REPLY_PREVIEW_LIMIT = 3;

function findThreadParentId(threadId) {
  if (!threadId) return null;
  // threadId is always an 8-char shortid (see parseTarget). Any message whose
  // id starts with that prefix gets indexed by its prefix in messagesByShortId,
  // so this is an O(1) lookup that replaces a full store.messages scan.
  const parent = messagesByShortId.get(threadId);
  return parent && !parent.threadId ? parent.id : null;
}

function collectThreadReplies(parentMsg) {
  if (!parentMsg || parentMsg.threadId) return { replies: [], replyCount: 0 };
  const shortid = parentMsg.id.slice(0, 8);
  const all = repliesByThreadId.get(shortid) || [];
  // channelId guard preserves the original semantics — if two parents share
  // an 8-char prefix in different channels, we still attribute replies to the
  // right one. The reply array is small per-thread so this is cheap.
  const matched = all.filter((m) => m.channelId === parentMsg.channelId);
  return { replies: matched.slice(-INLINE_REPLY_PREVIEW_LIMIT), replyCount: matched.length };
}

function formatMessageForClient(msg, viewerName, options = {}) {
  const { includeReplies = false } = options;
  const isThread = !!msg.threadId;
  // For DMs: if viewerName provided, show peer name; otherwise include dm_parties
  const resolveDmName = (name) => {
    if (!viewerName) return name; // canonical name stays, frontend resolves
    return dmPeerFrom(name, viewerName);
  };
  const parties = msg.channelType === "dm" ? dmChannelParties(msg.channelName) : null;
  const base = {
    id: msg.id,
    messageId: msg.id,
    senderName: msg.senderName,
    senderType: msg.senderType,
    channelName: isThread
      ? msg.threadId
      : (msg.channelType === "dm" ? resolveDmName(msg.channelName) : msg.channelName),
    channelType: isThread ? "thread" : msg.channelType,
    parentChannelName: isThread
      ? (msg.channelType === "dm" ? resolveDmName(msg.channelName) : msg.channelName)
      : null,
    parentChannelType: isThread ? msg.channelType : null,
    threadId: msg.threadId || null,
    parentMessageId: isThread ? findThreadParentId(msg.threadId) : null,
    content: msg.content,
    createdAt: msg.createdAt,
    attachments: msg.attachments || [],
    taskStatus: msg.taskStatus || null,
    taskNumber: msg.taskNumber || null,
    taskAssigneeId: msg.taskAssigneeId || null,
    taskAssigneeType: msg.taskAssigneeType || null,
    // Include parties so frontend can resolve peer without viewerName
    ...(parties && !viewerName ? { dmParties: parties } : {}),
  };
  if (includeReplies && !isThread) {
    const { replies, replyCount } = collectThreadReplies(msg);
    base.replies = replies.map((r) => formatMessageForClient(r, viewerName));
    base.replyCount = replyCount;
  }
  return base;
}

function formatMessageForAgent(msg, recipientAgentId) {
  const agentName = recipientAgentId ? (store.agents[recipientAgentId]?.name || recipientAgentId) : null;
  const formatted = formatMessageForClient(msg, agentName);
  return {
    message_id: formatted.messageId,
    sender_name: formatted.senderName,
    sender_type: formatted.senderType,
    channel_name: formatted.channelName,
    channel_type: formatted.channelType,
    parent_channel_name: formatted.parentChannelName,
    parent_channel_type: formatted.parentChannelType,
    thread_id: formatted.threadId,
    parent_message_id: formatted.parentMessageId,
    content: formatted.content,
    timestamp: formatted.createdAt,
    attachments: formatted.attachments,
    task_status: formatted.taskStatus,
    task_number: formatted.taskNumber,
    task_assignee_id: formatted.taskAssigneeId,
    task_assignee_type: formatted.taskAssigneeType,
  };
}

// ─── WS connect-storm tracker ─────────────────────────────────────
// One bad client (stale tab, runaway daemon, buggy reconnect loop) can saturate
// the single-replica event loop just by re-opening /ws over and over. Each
// connect runs handleWebConnection which sends a full init payload sync. We
// observed ~40 conn/s in production → ~12s p50 latency on unrelated HTTP.
//
// Defence is two-pronged:
//   1. Rate-limit /ws upgrades per token (or per IP for guests). Auto-block
//      any source that exceeds WS_RATE_BLOCK_THRESHOLD opens within
//      WS_RATE_WINDOW_MS for WS_BLOCK_DURATION_MS.
//   2. Defer the init send via setImmediate so a burst is interleaved with
//      other event-loop work instead of monopolizing one tick.
//
// Tracker entries are surfaced via /api/_internal/ws-clients so the operator
// can see who's misbehaving and revoke the offending session from Settings.
const WS_RATE_WINDOW_MS = 60_000;
const WS_RATE_BLOCK_THRESHOLD = Number(process.env.WS_RATE_BLOCK_THRESHOLD || 12);
const WS_BLOCK_DURATION_MS = 5 * 60_000;
const WS_TRACKER_TTL_MS = 24 * 60 * 60 * 1000;
const WS_REVOKE_BLOCK_MS = 24 * 60 * 60 * 1000;
// Invalid token = client sent ?token=… but it isn't in authSessions. Almost
// always a stale tab after revoke/logout/deploy. The client's own retry
// budget will keep firing it; harshly throttle to make it cheap.
const WS_INVALID_TOKEN_THRESHOLD = Number(process.env.WS_INVALID_TOKEN_THRESHOLD || 3);
const WS_INVALID_BLOCK_MS = 24 * 60 * 60 * 1000;

const wsTrackers = new Map(); // fingerprint -> entry

function tokenFingerprint(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex").slice(0, 16);
}

function pruneRecentConnects(entry, nowMs) {
  const cutoff = nowMs - WS_RATE_WINDOW_MS;
  while (entry.recentConnects.length && entry.recentConnects[0] < cutoff) {
    entry.recentConnects.shift();
  }
}

function recordWsConnectAttempt(token, ip) {
  const nowMs = Date.now();
  const kind = token ? "token" : "ip";
  const key = token ? tokenFingerprint(token) : `ip:${ip || "unknown"}`;
  let entry = wsTrackers.get(key);
  if (!entry) {
    entry = {
      key,
      kind,
      token: token || null,
      ip: ip || null,
      openCount: 0,
      totalConnects: 0,
      totalDisconnects: 0,
      totalRejections: 0,
      lastConnectAt: 0,
      lastDisconnectAt: 0,
      lastRejectionAt: 0,
      recentConnects: [],
      blockedUntil: 0,
      blockReason: null,
      manualBlock: false,
      firstSeenAt: nowMs,
    };
    wsTrackers.set(key, entry);
  }
  // Hot path: already blocked → return immediately, no prune / no array work.
  // A storming source can pound on this at >30/s; the original code pruned and
  // pushed for every attempt even when the answer was already "rejected".
  if (entry.blockedUntil > nowMs) {
    entry.totalRejections += 1;
    entry.lastRejectionAt = nowMs;
    return { allow: false, entry, reason: entry.blockReason || "blocked" };
  }
  // Refresh ip in case the same token now connects from a different network.
  if (ip) entry.ip = ip;
  pruneRecentConnects(entry, nowMs);
  entry.recentConnects.push(nowMs);
  entry.totalConnects += 1;
  entry.lastConnectAt = nowMs;
  if (entry.recentConnects.length > WS_RATE_BLOCK_THRESHOLD) {
    entry.blockedUntil = nowMs + WS_BLOCK_DURATION_MS;
    entry.blockReason = `auto: ${entry.recentConnects.length} connects in ${WS_RATE_WINDOW_MS / 1000}s (limit ${WS_RATE_BLOCK_THRESHOLD})`;
    console.warn(`[ws-tracker] auto-blocked ${entry.kind}=${entry.key} for ${WS_BLOCK_DURATION_MS / 1000}s — ${entry.blockReason}`);
    entry.totalRejections += 1;
    entry.lastRejectionAt = nowMs;
    return { allow: false, entry, reason: entry.blockReason };
  }
  entry.openCount += 1;
  return { allow: true, entry };
}

// Tracks /ws upgrades that arrived with a token the server doesn't recognize.
// These are *always* rejected; the tracker exists so we can escalate to a long
// block once the misbehaving client has burned through WS_INVALID_TOKEN_THRESHOLD
// strikes — no point letting them keep wasting TLS handshakes for 24h.
//
// Hot-path discipline: a buggy client can hammer this at >30/s. Once an entry
// is already blocked, do the absolute minimum (bump a counter + return) and
// skip the SHA-window prune, the array push, the blockedUntil reassignment,
// and the console.warn. The original implementation re-logged + re-set
// blockedUntil on every rejected attempt — at 30/s that re-introduced the
// event-loop pressure we were trying to defend against.
function recordInvalidTokenAttempt(token, ip) {
  const nowMs = Date.now();
  const fp = tokenFingerprint(token);
  const key = `bad:${fp}`;
  let entry = wsTrackers.get(key);
  if (!entry) {
    entry = {
      key,
      kind: "invalid_token",
      token: null,
      ip: ip || null,
      openCount: 0,
      totalConnects: 0,
      totalDisconnects: 0,
      totalRejections: 0,
      lastConnectAt: 0,
      lastDisconnectAt: 0,
      lastRejectionAt: 0,
      recentConnects: [],
      blockedUntil: 0,
      blockReason: null,
      manualBlock: false,
      firstSeenAt: nowMs,
    };
    wsTrackers.set(key, entry);
  }
  // Hot path: already blocked → just bump the counter and return. No prune,
  // no array push, no log, no Date math.
  if (entry.blockedUntil > nowMs) {
    entry.totalRejections += 1;
    entry.lastRejectionAt = nowMs;
    return entry;
  }
  if (ip) entry.ip = ip;
  pruneRecentConnects(entry, nowMs);
  entry.recentConnects.push(nowMs);
  entry.totalRejections += 1;
  entry.lastRejectionAt = nowMs;
  // Only fires on the actual transition into blocked state.
  if (!entry.manualBlock && entry.recentConnects.length > WS_INVALID_TOKEN_THRESHOLD) {
    entry.blockedUntil = nowMs + WS_INVALID_BLOCK_MS;
    entry.blockReason = `invalid token: ${entry.recentConnects.length} bad attempts in ${WS_RATE_WINDOW_MS / 1000}s`;
    console.warn(`[ws-tracker] invalid-token block ${key} for ${WS_INVALID_BLOCK_MS / 1000}s — ${entry.blockReason}`);
  }
  return entry;
}

function recordWsDisconnect(entry) {
  if (!entry) return;
  entry.totalDisconnects += 1;
  entry.lastDisconnectAt = Date.now();
  if (entry.openCount > 0) entry.openCount -= 1;
}

function pruneOldWsTrackers(nowMs = Date.now()) {
  for (const [key, entry] of wsTrackers) {
    if (entry.openCount > 0) continue;
    if (entry.blockedUntil > nowMs) continue;
    if (entry.manualBlock) continue;
    const lastActivity = Math.max(entry.lastConnectAt, entry.lastDisconnectAt, entry.lastRejectionAt);
    if (lastActivity && (nowMs - lastActivity) > WS_TRACKER_TTL_MS) {
      wsTrackers.delete(key);
    }
  }
}
setInterval(() => pruneOldWsTrackers(), 60 * 60 * 1000).unref?.();

// ─── WebSocket: daemon connections ────────────────────────────────

const daemonSockets = new Map(); // agentId -> ws
const daemonConnections = new Set(); // all daemon ws connections (for sending agent:start before any agent is registered)
const webSockets = new Set(); // web UI connections
const machines = new Map(); // machineId -> { id, hostname, os, runtimes, capabilities, connectedAt, agentIds }
const pendingRuntimeModelRequests = new Map(); // requestId -> { resolve, timer }
const pendingContextResets = new Map(); // agentId -> resolver (fires on daemon agent:status=inactive, for reset-context orchestration)
const onlineHumans = new Map(); // humanName -> { id, name, picture, gravatarUrl, guest, count }
// Everyone we've ever seen as an authenticated user (seeded from `sessions` table on
// startup, upserted on OAuth login + profile update). Lets the people list retain
// users who are currently offline, and lets @mentions resolve to them.
// Guests are intentionally NOT stored here — they vanish from the list when their
// only WS connection drops.
const allTimeHumans = new Map(); // humanName -> { id, name, picture, gravatarUrl, guest: false }

// Per-agent queue of messages that arrived while the daemon socket was offline.
// Drained on reconnect (see replayPendingDeliveries). Bounded per agent (oldest
// dropped) and time-limited so a long-offline agent doesn't get blasted with
// stale events when it reconnects.
const pendingDeliveries = new Map(); // agentId -> [{ message, queuedAt }]
const PENDING_DELIVERY_CAP = 500;
const PENDING_DELIVERY_TTL_MS = 24 * 60 * 60 * 1000;

function hasKnownAgentConfig(agentId) {
  return agentConfigs.some((config) => config.id === agentId);
}

function purgeUnknownAgentState(agentId) {
  pendingDeliveries.delete(agentId);
  if (store.agents[agentId]) delete store.agents[agentId];
  daemonSockets.delete(agentId);
  for (const machine of machines.values()) {
    if (Array.isArray(machine.agentIds)) {
      machine.agentIds = machine.agentIds.filter((id) => id !== agentId);
    }
  }
}

function sendAgentStop(
  agentId,
  preferredWs = null,
  {
    broadcast = preferredWs == null,
    includeCurrentOwner = preferredWs == null,
  } = {}
) {
  const targets = new Set();
  if (preferredWs?.readyState === 1) targets.add(preferredWs);
  if (includeCurrentOwner) {
    const directWs = daemonSockets.get(agentId);
    if (directWs?.readyState === 1) targets.add(directWs);
  }
  if (broadcast) {
    for (const ws of daemonConnections) {
      if (ws.readyState === 1) targets.add(ws);
    }
  }
  for (const ws of targets) {
    ws.send(JSON.stringify({ type: "agent:stop", agentId }));
  }
}

function queuePendingDelivery(agentId, message) {
  let queue = pendingDeliveries.get(agentId);
  if (!queue) {
    queue = [];
    pendingDeliveries.set(agentId, queue);
  }
  queue.push({ message, queuedAt: Date.now() });
  if (queue.length > PENDING_DELIVERY_CAP) {
    queue.splice(0, queue.length - PENDING_DELIVERY_CAP);
  }
}

function replayPendingDeliveries(agentId) {
  const queue = pendingDeliveries.get(agentId);
  if (!queue || queue.length === 0) return;
  pendingDeliveries.delete(agentId);
  const cutoff = Date.now() - PENDING_DELIVERY_TTL_MS;
  for (const item of queue) {
    if (item.queuedAt < cutoff) continue;
    deliverToAgent(agentId, item.message);
  }
}

function broadcastToWeb(event) {
  const data = JSON.stringify(event);
  for (const ws of webSockets) {
    if (ws.readyState !== 1) continue;
    if (!shouldDeliverEventToWebViewer(event, ws)) continue;
    ws.send(data);
  }
}

// DM messages must only reach the two parties; everything else (channel posts,
// agent/machine/task/config updates) continues to broadcast globally.
function shouldDeliverEventToWebViewer(event, ws) {
  if (event.type !== "message" && event.type !== "new_message") return true;
  const msg = event.message;
  if (!msg) return true;
  const isDm = msg.channelType === "dm" || msg.parentChannelType === "dm";
  if (!isDm) return true;
  const parties = msg.dmParties;
  if (!parties || parties.length === 0) return true;
  const viewer = ws._humanName;
  if (!viewer) return false;
  return parties.includes(viewer);
}

const profilePresets = createProfilePresetsStore({
  filePath: AGENT_PROFILE_PRESETS_FILE,
  db,
  broadcast: broadcastToWeb,
});

function humanId(name) {
  return `human:${String(name || "").trim().toLowerCase()}`;
}

function currentHumans() {
  // Merge: everyone who's logged in before (allTimeHumans) + currently-connected
  // guests (onlineHumans entries with no allTimeHumans counterpart). Each entry
  // carries an `online` flag derived from onlineHumans counts.
  const result = [];
  const seen = new Set();
  for (const human of allTimeHumans.values()) {
    seen.add(human.name);
    const presence = onlineHumans.get(human.name);
    result.push({
      id: human.id,
      name: human.name,
      picture: human.picture || undefined,
      gravatarUrl: human.gravatarUrl || undefined,
      guest: false,
      online: !!(presence && presence.count > 0),
    });
  }
  for (const presence of onlineHumans.values()) {
    if (seen.has(presence.name)) continue;
    if (presence.count <= 0) continue;
    result.push({
      id: presence.id || humanId(presence.name),
      name: presence.name,
      picture: presence.picture || undefined,
      gravatarUrl: presence.gravatarUrl || undefined,
      guest: !!presence.guest,
      online: true,
    });
  }
  result.sort((a, b) => {
    if (a.online !== b.online) return a.online ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return result;
}

function upsertAllTimeHuman(human) {
  if (!human?.name) return false;
  const prev = allTimeHumans.get(human.name);
  const next = {
    id: human.id || humanId(human.name),
    name: human.name,
    picture: human.picture || prev?.picture || undefined,
    gravatarUrl: human.gravatarUrl || prev?.gravatarUrl || undefined,
    guest: false,
  };
  if (prev && prev.id === next.id && prev.picture === next.picture && prev.gravatarUrl === next.gravatarUrl) {
    return false;
  }
  allTimeHumans.set(human.name, next);
  return true;
}

function broadcastHumans() {
  store.humans = currentHumans();
  broadcastToWeb({ type: "humans_updated", humans: store.humans });
}

function addHumanPresence(human) {
  if (!human?.name) return;
  const existing = onlineHumans.get(human.name);
  if (existing) {
    existing.count += 1;
    existing.picture = human.picture ?? existing.picture;
    existing.gravatarUrl = human.gravatarUrl ?? existing.gravatarUrl;
    existing.guest = human.guest ?? existing.guest;
  } else {
    onlineHumans.set(human.name, {
      id: human.id || humanId(human.name),
      name: human.name,
      picture: human.picture,
      gravatarUrl: human.gravatarUrl,
      guest: !!human.guest,
      count: 1,
    });
  }
  // An authenticated user connecting refreshes their persistent profile too.
  if (!human.guest) upsertAllTimeHuman(human);
  broadcastHumans();
}

function removeHumanPresence(name) {
  if (!name) return;
  const existing = onlineHumans.get(name);
  if (!existing) return;
  existing.count -= 1;
  if (existing.count <= 0) onlineHumans.delete(name);
  broadcastHumans();
}

function resolveWsHuman(msg = {}, fallbackToken = null) {
  const token = typeof msg.token === "string" && msg.token ? msg.token : fallbackToken;
  if (token && authSessions.has(token)) {
    const user = authSessions.get(token);
    return {
      token,
      human: {
        id: humanId(user.name),
        name: user.name,
        picture: user.picture || undefined,
        gravatarUrl: user.gravatarUrl || (user.email ? gravatarUrl(user.email) : undefined),
        guest: false,
      },
    };
  }

  const name = typeof msg.name === "string" ? msg.name.trim() : "";
  if (!name) return { token: null, human: null };
  return {
    token: null,
    human: {
      id: humanId(name),
      name,
      picture: typeof msg.picture === "string" && msg.picture ? msg.picture : undefined,
      gravatarUrl: typeof msg.gravatarUrl === "string" && msg.gravatarUrl ? msg.gravatarUrl : undefined,
      guest: true,
    },
  };
}

function setWebPresence(ws, msg = {}) {
  const { token, human } = resolveWsHuman(msg, ws._authToken || null);
  const previousName = ws._humanName || null;

  if (!human) {
    if (previousName) {
      removeHumanPresence(previousName);
      ws._humanName = null;
      ws._human = null;
    }
    if (!token) {
      ws._authenticated = false;
      ws._authToken = null;
    }
    return;
  }

  if (token) {
    ws._authenticated = true;
    ws._authToken = token;
  }

  if (previousName && previousName !== human.name) {
    removeHumanPresence(previousName);
  }

  if (previousName === human.name) {
    const existing = onlineHumans.get(human.name);
    if (existing) {
      existing.picture = human.picture ?? existing.picture;
      existing.gravatarUrl = human.gravatarUrl ?? existing.gravatarUrl;
      existing.guest = human.guest ?? existing.guest;
      broadcastHumans();
    } else {
      addHumanPresence(human);
    }
  } else {
    addHumanPresence(human);
  }

  ws._humanName = human.name;
  ws._human = human;
}

function deliverToAgent(agentId, message) {
  const ws = daemonSockets.get(agentId);
  if (ws && ws.readyState === 1) {
    const seq = nextSeq();
    ws.send(JSON.stringify({
      type: "agent:deliver",
      agentId,
      seq,
      message: formatMessageForAgent(message, agentId),
    }));
    // Do NOT pre-mark as read here. Pre-marking was breaking mid-turn steering
    // for notification-mode drivers (Claude): the daemon would notify the agent
    // "N new messages waiting", the agent would call check_messages, and the
    // server would return nothing because the message was already marked read.
    // The agent's own check_messages call now advances the cursor via /receive.
    return;
  }
  queuePendingDelivery(agentId, message);
}

function mentionAliases(...values) {
  const aliases = new Set();
  for (const value of values) {
    const trimmed = String(value || "").trim();
    if (!trimmed) continue;
    aliases.add(trimmed);
    aliases.add(trimmed.replace(/\s+/g, "_"));
  }
  return [...aliases].map((alias) => alias.toLowerCase());
}

function agentMatchesMention(agent, mention) {
  const normalizedMention = String(mention || "").trim().toLowerCase();
  if (!normalizedMention) return false;
  return mentionAliases(agent?.name, agent?.displayName).includes(normalizedMention);
}

function extractMentions(content) {
  const mentions = [];
  const regex = /@([\p{L}\p{N}_-]+)/gu;
  let match;
  while ((match = regex.exec(content)) !== null) {
    mentions.push(match[1].toLowerCase());
  }
  return mentions;
}

function deliverToAllAgents(message, excludeAgent = null) {
  const mentions = extractMentions(message.content || "");
  const hasSpecificMention = mentions.some((m) =>
    Object.values(store.agents).some((a) => agentMatchesMention(a, m))
  );

  // Resolve the channel row so we can ask who's subscribed. Messages always
  // carry channelId (set at write time); fall back to name/type lookup in
  // case of old records.
  const ch = message.channelId
    ? store.channels.find((c) => c.id === message.channelId)
    : store.channels.find((c) => c.name === message.channelName && (c.type || "channel") === (message.channelType || "channel"));

  // DMs derive subscribers from the canonical party list — bypasses
  // channel_agents so a missing seed row can't strand the agent party.
  let subscribedIds;
  if (ch && (ch.type || "channel") === "dm") {
    const parties = dmChannelParties(ch.name) || [];
    subscribedIds = parties
      .map((p) => agentIdByName(p))
      .filter(Boolean);
  } else {
    subscribedIds = ch ? subscribedAgentIdsFor(ch.id) : [];
  }

  for (const agentId of subscribedIds) {
    if (excludeAgent && agentId === excludeAgent) continue;
    const agent = store.agents[agentId];
    if (!agent || agent.status !== "active") continue;

    // If message mentions specific agent(s), only deliver to them
    if (hasSpecificMention) {
      const isTargeted = mentions.some((mention) => agentMatchesMention(agent, mention));
      if (!isTargeted) continue;
    }

    deliverToAgent(agentId, message);
  }
}

// ─── Express app ──────────────────────────────────────────────────

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

const attachmentStorage = createStorage(
  process.env.ZOUK_UPLOADS_DIR || path.join(__dirname, "..", "uploads")
);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// Resolve an array of attachment ids into the thin {id, filename, contentType}
// shape that rides along with each message. Unknown ids fall through as
// filename:"unknown" so messages never crash a renderer that expects the shape.
function resolveAttachmentRefs(ids) {
  if (!Array.isArray(ids)) return [];
  return ids.map((aid) => {
    const meta = attachmentStorage.statSync(aid);
    if (!meta) return { id: aid, filename: "unknown" };
    return { id: aid, filename: meta.filename, contentType: meta.contentType };
  });
}

// ─── REST API: MCP tool endpoints ─────────────────────────────────

// send_message
app.post("/internal/agent/:agentId/send", (req, res) => {
  const { agentId } = req.params;
  const { target, content, attachmentIds } = req.body;
  // Use config-derived name (agentPayload overlays config on runtime).
  // store.agents[agentId].name may still be the raw ID for agents that
  // were already running before configs were loaded/fixed.
  const senderName = agentPayload(agentId)?.name || agentId;
  const { channelName, channelType, threadId } = parseTarget(target, senderName);
  const ch = findOrCreateChannel(channelName, channelType);

  const msg = {
    id: uuidv4(),
    seq: nextSeq(),
    channelId: ch.id,
    channelName,
    channelType,
    threadId: threadId || null,
    senderName,
    senderType: "agent",
    content,
    createdAt: now(),
    attachments: resolveAttachmentRefs(attachmentIds),
  };
  appendMessage(msg);
  db.saveMessage(msg);

  // Deliver to other agents
  deliverToAllAgents(msg, agentId);
  // Broadcast to web UI
  broadcastToWeb({ type: "message", message: formatMessageForClient(msg) });

  res.json({ messageId: msg.id, recentUnread: [] });
});

// check_messages (receive)
app.get("/internal/agent/:agentId/receive", (req, res) => {
  const { agentId } = req.params;
  const lastRead = store.agentReadSeq[agentId] || 0;
  const selfName = agentPayload(agentId)?.name || agentId;
  // Filter to messages the agent is allowed to see: later than lastRead,
  // not from self, AND in a channel the agent is a member of (can_read).
  const unread = store.messages
    .filter((m) => (
      m.seq > lastRead
      && m.senderName !== selfName
      && messageVisibleToAgent(m, agentId)
    ))
    .map((m) => formatMessageForAgent(m, agentId));
  // Update read position (across all messages so we never revisit old seqs)
  if (store.messages.length > 0) {
    store.agentReadSeq[agentId] = store.messages[store.messages.length - 1].seq;
  }
  res.json({ messages: unread });
});

// list_server
app.get("/internal/agent/:agentId/server", (req, res) => {
  const { agentId } = req.params;
  const channels = store.channels
    .filter((ch) => (ch.type || "channel") === "channel")
    .map((ch) => {
      const row = getMembership(ch.id, agentId);
      return {
        name: ch.name,
        description: ch.description || "",
        joined: !!(row && row.canRead),
        subscribed: !!(row && row.subscribed),
      };
    });
  const agents = Object.keys(store.agents).map((id) => {
    const p = agentPayload(id);
    return { name: p?.name || id, status: p?.status || "inactive" };
  });
  res.json({ channels, agents, humans: store.humans });
});

// list the agent's channel memberships (subscriptions)
app.get("/internal/agent/:agentId/subscriptions", (req, res) => {
  const { agentId } = req.params;
  const out = [];
  for (const ch of store.channels) {
    const row = getMembership(ch.id, agentId);
    if (!row) continue;
    out.push({
      channelId: ch.id,
      channelName: ch.name,
      channelType: ch.type || "channel",
      canRead: !!row.canRead,
      subscribed: !!row.subscribed,
    });
  }
  res.json({ subscriptions: out });
});

// update a single subscription. Body: { channelId?, channelName?, channelType?, canRead?, subscribed? }
// Either channelId or (channelName[, channelType]) must be provided.
app.patch("/internal/agent/:agentId/subscriptions", (req, res) => {
  const { agentId } = req.params;
  const { channelId, channelName, channelType = "channel", canRead, subscribed } = req.body || {};
  let ch;
  if (channelId) {
    ch = store.channels.find((c) => c.id === channelId);
  } else if (channelName) {
    ch = store.channels.find((c) => c.name === channelName && (c.type || "channel") === channelType);
  }
  if (!ch) return res.status(404).json({ error: "channel_not_found" });
  const existing = getMembership(ch.id, agentId) || { canRead: true, subscribed: true };
  const next = {
    canRead: canRead === undefined ? existing.canRead : !!canRead,
    subscribed: subscribed === undefined ? existing.subscribed : !!subscribed,
  };
  // If both flags end up false, remove the row entirely (not a member).
  if (!next.canRead && !next.subscribed) {
    removeMembership(ch.id, agentId);
    return res.json({ ok: true, membership: null });
  }
  setMembership(ch.id, agentId, next);
  res.json({ ok: true, membership: { channelId: ch.id, channelName: ch.name, ...next } });
});

// read_history
app.get("/internal/agent/:agentId/history", (req, res) => {
  const { agentId } = req.params;
  const { channel, limit = 50, before, after, around } = req.query;
  const agentName = store.agents[agentId]?.name || agentId;
  let msgs = store.messages.filter((m) => (
    matchesTarget(m, channel, agentName) && messageVisibleToAgent(m, agentId)
  ));
  const limitNum = parseInt(limit);

  if (around) {
    // Find the message and return context around it
    const idx = msgs.findIndex((m) => m.id === around || String(m.seq) === around);
    if (idx >= 0) {
      const half = Math.floor(limitNum / 2);
      const start = Math.max(0, idx - half);
      const end = Math.min(msgs.length, idx + half + 1);
      msgs = msgs.slice(start, end);
    } else {
      msgs = msgs.slice(-limitNum);
    }
  } else {
    if (before) msgs = msgs.filter((m) => m.seq < parseInt(before));
    if (after) msgs = msgs.filter((m) => m.seq > parseInt(after));
    msgs = msgs.slice(-limitNum);
  }

  res.json({
    messages: msgs.map((m) => formatMessageForAgent(m, agentId)),
    last_read_seq: store.seq,
    has_more: false,
    has_older: false,
    has_newer: false,
    historyLimited: false,
    historyLimitMessage: null,
  });
});

// search_messages
app.get("/internal/agent/:agentId/search", (req, res) => {
  const { agentId } = req.params;
  const agentName = store.agents[agentId]?.name || agentId;
  const { q, limit = 10, channel } = req.query;
  // Always limit search to channels the agent can read so DM / private-channel
  // content can't leak via the search path.
  let msgs = store.messages.filter((m) => messageVisibleToAgent(m, agentId));
  if (channel) {
    msgs = msgs.filter((m) => matchesTarget(m, channel, agentName));
  }
  if (q) {
    const query = q.toLowerCase();
    msgs = msgs.filter((m) => m.content.toLowerCase().includes(query));
  }
  msgs = msgs.slice(-parseInt(limit));

  res.json({
    results: msgs.map((m) => ({
      ...formatMessageForClient(m),
      seq: m.seq,
      createdAt: m.createdAt,
      snippet: m.content.substring(0, 200),
    })),
  });
});

// list_tasks
app.get("/internal/agent/:agentId/tasks", (req, res) => {
  const { channel, status } = req.query;
  let tasks = store.tasks;
  if (channel) {
    const { channelName } = parseTarget(channel);
    const ch = store.channels.find((c) => c.name === channelName);
    if (ch) tasks = tasks.filter((t) => t.channelId === ch.id);
  }
  if (status && status !== "all") {
    tasks = tasks.filter((t) => t.status === status);
  }
  res.json({
    tasks: tasks.map((t) => ({
      taskNumber: t.taskNumber,
      title: t.title,
      status: t.status,
      messageId: t.messageId,
      claimedByName: t.claimedByName || null,
      createdByName: t.createdByName,
      isLegacy: false,
    })),
  });
});

// create_tasks
app.post("/internal/agent/:agentId/tasks", (req, res) => {
  const { agentId } = req.params;
  const { channel, tasks: taskDefs } = req.body;
  const { channelName, channelType } = parseTarget(channel);
  const ch = findOrCreateChannel(channelName, channelType);
  const agentName = store.agents[agentId]?.name || agentId;

  const created = taskDefs.map((td) => {
    const taskNum = nextTaskNum();
    const msgId = uuidv4();
    const task = {
      taskNumber: taskNum,
      channelId: ch.id,
      title: td.title,
      status: "todo",
      messageId: msgId,
      claimedByName: null,
      claimedByType: null,
      createdByName: agentName,
    };
    store.tasks.push(task);
    db.saveTask(task);

    // Create a system message for the task
    const msg = {
      id: msgId,
      seq: nextSeq(),
      channelId: ch.id,
      channelName,
      channelType,
      threadId: null,
      senderName: "system",
      senderType: "system",
      content: `📋 New task #${taskNum}: ${td.title}`,
      createdAt: now(),
      attachments: [],
      taskNumber: taskNum,
      taskStatus: "todo",
    };
    appendMessage(msg);
    db.saveMessage(msg);
    broadcastToWeb({ type: "message", message: formatMessageForClient(msg) });

    return { taskNumber: taskNum, messageId: msgId, title: td.title };
  });

  res.json({ tasks: created });
});

// claim_tasks
// Claims existing tasks by task number or by the backing task-message id.
// This route does not convert ordinary messages into tasks.
app.post("/internal/agent/:agentId/tasks/claim", (req, res) => {
  const { agentId } = req.params;
  const { channel, task_numbers, message_ids } = req.body;
  const agentName = store.agents[agentId]?.name || agentId;

  // Resolve tasks from both task_numbers and message_ids.
  // message_ids only match existing task messages; agents should use
  // create_tasks for ordinary messages that need to become tasks.
  const tasksToProcess = [];
  if (task_numbers) {
    for (const num of task_numbers) {
      const task = store.tasks.find((t) => t.taskNumber === num);
      const reason = task ? null : "task not found";
      tasksToProcess.push({ task, taskNumber: num, reason });
    }
  }
  if (message_ids) {
    for (const mid of message_ids) {
      const task = store.tasks.find((t) => t.messageId === mid);
      if (task) {
        tasksToProcess.push({ task, messageId: mid, taskNumber: task.taskNumber, reason: null });
        continue;
      }

      const message = store.messages.find((m) => m.id === mid);
      const reason = message
        ? "message exists but is not a task; create a new task explicitly"
        : "message not found";
      tasksToProcess.push({ task: null, messageId: mid, taskNumber: message?.taskNumber ?? null, reason });
    }
  }

  const results = tasksToProcess.map(({ task, taskNumber, messageId, reason }) => {
    if (!task) return { taskNumber, messageId, success: false, reason };
    const num = task.taskNumber;
    if (task.claimedByName && task.claimedByName !== agentName) {
      return { taskNumber: num, messageId: task.messageId, success: false, reason: `already claimed by @${task.claimedByName}` };
    }
    task.claimedByName = agentName;
    task.claimedByType = "agent";
    task.status = "in_progress";
    db.saveTask(task);

    const msg = {
      id: uuidv4(), seq: nextSeq(),
      channelId: task.channelId, channelName: store.channels.find((c) => c.id === task.channelId)?.name || "all",
      channelType: "channel", threadId: null,
      senderName: "system", senderType: "system",
      content: `📌 ${agentName} claimed #${num} "${task.title}"`,
      createdAt: now(), attachments: [], taskNumber: num, taskStatus: "in_progress",
    };
    appendMessage(msg);
    db.saveMessage(msg);
    broadcastToWeb({ type: "message", message: formatMessageForClient(msg) });

    return { taskNumber: num, messageId: task.messageId, success: true, reason: null };
  });

  res.json({ results });
});

// unclaim_task
app.post("/internal/agent/:agentId/tasks/unclaim", (req, res) => {
  const { task_number, channel } = req.body;
  const task = store.tasks.find((t) => t.taskNumber === task_number);
  if (task) {
    task.claimedByName = null;
    task.claimedByType = null;
    task.status = "todo";
    db.saveTask(task);
  }
  res.json({ success: true });
});

// update_task_status
app.post("/internal/agent/:agentId/tasks/update-status", (req, res) => {
  const { agentId } = req.params;
  const { task_number, status, channel } = req.body;
  const task = store.tasks.find((t) => t.taskNumber === task_number);
  if (task) {
    const oldStatus = task.status;
    task.status = status;
    db.saveTask(task);
    const agentName = store.agents[agentId]?.name || agentId;
    const emoji = status === "done" ? "✅" : status === "in_review" ? "👀" : "🔄";

    const msg = {
      id: uuidv4(), seq: nextSeq(),
      channelId: task.channelId, channelName: store.channels.find((c) => c.id === task.channelId)?.name || "all",
      channelType: "channel", threadId: null,
      senderName: "system", senderType: "system",
      content: `${emoji} ${agentName} moved #${task_number} "${task.title}" to ${status}`,
      createdAt: now(), attachments: [], taskNumber: task_number, taskStatus: status,
    };
    appendMessage(msg);
    db.saveMessage(msg);
    broadcastToWeb({ type: "message", message: formatMessageForClient(msg) });
  }
  res.json({ success: true });
});

// resolve-channel
app.post("/internal/agent/:agentId/resolve-channel", (req, res) => {
  const { agentId } = req.params;
  const agentName = store.agents[agentId]?.name || agentId;
  const { target } = req.body;
  const { channelName, channelType } = parseTarget(target, agentName);
  const ch = findOrCreateChannel(channelName, channelType);
  res.json({ channelId: ch.id });
});

// upload
app.post("/internal/agent/:agentId/upload", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file" });
  const id = uuidv4();
  try {
    await attachmentStorage.put(id, req.file.buffer, {
      filename: req.file.originalname,
      contentType: req.file.mimetype,
    });
  } catch (err) {
    return res.status(500).json({ error: "Failed to persist attachment", detail: err.message });
  }
  res.json({ id, filename: req.file.originalname, sizeBytes: req.file.size });
});

// view_file (attachment download)
app.get("/api/attachments/:attachmentId", (req, res) => {
  const id = req.params.attachmentId;
  const meta = attachmentStorage.statSync(id);
  if (!meta || !attachmentStorage.existsSync(id)) {
    return res.status(404).json({ error: "Not found" });
  }
  res.set("Content-Type", meta.contentType || "application/octet-stream");
  attachmentStorage.stream(id).on("error", () => {
    if (!res.headersSent) res.status(500).end();
    else res.destroy();
  }).pipe(res);
});

// ─── Web API: for the frontend ────────────────────────────────────

// Auth middleware: blocks guest (unauthenticated) users from write operations.
// Also enforces the email allowlist on every request — a session minted before
// the allowlist became active (or whose email was later removed) is rejected.
function requireAuth(req, res, next) {
  const token = req.headers.authorization?.replace("Bearer ", "");
  const user = token ? authSessions.get(token) : null;
  if (!user) {
    return res.status(403).json({ error: "Authentication required. Sign in with Google to perform this action." });
  }
  if (allowlistActive() && !isEmailAllowed(user.email)) {
    return res.status(403).json({ error: "Email not authorized to access this server." });
  }
  next();
}

// Single insert path for human-style messages — POST /api/messages and
// POST /api/trigger both go through this so any new downstream side-effect
// (mention-fanout, broadcast, persistence) lands in lockstep.
function insertUserMessage({ channelId, channelName, channelType, threadId, senderName, senderType, content, attachments }) {
  const msg = {
    id: uuidv4(),
    seq: nextSeq(),
    channelId,
    channelName,
    channelType,
    threadId: threadId || null,
    senderName,
    senderType,
    content,
    createdAt: now(),
    attachments: attachments || [],
  };
  appendMessage(msg);
  db.saveMessage(msg);
  // Regular channel delivery uses channel_agents membership; DM delivery
  // resolves parties from the canonical channel name inside deliverToAllAgents.
  deliverToAllAgents(msg);
  // Broadcast to web UI (no viewerName — includes dmParties for frontend to resolve)
  broadcastToWeb({ type: "message", message: formatMessageForClient(msg) });
  return msg;
}

// Send message from web UI (human user)
app.post("/api/messages", requireAuth, (req, res) => {
  // Prefer the authenticated user's name over any body field so a stale client
  // state can't pollute canonical DM channel names (would split PM threads).
  // Falls back to the legacy body.senderName, then to "local-user" for tooling.
  const token = req.headers.authorization?.replace("Bearer ", "");
  const authedName = token ? authSessions.get(token)?.name : null;
  const { target, content, senderName: bodyName, attachmentIds } = req.body;
  const senderName = authedName || bodyName || "local-user";
  const { channelName, channelType, threadId } = parseTarget(target, senderName);
  const ch = findOrCreateChannel(channelName, channelType);

  const msg = insertUserMessage({
    channelId: ch.id,
    channelName,
    channelType,
    threadId,
    senderName,
    senderType: "human",
    content,
    attachments: resolveAttachmentRefs(attachmentIds),
  });

  res.json({ messageId: msg.id, message: msg });
});

// Auth middleware for the external trigger API — validates the X-API-Key
// header against the existing machine_keys table, the same store used today
// for daemon WS connect. Debug keys ("1007"/"test", non-prod only) are
// accepted via validateApiKey() but have no DB record to bump.
function requireMachineKey(req, res, next) {
  const apiKey = req.headers["x-api-key"];
  if (!apiKey) {
    return res.status(401).json({ error: "Missing X-API-Key header" });
  }
  if (!validateApiKey(apiKey)) {
    return res.status(401).json({ error: "Invalid or revoked API key" });
  }
  const keyRecord = findMachineKeyRecord(apiKey);
  if (keyRecord) {
    keyRecord.lastUsedAt = now();
    saveMachineKeys(machineKeys);
    db.saveMachineKey(keyRecord);
  }
  next();
}

// POST /api/trigger — let external systems inject a message that behaves
// exactly like a human-sent one (full deliverToAllAgents + broadcastToWeb
// fanout, mention parsing, agent wakeup). Public channels only — no DM,
// no attachments. Sender is hardcoded to "system"; the name is reserved
// (see RESERVED_USER_NAMES) so it can't collide with a real user.
app.post("/api/trigger", requireMachineKey, (req, res) => {
  const { target, content } = req.body || {};
  if (typeof target !== "string" || !target.startsWith("#")) {
    return res.status(400).json({ error: "target must be a public channel like '#general' (DMs not supported)" });
  }
  if (typeof content !== "string" || !content.trim()) {
    return res.status(400).json({ error: "content required" });
  }
  const senderName = "system";
  const { channelName, channelType, threadId } = parseTarget(target, senderName);
  if (channelType !== "channel") {
    return res.status(400).json({ error: "trigger only supports public channels (no DMs)" });
  }
  // Require channel to already exist — external systems shouldn't spawn new
  // channels by accident. Caller should create via the web UI first.
  const ch = store.channels.find((c) => c.name === channelName && (c.type || "channel") === "channel");
  if (!ch) {
    return res.status(404).json({ error: `channel #${channelName} not found` });
  }

  const msg = insertUserMessage({
    channelId: ch.id,
    channelName,
    channelType: "channel",
    threadId,
    senderName,
    senderType: "human",
    content,
    attachments: [],
  });

  res.json({ messageId: msg.id, message: msg });
});

// Upload an attachment from the web UI. Shares the same on-disk storage the
// agent upload path writes to, so the returned id is interchangeable — clients
// pass it back via POST /api/messages { attachmentIds }.
app.post("/api/attachments", requireAuth, upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file" });
  const id = uuidv4();
  try {
    await attachmentStorage.put(id, req.file.buffer, {
      filename: req.file.originalname,
      contentType: req.file.mimetype,
    });
  } catch (err) {
    return res.status(500).json({ error: "Failed to persist attachment", detail: err.message });
  }
  res.json({
    id,
    filename: req.file.originalname,
    contentType: req.file.mimetype,
    sizeBytes: req.file.size,
  });
});

// Get messages for a channel
// The Cloudflare proxy rewrites both query strings AND path segments during
// its 307 redirect chain, so the primary web client passes the channel target
// in request headers (X-Channel, X-Limit, X-Sender) which survive untouched.
// Query-string fallback kept for backward compat (curl, daemon internal API).
app.get("/api/messages", (req, res) => {
  const channel = req.headers["x-channel"] || req.query.channel || "#all";
  const limit = parseInt(req.headers["x-limit"] || req.query.limit || 100);
  const sender = req.headers["x-sender"] || req.query.sender || null;
  const before = req.headers["x-before"] || req.query.before || null;

  const filtered = store.messages.filter((m) => matchesTarget(m, channel, sender));
  let windowEnd = filtered.length;
  if (before) {
    const idx = filtered.findIndex((m) => m.id === before);
    if (idx >= 0) windowEnd = idx;
  }
  const windowStart = Math.max(0, windowEnd - limit);
  const msgs = filtered.slice(windowStart, windowEnd);
  res.json({
    messages: msgs.map((m) => formatMessageForClient(m, sender, { includeReplies: true })),
    hasMore: windowStart > 0,
  });
});

// Get channels
app.get("/api/channels", (req, res) => {
  res.json({
    channels: store.channels.filter((ch) => (ch.type || "channel") === "channel"),
  });
});

// Create channel
app.post("/api/channels", requireAuth, (req, res) => {
  const { name, description } = req.body;
  const ch = findOrCreateChannel(name);
  ch.description = description || "";
  db.saveChannel(ch);
  broadcastToWeb({ type: "channel_created", channel: ch });
  res.json({ channel: ch });
});

app.delete("/api/channels/:id", requireAuth, async (req, res) => {
  const { id } = req.params;
  const idx = store.channels.findIndex((ch) => ch.id === id && (ch.type || "channel") === "channel");
  if (idx < 0) return res.status(404).json({ error: "Channel not found" });

  const [channel] = store.channels.splice(idx, 1);
  purgeChannelMemberships(channel.id);
  await db.deleteChannel(channel.id);
  broadcastToWeb({ type: "channel_deleted", channelId: channel.id, channelName: channel.name });
  res.json({ success: true, channel });
});

// List agents subscribed to a channel. Used by the admin UI.
app.get("/api/channels/:id/agents", requireAuth, (req, res) => {
  const { id } = req.params;
  const ch = store.channels.find((c) => c.id === id);
  if (!ch) return res.status(404).json({ error: "Channel not found" });
  const ca = store.channelAgents.get(ch.id);
  const rows = ca
    ? [...ca.entries()].map(([agentId, m]) => ({
        agentId,
        agentName: agentPayload(agentId)?.name || agentId,
        canRead: m.canRead,
        subscribed: m.subscribed,
      }))
    : [];
  res.json({ agents: rows });
});

// Set (or remove) a single agent's membership on a channel. Admin-facing.
app.patch("/api/channels/:id/agents/:agentId", requireAuth, (req, res) => {
  const { id, agentId } = req.params;
  const { canRead, subscribed } = req.body || {};
  const ch = store.channels.find((c) => c.id === id);
  if (!ch) return res.status(404).json({ error: "Channel not found" });
  const existing = getMembership(ch.id, agentId) || { canRead: true, subscribed: true };
  const next = {
    canRead: canRead === undefined ? existing.canRead : !!canRead,
    subscribed: subscribed === undefined ? existing.subscribed : !!subscribed,
  };
  if (!next.canRead && !next.subscribed) {
    removeMembership(ch.id, agentId);
    return res.json({ ok: true, membership: null });
  }
  setMembership(ch.id, agentId, next);
  res.json({ ok: true, membership: { channelId: ch.id, agentId, ...next } });
});

app.delete("/api/channels/:id/agents/:agentId", requireAuth, (req, res) => {
  const { id, agentId } = req.params;
  const ch = store.channels.find((c) => c.id === id);
  if (!ch) return res.status(404).json({ error: "Channel not found" });
  removeMembership(ch.id, agentId);
  res.json({ ok: true });
});

// Read-only task list for the frontend kanban. Tasks don't carry their own
// timestamps in the schema, so we derive createdAt/updatedAt from the system
// messages stamped with each task_number (create → claim → status updates).
app.get("/api/tasks", (req, res) => {
  const taskTimes = new Map(); // taskNumber -> { createdAt, updatedAt }
  for (const m of store.messages) {
    if (!m.taskNumber) continue;
    const cur = taskTimes.get(m.taskNumber);
    if (!cur) {
      taskTimes.set(m.taskNumber, { createdAt: m.createdAt, updatedAt: m.createdAt });
    } else {
      if (m.createdAt < cur.createdAt) cur.createdAt = m.createdAt;
      if (m.createdAt > cur.updatedAt) cur.updatedAt = m.createdAt;
    }
  }

  const tasks = store.tasks.map((t) => {
    const times = taskTimes.get(t.taskNumber) || { createdAt: null, updatedAt: null };
    return {
      taskNumber: t.taskNumber,
      channelId: t.channelId,
      channelName: store.channels.find((c) => c.id === t.channelId)?.name || null,
      title: t.title,
      status: t.status,
      messageId: t.messageId,
      claimedByName: t.claimedByName,
      claimedByType: t.claimedByType,
      createdByName: t.createdByName,
      createdAt: times.createdAt,
      updatedAt: times.updatedAt,
    };
  });

  res.json({ tasks });
});

// List connected machines (daemons)
app.get("/api/machines", (req, res) => {
  const machineList = Array.from(machines.values()).map((m) => ({
    ...m,
    agents: m.agentIds.map((id) => agentPayload(id)).filter(Boolean),
  }));
  res.json({ machines: machineList });
});

// Ask a daemon to enumerate installed models for a given runtime.
// Daemons that don't implement the protocol (old zouk-daemon) will stay silent,
// so we always fall back via the 5s timeout. Clients can treat
// {models: []} and a timeout identically — both mean "free-form input please".
app.get("/api/machines/:id/runtimes/:runtime/models", (req, res) => {
  const { id, runtime } = req.params;
  if (!machines.has(id)) {
    return res.status(404).json({ error: "machine_not_found" });
  }
  let targetWs = null;
  for (const dws of daemonConnections) {
    if (dws.readyState === 1 && dws._machineId === id) { targetWs = dws; break; }
  }
  if (!targetWs) {
    return res.status(502).json({ error: "daemon_not_connected" });
  }
  const requestId = uuidv4();
  const timeout = new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingRuntimeModelRequests.delete(requestId);
      resolve({ models: [], default: null, error: "timeout" });
    }, 5000);
    pendingRuntimeModelRequests.set(requestId, {
      resolve: (value) => resolve(value),
      timer,
    });
  });
  try {
    targetWs.send(JSON.stringify({ type: "machine:runtime_models:detect", runtime, requestId }));
  } catch (e) {
    const pending = pendingRuntimeModelRequests.get(requestId);
    if (pending) {
      clearTimeout(pending.timer);
      pendingRuntimeModelRequests.delete(requestId);
    }
    return res.status(502).json({ error: "send_failed", message: e.message });
  }
  timeout.then((result) => {
    res.json({ models: result.models, default: result.default, error: result.error });
  });
});

// Get agents (running + configs)
app.get("/api/agents", (req, res) => {
  const agents = Object.keys(store.agents).map((id) => agentPayload(id));
  res.json({ agents, configs: agentConfigs });
});

// Get recent activity entries for an agent (used by the Activity tab).
app.get("/api/agents/:id/activities", async (req, res) => {
  const agentId = req.params.id;
  if (!hasKnownAgentConfig(agentId)) {
    return res.status(404).json({ error: "unknown agent" });
  }
  const rawLimit = parseInt(req.query.limit, 10);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 100) : 100;
  try {
    const entries = await db.loadAgentActivities(agentId, limit);
    res.json({ entries });
  } catch (e) {
    console.error(`[api] /api/agents/${agentId}/activities error:`, e.message);
    res.status(500).json({ error: "failed to load activities" });
  }
});

// ─── Agent config CRUD ───────────────────────────────────────────

// List all agent configs
app.get("/api/agent-configs", (req, res) => {
  res.json({ configs: agentConfigs });
});

// Mirror config fields that also live on the runtime agent record. Without
// this, edits land in agentConfigs (and Supabase) but the live `store.agents`
// keeps the old values until the next server restart — so the sidebar / detail
// header keep showing the pre-rename name even though the user clicked SAVE.
function syncRuntimeAgentFromConfig(id, config) {
  const a = store.agents[id];
  if (!a) return false;
  let changed = false;
  if (config.name !== undefined && config.name !== a.name) { a.name = config.name; changed = true; }
  if (config.displayName !== undefined && config.displayName !== a.displayName) { a.displayName = config.displayName; changed = true; }
  if (config.runtime !== undefined && config.runtime !== a.runtime) { a.runtime = config.runtime; changed = true; }
  if (config.model !== undefined && config.model !== a.model) { a.model = config.model; changed = true; }
  if (config.workDir !== undefined && config.workDir !== a.workDir) { a.workDir = config.workDir; changed = true; }
  return changed;
}

// Create/save agent config
app.post("/api/agent-configs", requireAuth, (req, res) => {
  const config = req.body;
  if (!config.id) config.id = `agent-${uuidv4().substring(0, 8)}`;
  const existing = agentConfigs.findIndex((c) => c.id === config.id);
  if (existing >= 0) {
    // machineId is immutable — never let the payload overwrite the stored value.
    const { machineId: _ignored, ...rest } = config;
    agentConfigs[existing] = { ...agentConfigs[existing], ...rest };
  } else {
    if (!config.machineId) return res.status(400).json({ error: "machineId is required" });
    if (!isPersistentMachineId(config.machineId)) return res.status(400).json({ error: "machineId does not match any machine key" });
    agentConfigs.push(config);
  }
  const saved = agentConfigs.find((c) => c.id === config.id);
  saveAgentConfigs(agentConfigs);
  db.saveAgentConfig(saved);
  if (syncRuntimeAgentFromConfig(saved.id, saved)) {
    broadcastToWeb({ type: "agent_started", agent: agentPayload(saved.id) });
  }
  broadcastToWeb({ type: "config_updated", configs: agentConfigs });
  res.json({ config: saved });
});

// Update agent config (upsert: creates config from running agent if none exists)
app.put("/api/agents/:id/config", requireAuth, (req, res) => {
  const { id } = req.params;
  const updates = req.body;
  let idx = agentConfigs.findIndex((c) => c.id === id);
  if (idx < 0) {
    const running = store.agents[id];
    if (!running) return res.status(404).json({ error: "Agent not found" });
    if (!running.machineId) return res.status(400).json({ error: "Running agent has no machineId" });
    agentConfigs.push({
      id,
      name: running.name,
      displayName: running.displayName,
      runtime: running.runtime,
      model: running.model,
      workDir: running.workDir,
      machineId: running.machineId,
    });
    idx = agentConfigs.length - 1;
  }
  // machineId is immutable — never let the payload overwrite the stored value.
  const { machineId: _ignored, ...rest } = updates;
  agentConfigs[idx] = { ...agentConfigs[idx], ...rest };
  // description is the system prompt — keep them in sync
  if (updates.description !== undefined && updates.systemPrompt === undefined) {
    agentConfigs[idx].systemPrompt = updates.description;
  }
  saveAgentConfigs(agentConfigs);
  db.saveAgentConfig(agentConfigs[idx]);
  if (syncRuntimeAgentFromConfig(id, agentConfigs[idx])) {
    broadcastToWeb({ type: "agent_started", agent: agentPayload(id) });
  }
  broadcastToWeb({ type: "config_updated", configs: agentConfigs });
  res.json({ config: agentConfigs[idx] });
});

// Delete agent config
app.delete("/api/agents/:id", requireAuth, (req, res) => {
  const { id } = req.params;
  sendAgentStop(id);
  const idx = agentConfigs.findIndex((c) => c.id === id);
  if (idx >= 0) {
    agentConfigs.splice(idx, 1);
    saveAgentConfigs(agentConfigs);
    db.deleteAgentConfig(id);
  }
  purgeAgentMemberships(id);
  purgeUnknownAgentState(id);
  broadcastToWeb({ type: "agent_status", agentId: id, status: "deleted" });
  broadcastToWeb({ type: "config_updated", configs: agentConfigs });
  res.json({ success: true });
});

// ─── Profile preset pool ────────────────────────────────────────

app.get("/api/agent-profile-presets", (req, res) => {
  res.json({ presets: profilePresets.list(), max: PROFILE_PRESET_MAX });
});

app.post("/api/agent-profile-presets", requireAuth, async (req, res) => {
  const { image } = req.body || {};
  const result = await profilePresets.add(image);
  if (result.error) return res.status(400).json({ error: result.error });
  res.json({ preset: result.preset, count: profilePresets.count(), max: PROFILE_PRESET_MAX });
});

app.delete("/api/agent-profile-presets/:id", requireAuth, async (req, res) => {
  const result = await profilePresets.remove(req.params.id);
  if (result.error) return res.status(404).json({ error: result.error });
  res.json({ success: true, count: profilePresets.count(), max: PROFILE_PRESET_MAX });
});

// ─── Machine API key management ─────────────────────────────────

// List machine API keys (masked)
app.get("/api/machine-keys", requireAuth, (req, res) => {
  const keys = machineKeys
    .filter((k) => !k.revokedAt)
    .map((k) => ({
      id: k.id,
      name: k.name,
      keyPrefix: k.rawKey.substring(0, 18),
      createdAt: k.createdAt,
      lastUsedAt: k.lastUsedAt,
    }));
  res.json({ keys });
});

// Generate a new machine API key
app.post("/api/machine-keys", requireAuth, async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: "Name is required" });

  const rawKey = generateApiKey();
  const keyRecord = {
    id: `mk-${uuidv4().substring(0, 8)}`,
    name,
    rawKey,
    createdAt: now(),
    lastUsedAt: null,
    revokedAt: null,
    boundFingerprint: null,
  };
  machineKeys.push(keyRecord);
  saveMachineKeys(machineKeys);
  await db.saveMachineKey(keyRecord);
  console.log(`[keys] Generated machine key "${name}" (${rawKey.substring(0, 18)}...)`);

  res.json({
    key: {
      id: keyRecord.id,
      name: keyRecord.name,
      keyPrefix: rawKey.substring(0, 18),
      createdAt: keyRecord.createdAt,
      lastUsedAt: keyRecord.lastUsedAt,
    },
    rawKey,
  });
});

// Delete a machine API key — cascades to agent_configs bound to this machine.
app.delete("/api/machine-keys/:id", requireAuth, async (req, res) => {
  const { id } = req.params;
  const idx = machineKeys.findIndex((k) => k.id === id);
  if (idx < 0) return res.status(404).json({ error: "Key not found" });
  const key = machineKeys[idx];

  // Cascade: collect agents bound to this machine, stop them, purge state.
  const orphanedAgentIds = agentConfigs
    .filter((c) => c.machineId === id)
    .map((c) => c.id);
  for (const agentId of orphanedAgentIds) {
    sendAgentStop(agentId);
    purgeUnknownAgentState(agentId);
    broadcastToWeb({ type: "agent_status", agentId, status: "deleted" });
  }
  for (let i = agentConfigs.length - 1; i >= 0; i--) {
    if (agentConfigs[i].machineId === id) agentConfigs.splice(i, 1);
  }
  saveAgentConfigs(agentConfigs);

  // Remove the key itself. The DB has ON DELETE CASCADE, so agent_configs
  // rows in Postgres are removed by the FK — we don't need deleteAgentConfig.
  machineKeys.splice(idx, 1);
  saveMachineKeys(machineKeys);
  await db.deleteMachineKey(id);

  // Drop any live daemon connection authenticated with this key.
  for (const dws of daemonConnections) {
    if (dws._machineId === id) {
      try { dws.close(1008, "machine key deleted"); } catch {}
    }
  }
  machines.delete(id);
  broadcastToWeb({ type: "machine:disconnected", machineId: id });
  broadcastToWeb({ type: "config_updated", configs: agentConfigs });
  console.log(`[keys] Deleted machine key "${key.name}" (cascaded ${orphanedAgentIds.length} agent config(s))`);
  res.json({ success: true });
});

// ─── Agent lifecycle ─────────────────────────────────────────────

function startAgentOnDaemon(id, config) {
  const runtime = config.runtime || "claude";
  const requestedMachineId = typeof config.machineId === "string" && config.machineId.trim()
    ? config.machineId.trim()
    : undefined;
  const requestedWorkDir = typeof config.workDir === "string" && config.workDir.trim()
    ? config.workDir.trim()
    : undefined;

  // Never spill a machine-pinned agent onto another host. That switches the
  // workspace underneath the server's saved config.
  let targetWs = null;
  if (requestedMachineId) {
    for (const ws of daemonConnections) {
      if (ws.readyState === 1 && ws._machineId === requestedMachineId) {
        targetWs = ws;
        break;
      }
    }
    if (!targetWs) {
      return { error: `Requested machine ${requestedMachineId} is not connected` };
    }
    if (!targetWs._runtimes?.includes(runtime)) {
      return { error: `Requested machine ${requestedMachineId} does not support runtime ${runtime}` };
    }
  } else {
    for (const ws of daemonConnections) {
      if (ws.readyState === 1 && ws._runtimes?.includes(runtime)) {
        targetWs = ws;
        break;
      }
    }
  }
  if (!targetWs) return { error: "No daemon connected with the requested runtime" };

  // Register agent in store — buildRuntimeAgent reads from agentConfigs first,
  // then falls back to the request payload for fields not yet persisted.
  store.agents[id] = buildRuntimeAgent(id, {
    runtime,
    model: config.model,
    workDir: requestedWorkDir,
    status: "starting",
    machineId: targetWs._machineId,
  });

  const daemonConfig = {
    runtime,
    model: config.model,
    systemPrompt: config.systemPrompt || config.description || "",
    serverUrl: PUBLIC_URL,
    authToken: "test",
    name: config.name || id,
    displayName: config.displayName || config.name || id,
    description: config.description || "",
  };
  if (requestedWorkDir) daemonConfig.workDir = requestedWorkDir;

  // Send agent:start to daemon — read from config (source of truth),
  // not store.agents (which may have fallback values).
  targetWs.send(JSON.stringify({
    type: "agent:start",
    agentId: id,
    launchId: uuidv4(),
    config: daemonConfig,
  }));

  daemonSockets.set(id, targetWs);

  // Upsert into agentConfigs BEFORE broadcasting so that agentPayload()
  // can overlay the authoritative config onto the runtime entry.
  const existingIdx = agentConfigs.findIndex((c) => c.id === id);
  if (existingIdx < 0) {
    const persisted = {
      id,
      name: config.name || id,
      displayName: config.displayName || config.name || id,
      description: config.description || "",
      systemPrompt: config.systemPrompt || config.description || "",
      runtime,
      model: config.model,
      machineId: targetWs._machineId,
      autoStart: true,
    };
    if (requestedWorkDir) persisted.workDir = requestedWorkDir;
    const usedImages = new Set(agentConfigs.map((c) => c.picture).filter(Boolean));
    const shardedPicture = profilePresets.pickForAgent(id, usedImages);
    if (shardedPicture) persisted.picture = shardedPicture;
    agentConfigs.push(persisted);
    saveAgentConfigs(agentConfigs);
    db.saveAgentConfig(persisted);
    // New agent → subscribe to every regular (non-DM) channel so the legacy
    // "visible everywhere by default" behavior is preserved. Humans can
    // unsubscribe via the /subscriptions API.
    seedAgentIntoRegularChannels(id);
  }
  // Existing configs: machineId is immutable — no rewrite on restart.

  broadcastToWeb({ type: "agent_started", agent: agentPayload(id) });
  broadcastToWeb({ type: "config_updated", configs: agentConfigs });
  console.log(`[api] Starting agent ${id} (runtime: ${runtime}) on daemon`);
  return { agentId: id, status: "starting" };
}

// Start an agent
app.post("/api/agents/start", requireAuth, (req, res) => {
  const config = req.body;
  const id = config.agentId || config.id || `agent-${uuidv4().substring(0, 8)}`;

  // If starting from a saved config, look it up. machineId on a saved config
  // is immutable, so the request body's machineId is ignored when one exists.
  const savedConfig = agentConfigs.find((c) => c.id === id);
  const mergedConfig = { ...savedConfig, ...config };
  if (savedConfig?.machineId) mergedConfig.machineId = savedConfig.machineId;

  if (store.agents[id] && store.agents[id].status === "active") {
    return res.status(400).json({ error: `Agent ${id} is already running` });
  }

  const result = startAgentOnDaemon(id, mergedConfig);
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

// Stop an agent
app.post("/api/agents/:id/stop", requireAuth, (req, res) => {
  const { id } = req.params;
  const ws = daemonSockets.get(id);
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({ type: "agent:stop", agentId: id }));
  }
  if (store.agents[id]) {
    store.agents[id].status = "stopping";
    broadcastToWeb({ type: "agent_status", agentId: id, status: "stopping" });
  }
  console.log(`[api] Stopping agent ${id}`);
  res.json({ success: true });
});

// Reset an agent's conversation context: SIGTERM the running process, wait for
// it to exit, then cold-start with a null session_id. Workspace is preserved.
app.post("/api/agents/:id/reset-context", requireAuth, async (req, res) => {
  const { id } = req.params;
  const savedConfig = agentConfigs.find((c) => c.id === id);
  if (!savedConfig) return res.status(404).json({ error: "agent not found" });

  const ws = daemonSockets.get(id);
  const isActive = store.agents[id]?.status === "active";

  if (isActive && ws && ws.readyState === 1) {
    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        pendingContextResets.delete(id);
        resolve();
      }, 3000);
      pendingContextResets.set(id, () => {
        clearTimeout(timer);
        resolve();
      });
      ws.send(JSON.stringify({ type: "agent:stop", agentId: id }));
      if (store.agents[id]) {
        store.agents[id].status = "stopping";
        broadcastToWeb({ type: "agent_status", agentId: id, status: "stopping" });
      }
    });
  }

  const result = startAgentOnDaemon(id, savedConfig);
  if (result.error) return res.status(400).json(result);
  console.log(`[api] Context reset for agent ${id}`);
  res.json({ success: true });
});

// Start all auto-start agents (called when daemon connects)
function autoStartAgents() {
  const autoStart = agentConfigs.filter((c) => c.autoStart);
  for (const config of autoStart) {
    if (store.agents[config.id]?.status === "active") continue;
    const result = startAgentOnDaemon(config.id, config);
    if (result.error) {
      const agentName = config.displayName || config.name || config.id;
      console.log(`[auto-start] Failed to start ${agentName} (${config.id}): ${result.error}`);
    }
  }
}

// ─── HTTP Server + WebSocket ──────────────────────────────────────

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (request, socket, head) => {
  const parsed = new URL(request.url, `http://${request.headers.host}`);

  if (parsed.pathname === "/daemon/connect") {
    // Daemon WebSocket connection — validate API key
    const apiKey = parsed.searchParams.get("key");
    if (!validateApiKey(apiKey)) {
      console.log(`[daemon] Rejected connection: invalid API key (${apiKey?.substring(0, 12)}...) from ${request.socket.remoteAddress}:${request.socket.remotePort}`);
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }
    // Track key usage
    const keyRecord = machineKeys.find((k) => k.rawKey === apiKey);
    if (keyRecord) {
      keyRecord.lastUsedAt = now();
      saveMachineKeys(machineKeys);
      db.saveMachineKey(keyRecord);
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      handleDaemonConnection(ws, apiKey);
    });
  } else if (parsed.pathname === "/ws") {
    // Web UI WebSocket connection — check optional auth token
    const wsToken = parsed.searchParams.get("token");
    const remoteIp = (request.headers["x-forwarded-for"] || "").toString().split(",")[0].trim()
      || request.socket.remoteAddress
      || null;
    // Reject upgrades that present a token the server doesn't know. Without
    // this gate, a stale tab whose session was revoked/logged-out keeps
    // hammering the server and the upgrade succeeds as a "guest" — same
    // expensive init payload, just under a different label. Outright reject
    // and escalate to a 24h block after a few strikes.
    if (wsToken && !authSessions.has(wsToken)) {
      const entry = recordInvalidTokenAttempt(wsToken, remoteIp);
      const blocked = entry.blockedUntil > Date.now();
      const reason = (blocked ? entry.blockReason : "invalid or expired token").replace(/[\r\n]/g, " ").slice(0, 120);
      socket.write(
        `HTTP/1.1 ${blocked ? "429 Too Many Requests" : "401 Unauthorized"}\r\n` +
        "Connection: close\r\n" +
        `X-Block-Reason: ${reason}\r\n` +
        "Content-Length: 0\r\n\r\n"
      );
      socket.destroy();
      return;
    }
    const wsAuthenticated = !!wsToken; // implied: token present AND in authSessions
    // Defend the event loop: a runaway client (stale tab, buggy reconnect)
    // can saturate the single replica with init-payload work. Rate-limit by
    // token; fall back to remote IP for guests.
    const trackerToken = wsAuthenticated ? wsToken : null;
    const decision = recordWsConnectAttempt(trackerToken, remoteIp);
    if (!decision.allow) {
      const reason = decision.reason.replace(/[\r\n]/g, " ").slice(0, 120);
      socket.write(
        "HTTP/1.1 429 Too Many Requests\r\n" +
        "Connection: close\r\n" +
        `X-Block-Reason: ${reason}\r\n` +
        "Content-Length: 0\r\n\r\n"
      );
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      ws._trackerEntry = decision.entry;
      handleWebConnection(ws, wsAuthenticated, wsToken || null);
    });
  } else {
    socket.destroy();
  }
});

function handleDaemonConnection(ws, apiKey) {
  console.log(`[daemon] Connected with key: ${apiKey?.substring(0, 8)}...`);
  let connectedAgents = new Set();
  daemonConnections.add(ws);
  ws._apiKey = apiKey;
  ws._runtimes = []; // store runtimes reported by this daemon
  ws._capabilities = [];
  const keyRecord = findMachineKeyRecord(apiKey);
  const machineId = resolveDaemonMachineId(apiKey);
  ws._machineId = machineId;
  const existingMachine = machines.get(machineId);
  const machineRecord = {
    id: machineId,
    alias: keyRecord?.name || existingMachine?.alias,
    hostname: existingMachine?.hostname || 'unknown',
    os: existingMachine?.os || 'unknown',
    runtimes: existingMachine?.runtimes || [],
    capabilities: existingMachine?.capabilities || [],
    connectedAt: now(),
    agentIds: [],
  };
  machines.set(machineId, machineRecord);
  broadcastToWeb({ type: existingMachine ? 'machine:updated' : 'machine:connected', machine: machineRecord });

  ws.on("message", (data) => {
    try {
      const msg = JSON.parse(data);
      handleDaemonMessage(ws, msg, connectedAgents);
    } catch (e) {
      console.error("[daemon] Invalid message:", e.message);
    }
  });

  ws.on("close", () => {
    console.log("[daemon] Disconnected");
    daemonConnections.delete(ws);
    const replacementConnected = Array.from(daemonConnections).some((otherWs) => (
      otherWs.readyState === 1 && otherWs._machineId === ws._machineId
    ));
    if (!replacementConnected) {
      machines.delete(ws._machineId);
      broadcastToWeb({ type: 'machine:disconnected', machineId: ws._machineId });
    }
    for (const agentId of connectedAgents) {
      if (daemonSockets.get(agentId) !== ws) continue;
      if (store.agents[agentId]) {
        store.agents[agentId].status = "inactive";
        daemonSockets.delete(agentId);
        broadcastToWeb({ type: "agent_status", agentId, status: "inactive" });
      }
    }
  });

  // Application-level keepalive. Cellular NAT gateways drop idle TCP mappings
  // in as little as 30 s, and Cloudflare's WebSocket idle timeout is 100 s.
  // Without a regular frame the connection goes stale — the client's inbound
  // watchdog (web/src/lib/ws.ts, INBOUND_WATCHDOG_MS) relies on these pings to
  // know the socket is still alive. Interval must be < watchdog / 2.
  const pingInterval = setInterval(() => {
    if (ws.readyState === 1) {
      ws.send(JSON.stringify({ type: "ping" }));
    }
  }, 30000);
  ws.on("close", () => clearInterval(pingInterval));
}

// Per-agent serialization for save-then-broadcast of activity frames.
// Ensures: (1) the DB write commits before the live WS broadcast, so a client
// that fetches history via HTTP after receiving the WS event will see that
// entry in the fetch result; (2) frames from the same agent broadcast in
// arrival order even when awaits vary.
const activityChains = new Map();
function enqueueActivity(agentId, task) {
  const prev = activityChains.get(agentId) || Promise.resolve();
  const next = prev.catch(() => {}).then(task);
  activityChains.set(agentId, next);
  next.finally(() => {
    if (activityChains.get(agentId) === next) activityChains.delete(agentId);
  });
}

function handleDaemonMessage(ws, msg, connectedAgents) {
  switch (msg.type) {
    case "ready": {
      console.log(`[daemon] Ready. Runtimes: ${msg.runtimes?.join(", ")}. Agents: ${msg.runningAgents?.join(", ") || "none"}`);
      ws._runtimes = msg.runtimes || [];
      ws._capabilities = msg.capabilities || [];
      // Update machine record with real info from daemon
      const machine = machines.get(ws._machineId);
      if (machine) {
        const keyRecord = findMachineKeyRecord(ws._apiKey);
        if (keyRecord?.name) machine.alias = keyRecord.name;
        machine.hostname = msg.hostname || 'unknown';
        machine.os = msg.os || 'unknown';
        machine.runtimes = msg.runtimes || [];
        machine.capabilities = msg.capabilities || [];
        broadcastToWeb({ type: 'machine:updated', machine });
      }
      // Machine binding: silently bind or reject based on hostname:os fingerprint
      if (!isDebugKey(ws._apiKey)) {
        const keyRecord = findMachineKeyRecord(ws._apiKey);
        if (keyRecord) {
          const fingerprint = computeMachineFingerprint(msg.hostname, msg.os);
          if (!keyRecord.boundFingerprint) {
            // First-time bind: record the fingerprint
            keyRecord.boundFingerprint = fingerprint;
            saveMachineKeys(machineKeys);
            db.saveMachineKey(keyRecord);
            console.log(`[daemon] Key "${keyRecord.name}" bound to machine fingerprint ${fingerprint.substring(0, 12)}...`);
          } else if (keyRecord.boundFingerprint !== fingerprint) {
            // Fingerprint mismatch: reject silently
            console.log(`[daemon] Key "${keyRecord.name}" rejected — fingerprint mismatch (expected ${keyRecord.boundFingerprint.substring(0, 12)}..., got ${fingerprint.substring(0, 12)}...)`);
            ws.close(1008, 'machine binding mismatch');
            return;
          }
        }
      }
      // Auto-start configured agents after a short delay
      setTimeout(() => autoStartAgents(), 1000);
      // Register any running agents
      if (msg.runningAgents) {
        for (const agentId of msg.runningAgents) {
          if (!hasKnownAgentConfig(agentId)) {
            purgeUnknownAgentState(agentId);
            sendAgentStop(agentId, ws, { broadcast: false });
            continue;
          }
          const affinity = evaluateAgentMachineAffinity(agentId, ws);
          if (!affinity.allowed) {
            console.log(`[agent:${agentId}] Rejecting daemon adoption from machine ${ws._machineId}; expected ${affinity.expectedMachineId}`);
            sendAgentStop(agentId, ws, { broadcast: false });
            continue;
          }
          connectedAgents.add(agentId);
          daemonSockets.set(agentId, ws);
          const isNew = !store.agents[agentId];
          if (isNew) {
            store.agents[agentId] = buildRuntimeAgent(agentId, { status: "active", machineId: ws._machineId });
          } else {
            // Refresh config fields on existing agents — they may still
            // have stale/fallback values from before configs were loaded.
            const cfg = agentConfigs.find((c) => c.id === agentId);
            if (cfg) syncRuntimeAgentFromConfig(agentId, cfg);
          }
          store.agents[agentId].status = "active";
          store.agents[agentId].machineId = ws._machineId;
          // Track agent in machine record (mirrors "agent:status" handler)
          const readyMachine = machines.get(ws._machineId);
          if (readyMachine && !readyMachine.agentIds.includes(agentId)) {
            readyMachine.agentIds.push(agentId);
          }
          broadcastToWeb({ type: "agent_started", agent: agentPayload(agentId) });
          hydrateAgentContextUsage(agentId);
          replayPendingDeliveries(agentId);
        }
      }
      break;
    }
    case "agent:status": {
      const { agentId, status } = msg;
      if (!hasKnownAgentConfig(agentId)) {
        purgeUnknownAgentState(agentId);
        sendAgentStop(agentId, ws, { broadcast: false });
        break;
      }
      const affinity = evaluateAgentMachineAffinity(agentId, ws);
      if (!affinity.allowed) {
        console.log(`[agent:${agentId}] Ignoring status from machine ${ws._machineId}; expected ${affinity.expectedMachineId}`);
        sendAgentStop(agentId, ws, { broadcast: false });
        break;
      }
      const isNew = !store.agents[agentId];
      const wasActive = !isNew && store.agents[agentId].status === "active";
      if (isNew) {
        store.agents[agentId] = buildRuntimeAgent(agentId, {
          status,
          machineId: ws._machineId,
        });
      } else {
        const cfg = agentConfigs.find((c) => c.id === agentId);
        if (cfg) syncRuntimeAgentFromConfig(agentId, cfg);
      }
      connectedAgents.add(agentId);
      daemonSockets.set(agentId, ws);
      store.agents[agentId].status = status;
      store.agents[agentId].machineId = ws._machineId;
      const workDirChanged = updateAgentWorkDir(agentId, msg.workDir);
      // Track agent in machine record
      const machine = machines.get(ws._machineId);
      if (machine && !machine.agentIds.includes(agentId)) {
        machine.agentIds.push(agentId);
      }
      if (isNew) {
        broadcastToWeb({ type: "agent_started", agent: agentPayload(agentId) });
      } else {
        broadcastToWeb({ type: "agent_status", agentId, status });
        if (workDirChanged) {
          broadcastToWeb({ type: "agent_started", agent: agentPayload(agentId) });
          broadcastToWeb({ type: "config_updated", configs: agentConfigs });
        }
      }
      if (status === "active") hydrateAgentContextUsage(agentId);
      if (status === "active") {
        replayPendingDeliveries(agentId);
        if (!wasActive) {
          db.trimAgentActivities(agentId).catch((e) =>
            console.error(`[db] trimAgentActivities(${agentId}) failed:`, e.message)
          );
        }
      }
      if (status === "inactive") {
        const resolver = pendingContextResets.get(agentId);
        if (resolver) {
          pendingContextResets.delete(agentId);
          resolver();
        }
      }
      console.log(`[agent:${agentId}] Status: ${status}`);
      break;
    }
    case "agent:activity": {
      const { agentId, activity, detail, entries, contextUsage } = msg;
      if (!hasKnownAgentConfig(agentId)) {
        purgeUnknownAgentState(agentId);
        sendAgentStop(agentId, ws, { broadcast: false });
        break;
      }
      const ownerWs = daemonSockets.get(agentId);
      if (ownerWs && ownerWs !== ws) {
        console.log(`[agent:${agentId}] Ignoring activity from stale daemon connection on machine ${ws._machineId}`);
        break;
      }
      enqueueActivity(agentId, async () => {
        if (store.agents[agentId]) {
          store.agents[agentId].activity = activity;
          store.agents[agentId].activityDetail = detail;
          if (contextUsage) {
            store.agents[agentId].contextUsage = contextUsage;
          }
        }
        if (Array.isArray(entries) && entries.length > 0) {
          try {
            await db.saveActivityEntries(agentId, activity, detail, entries);
          } catch (e) {
            console.error(`[db] saveActivityEntries(${agentId}) failed:`, e.message);
          }
        }
        broadcastToWeb({ type: "agent_activity", agentId, activity, detail, entries, contextUsage });
      });
      break;
    }
    case "agent:session": {
      const { agentId, sessionId } = msg;
      if (!hasKnownAgentConfig(agentId)) {
        purgeUnknownAgentState(agentId);
        sendAgentStop(agentId, ws, { broadcast: false });
        break;
      }
      const ownerWs = daemonSockets.get(agentId);
      if (ownerWs && ownerWs !== ws) {
        console.log(`[agent:${agentId}] Ignoring session update from stale daemon connection on machine ${ws._machineId}`);
        break;
      }
      if (store.agents[agentId]) {
        store.agents[agentId].sessionId = sessionId;
      }
      console.log(`[agent:${agentId}] Session: ${sessionId?.substring(0, 8)}...`);
      break;
    }
    case "agent:deliver:ack": {
      // Acknowledged delivery, no-op
      break;
    }
    case "agent:workspace:file_tree": {
      const ownerWs = daemonSockets.get(msg.agentId);
      if (ownerWs && ownerWs !== ws) {
        console.log(`[agent:${msg.agentId}] Ignoring workspace tree from stale daemon connection on machine ${ws._machineId}`);
        break;
      }
      const workDirChanged = updateAgentWorkDir(msg.agentId, msg.workDir);
      // Forward to web UI
      broadcastToWeb({
        type: "workspace:file_tree",
        agentId: msg.agentId,
        dirPath: msg.dirPath || "",
        workDir: msg.workDir,
        files: msg.files,
      });
      if (workDirChanged) {
        broadcastToWeb({ type: "agent_started", agent: agentPayload(msg.agentId) });
        broadcastToWeb({ type: "config_updated", configs: agentConfigs });
      }
      break;
    }
    case "agent:workspace:file_content": {
      const ownerWs = daemonSockets.get(msg.agentId);
      if (ownerWs && ownerWs !== ws) {
        console.log(`[agent:${msg.agentId}] Ignoring workspace file content from stale daemon connection on machine ${ws._machineId}`);
        break;
      }
      broadcastToWeb({ type: "workspace:file_content", agentId: msg.agentId, requestId: msg.requestId, content: msg.content });
      break;
    }
    case "agent:memory:list_result": {
      broadcastToWeb({ type: "memory:list_result", agentId: msg.agentId, uri: msg.uri, entries: msg.entries, error: msg.error });
      break;
    }
    case "agent:memory:content": {
      broadcastToWeb({ type: "memory:content", agentId: msg.agentId, requestId: msg.requestId, uri: msg.uri, content: msg.content, error: msg.error });
      break;
    }
    case "agent:skills:list_result": {
      const ownerWs = daemonSockets.get(msg.agentId);
      if (ownerWs && ownerWs !== ws) {
        console.log(`[agent:${msg.agentId}] Ignoring skills result from stale daemon connection on machine ${ws._machineId}`);
        break;
      }
      broadcastToWeb({ type: "skills:list_result", agentId: msg.agentId, global: msg.global, workspace: msg.workspace });
      break;
    }
    case "machine:workspace:scan_result": {
      broadcastToWeb({ type: "machine:workspace:scan_result", machineId: ws._machineId, directories: msg.directories });
      break;
    }
    case "machine:workspace:delete_result": {
      broadcastToWeb({ type: "machine:workspace:delete_result", machineId: ws._machineId, directoryName: msg.directoryName, success: msg.success });
      break;
    }
    case "machine:runtime_models:result": {
      const pending = pendingRuntimeModelRequests.get(msg.requestId);
      if (pending) {
        clearTimeout(pending.timer);
        pendingRuntimeModelRequests.delete(msg.requestId);
        pending.resolve({
          models: Array.isArray(msg.models) ? msg.models : [],
          default: typeof msg.default === "string" ? msg.default : null,
          error: typeof msg.error === "string" ? msg.error : null,
        });
      }
      break;
    }
    case "pong": {
      // Heartbeat response, no-op
      break;
    }
    default: {
      console.log(`[daemon] Unknown message type: ${msg.type}`);
    }
  }
}

// WS message types that require authentication (write operations)
const WS_AUTH_REQUIRED_TYPES = new Set([
  "agent:start",
  "agent:stop",
  "machine:workspace:delete",
  "machine:workspace:scan",
]);

function handleWebConnection(ws, authenticated, token = null) {
  ws._authenticated = !!authenticated;
  ws._authToken = token;
  // Seed from the auth session so DM broadcasts can be filtered immediately;
  // setWebPresence() will overwrite this with the canonical presence identity.
  ws._humanName = token ? (authSessions.get(token)?.name || null) : null;
  ws._human = null;
  webSockets.add(ws);
  console.log(`[web] Client connected (authenticated: ${ws._authenticated})`);

  // Defer the init send so a burst of reconnects doesn't monopolize one tick.
  // The init payload is large (channels + agents + humans + configs + machines
  // + presets) and JSON.stringify is sync; spreading sends across ticks lets
  // unrelated HTTP requests interleave instead of queuing behind a burst.
  setImmediate(() => {
    if (ws.readyState !== 1) return;
    try {
      ws.send(JSON.stringify({
        type: "init",
        channels: store.channels.filter((ch) => (ch.type || "channel") === "channel"),
        agents: Object.keys(store.agents).map((id) => agentPayload(id)),
        humans: currentHumans(),
        configs: agentConfigs,
        machines: Array.from(machines.values()),
        profilePresets: profilePresets.list(),
      }));
    } catch (e) {
      console.warn("[web] init send failed:", e.message);
    }
  });

  ws.on("message", (data) => {
    try {
      const msg = JSON.parse(data);
      handleWebMessage(ws, msg);
    } catch (e) {
      console.error("[web] Invalid message:", e.message);
    }
  });

  ws.on("close", () => {
    if (ws._humanName) removeHumanPresence(ws._humanName);
    webSockets.delete(ws);
    recordWsDisconnect(ws._trackerEntry);
    console.log("[web] Client disconnected");
  });

  const pingInterval = setInterval(() => {
    if (ws.readyState === 1) {
      ws.send(JSON.stringify({ type: "ping" }));
    }
  }, 30000);
  ws.on("close", () => clearInterval(pingInterval));
}

function handleWebMessage(ws, msg) {
  // Block write-type messages from unauthenticated (guest) connections
  if (WS_AUTH_REQUIRED_TYPES.has(msg.type) && !ws._authenticated) {
    ws.send(JSON.stringify({ type: "error", message: "Authentication required. Sign in with Google to perform this action." }));
    console.log(`[web] Blocked unauthenticated WS message: ${msg.type}`);
    return;
  }

  switch (msg.type) {
    case "presence:update": {
      setWebPresence(ws, msg);
      break;
    }
    case "presence:clear": {
      setWebPresence(ws, {});
      break;
    }
    case "workspace:list": {
      const agentWs = daemonSockets.get(msg.agentId);
      if (agentWs && agentWs.readyState === 1) {
        const payload = { agentId: msg.agentId, dirPath: msg.dirPath || null };
        if (hasWorkspaceFsCapability(agentWs)) {
          agentWs.send(JSON.stringify({ type: "workspace:list", ...payload }));
        } else {
          agentWs.send(JSON.stringify({ type: "agent:workspace:list", ...payload }));
        }
      }
      break;
    }
    case "workspace:read": {
      const agentWs = daemonSockets.get(msg.agentId);
      if (agentWs && agentWs.readyState === 1) {
        const payload = { agentId: msg.agentId, requestId: msg.requestId || uuidv4(), path: msg.path };
        if (hasWorkspaceFsCapability(agentWs)) {
          agentWs.send(JSON.stringify({ type: "workspace:read", ...payload }));
        } else {
          agentWs.send(JSON.stringify({ type: "agent:workspace:read", ...payload }));
        }
      }
      break;
    }
    case "memory:list": {
      const agentWs = daemonSockets.get(msg.agentId);
      if (agentWs && agentWs.readyState === 1) {
        agentWs.send(JSON.stringify({ type: "agent:memory:list", agentId: msg.agentId, uri: msg.uri || "viking:///" }));
      }
      break;
    }
    case "memory:read": {
      const agentWs = daemonSockets.get(msg.agentId);
      if (agentWs && agentWs.readyState === 1) {
        agentWs.send(JSON.stringify({ type: "agent:memory:read", agentId: msg.agentId, requestId: msg.requestId || uuidv4(), uri: msg.uri }));
      }
      break;
    }
    case "agent:start": {
      // Trigger agent start via daemon — saved config's machineId is
      // authoritative. The payload can only pick a machine when no config
      // exists yet (first-bind for a brand-new agent).
      const savedCfg = msg.agentId ? agentConfigs.find((c) => c.id === msg.agentId) : null;
      const requestedMachineId = savedCfg?.machineId
        || (typeof msg.machineId === "string" && msg.machineId.trim()
          ? msg.machineId.trim()
          : (typeof msg.config?.machineId === "string" && msg.config.machineId.trim()
            ? msg.config.machineId.trim()
            : null));
      if (savedCfg && !savedCfg.machineId) {
        console.log(`[ws] Refusing agent:start for ${msg.agentId}: saved config has no machineId`);
        break;
      }
      let targetWs = null;
      const existing = msg.agentId ? daemonSockets.get(msg.agentId) : null;
      if (existing && existing.readyState === 1 && (!requestedMachineId || existing._machineId === requestedMachineId)) {
        targetWs = existing;
      }
      if (!targetWs) {
        for (const dws of daemonConnections) {
          if (dws.readyState !== 1) continue;
          if (requestedMachineId && dws._machineId !== requestedMachineId) continue;
          targetWs = dws;
          break;
        }
      }
      if (savedCfg && targetWs && targetWs._machineId !== savedCfg.machineId) {
        console.log(`[ws] Refusing agent:start for ${msg.agentId}: daemon ${targetWs._machineId} != bound ${savedCfg.machineId}`);
        break;
      }
      if (targetWs && targetWs.readyState === 1) {
        const agentId = msg.agentId || `agent-${uuidv4().substring(0, 8)}`;
        daemonSockets.set(agentId, targetWs);
        const config = {
          runtime: msg.config?.runtime || "claude",
          model: msg.config?.model || "sonnet",
          serverUrl: PUBLIC_URL,
          authToken: "test",
          name: agentId,
          displayName: agentId,
          ...msg.config,
        };
        targetWs.send(JSON.stringify({
          type: "agent:start",
          agentId,
          launchId: uuidv4(),
          config,
        }));
      }
      break;
    }
    case "agent:stop": {
      const agentWs = daemonSockets.get(msg.agentId);
      if (agentWs && agentWs.readyState === 1) {
        agentWs.send(JSON.stringify({ type: "agent:stop", agentId: msg.agentId }));
      }
      break;
    }
    case "skills:list": {
      const agentWs = daemonSockets.get(msg.agentId);
      if (agentWs && agentWs.readyState === 1) {
        agentWs.send(JSON.stringify({ type: "agent:skills:list", agentId: msg.agentId, runtime: msg.runtime || null }));
      }
      break;
    }
    case "machine:workspace:scan": {
      // Target a specific machine by machineId, or broadcast to all daemons
      let sent = false;
      for (const dws of daemonConnections) {
        if (dws.readyState === 1 && (!msg.machineId || dws._machineId === msg.machineId)) {
          dws.send(JSON.stringify({ type: "machine:workspace:scan" }));
          sent = true;
          if (msg.machineId) break;
        }
      }
      break;
    }
    case "machine:workspace:delete": {
      for (const dws of daemonConnections) {
        if (dws.readyState === 1 && (!msg.machineId || dws._machineId === msg.machineId)) {
          dws.send(JSON.stringify({ type: "machine:workspace:delete", directoryName: msg.directoryName }));
          if (msg.machineId) break;
        }
      }
      break;
    }
  }
}

// ─── Auth: Google OAuth ──────────────────────────────────────────

// Session store: token -> { name, email, picture }
// Persisted to data/sessions.json so sessions survive server restarts.
const authSessions = new Map();

// Load sessions from Supabase (when available) or local file fallback.
// Called at startup — must be awaited before server accepts requests.
async function loadAuthSessions() {
  if (db.enabled) {
    try {
      const rows = await db.loadSessions();
      if (rows) {
        for (const { token, user } of rows) authSessions.set(token, user);
        console.log(`[auth] Loaded ${authSessions.size} session(s) from Supabase`);
        return;
      }
    } catch (e) {
      console.warn("[auth] Supabase session load failed, falling back to disk:", e.message);
    }
  }
  // Local file fallback (local dev without Supabase)
  try {
    if (fs.existsSync(SESSIONS_FILE)) {
      const entries = JSON.parse(fs.readFileSync(SESSIONS_FILE, "utf8"));
      for (const [token, user] of entries) authSessions.set(token, user);
      console.log(`[auth] Loaded ${authSessions.size} session(s) from disk`);
    }
  } catch (e) {
    console.warn("[auth] Failed to load sessions from disk:", e.message);
  }
}

async function persistSession(token, user) {
  if (db.enabled) {
    await db.saveSession(token, user);
  } else {
    try {
      fs.writeFileSync(SESSIONS_FILE, JSON.stringify([...authSessions.entries()]), "utf8");
    } catch (e) {
      console.warn("[auth] Failed to save sessions to disk:", e.message);
    }
  }
}

async function removeSession(token) {
  if (db.enabled) {
    await db.deleteSession(token);
  } else {
    try {
      fs.writeFileSync(SESSIONS_FILE, JSON.stringify([...authSessions.entries()]), "utf8");
    } catch (e) {
      console.warn("[auth] Failed to save sessions to disk:", e.message);
    }
  }
}

app.post("/api/auth/google", async (req, res) => {
  const { credential } = req.body;
  if (!credential) return res.status(400).json({ error: "Missing credential" });
  if (!googleClient) return res.status(501).json({ error: "Google OAuth not configured (set GOOGLE_CLIENT_ID)" });

  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    if (!isEmailAllowed(payload.email)) {
      console.log(`[auth] Rejected login: ${payload.email} not in allowlist`);
      return res.status(403).json({ error: "Email not authorized to access this server." });
    }
    const sessionToken = crypto.randomBytes(32).toString("hex");
    // Use email prefix as default display name (e.g. "zaynjarvis" from "zaynjarvis@gmail.com")
    const emailPrefix = payload.email.split("@")[0];
    if (isReservedName(emailPrefix)) {
      console.log(`[auth] Rejected login: email prefix "${emailPrefix}" is reserved`);
      return res.status(403).json({ error: "Reserved username — please contact an admin." });
    }
    const grav = gravatarUrl(payload.email);
    const user = {
      name: emailPrefix,
      email: payload.email,
      picture: payload.picture || null,
      gravatarUrl: grav,
    };
    authSessions.set(sessionToken, user);
    persistSession(sessionToken, user).catch(e => console.warn("[auth] persistSession error:", e.message));

    // Surface this user in the people list immediately, even before any WS
    // connection. Lets others @-mention them while still offline.
    const changed = upsertAllTimeHuman({
      id: humanId(user.name),
      name: user.name,
      picture: user.picture || undefined,
      gravatarUrl: user.gravatarUrl || undefined,
    });
    if (changed) broadcastHumans();

    res.json({ token: sessionToken, user });
  } catch (err) {
    console.error("[auth] Google token verification failed:", err.message);
    res.status(401).json({ error: "Invalid Google credential" });
  }
});

app.get("/api/auth/me", (req, res) => {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token || !authSessions.has(token)) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  res.json({ user: authSessions.get(token) });
});

app.post("/api/auth/logout", (req, res) => {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (token) {
    authSessions.delete(token);
    removeSession(token).catch(e => console.warn("[auth] removeSession error:", e.message));
  }
  res.json({ ok: true });
});

app.put("/api/auth/profile", requireAuth, (req, res) => {
  const token = req.headers.authorization?.replace("Bearer ", "");
  const { name, picture } = req.body;
  if (!name || typeof name !== "string" || !name.trim()) {
    return res.status(400).json({ error: "name required" });
  }
  const trimmed = name.trim();
  if (isReservedName(trimmed)) {
    return res.status(400).json({ error: `"${trimmed}" is a reserved username and cannot be used.` });
  }
  const user = authSessions.get(token);
  if (!user) return res.status(401).json({ error: "Not authenticated" });
  const oldName = user.name;
  user.name = trimmed;
  // Update avatar if provided (base64 string, max ~50KB)
  if (picture !== undefined) {
    if (picture === null || picture === "") {
      user.picture = null;
    } else if (typeof picture === "string" && picture.length <= 14000) {
      user.picture = picture;
    } else {
      return res.status(400).json({ error: "picture too large (max 10KB)" });
    }
  }
  authSessions.set(token, user);
  // Ensure gravatarUrl is set if user has email
  if (!user.gravatarUrl && user.email) {
    user.gravatarUrl = gravatarUrl(user.email);
  }
  if (oldName && oldName !== trimmed) {
    if (onlineHumans.has(oldName)) {
      const previous = onlineHumans.get(oldName);
      onlineHumans.delete(oldName);
      onlineHumans.set(trimmed, {
        ...previous,
        id: humanId(trimmed),
        name: trimmed,
        picture: user.picture || undefined,
        gravatarUrl: user.gravatarUrl || undefined,
        guest: false,
      });
      for (const client of webSockets) {
        if (client._humanName === oldName) {
          client._humanName = trimmed;
          client._human = {
            id: humanId(trimmed),
            name: trimmed,
            picture: user.picture || undefined,
            gravatarUrl: user.gravatarUrl || undefined,
            guest: false,
          };
        }
      }
    }
    allTimeHumans.delete(oldName);
  } else if (onlineHumans.has(trimmed)) {
    const existing = onlineHumans.get(trimmed);
    existing.picture = user.picture || undefined;
    existing.gravatarUrl = user.gravatarUrl || undefined;
    existing.guest = false;
  }
  upsertAllTimeHuman({
    id: humanId(trimmed),
    name: trimmed,
    picture: user.picture || undefined,
    gravatarUrl: user.gravatarUrl || undefined,
  });
  broadcastHumans();
  db.saveSession(token, user).catch(e => console.warn("[auth] saveSession error:", e.message));
  res.json({ user });
});

app.get("/api/auth/config", (_req, res) => {
  res.json({ googleClientId: GOOGLE_CLIENT_ID || null, allowlistActive: allowlistActive() });
});

// Internal diagnostics: in-memory store sizes + index counts. Auth-gated so
// random visitors can't fingerprint server load, but cheap enough to curl
// when investigating "feels slow" reports.
app.get("/api/_internal/stats", requireAuth, (_req, res) => {
  let threadReplyTotal = 0;
  for (const arr of repliesByThreadId.values()) threadReplyTotal += arr.length;
  res.json({
    timestamp: now(),
    seq: store.seq,
    taskSeq: store.taskSeq,
    store: {
      messages: store.messages.length,
      messagesCap: MAX_IN_MEMORY_MESSAGES,
      channels: store.channels.length,
      tasks: store.tasks.length,
      agents: Object.keys(store.agents).length,
    },
    indexes: {
      messagesById: messagesById.size,
      messagesByShortId: messagesByShortId.size,
      threads: repliesByThreadId.size,
      threadReplies: threadReplyTotal,
    },
    sockets: {
      web: webSockets.size,
      daemon: daemonSockets.size,
      pendingDeliveryAgents: pendingDeliveries.size,
    },
  });
});

// WS connect tracker — surfaces who's hitting /ws (and how hard) so the
// operator can identify a runaway client and cut its session.
app.get("/api/_internal/ws-clients", requireAuth, (req, res) => {
  const callerToken = req.headers.authorization?.replace("Bearer ", "");
  const callerId = callerToken ? tokenFingerprint(callerToken) : null;
  const nowMs = Date.now();
  const clients = [];
  for (const entry of wsTrackers.values()) {
    pruneRecentConnects(entry, nowMs);
    let owner = null;
    if (entry.kind === "token" && entry.token) {
      owner = authSessions.get(entry.token) || null;
    }
    const blocked = entry.blockedUntil > nowMs;
    clients.push({
      id: entry.key,
      kind: entry.kind,
      ownerName: owner?.name || null,
      ownerEmail: owner?.email || null,
      ownerPicture: owner?.picture || owner?.gravatarUrl || null,
      ip: entry.ip,
      openCount: entry.openCount,
      totalConnects: entry.totalConnects,
      totalDisconnects: entry.totalDisconnects,
      totalRejections: entry.totalRejections,
      connectsLastMinute: entry.recentConnects.length,
      lastConnectAt: entry.lastConnectAt || null,
      lastDisconnectAt: entry.lastDisconnectAt || null,
      lastRejectionAt: entry.lastRejectionAt || null,
      firstSeenAt: entry.firstSeenAt,
      blockedUntil: blocked ? entry.blockedUntil : 0,
      blockReason: blocked ? entry.blockReason : null,
      manualBlock: !!entry.manualBlock,
      sessionExists: entry.kind === "token" ? authSessions.has(entry.token) : null,
    });
  }
  clients.sort((a, b) => {
    const ablk = a.blockedUntil > 0 ? 1 : 0;
    const bblk = b.blockedUntil > 0 ? 1 : 0;
    if (ablk !== bblk) return bblk - ablk;
    if (b.connectsLastMinute !== a.connectsLastMinute) return b.connectsLastMinute - a.connectsLastMinute;
    return (b.lastConnectAt || 0) - (a.lastConnectAt || 0);
  });
  res.json({
    rateWindowSeconds: WS_RATE_WINDOW_MS / 1000,
    autoBlockThreshold: WS_RATE_BLOCK_THRESHOLD,
    blockDurationSeconds: WS_BLOCK_DURATION_MS / 1000,
    revokeBlockSeconds: WS_REVOKE_BLOCK_MS / 1000,
    callerId,
    clients,
  });
});

// Revoke kills the auth session, marks the tracker manually blocked for 24h,
// and force-closes any open WS the token still has. The blocked entry stays
// visible in the list so the operator can confirm it took effect.
app.post("/api/_internal/ws-clients/:id/revoke", requireAuth, (req, res) => {
  const id = req.params.id;
  const entry = wsTrackers.get(id);
  if (!entry) return res.status(404).json({ error: "client not found" });
  const nowMs = Date.now();
  entry.blockedUntil = nowMs + WS_REVOKE_BLOCK_MS;
  entry.manualBlock = true;
  entry.blockReason = "manual revoke";
  if (entry.kind === "token" && entry.token) {
    const tokenToKill = entry.token;
    if (authSessions.has(tokenToKill)) {
      authSessions.delete(tokenToKill);
      removeSession(tokenToKill).catch(e => console.warn("[auth] removeSession error:", e.message));
    }
    let killed = 0;
    for (const ws of webSockets) {
      if (ws._authToken === tokenToKill) {
        try { ws.close(4003, "session revoked"); } catch { /* ignore */ }
        killed += 1;
      }
    }
    console.log(`[ws-tracker] manual revoke ${id} — killed ${killed} open socket(s)`);
  }
  res.json({ ok: true, blockedUntil: entry.blockedUntil });
});

// Lift a manual block. Useful if the operator changes their mind, or to
// re-enable an IP entry that auto-blocked. Does NOT restore a deleted session.
app.post("/api/_internal/ws-clients/:id/unblock", requireAuth, (req, res) => {
  const id = req.params.id;
  const entry = wsTrackers.get(id);
  if (!entry) return res.status(404).json({ error: "client not found" });
  entry.blockedUntil = 0;
  entry.manualBlock = false;
  entry.blockReason = null;
  entry.recentConnects = [];
  res.json({ ok: true });
});

// ─── Settings: email allowlist (admin UI for the DB source) ──────
// Any authenticated user may view and edit the allowlist. Entries seeded from
// the ALLOW env are read-only here (listed with source="env") — editing them
// requires a server restart. DB entries are mutable.

app.get("/api/settings/allowlist", requireAuth, (_req, res) => {
  const env = [...ENV_ALLOW_EMAILS].map((email) => ({ email, source: "env" }));
  const dbList = [...dbAllowEmails.entries()].map(([email, meta]) => ({
    email,
    source: "db",
    addedAt: meta.addedAt,
    addedBy: meta.addedBy || null,
  }));
  res.json({
    env,
    db: dbList,
    allowlistActive: allowlistActive(),
    dbWritable: db.enabled,
  });
});

app.post("/api/settings/allowlist", requireAuth, async (req, res) => {
  if (!db.enabled) {
    return res.status(501).json({ error: "Database not configured — cannot persist allowlist entries. Use the ALLOW env var instead." });
  }
  const normalized = normalizeEmailInput(req.body?.email);
  if (!normalized) {
    return res.status(400).json({ error: "Invalid email address" });
  }
  const token = req.headers.authorization?.replace("Bearer ", "");
  const addedBy = token ? authSessions.get(token)?.email || null : null;
  const row = await db.addEmailAllowlist(normalized, addedBy);
  if (!row || row.dbError) {
    return res.status(500).json({ error: row?.dbError || "Failed to add allowlist entry" });
  }
  dbAllowEmails.set(row.email, { addedAt: row.addedAt, addedBy: row.addedBy });
  res.json({ ok: true, entry: { email: row.email, source: "db", addedAt: row.addedAt, addedBy: row.addedBy } });
});

app.delete("/api/settings/allowlist/:email", requireAuth, async (req, res) => {
  if (!db.enabled) {
    return res.status(501).json({ error: "Database not configured" });
  }
  const normalized = normalizeEmailInput(decodeURIComponent(req.params.email || ""));
  if (!normalized) {
    return res.status(400).json({ error: "Invalid email address" });
  }
  if (!dbAllowEmails.has(normalized)) {
    return res.status(404).json({ error: "Entry not found (env-seeded entries cannot be removed via API)" });
  }
  const ok = await db.removeEmailAllowlist(normalized);
  if (!ok) {
    return res.status(500).json({ error: "Failed to remove allowlist entry" });
  }
  dbAllowEmails.delete(normalized);
  res.json({ ok: true });
});

// Guest session endpoint.
// When Google OAuth is not configured (open/dev mode), issue a real session
// token so guests can post messages without hitting the requireAuth wall.
// When Google OAuth IS configured, we keep the old behaviour (token-less) so
// the "Sign in with Google" prompt still appears.
app.post("/api/auth/guest-session", async (req, res) => {
  // Email allowlist disables guest access entirely — an active allowlist implies
  // "only these humans may enter", and guests have no email to check.
  if (allowlistActive()) {
    return res.status(403).json({ error: "Guest access disabled on this server." });
  }
  const { name } = req.body || {};
  if (!name || typeof name !== "string" || !name.trim()) {
    return res.status(400).json({ error: "name required" });
  }
  const trimmed = name.trim();
  if (trimmed.length > 100) return res.status(400).json({ error: "name too long (max 100)" });
  if (isReservedName(trimmed)) {
    return res.status(400).json({ error: `"${trimmed}" is a reserved username and cannot be used.` });
  }

  // In open/dev mode (no Google OAuth), mint a real session so guests aren't
  // blocked from write operations (sending messages, etc.).
  if (!GOOGLE_CLIENT_ID) {
    const token = crypto.randomBytes(24).toString("hex");
    const user = { name: trimmed, email: null, picture: null, guest: true };
    authSessions.set(token, user);
    await persistSession(token, user);
    return res.json({ ok: true, name: trimmed, token, user });
  }

  res.json({ ok: true, name: trimmed });
});

// ─── Serve static web frontend ────────────────────────────────────
// Prefer React build (web/dist/) over static HTML (web/public/)

const webDistDir = path.join(__dirname, "..", "web", "dist");
const webPublicDir = path.join(__dirname, "..", "web", "public");
const webDir = fs.existsSync(webDistDir) ? webDistDir : webPublicDir;
if (fs.existsSync(webDir)) {
  app.use(express.static(webDir));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api") || req.path.startsWith("/internal")) return next();
    res.sendFile(path.join(webDir, "index.html"));
  });
}

// ─── DB init + startup ────────────────────────────────────────────

async function initFromDB() {
  if (!db.enabled) return;
  try {
    await db.migrate();

    const [maxSeq, maxTaskNum, msgs, channels, tasks, dbConfigs, dbKeys, channelAgents] = await Promise.all([
      db.loadMaxSeq(),
      db.loadMaxTaskNum(),
      db.loadMessages(),
      db.loadChannels(),
      db.loadTasks(),
      db.loadAgentConfigs(),
      db.loadMachineKeys(),
      db.loadChannelAgents(),
    ]);

    if (maxSeq > store.seq) store.seq = maxSeq;
    if (maxTaskNum > store.taskSeq) store.taskSeq = maxTaskNum;

    if (msgs.length > 0) {
      setStoreMessages(msgs);
      console.log(`[db] Loaded ${msgs.length} messages`);
    }

    for (const ch of channels) {
      if (!store.channels.find((c) => c.id === ch.id)) {
        store.channels.push(ch);
      } else {
        const existing = store.channels.find((c) => c.id === ch.id);
        if (existing) existing.description = ch.description;
      }
    }
    if (channels.length > 0) console.log(`[db] Loaded ${channels.length} channels`);

    if (tasks.length > 0) {
      store.tasks = tasks;
      console.log(`[db] Loaded ${tasks.length} tasks`);
    }

    // channel_agents memberships — populate in-memory map from DB rows.
    for (const row of (channelAgents || [])) {
      let ca = store.channelAgents.get(row.channelId);
      if (!ca) {
        ca = new Map();
        store.channelAgents.set(row.channelId, ca);
      }
      ca.set(row.agentId, { canRead: !!row.canRead, subscribed: !!row.subscribed });
    }
    if (channelAgents && channelAgents.length > 0) {
      console.log(`[db] Loaded ${channelAgents.length} channel_agents memberships`);
    }

    // Backfill for first boot on this code: regular channels without any
    // membership rows get seeded the same way seedMembershipOnChannelCreate
    // would have handled them — every configured agent joins. DMs skip the
    // table entirely; visibility and delivery consult the canonical party
    // list in the channel name instead.
    for (const ch of store.channels) {
      if ((ch.type || "channel") === "dm") continue;
      const ca = store.channelAgents.get(ch.id);
      if (ca && ca.size > 0) continue;
      for (const cfg of agentConfigs) {
        setMembership(ch.id, cfg.id, { canRead: true, subscribed: true });
      }
    }

    // Persist the default `all` channel if it's not already in DB — so it has
    // a row for channel_agents to FK against and doesn't drift between runs.
    const allCh = store.channels.find((c) => c.name === "all" && (c.type || "channel") === "channel");
    if (allCh) await db.saveChannel(allCh);

    // Agent configs: DB wins over file when DB has entries
    if (dbConfigs !== null && dbConfigs.length > 0) {
      agentConfigs.length = 0;
      agentConfigs.push(...dbConfigs);
      console.log(`[db] Loaded ${dbConfigs.length} agent configs`);
    } else if (dbConfigs !== null && dbConfigs.length === 0 && agentConfigs.length > 0) {
      // DB is empty but file has configs — seed DB from file
      for (const cfg of agentConfigs) await db.saveAgentConfig(cfg);
      console.log(`[db] Seeded ${agentConfigs.length} agent configs to DB`);
    }

    await profilePresets.hydrateFromDb();

    // One-shot trim of any historical activity backlog — cheap at our scale.
    db.trimAllAgentActivities().catch((e) =>
      console.error("[db] trimAllAgentActivities at boot failed:", e.message)
    );

    // Machine keys: DB wins over file when DB has entries
    if (dbKeys !== null && dbKeys.length > 0) {
      machineKeys.length = 0;
      machineKeys.push(...dbKeys);
      console.log(`[db] Loaded ${dbKeys.length} machine keys`);
    } else if (dbKeys !== null && dbKeys.length === 0 && machineKeys.length > 0) {
      // DB is empty but file has keys — seed DB from file
      for (const k of machineKeys) await db.saveMachineKey(k);
      console.log(`[db] Seeded ${machineKeys.length} machine keys to DB`);
    }
  } catch (e) {
    console.error("[db] initFromDB error (continuing in-memory):", e.message);
  }
}

// Reapply the loaded agent configs on top of any already-registered runtime
// entries. This is a belt-and-suspenders for the race where a daemon reconnects
// between `server.listen` starting and `initFromDB` finishing — without this,
// `store.agents[id]` would freeze with the fallback defaults (name=id,
// runtime="claude", model="unknown") and never pick up the real config.
function reconcileAgentsWithConfigs() {
  for (const agentId of Object.keys(store.agents)) {
    const cfg = agentConfigs.find((c) => c.id === agentId);
    if (!cfg) continue;
    const a = store.agents[agentId];
    const before = { name: a.name, displayName: a.displayName, runtime: a.runtime, model: a.model };
    if (cfg.name) a.name = cfg.name;
    if (cfg.displayName) a.displayName = cfg.displayName;
    else if (cfg.name) a.displayName = cfg.name;
    if (cfg.runtime) a.runtime = cfg.runtime;
    if (cfg.model) a.model = cfg.model;
    if (cfg.workDir) a.workDir = cfg.workDir;
    const changed =
      before.name !== a.name ||
      before.displayName !== a.displayName ||
      before.runtime !== a.runtime ||
      before.model !== a.model;
    if (changed) {
      broadcastToWeb({ type: "agent_started", agent: agentPayload(agentId) });
    }
  }
}

// ─── Start ────────────────────────────────────────────────────────

(async () => {
  // Load persistent state before accepting any connections — otherwise a daemon
  // reconnecting mid-init races with `initFromDB` and lands on fallback
  // name/runtime/model for every running agent (see reconcileAgentsWithConfigs
  // above for the backstop).
  await initFromDB();
  await loadAuthSessions();
  // Seed allTimeHumans from authSessions so anyone who has logged in is in the
  // people list immediately on boot (offline until they connect). Skip guest
  // sessions — they're CI/anonymous and shouldn't appear in the persistent list.
  for (const user of authSessions.values()) {
    if (!user?.name || user.guest) continue;
    upsertAllTimeHuman({
      id: humanId(user.name),
      name: user.name,
      picture: user.picture || undefined,
      gravatarUrl: user.gravatarUrl || (user.email ? gravatarUrl(user.email) : undefined),
    });
  }
  await loadEmailAllowlistFromDb();
  reconcileAgentsWithConfigs();

  if (mockData.shouldSeed(db)) {
    mockData.seed({
      store,
      agentConfigs,
      machines,
      addHumanPresence,
      findOrCreateChannel,
    });
    // Mock seed pushes onto store.messages directly (it's a one-shot bootstrap
    // path), so the secondary indexes need a rebuild after it runs.
    rebuildMessageIndex();
    // Mock seeds push channels and agents in an order that skips the
    // per-channel-create seeding hook, so do a once-over here to backfill
    // memberships for every mock agent on every mock channel.
    for (const ch of store.channels) {
      if ((ch.type || "channel") === "dm") continue;
      for (const cfg of agentConfigs) {
        if (!getMembership(ch.id, cfg.id)) {
          setMembership(ch.id, cfg.id, { canRead: true, subscribed: true });
        }
      }
    }
  }

  server.listen(PORT, () => {
    console.log(`\n🚀 Zouk server running on ${PUBLIC_URL}`);
    console.log(`\n  Daemon endpoint:  ws://localhost:${PORT}/daemon/connect?key=test`);
    console.log(`  Web UI endpoint:  ws://localhost:${PORT}/ws`);
    console.log(`  REST API:         ${PUBLIC_URL}/internal/agent/{id}/...`);
    console.log(`\nTo connect a daemon:`);
    console.log(`  # clone zouk-daemon first`);
    console.log(`  npx tsx src/index.ts --server-url ${PUBLIC_URL} --api-key <api_key>`);
    console.log(`  Generate additional keys via POST /api/machine-keys or the Machine Setup UI.`);
    if (!process.env.NODE_ENV?.startsWith("prod")) {
      console.log(`  Dev mode: key "test" is also accepted without registration.\n`);
    }
  });
})();
