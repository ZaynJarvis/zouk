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
const {
  createEmbedSettingsStore,
  createEmbedRateLimiter,
  normalizeOrigin: normalizeEmbedOrigin,
  sanitizeEmbedGuestName,
  embedGuestSuffixForBrowser,
} = require("./embedSessions");
const { createStorage } = require("./storage");
const mockData = require("./mockData");
const { provisionAgentKey } = require("./openviking-admin");
const { AgentDeliveryRouter } = require("./notifications/agentDeliveryRouter");
const { DEFAULT_WORKSPACE_ID, allocateWorkspaceId, normalizeWorkspaceId } = require("./workspaceIds");

function gravatarUrl(email) {
  if (!email) return null;
  const hash = crypto.createHash("md5").update(email.trim().toLowerCase()).digest("hex");
  return `https://www.gravatar.com/avatar/${hash}?s=128&d=identicon`;
}

const PORT = process.env.PORT || 7777;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const googleClient = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;
const PUBLIC_URL = process.env.PUBLIC_URL || `http://localhost:${PORT}`;
const DEFAULT_WORKSPACE_NAME = process.env.ZOUK_DEFAULT_WORKSPACE_NAME || "Default";
const DEFAULT_WORKSPACE_ICON = process.env.ZOUK_DEFAULT_WORKSPACE_ICON || "z";
const MAX_WORKSPACE_ICON_BYTES = 12 * 1024;
const PERF_LOG_MODE = String(process.env.ZOUK_PERF_LOG || "slow").trim().toLowerCase();
const PERF_LOG_ENABLED = ["1", "true", "yes", "slow", "verbose", "all"].includes(PERF_LOG_MODE);
const PERF_LOG_VERBOSE = ["verbose", "all"].includes(PERF_LOG_MODE);
const PERF_SLOW_MS = Math.max(1, parseInt(process.env.ZOUK_PERF_SLOW_MS || "1000", 10) || 1000);
const PERF_THREAD_REPLY_PAIR_WARN = Math.max(1, parseInt(process.env.ZOUK_PERF_THREAD_REPLY_PAIR_WARN || "10", 10) || 10);

function perfNowMs() {
  return Number(process.hrtime.bigint()) / 1e6;
}

function logPerf(label, durationMs, fields = {}, { force = false } = {}) {
  if (!PERF_LOG_ENABLED) return;
  if (!force && !PERF_LOG_VERBOSE && durationMs < PERF_SLOW_MS) return;
  const parts = [`[perf] ${label}`, `duration_ms=${durationMs.toFixed(1)}`];
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null || value === "") continue;
    parts.push(`${key}=${JSON.stringify(value)}`);
  }
  console.warn(parts.join(" "));
}

function workspaceIdFromReq(req) {
  return normalizeWorkspaceId(
    req.headers["x-workspace-id"]
      || req.query?.workspaceId
      || req.body?.workspaceId
      || DEFAULT_WORKSPACE_ID
  );
}

function workspaceIconFallback(name, id) {
  const source = String(name || id || DEFAULT_WORKSPACE_ICON);
  return source.trim().slice(0, 1).toUpperCase() || DEFAULT_WORKSPACE_ICON;
}

function normalizeWorkspaceIconInput(raw, fallback = DEFAULT_WORKSPACE_ICON) {
  if (raw === undefined || raw === null) return fallback;
  if (typeof raw !== "string") {
    const err = new Error("icon must be a string");
    err.statusCode = 400;
    throw err;
  }
  const icon = raw.trim();
  if (!icon) return fallback;
  if (icon.startsWith("data:image/")) {
    if (!/^data:image\/(png|jpe?g|webp|gif);base64,/i.test(icon)) {
      const err = new Error("icon must be an image data URL");
      err.statusCode = 400;
      throw err;
    }
    if (Buffer.byteLength(icon, "utf8") > MAX_WORKSPACE_ICON_BYTES) {
      const err = new Error("icon too large");
      err.statusCode = 400;
      throw err;
    }
    return icon;
  }
  return icon.slice(0, 4) || fallback;
}

// OpenViking server-issued per-agent keys.
// New-format root keys are `base64url(account).base64url(user).base64url(secret)` —
// we decode the account from the key so operators only need to set two env vars.
// Legacy hex keys can't carry an account; provisioning is disabled in that case.
const OPENVIKING_URL = (process.env.OPENVIKING_URL || "").replace(/\/+$/, "") || null;
const OPENVIKING_ROOT_KEY = process.env.OPENVIKING_ROOT_KEY || null;

// Runtimes that ship a first-class OV memory plugin — used as the default
// value of each agent's `openvikingEnabled` toggle. Users can override per
// agent via Agent Config; this list only controls the default at creation
// time and the `★ OV` recommendation badge in the create dialog.
const OV_RUNTIME_WHITELIST = (process.env.OV_RUNTIME_WHITELIST || "claude")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
function ovDefaultForRuntime(runtime) {
  return !!runtime && OV_RUNTIME_WHITELIST.includes(runtime);
}
// Resolves the effective ON/OFF for a given agent config. `openvikingEnabled`
// undefined / non-boolean means "follow the runtime default" — so existing
// rows that never had the field work without a migration.
function isOvEnabledForAgent(cfg) {
  if (cfg && typeof cfg.openvikingEnabled === "boolean") return cfg.openvikingEnabled;
  return ovDefaultForRuntime(cfg && cfg.runtime);
}
function decodeOvKey(key) {
  // New-format key: base64url(account).base64url(user).base64url(secret).
  // Returns { account, user } if both segments decode; null fields otherwise.
  if (!key || typeof key !== "string" || !key.includes(".")) {
    return { account: null, user: null };
  }
  const parts = key.split(".");
  const decodeSeg = (s) => {
    try {
      const out = Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
      return out || null;
    } catch {
      return null;
    }
  };
  return {
    account: parts[0] ? decodeSeg(parts[0]) : null,
    user: parts.length >= 2 ? decodeSeg(parts[1]) : null,
  };
}
function decodeAccountFromKey(key) {
  return decodeOvKey(key).account;
}
const OPENVIKING_ACCOUNT = decodeAccountFromKey(OPENVIKING_ROOT_KEY);
const OV_PROVISIONING_ENABLED = !!(OPENVIKING_URL && OPENVIKING_ROOT_KEY && OPENVIKING_ACCOUNT);
if (OPENVIKING_ROOT_KEY && !OV_PROVISIONING_ENABLED) {
  console.warn(
    "[ov] root key is legacy format — please use a new-format key from POST /api/v1/admin/accounts/{acct}/users; provisioning disabled"
  );
} else if (OV_PROVISIONING_ENABLED) {
  console.log(`[ov] provisioning enabled (account=${OPENVIKING_ACCOUNT}, url=${OPENVIKING_URL})`);
}

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

// Email allowlist — union of three sources, all granting equal access:
//   1. `ALLOW` env, comma-separated. Entries starting with `@` match by
//      domain (e.g. `@example.com` lets the whole tenant in); bare entries
//      match by exact address. Immutable without restart.
//   2. `email_allowlist` DB table (managed via Settings UI, hot-reloaded)
// When the union is non-empty, only listed addresses can mint sessions and
// guest mode is disabled. Empty union = unrestricted (default).
const ENV_ALLOW_EMAILS = new Set();
const ENV_ALLOW_DOMAINS = new Set();
for (const raw of (process.env.ALLOW || "").split(",")) {
  const entry = raw.trim().toLowerCase();
  if (!entry) continue;
  if (entry.startsWith("@")) ENV_ALLOW_DOMAINS.add(entry);
  else ENV_ALLOW_EMAILS.add(entry);
}
// `${workspaceId}:${email}` -> { workspaceId, email, addedAt, addedBy }
// (populated async from DB at startup)
const dbAllowEmails = new Map();

function allowlistKey(workspaceId, email) {
  return `${normalizeWorkspaceId(workspaceId)}:${String(email || "").trim().toLowerCase()}`;
}

// Default workspace gates *only* on ENV (ALLOW env var). Non-default
// workspaces gate purely on their own workspace-scoped DB rows. So an
// empty ALLOW env means the default workspace is fully open even when
// other workspaces have allowlist rows in the DB.
function allowlistActive(workspaceId = null) {
  if (!workspaceId) {
    return ENV_ALLOW_EMAILS.size > 0 || ENV_ALLOW_DOMAINS.size > 0 || dbAllowEmails.size > 0;
  }
  const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
  if (normalizedWorkspaceId === DEFAULT_WORKSPACE_ID) {
    return ENV_ALLOW_EMAILS.size > 0 || ENV_ALLOW_DOMAINS.size > 0;
  }
  for (const meta of dbAllowEmails.values()) {
    if ((meta.workspaceId || DEFAULT_WORKSPACE_ID) === normalizedWorkspaceId) return true;
  }
  return false;
}

function isEmailAllowed(email, workspaceId = DEFAULT_WORKSPACE_ID) {
  if (!allowlistActive(workspaceId)) return true;
  if (!email || typeof email !== "string") return false;
  const norm = email.trim().toLowerCase();
  const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
  if (normalizedWorkspaceId === DEFAULT_WORKSPACE_ID) {
    if (ENV_ALLOW_EMAILS.has(norm)) return true;
    const at = norm.lastIndexOf("@");
    if (at >= 0 && ENV_ALLOW_DOMAINS.has(norm.slice(at))) return true;
    return false;
  }
  return dbAllowEmails.has(allowlistKey(normalizedWorkspaceId, norm));
}

// True if the email can mint a session — i.e. it's allowed in at least one
// workspace, or the default workspace is open (no ENV allowlist). When the
// default is open every authenticated user gets `member` in default by default,
// so we should accept their login even if no subserver allowlist matches.
function isEmailAllowedAnyWorkspace(email) {
  if (!email || typeof email !== "string") return false;
  const norm = email.trim().toLowerCase();
  // Default workspace is open → anyone with a valid auth can log in (and they
  // will land in default as a member; subserver access still gated separately).
  if (!allowlistActive(DEFAULT_WORKSPACE_ID)) return true;
  if (!isWorkspaceMemberRemoved(DEFAULT_WORKSPACE_ID, norm)) {
    if (ENV_ALLOW_EMAILS.has(norm)) return true;
    const at = norm.lastIndexOf("@");
    if (at >= 0 && ENV_ALLOW_DOMAINS.has(norm.slice(at))) return true;
  }
  for (const meta of dbAllowEmails.values()) {
    if ((meta.email || "").trim().toLowerCase() !== norm) continue;
    if (isWorkspaceMemberRemoved(meta.workspaceId || DEFAULT_WORKSPACE_ID, norm)) continue;
    return true;
  }
  return false;
}

// True if any workspace has an active allowlist. Used by /api/auth/config to
// decide whether the frontend should hide the guest button — if any server in
// the deployment gates on an allowlist, we shouldn't advertise guest access.
function allowlistActiveAnywhere() {
  return (
    ENV_ALLOW_EMAILS.size > 0 ||
    ENV_ALLOW_DOMAINS.size > 0 ||
    dbAllowEmails.size > 0
  );
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

if (ENV_ALLOW_EMAILS.size > 0 || ENV_ALLOW_DOMAINS.size > 0) {
  console.log(
    `[auth] Email allowlist seeded from ALLOW env ` +
    `(${ENV_ALLOW_EMAILS.size} address(es), ${ENV_ALLOW_DOMAINS.size} domain(s))`
  );
}

// ZOUK_SUPERUSERS — comma-separated emails that get root access on every
// workspace (read, admin, member CRUD, see all workspaces in the list).
// Backend-only; there is no superuser UI yet — these users simply have
// elevated authority everywhere they hit the API.
const ENV_SUPERUSERS = new Set();
for (const raw of (process.env.ZOUK_SUPERUSERS || "").split(",")) {
  const entry = raw.trim().toLowerCase();
  if (entry) ENV_SUPERUSERS.add(entry);
}
function isSuperuser(email) {
  if (!email || typeof email !== "string") return false;
  return ENV_SUPERUSERS.has(email.trim().toLowerCase());
}
if (ENV_SUPERUSERS.size > 0) {
  console.log(`[auth] ${ENV_SUPERUSERS.size} superuser(s) seeded from ZOUK_SUPERUSERS env`);
}

// Local-dev escape hatch: promote guest sessions (email-less users) to root on
// the default workspace so they can create/admin workspaces without OAuth. Off
// by default — never set this in production.
const GUEST_ELEVATED = (() => {
  const raw = (process.env.ZOUK_GUEST_ELEVATED || "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
})();
if (GUEST_ELEVATED) {
  console.warn("[auth] ZOUK_GUEST_ELEVATED=1 — guest sessions get root on default workspace (dev only)");
}

async function loadEmailAllowlistFromDb() {
  if (!db.enabled) return;
  try {
    const rows = await db.loadEmailAllowlist();
    if (!rows) return;
    dbAllowEmails.clear();
    for (const row of rows) {
      const workspaceId = row.workspaceId || DEFAULT_WORKSPACE_ID;
      dbAllowEmails.set(allowlistKey(workspaceId, row.email), {
        workspaceId,
        email: row.email,
        addedAt: row.addedAt,
        addedBy: row.addedBy,
      });
    }
    if (rows.length > 0) {
      console.log(`[auth] Loaded ${rows.length} allowlist entry(ies) from database`);
    }
  } catch (e) {
    console.warn("[auth] Failed to load email allowlist:", e.message);
  }
}
const CONFIG_DIR = process.env.ZOUK_CONFIG_DIR || path.join(__dirname, "..", "data");
const AGENT_CONFIGS_FILE = path.join(CONFIG_DIR, "agent-configs.json");
const MACHINE_KEYS_FILE = path.join(CONFIG_DIR, "machine-keys.json");
const SESSIONS_FILE = path.join(CONFIG_DIR, "sessions.json");
const AGENT_PROFILE_PRESETS_FILE = path.join(CONFIG_DIR, "agent-profile-presets.json");
const WORKSPACE_EMBED_SETTINGS_FILE = path.join(CONFIG_DIR, "workspace-embed-settings.json");

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

function workspaceIdFromAgent(agentId) {
  const cfg = agentConfigs.find((c) => c.id === agentId);
  return normalizeWorkspaceId(cfg?.workspaceId || store.agents[agentId]?.workspaceId || DEFAULT_WORKSPACE_ID);
}

/** Build a store.agents entry, always preferring agentConfigs values. */
function buildRuntimeAgent(agentId, runtimeOverrides = {}) {
  const cfg = agentConfigs.find((c) => c.id === agentId);
  return {
    workspaceId: cfg?.workspaceId || runtimeOverrides.workspaceId || DEFAULT_WORKSPACE_ID,
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

/** Return the list of non-DM channel names an agent can read.
 *  Works for any agentId regardless of whether the agent is currently running. */
function agentChannelNames(agentId) {
  const names = [];
  const agentWorkspaceId = workspaceIdFromAgent(agentId);
  for (const ch of store.channels) {
    if ((ch.workspaceId || DEFAULT_WORKSPACE_ID) !== agentWorkspaceId) continue;
    if ((ch.type || "channel") === "dm") continue;
    const row = getMembership(ch.id, agentId);
    if (row && row.canRead) names.push(ch.name);
  }
  return names;
}

/** Build a full agent payload for broadcasting to the frontend.
 *  Always overlays config fields on top of runtime state so config
 *  edits are never masked by stale runtime copies. */
function agentPayload(agentId) {
  const a = store.agents[agentId];
  if (!a) return null;
  const cfg = agentConfigs.find((c) => c.id === agentId);
  const base = { id: agentId, ...a };
  if (!cfg) {
    const runtime = a.runtime;
    return {
      ...base,
      ovEnabled: ovDefaultForRuntime(runtime),
      ovEnabledIsDefault: true,
      ovDefault: ovDefaultForRuntime(runtime),
    };
  }
  return {
    ...base,
    workspaceId: cfg.workspaceId || a.workspaceId || DEFAULT_WORKSPACE_ID,
    name: cfg.name || a.name,
    displayName: cfg.displayName || cfg.name || a.displayName,
    runtime: cfg.runtime || a.runtime,
    model: cfg.model || a.model,
    workDir: cfg.workDir || a.workDir,
    picture: cfg.picture || a.picture || undefined,
    lifecycle: cfg.lifecycle === 'ephemeral' ? 'ephemeral' : 'persistent',
    channels: agentChannelNames(agentId),
    openvikingProvisioned: !!cfg.openvikingApiKey,
    openvikingMode: cfg.openvikingMode === 'custom' ? 'custom' : 'provisioned',
    openvikingCustomConfigured: !!cfg.openvikingCustomApiKey,
    ovEnabled: isOvEnabledForAgent(cfg),
    ovEnabledIsDefault: typeof cfg.openvikingEnabled !== 'boolean',
    ovDefault: ovDefaultForRuntime(cfg.runtime || a.runtime),
  };
}

// Strip secret fields (openvikingApiKey, openvikingCustomApiKey) before sending
// agent configs to browser clients. Keep openvikingUserId — it's the same id
// surfaced as
// `X-OpenViking-Agent` in admin views and not sensitive.
function sanitizedAgentConfigs() {
  return agentConfigs.map(({ openvikingApiKey, openvikingCustomApiKey, ...rest }) => ({
    ...rest,
    openvikingProvisioned: !!openvikingApiKey,
    openvikingMode: rest.openvikingMode === 'custom' ? 'custom' : 'provisioned',
    openvikingCustomConfigured: !!openvikingCustomApiKey,
    ovEnabled: isOvEnabledForAgent(rest),
    ovEnabledIsDefault: typeof rest.openvikingEnabled !== 'boolean',
    ovDefault: ovDefaultForRuntime(rest.runtime),
  }));
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

function isPersistentMachineId(machineId, workspaceId = null) {
  if (!machineId) return false;
  return machineKeys.some((k) => (
    !k.revokedAt
    && k.id === machineId
    && (!workspaceId || (k.workspaceId || DEFAULT_WORKSPACE_ID) === normalizeWorkspaceId(workspaceId))
  ));
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
  workspaces: [
    { id: DEFAULT_WORKSPACE_ID, name: DEFAULT_WORKSPACE_NAME, icon: DEFAULT_WORKSPACE_ICON, ownerEmail: null },
  ],
  workspaceMembers: new Map(),
  channels: [
    { id: "ch-all", workspaceId: DEFAULT_WORKSPACE_ID, name: "all", description: "General channel", members: [] },
  ],
  // Per-channel tail cache: channelId -> Message[] in seq ASC order, capped
  // at CHANNEL_CACHE_TAIL per channel. Serves /api/messages "latest page" fast
  // path and masks the fire-and-forget db.saveMessage race window. Older
  // history is always fetched from DB.
  channelMessages: new Map(),
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

// In-memory secondary indexes — best-effort O(1) lookups for very recent
// messages. Populated by appendMessage (every new message) and by
// seedFromBootstrap (the most recent N messages at startup). NOT a full
// history cache: lookups that miss must fall back to DB.
const messagesById = new Map();         // full id   -> msg
const messagesByShortId = new Map();    // id.slice(0,8) -> msg (parent lookup; threadId is always an 8-char shortid)
const repliesByThreadId = new Map();    // 8-char threadId -> Message[] (replies, push order = seq order)

// Per-channel tail cache size. Sized at the typical /api/messages page limit
// so the "latest page" fast path almost always hits without a DB round-trip;
// pagination beyond this window always goes to DB.
const CHANNEL_CACHE_TAIL = parseInt(process.env.CHANNEL_CACHE_TAIL || '50', 10);

// Derived map for /api/tasks createdAt/updatedAt — first/last message
// timestamps per task, keyed by `${workspaceId}:${taskNumber}`. Seeded from a
// dedicated DB aggregate at boot, then maintained incrementally.
const taskTimes = new Map();

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

function appendToChannelCache(msg) {
  if (!msg || !msg.channelId) return;
  let arr = store.channelMessages.get(msg.channelId);
  if (!arr) {
    arr = [];
    store.channelMessages.set(msg.channelId, arr);
  }
  arr.push(msg);
  if (arr.length > CHANNEL_CACHE_TAIL) arr.shift();
}

function recordTaskTime(msg) {
  if (!msg || !msg.taskNumber) return;
  const key = `${msg.workspaceId || DEFAULT_WORKSPACE_ID}:${msg.taskNumber}`;
  const cur = taskTimes.get(key);
  if (!cur) {
    taskTimes.set(key, { createdAt: msg.createdAt, updatedAt: msg.createdAt });
  } else {
    if (msg.createdAt < cur.createdAt) cur.createdAt = msg.createdAt;
    if (msg.createdAt > cur.updatedAt) cur.updatedAt = msg.createdAt;
  }
}

// All hot-path message inserts go through this: in-memory indexes + per-channel
// cache stay in sync, taskTimes track the message timestamp for /api/tasks.
// DB persistence is the caller's responsibility (saveMessage is fire-and-forget
// at the call site).
function appendMessage(msg) {
  indexMessage(msg);
  appendToChannelCache(msg);
  recordTaskTime(msg);
}

// Boot-from-DB seed: populates the threading indexes, per-channel tail cache,
// and clears any prior state. Bootstrap msgs come back from DB in seq ASC.
function seedFromBootstrap(msgs) {
  messagesById.clear();
  messagesByShortId.clear();
  repliesByThreadId.clear();
  store.channelMessages.clear();
  for (const m of msgs) {
    indexMessage(m);
    appendToChannelCache(m);
    // taskTimes is seeded separately from db.loadTaskMessageTimes() which
    // sees ALL messages, not just the bootstrap window.
  }
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

function workspacePayload(workspace) {
  return {
    id: workspace.id,
    name: workspace.name || workspace.id,
    icon: workspace.icon || DEFAULT_WORKSPACE_ICON,
    ownerEmail: workspace.ownerEmail || null,
    createdAt: workspace.createdAt || null,
  };
}

function findWorkspace(id) {
  const workspaceId = normalizeWorkspaceId(id);
  return store.workspaces.find((w) => w.id === workspaceId) || null;
}

function ensureWorkspace(workspace) {
  const workspaceId = normalizeWorkspaceId(workspace?.id || DEFAULT_WORKSPACE_ID);
  let existing = findWorkspace(workspaceId);
  const next = {
    id: workspaceId,
    name: workspace?.name || existing?.name || (workspaceId === DEFAULT_WORKSPACE_ID ? DEFAULT_WORKSPACE_NAME : workspaceId),
    icon: workspace?.icon || existing?.icon || (workspaceId === DEFAULT_WORKSPACE_ID ? DEFAULT_WORKSPACE_ICON : workspaceId.slice(0, 1).toUpperCase()),
    ownerEmail: workspace?.ownerEmail ?? existing?.ownerEmail ?? null,
    createdAt: workspace?.createdAt || existing?.createdAt || now(),
  };
  if (existing) {
    Object.assign(existing, next);
  } else {
    store.workspaces.push(next);
    existing = next;
  }
  return existing;
}

function workspaceMembersFor(workspaceId) {
  const id = normalizeWorkspaceId(workspaceId);
  let members = store.workspaceMembers.get(id);
  if (!members) {
    members = new Map();
    store.workspaceMembers.set(id, members);
  }
  return members;
}

const removedWorkspaceMembers = new Map();

function workspaceMemberRemovalKey(workspaceId, email) {
  return allowlistKey(workspaceId, email);
}

function workspaceMemberRemovalPayload(removal) {
  return {
    workspaceId: removal.workspaceId,
    email: removal.email,
    removedAt: removal.removedAt || null,
    removedBy: removal.removedBy || null,
  };
}

function workspaceMemberRemovalApplies(workspaceId) {
  const id = normalizeWorkspaceId(workspaceId);
  // Non-default workspaces are already explicit membership sets: deleting
  // workspace_members (and the matching allowlist row) is enough. Restricted
  // default needs a durable override because ENV ALLOW would otherwise
  // re-materialize the member on the next request.
  return id === DEFAULT_WORKSPACE_ID && allowlistActive(id);
}

function isWorkspaceMemberRemoved(workspaceId, email) {
  if (!email) return false;
  if (!workspaceMemberRemovalApplies(workspaceId)) return false;
  return removedWorkspaceMembers.has(workspaceMemberRemovalKey(workspaceId, email));
}

function markWorkspaceMemberRemoved(workspaceId, email, removedBy, { persist = true } = {}) {
  if (!email) return null;
  const id = normalizeWorkspaceId(workspaceId);
  const normalized = String(email).trim().toLowerCase();
  const removal = {
    workspaceId: id,
    email: normalized,
    removedAt: now(),
    removedBy: removedBy || null,
  };
  if (!workspaceMemberRemovalApplies(id)) return null;
  removedWorkspaceMembers.set(workspaceMemberRemovalKey(id, normalized), removal);
  if (persist) db.saveWorkspaceMemberRemoval(removal).catch(e => console.warn("[db] saveWorkspaceMemberRemoval error:", e.message));
  return removal;
}

function clearWorkspaceMemberRemoval(workspaceId, email, { persist = true } = {}) {
  if (!email) return false;
  const id = normalizeWorkspaceId(workspaceId);
  const normalized = String(email).trim().toLowerCase();
  const removed = removedWorkspaceMembers.delete(workspaceMemberRemovalKey(id, normalized));
  if (persist && removed) {
    db.deleteWorkspaceMemberRemoval(id, normalized).catch(e => console.warn("[db] deleteWorkspaceMemberRemoval error:", e.message));
  }
  return removed;
}

function workspaceMemberCount(workspaceId) {
  return workspaceMembersFor(workspaceId).size;
}

function getWorkspaceMember(workspaceId, email) {
  if (!email) return null;
  return workspaceMembersFor(workspaceId).get(String(email).trim().toLowerCase()) || null;
}

function setWorkspaceMember(member, { persist = true } = {}) {
  if (!member?.email) return null;
  const workspaceId = normalizeWorkspaceId(member.workspaceId || DEFAULT_WORKSPACE_ID);
  const email = member.email.trim().toLowerCase();
  if (persist) clearWorkspaceMemberRemoval(workspaceId, email);
  const next = {
    workspaceId,
    email,
    role: member.role || "member",
    name: member.name || null,
    joinedAt: member.joinedAt || now(),
  };
  workspaceMembersFor(workspaceId).set(email, next);
  if (persist) db.saveWorkspaceMember(next);
  return next;
}

function removeWorkspaceMember(workspaceId, email) {
  if (!email) return false;
  const id = normalizeWorkspaceId(workspaceId);
  const normalized = String(email).trim().toLowerCase();
  const removed = workspaceMembersFor(id).delete(normalized);
  if (removed) db.deleteWorkspaceMember(id, normalized);
  return removed;
}

function workspaceMemberPayload(member) {
  return {
    workspaceId: member.workspaceId,
    email: member.email,
    role: member.role || "member",
    name: member.name || null,
    joinedAt: member.joinedAt || null,
  };
}

function listWorkspaceMembers(workspaceId) {
  const id = normalizeWorkspaceId(workspaceId);
  return [...workspaceMembersFor(id).values()].map(workspaceMemberPayload);
}

function ensureWorkspaceMemberForUser(user, workspaceId = DEFAULT_WORKSPACE_ID) {
  if (!user?.email) return null;
  const id = normalizeWorkspaceId(workspaceId);
  if (!findWorkspace(id)) {
    if (id !== DEFAULT_WORKSPACE_ID) return null;
    ensureWorkspace({ id });
  }
  const existing = getWorkspaceMember(id, user.email);
  if (existing) return existing;
  if (isWorkspaceMemberRemoved(id, user.email)) return null;
  if (id !== DEFAULT_WORKSPACE_ID) return null;
  if (!isEmailAllowed(user.email, id)) return null;
  const role = workspaceMemberCount(id) === 0 ? "root" : "member";
  const member = setWorkspaceMember({ workspaceId: id, email: user.email, name: user.name, role });
  broadcastWorkspaceMembers(id);
  return member;
}

function userWorkspaceRole(user, workspaceId = DEFAULT_WORKSPACE_ID) {
  const id = normalizeWorkspaceId(workspaceId);
  if (isEmbedSessionUser(user)) {
    return normalizeWorkspaceId(user.embed.workspaceId) === id ? "member" : null;
  }
  if (!user?.email) {
    if (id !== DEFAULT_WORKSPACE_ID || allowlistActive(id)) return null;
    return GUEST_ELEVATED ? "root" : "member";
  }
  // Superusers override every other gate — they can read and admin any
  // workspace regardless of allowlist or membership rows.
  if (isSuperuser(user.email)) return "root";
  if (isWorkspaceMemberRemoved(id, user.email)) return null;
  if (allowlistActive(id) && !isEmailAllowed(user.email, id)) return null;
  const member = getWorkspaceMember(id, user.email);
  if (member) return member.role || "member";
  if (id !== DEFAULT_WORKSPACE_ID) return null;
  return isEmailAllowed(user.email, id) ? "member" : null;
}

function userCanAccessWorkspace(user, workspaceId = DEFAULT_WORKSPACE_ID) {
  return !!userWorkspaceRole(user, workspaceId);
}

function userCanAdminWorkspace(user, workspaceId = DEFAULT_WORKSPACE_ID) {
  const role = userWorkspaceRole(user, workspaceId);
  return role === "root" || role === "owner" || role === "admin";
}

function userCanRootWorkspace(user, workspaceId = DEFAULT_WORKSPACE_ID) {
  return userWorkspaceRole(user, workspaceId) === "root" || isSuperuser(user?.email);
}

function visibleWorkspacesForUser(user) {
  if (!user) {
    return [workspacePayload(ensureWorkspace({ id: DEFAULT_WORKSPACE_ID }))];
  }
  const workspaces = [];
  for (const workspace of store.workspaces) {
    if (userCanAccessWorkspace(user, workspace.id)) {
      workspaces.push(workspacePayload(workspace));
    }
  }
  if (workspaces.length === 0) {
    const member = ensureWorkspaceMemberForUser(user, DEFAULT_WORKSPACE_ID);
    if (member) workspaces.push(workspacePayload(ensureWorkspace({ id: DEFAULT_WORKSPACE_ID })));
  }
  return workspaces;
}

function workspaceEventIdFromPayload(event) {
  if (event.workspaceId) return normalizeWorkspaceId(event.workspaceId);
  const msg = event.message;
  if (msg?.workspaceId) return normalizeWorkspaceId(msg.workspaceId);
  if (event.channel?.workspaceId) return normalizeWorkspaceId(event.channel.workspaceId);
  if (event.agent?.workspaceId) return normalizeWorkspaceId(event.agent.workspaceId);
  if (event.agentId) return workspaceIdFromAgent(event.agentId);
  if (event.machine?.workspaceId) return normalizeWorkspaceId(event.machine.workspaceId);
  if (event.machineId) {
    const machine = machines?.get?.(event.machineId);
    if (machine?.workspaceId) return normalizeWorkspaceId(machine.workspaceId);
    const key = machineKeys?.find?.((k) => k.id === event.machineId);
    if (key?.workspaceId) return normalizeWorkspaceId(key.workspaceId);
  }
  if (event.config?.workspaceId) return normalizeWorkspaceId(event.config.workspaceId);
  return null;
}

function resolveUniqueByIdOrPrefix(items, rawId, getId) {
  if (!rawId || typeof rawId !== "string") return { item: null, reason: "invalid id" };
  const exact = items.find((item) => getId(item) === rawId);
  if (exact) return { item: exact, reason: null };
  // Agent notifications use 8-char message prefixes. Accept reasonably long
  // unique prefixes so those headers can be passed back directly.
  if (rawId.length < 8) return { item: null, reason: "not found" };
  const matches = items.filter((item) => {
    const id = getId(item);
    return typeof id === "string" && id.startsWith(rawId);
  });
  if (matches.length === 1) return { item: matches[0], reason: null };
  if (matches.length > 1) return { item: null, reason: "ambiguous id prefix" };
  return { item: null, reason: "not found" };
}

const taskMutationLocks = new Map();
async function withTaskMutationLock(key, fn) {
  const previous = taskMutationLocks.get(key) || Promise.resolve();
  let release;
  const current = new Promise((resolve) => { release = resolve; });
  const chain = previous.catch(() => {}).then(() => current);
  taskMutationLocks.set(key, chain);
  await previous.catch(() => {});
  try {
    return await fn();
  } finally {
    release();
    if (taskMutationLocks.get(key) === chain) taskMutationLocks.delete(key);
  }
}

function channelForTask(task) {
  if (!task) return null;
  const workspaceId = normalizeWorkspaceId(task.workspaceId || DEFAULT_WORKSPACE_ID);
  return store.channels.find((c) => c.id === task.channelId && (c.workspaceId || DEFAULT_WORKSPACE_ID) === workspaceId)
    || (task.channelName ? store.channels.find((c) => c.name === task.channelName && (c.workspaceId || DEFAULT_WORKSPACE_ID) === workspaceId) : null)
    || null;
}

function taskChannelPayload(task) {
  const ch = channelForTask(task);
  return {
    workspaceId: task.workspaceId || ch?.workspaceId || DEFAULT_WORKSPACE_ID,
    channelId: task.channelId || ch?.id || "ch-all",
    channelName: ch?.name || task.channelName || "all",
    channelType: ch?.type || (task.channelName?.startsWith("dm:") ? "dm" : "channel"),
  };
}

function taskTitleFromMessage(message) {
  const text = String(message?.content || "").replace(/\s+/g, " ").trim();
  if (!text) return "Untitled task";
  return text.length > 120 ? `${text.slice(0, 117)}...` : text;
}

async function syncTaskBackingMessage(task) {
  // Targeted UPDATE so we don't need the backing message in memory — historical
  // messages live only in DB. Also patch the in-memory mirror if the message
  // is in the recent index, so subsequent cache reads see the new state.
  const cached = messagesById.get(task.messageId);
  if (cached) {
    cached.taskNumber = task.taskNumber;
    cached.taskStatus = task.status;
    cached.taskAssigneeId = task.claimedByName || null;
    cached.taskAssigneeType = task.claimedByType || null;
  }
  await db.updateMessageTaskFields({
    id: task.messageId,
    taskNumber: task.taskNumber,
    taskStatus: task.status,
    taskAssigneeId: task.claimedByName || null,
    taskAssigneeType: task.claimedByType || null,
  });
}

function taskMatchesTarget(task, target, agentName) {
  if (!target) return true;
  const { channelName, channelType } = parseTarget(target, agentName);
  const ch = channelForTask(task);
  const taskChannelName = ch?.name || task.channelName || null;
  const taskChannelType = ch?.type || (taskChannelName?.startsWith("dm:") ? "dm" : "channel");
  if (taskChannelType !== channelType) return false;
  if (taskChannelName === channelName) return true;

  // Compatibility for tasks created by older agent endpoints, which parsed
  // dm:@peer without the agent name and stored them under single-party
  // orphan channels such as dm:zaynjarvis.
  if (channelType === "dm") {
    const parties = dmChannelParties(channelName) || [];
    return parties.some((party) => taskChannelName === `dm:${party}`);
  }
  return false;
}

function findOrCreateChannel(name, type = "channel", workspaceId = DEFAULT_WORKSPACE_ID) {
  const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
  let ch = store.channels.find((c) => (
    (c.workspaceId || DEFAULT_WORKSPACE_ID) === normalizedWorkspaceId
    && c.name === name
    && (c.type || "channel") === (type || "channel")
  ));
  if (!ch) {
    const idPrefix = type === "dm" ? "dm-" : "ch-";
    const defaultAll = normalizedWorkspaceId === DEFAULT_WORKSPACE_ID && type !== "dm" && name === "all";
    ch = {
      id: defaultAll ? "ch-all" : `${idPrefix}${uuidv4().substring(0, 8)}`,
      workspaceId: normalizedWorkspaceId,
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
  const channel = store.channels.find((c) => c.id === channelId);
  let ca = store.channelAgents.get(channelId);
  if (!ca) {
    ca = new Map();
    store.channelAgents.set(channelId, ca);
  }
  const existing = ca.get(agentId);
  if (existing && existing.canRead === !!canRead && existing.subscribed === !!subscribed) return false;
  ca.set(agentId, { canRead: !!canRead, subscribed: !!subscribed });
  db.saveChannelAgent({
    workspaceId: channel?.workspaceId || workspaceIdFromAgent(agentId),
    channelId,
    agentId,
    canRead: !!canRead,
    subscribed: !!subscribed,
  });
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
  const agentWorkspaceId = workspaceIdFromAgent(agentId);
  const msgWorkspaceId = normalizeWorkspaceId(msg.workspaceId || DEFAULT_WORKSPACE_ID);
  const ch = msg.channelId
    ? store.channels.find((c) => c.id === msg.channelId)
    : store.channels.find((c) => (
      (c.workspaceId || DEFAULT_WORKSPACE_ID) === msgWorkspaceId
      && c.name === msg.channelName
      && (c.type || "channel") === (msg.channelType || "channel")
    ));
  if (!ch) return false;
  if ((ch.type || "channel") === "dm") {
    // DMs are party-scoped — workspace filter doesn't apply so agents in
    // different workspace slots still receive their DMs.
    const parties = dmChannelParties(ch.name) || [];
    const agentName = agentPayload(agentId)?.name
      || agentConfigs.find((c) => c.id === agentId)?.name;
    if (!agentName) return false;
    return parties.some((p) => String(p).toLowerCase() === String(agentName).toLowerCase());
  }
  if (msgWorkspaceId !== agentWorkspaceId) return false;
  return agentCanRead(ch.id, agentId);
}

// Seed membership when a channel is created.
//   DM: no rows — DM visibility/delivery is driven by the canonical party
//       list in the channel name, not channel_agents.
//   Regular channel: no agents are added by default. Agents must be explicitly
//                    subscribed via the API or by the agent's own seeding logic.
function seedMembershipOnChannelCreate(channel) {
  if ((channel.type || "channel") === "dm") return;
  // Initialize an empty membership Map so the backfill in initFromDB skips it.
  if (!store.channelAgents.has(channel.id)) {
    store.channelAgents.set(channel.id, new Map());
  }
}

function agentIdByName(name, workspaceId = null) {
  if (!name) return null;
  const lowered = String(name).toLowerCase();
  const ws = workspaceId ? normalizeWorkspaceId(workspaceId) : null;
  for (const cfg of agentConfigs) {
    if (ws && (cfg.workspaceId || DEFAULT_WORKSPACE_ID) !== ws) continue;
    if ((cfg.name || "").toLowerCase() === lowered) return cfg.id;
    if ((cfg.displayName || "").toLowerCase() === lowered) return cfg.id;
  }
  for (const [id, a] of Object.entries(store.agents)) {
    if (ws && workspaceIdFromAgent(id) !== ws) continue;
    if ((a.name || "").toLowerCase() === lowered) return id;
    if ((a.displayName || "").toLowerCase() === lowered) return id;
  }
  return null;
}

// Seed a newly-registered agent into the `all` channel only.
// New agents start with visibility only to #all; admins can subscribe them to
// other channels via the API. DMs are not seeded here.
function seedAgentIntoRegularChannels(agentId) {
  const agentWorkspaceId = workspaceIdFromAgent(agentId);
  const allChannel = store.channels.find(
    (ch) => (ch.workspaceId || DEFAULT_WORKSPACE_ID) === agentWorkspaceId
      && ch.name === "all"
      && (ch.type || "channel") === "channel"
  );
  if (allChannel && !getMembership(allChannel.id, agentId)) {
    setMembership(allChannel.id, agentId, { canRead: true, subscribed: true });
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

function matchesTarget(msg, target, requesterName, workspaceId = null) {
  if (workspaceId && normalizeWorkspaceId(msg.workspaceId || DEFAULT_WORKSPACE_ID) !== normalizeWorkspaceId(workspaceId)) {
    return false;
  }
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

// Resolve a target string (e.g. "#engineering", "dm:@alice:abc12345") to the
// concrete channel row + thread filter. Returns null when the channel doesn't
// exist in the requested workspace — caller should 404 / return empty.
function resolveTargetChannel(target, requesterName, workspaceId = DEFAULT_WORKSPACE_ID) {
  const wsId = normalizeWorkspaceId(workspaceId);
  const { channelName, channelType, threadId } = parseTarget(target, requesterName);
  const ch = store.channels.find((c) => (
    (c.workspaceId || DEFAULT_WORKSPACE_ID) === wsId
    && c.name === channelName
    && (c.type || "channel") === channelType
  ));
  if (!ch) return { channel: null, channelName, channelType, threadId };
  return { channel: ch, channelName, channelType, threadId };
}

function embedAllowedChannelIds(user) {
  if (!isEmbedSessionUser(user)) return null;
  return new Set(Array.isArray(user.embed.allowedChannelIds) ? user.embed.allowedChannelIds : []);
}

function embedCanAccessChannel(user, channel, workspaceId = DEFAULT_WORKSPACE_ID) {
  if (!isEmbedSessionUser(user)) return true;
  if (!channel) return false;
  if ((channel.type || "channel") !== "channel") return false;
  if (normalizeWorkspaceId(user.embed.workspaceId) !== normalizeWorkspaceId(workspaceId)) return false;
  if (normalizeWorkspaceId(channel.workspaceId || DEFAULT_WORKSPACE_ID) !== normalizeWorkspaceId(workspaceId)) return false;
  return embedAllowedChannelIds(user)?.has(channel.id) || false;
}

function embedVisibleAgentIds(user) {
  const allowed = embedAllowedChannelIds(user);
  if (!allowed) return null;
  const ids = new Set();
  for (const channelId of allowed) {
    const members = store.channelAgents.get(channelId);
    if (!members) continue;
    for (const [agentId, membership] of members.entries()) {
      if (membership?.canRead || membership?.subscribed) ids.add(agentId);
    }
  }
  return ids;
}

function embedApiRouteAllowed(req) {
  const method = String(req.method || "").toUpperCase();
  const path = req.path || "";
  if (path === "/api/messages" && (method === "GET" || method === "POST")) return true;
  if (path === "/api/channels" && method === "GET") return true;
  return false;
}

// Channel ids the agent is allowed to read messages in: regular channels via
// channel_agents (canRead = true) + DMs that include the agent by name.
// DMs are party-scoped across workspaces (mirrors deliverToAllAgents /
// messageVisibleToAgent in PR #299) — an agent in workspace B can still pull
// DMs from a channel that lives in workspace A as long as it's a party.
function visibleChannelIdsForAgent(agentId) {
  const wsId = workspaceIdFromAgent(agentId);
  const agentName = (agentPayload(agentId)?.name
    || agentConfigs.find((c) => c.id === agentId)?.name
    || "").toLowerCase();
  const ids = [];
  for (const ch of store.channels) {
    if ((ch.type || "channel") === "dm") {
      const parties = dmChannelParties(ch.name) || [];
      if (agentName && parties.some((p) => String(p).toLowerCase() === agentName)) ids.push(ch.id);
      continue;
    }
    if ((ch.workspaceId || DEFAULT_WORKSPACE_ID) !== wsId) continue;
    if (agentCanRead(ch.id, agentId)) ids.push(ch.id);
  }
  return ids;
}

// Look up a message by full id from the in-memory index first (recent messages)
// and fall back to DB. Returns null if not found anywhere.
async function getMessageByIdAnywhere(id) {
  if (!id) return null;
  const cached = messagesById.get(id);
  if (cached) return cached;
  return await db.getMessageById(id);
}

const INLINE_REPLY_PREVIEW_LIMIT = 3;

function findThreadParentId(threadId) {
  if (!threadId) return null;
  // threadId is always an 8-char shortid (see parseTarget). messagesByShortId
  // covers messages seen since boot — for threads whose parent predates the
  // bootstrap window the lookup misses and the API returns null. Frontend
  // treats parentMessageId as a hint, not a hard requirement.
  const parent = messagesByShortId.get(threadId);
  return parent && !parent.threadId ? parent.id : null;
}

function collectThreadReplies(parentMsg, override = null) {
  if (!parentMsg || parentMsg.threadId) return { replies: [], replyCount: 0 };
  const shortid = parentMsg.id.slice(0, 8);
  // The override map (used by /api/messages for historical pages) carries
  // pre-fetched DB replies keyed by `${threadShortId}:${channelId}` — but ONLY
  // for the parents whose replies weren't already in the in-memory index.
  // Parents that are in the index keep the fast path; the override is a
  // gap-filler, not a wholesale replacement.
  const key = `${shortid}:${parentMsg.channelId}`;
  if (override && override.has(key)) {
    const matched = override.get(key);
    return { replies: matched.slice(-INLINE_REPLY_PREVIEW_LIMIT), replyCount: matched.length };
  }
  const all = repliesByThreadId.get(shortid) || [];
  // channelId guard preserves the original semantics — if two parents share
  // an 8-char prefix in different channels, we still attribute replies to the
  // right one. The reply array is small per-thread so this is cheap.
  const matched = all.filter((m) => m.channelId === parentMsg.channelId);
  return { replies: matched.slice(-INLINE_REPLY_PREVIEW_LIMIT), replyCount: matched.length };
}

// Unified read helpers: cache-first, DB-fallback. When DB is disabled the
// per-channel cache is the only source of truth, so these helpers degrade
// cleanly into "scan whatever's cached" without hitting null helpers.

async function readChannelHistory({ workspaceId, channelId, threadId = null, beforeSeq = null, afterSeq = null, limit = 100 }) {
  const wsId = normalizeWorkspaceId(workspaceId);
  const cached = store.channelMessages.get(channelId) || [];
  const cacheView = cached.filter((m) => (
    (m.workspaceId || DEFAULT_WORKSPACE_ID) === wsId
    && (threadId === null ? !m.threadId : m.threadId === threadId)
    && (beforeSeq == null || m.seq < beforeSeq)
    && (afterSeq == null || m.seq > afterSeq)
  ));
  if (!db.enabled) return cacheView.slice(-limit);
  // Latest-page fast path: no before cursor + cache covers the limit → skip DB.
  if (beforeSeq == null && cacheView.length >= limit) return cacheView.slice(-limit);
  return await db.queryMessages({ workspaceId: wsId, channelId, threadId, beforeSeq, afterSeq, limit });
}

async function readChannelHistoryAround({ workspaceId, channelId, centerSeq, limit }) {
  if (db.enabled) {
    return await db.queryMessagesAround({ workspaceId, channelId, centerSeq, limit });
  }
  // No-DB fallback: in-cache around-window.
  const cached = store.channelMessages.get(channelId) || [];
  const idx = cached.findIndex((m) => m.seq === centerSeq);
  if (idx < 0) return cached.slice(-limit);
  const half = Math.floor(limit / 2);
  return cached.slice(Math.max(0, idx - half), Math.min(cached.length, idx + half + 1));
}

async function readMessagesForAgent({ workspaceId, channelIds, sinceSeq, limit }) {
  if (!db.enabled) {
    const wsId = normalizeWorkspaceId(workspaceId);
    const set = new Set(channelIds);
    const out = [];
    for (const cid of set) {
      const arr = store.channelMessages.get(cid) || [];
      for (const m of arr) {
        // DM messages are party-scoped — workspace filter doesn't apply, so a
        // cross-workspace DM still reaches its recipient via check_messages.
        if (m.channelType !== "dm" && (m.workspaceId || DEFAULT_WORKSPACE_ID) !== wsId) continue;
        if (m.seq > sinceSeq) out.push(m);
      }
    }
    out.sort((a, b) => a.seq - b.seq);
    return out.slice(0, limit);
  }
  return await db.queryMessagesForAgent({ workspaceId, channelIds, sinceSeq, limit });
}

async function searchVisibleMessages({ workspaceId, channelIds, keyword, limit }) {
  if (!db.enabled) {
    const wsId = normalizeWorkspaceId(workspaceId);
    const set = new Set(channelIds);
    const out = [];
    const lowered = keyword ? keyword.toLowerCase() : null;
    for (const cid of set) {
      const arr = store.channelMessages.get(cid) || [];
      for (const m of arr) {
        // DM messages bypass workspace filter (see readMessagesForAgent).
        if (m.channelType !== "dm" && (m.workspaceId || DEFAULT_WORKSPACE_ID) !== wsId) continue;
        if (lowered && !String(m.content || '').toLowerCase().includes(lowered)) continue;
        out.push(m);
      }
    }
    out.sort((a, b) => b.seq - a.seq);
    return out.slice(0, limit);
  }
  return await db.searchMessages({ workspaceId, channelIds, keyword, limit });
}

async function readThreadReplies({ threadId, channelId, limit = 50 }) {
  if (!db.enabled) {
    const arr = repliesByThreadId.get(threadId) || [];
    return arr.filter((m) => m.channelId === channelId).slice(0, limit);
  }
  return await db.queryThreadReplies({ threadId, channelId, limit });
}

async function readThreadRepliesBatch(pairs, limit = 50) {
  if (!Array.isArray(pairs) || pairs.length === 0) return [];
  if (!db.enabled || typeof db.queryThreadRepliesBatch !== "function") {
    const results = await Promise.all(pairs.map(({ threadId, channelId }) => (
      readThreadReplies({ threadId, channelId, limit })
    )));
    return results.flat();
  }
  return await db.queryThreadRepliesBatch({ pairs, limit });
}

// Pre-fetch thread replies for any thread root in `parents` whose replies
// aren't already proven by the in-memory index. Recent parents live in
// messagesByShortId; because replies always have later seqs, the bootstrap
// window contains every possible recent reply for those parents. Treating a
// recent parent with no repliesByThreadId entry as "zero replies" avoids a DB
// point lookup per message on the hot latest-page read path. Historical pages
// still fetch missing previews from DB, but in a single batched query.
async function fetchThreadRepliesForPage(parents) {
  const started = perfNowMs();
  const missingByKey = new Map(); // `${threadId}:${channelId}` -> { threadId, channelId }
  let indexedReplies = 0;
  let indexedEmpty = 0;
  for (const m of parents) {
    if (m.threadId) continue;
    const shortid = m.id.slice(0, 8);
    if (messagesByShortId.has(shortid)) {
      if (repliesByThreadId.has(shortid)) {
        indexedReplies += 1;
      } else {
        indexedEmpty += 1;
      }
      continue;
    }
    missingByKey.set(`${shortid}:${m.channelId}`, { threadId: shortid, channelId: m.channelId });
  }
  if (missingByKey.size === 0) {
    logPerf("messages.thread_replies", perfNowMs() - started, {
      parents: parents.length,
      indexedReplies,
      indexedEmpty,
      dbPairs: 0,
    });
    return null;
  }
  const out = new Map();
  const missing = Array.from(missingByKey.values());
  const rows = await readThreadRepliesBatch(missing);
  for (const row of rows) {
    const key = `${row.threadId}:${row.channelId}`;
    let arr = out.get(key);
    if (!arr) {
      arr = [];
      out.set(key, arr);
    }
    arr.push(row);
  }
  logPerf("messages.thread_replies", perfNowMs() - started, {
    parents: parents.length,
    indexedReplies,
    indexedEmpty,
    dbPairs: missing.length,
    dbRows: rows.length,
  }, {
    force: PERF_LOG_MODE !== "slow" && missing.length >= PERF_THREAD_REPLY_PAIR_WARN,
  });
  return out;
}

const agentDeliveryRouter = new AgentDeliveryRouter({
  getThreadRootMessage: (threadId) => {
    const parent = messagesByShortId.get(threadId);
    return parent && !parent.threadId ? parent : null;
  },
  getThreadReplies: (threadId, channelId) => {
    const all = repliesByThreadId.get(threadId) || [];
    return all.filter((m) => m.channelId === channelId);
  },
});

function senderAvatarForMessage(msg) {
  const senderName = msg?.senderName || "";
  if (!senderName || senderName === "system" || msg?.senderType === "system") return {};
  if (msg.senderType === "agent") {
    const agent = Object.keys(store.agents)
      .map((id) => agentPayload(id))
      .find((a) => a && (a.name === senderName || a.displayName === senderName));
    const config = agentConfigs.find((c) => c.name === senderName || c.displayName === senderName);
    return {
      senderPicture: agent?.picture || config?.picture || null,
      senderGravatarUrl: null,
    };
  }
  const sessionUser = Array.from(authSessions.values()).find((user) => user?.name === senderName);
  if (sessionUser?.picture || sessionUser?.gravatarUrl) {
    return {
      senderPicture: sessionUser.picture || null,
      senderGravatarUrl: sessionUser.gravatarUrl || null,
    };
  }
  const human = onlineHumans.get(senderName)
    || allTimeHumans.get(senderName)
    || store.humans.find((h) => h.name === senderName);
  return {
    senderPicture: human?.picture || null,
    senderGravatarUrl: human?.gravatarUrl || null,
  };
}

function formatMessageForClient(msg, viewerName, options = {}) {
  const { includeReplies = false, threadReplyOverride = null } = options;
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
    workspaceId: msg.workspaceId || DEFAULT_WORKSPACE_ID,
    channelId: msg.channelId || null,
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
    ...senderAvatarForMessage(msg),
    // Include parties so frontend can resolve peer without viewerName
    ...(parties && !viewerName ? { dmParties: parties } : {}),
  };
  if (includeReplies && !isThread) {
    const { replies, replyCount } = collectThreadReplies(msg, threadReplyOverride);
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
    workspace_id: formatted.workspaceId,
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
//      sources that exceed WS_RATE_BLOCK_THRESHOLD opens within
//      WS_RATE_WINDOW_MS for WS_BLOCK_DURATION_MS only when they look like
//      true churn (nearly no live sockets). Multiple legitimate browser
//      windows share one token and should not be killed merely for all
//      reconnecting around the same time after a deploy or visibility event.
//   2. Defer the init send via setImmediate so a burst is interleaved with
//      other event-loop work instead of monopolizing one tick.
//
// Tracker entries are surfaced via /api/_internal/ws-clients so the operator
// can see who's misbehaving and revoke the offending session from Settings.
const WS_RATE_WINDOW_MS = 60_000;
const WS_RATE_BLOCK_THRESHOLD = Number(process.env.WS_RATE_BLOCK_THRESHOLD || 24);
const WS_RATE_BLOCK_MAX_OPEN = Number(process.env.WS_RATE_BLOCK_MAX_OPEN || 1);
const WS_RATE_HARD_BLOCK_THRESHOLD = Number(process.env.WS_RATE_HARD_BLOCK_THRESHOLD || 120);
const WS_BLOCK_DURATION_MS = 5 * 60_000;
const WS_TRACKER_TTL_MS = 24 * 60 * 60 * 1000;
const WS_REVOKE_BLOCK_MS = 24 * 60 * 60 * 1000;
// Invalid token = client sent ?token=… but it isn't in authSessions. Almost
// always a stale tab after revoke/logout/deploy. The client's own retry
// budget will keep firing it; harshly throttle to make it cheap.
const WS_INVALID_TOKEN_THRESHOLD = Number(process.env.WS_INVALID_TOKEN_THRESHOLD || 10);
const WS_INVALID_BLOCK_MS = 5 * 60_000;

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
  const recentCount = entry.recentConnects.length;
  const hardStorm = recentCount > WS_RATE_HARD_BLOCK_THRESHOLD;
  const churnStorm = recentCount > WS_RATE_BLOCK_THRESHOLD && entry.openCount <= WS_RATE_BLOCK_MAX_OPEN;
  if (hardStorm || churnStorm) {
    entry.blockedUntil = nowMs + WS_BLOCK_DURATION_MS;
    entry.blockReason = hardStorm
      ? `auto: ${recentCount} connects in ${WS_RATE_WINDOW_MS / 1000}s (hard limit ${WS_RATE_HARD_BLOCK_THRESHOLD})`
      : `auto: ${recentCount} connects in ${WS_RATE_WINDOW_MS / 1000}s with ${entry.openCount} open (limit ${WS_RATE_BLOCK_THRESHOLD}, max open ${WS_RATE_BLOCK_MAX_OPEN})`;
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
    const dropped = queue.splice(0, queue.length - PENDING_DELIVERY_CAP);
    console.warn(`[delivery] pending queue overflow agent=${agentId} cap=${PENDING_DELIVERY_CAP} dropped=${dropped.length} (oldest message=${dropped[0]?.message?.id})`);
  }
}

function replayPendingDeliveries(agentId) {
  const queue = pendingDeliveries.get(agentId);
  if (!queue || queue.length === 0) return;
  pendingDeliveries.delete(agentId);
  const cutoff = Date.now() - PENDING_DELIVERY_TTL_MS;
  let expired = 0;
  for (const item of queue) {
    if (item.queuedAt < cutoff) {
      expired += 1;
      continue;
    }
    deliverToAgent(agentId, item.message);
  }
  if (expired > 0) {
    console.warn(`[delivery] replay dropped ${expired} expired message(s) agent=${agentId} ttl_ms=${PENDING_DELIVERY_TTL_MS}`);
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
  const eventWorkspaceId = workspaceEventIdFromPayload(event);
  if (eventWorkspaceId && normalizeWorkspaceId(ws._workspaceId || DEFAULT_WORKSPACE_ID) !== eventWorkspaceId) {
    return false;
  }
  const viewerUser = ws._authToken ? getAuthSession(ws._authToken) : null;
  if (isEmbedSessionUser(viewerUser) && event.type !== "message" && event.type !== "new_message") {
    return false;
  }
  if (event.type !== "message" && event.type !== "new_message") return true;
  const msg = event.message;
  if (!msg) return true;
  if (isEmbedSessionUser(viewerUser)) {
    const channel = msg.channelId
      ? store.channels.find((ch) => ch.id === msg.channelId)
      : store.channels.find((ch) => (
        (ch.workspaceId || DEFAULT_WORKSPACE_ID) === normalizeWorkspaceId(msg.workspaceId || DEFAULT_WORKSPACE_ID)
        && ch.name === (msg.parentChannelName || msg.channelName)
        && (ch.type || "channel") === (msg.parentChannelType || msg.channelType || "channel")
      ));
    return embedCanAccessChannel(viewerUser, channel, msg.workspaceId || DEFAULT_WORKSPACE_ID);
  }
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
});
const embedSettings = createEmbedSettingsStore({
  filePath: WORKSPACE_EMBED_SETTINGS_FILE,
  db,
  defaultWorkspaceId: DEFAULT_WORKSPACE_ID,
});
const embedSessionRateLimiter = createEmbedRateLimiter();

function removeWorkspaceFromMemory(workspaceId) {
  const id = normalizeWorkspaceId(workspaceId);
  if (id === DEFAULT_WORKSPACE_ID) return false;
  const existing = findWorkspace(id);
  if (!existing) return false;

  const removedChannelIds = new Set(
    store.channels
      .filter((channel) => normalizeWorkspaceId(channel.workspaceId || DEFAULT_WORKSPACE_ID) === id)
      .map((channel) => channel.id)
  );
  const removedAgentIds = new Set(
    agentConfigs
      .filter((config) => normalizeWorkspaceId(config.workspaceId || DEFAULT_WORKSPACE_ID) === id)
      .map((config) => config.id)
  );
  for (const [agentId, agent] of Object.entries(store.agents)) {
    if (normalizeWorkspaceId(agent?.workspaceId || workspaceIdFromAgent(agentId)) === id) {
      removedAgentIds.add(agentId);
    }
  }

  store.workspaces = store.workspaces.filter((workspace) => workspace.id !== id);
  store.workspaceMembers.delete(id);
  store.channels = store.channels.filter((channel) => normalizeWorkspaceId(channel.workspaceId || DEFAULT_WORKSPACE_ID) !== id);
  store.tasks = store.tasks.filter((task) => normalizeWorkspaceId(task.workspaceId || DEFAULT_WORKSPACE_ID) !== id);

  for (const channelId of removedChannelIds) {
    store.channelAgents.delete(channelId);
    store.channelMessages.delete(channelId);
  }

  for (const [messageId, message] of messagesById.entries()) {
    if (normalizeWorkspaceId(message.workspaceId || DEFAULT_WORKSPACE_ID) === id) messagesById.delete(messageId);
  }
  for (const [shortId, message] of messagesByShortId.entries()) {
    if (normalizeWorkspaceId(message.workspaceId || DEFAULT_WORKSPACE_ID) === id) messagesByShortId.delete(shortId);
  }
  for (const [threadId, replies] of repliesByThreadId.entries()) {
    const kept = replies.filter((message) => normalizeWorkspaceId(message.workspaceId || DEFAULT_WORKSPACE_ID) !== id);
    if (kept.length === 0) repliesByThreadId.delete(threadId);
    else if (kept.length !== replies.length) repliesByThreadId.set(threadId, kept);
  }
  for (const [channelId, messages] of store.channelMessages.entries()) {
    const kept = messages.filter((message) => normalizeWorkspaceId(message.workspaceId || DEFAULT_WORKSPACE_ID) !== id);
    if (kept.length === 0) store.channelMessages.delete(channelId);
    else if (kept.length !== messages.length) store.channelMessages.set(channelId, kept);
  }
  for (const key of [...taskTimes.keys()]) {
    if (key.startsWith(`${id}:`)) taskTimes.delete(key);
  }

  for (const agentId of removedAgentIds) {
    sendAgentStop(agentId);
    purgeAgentMemberships(agentId);
    purgeUnknownAgentState(agentId);
  }
  if (removedAgentIds.size > 0) {
    for (let i = agentConfigs.length - 1; i >= 0; i--) {
      if (removedAgentIds.has(agentConfigs[i].id)) agentConfigs.splice(i, 1);
    }
    saveAgentConfigs(agentConfigs);
  }

  let machineKeysChanged = false;
  for (let i = machineKeys.length - 1; i >= 0; i--) {
    if (normalizeWorkspaceId(machineKeys[i].workspaceId || DEFAULT_WORKSPACE_ID) === id) {
      machineKeys.splice(i, 1);
      machineKeysChanged = true;
    }
  }
  if (machineKeysChanged) saveMachineKeys(machineKeys);

  for (const [machineId, machine] of machines.entries()) {
    if (normalizeWorkspaceId(machine.workspaceId || DEFAULT_WORKSPACE_ID) === id) machines.delete(machineId);
  }
  for (const ws of daemonConnections) {
    if (normalizeWorkspaceId(ws._workspaceId || DEFAULT_WORKSPACE_ID) === id) {
      try { ws.close(1008, "workspace deleted"); } catch { void 0; }
    }
  }
  for (const key of [...dbAllowEmails.keys()]) {
    if (key.startsWith(`${id}:`)) dbAllowEmails.delete(key);
  }
  for (const key of [...removedWorkspaceMembers.keys()]) {
    if (key.startsWith(`${id}:`)) removedWorkspaceMembers.delete(key);
  }
  profilePresets.removeWorkspace?.(id);
  embedSettings.removeWorkspace(id);
  return true;
}

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
  // Strip base64 `picture` from mid-session humans_updated frames — they fan
  // out to every viewer and balloon the broadcast. Clients keep their cached
  // picture for known humans and pick up changes on next `init` (reconnect /
  // reload). The machine that actually changed the avatar updates locally via
  // the optimistic patch in `updateCurrentUser`.
  const slim = store.humans.map(({ picture: _picture, ...rest }) => rest);
  broadcastToWeb({ type: "humans_updated", humans: slim });
}

function broadcastWorkspaceMembers(workspaceId) {
  const id = normalizeWorkspaceId(workspaceId);
  broadcastToWeb({
    type: "workspace:members",
    workspaceId: id,
    members: listWorkspaceMembers(id),
  });
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

function removeAllTimeHumanIfInaccessible(email) {
  const normalized = String(email || "").trim().toLowerCase();
  if (!normalized) return false;
  let changed = false;
  for (const user of authSessions.values()) {
    if (String(user?.email || "").trim().toLowerCase() !== normalized) continue;
    if (visibleWorkspacesForUser(user).length > 0) continue;
    if (allTimeHumans.delete(user.name)) changed = true;
  }
  return changed;
}

function closeWorkspaceSocketsForEmail(workspaceId, email, reason = "workspace membership removed") {
  const id = normalizeWorkspaceId(workspaceId);
  const normalized = String(email || "").trim().toLowerCase();
  if (!normalized) return 0;
  let closed = 0;
  for (const ws of webSockets) {
    const user = ws._authToken ? getAuthSession(ws._authToken) : null;
    if (String(user?.email || "").trim().toLowerCase() !== normalized) continue;
    if (normalizeWorkspaceId(ws._workspaceId || DEFAULT_WORKSPACE_ID) !== id) continue;
    try { ws.close(4003, reason); } catch { void 0; }
    closed += 1;
  }
  return closed;
}

function resolveWsHuman(msg = {}, fallbackToken = null) {
  const token = typeof msg.token === "string" && msg.token ? msg.token : fallbackToken;
  const user = token ? getAuthSession(token) : null;
  if (user) {
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
    let payload;
    try {
      payload = JSON.stringify({
        type: "agent:deliver",
        agentId,
        seq,
        message: formatMessageForAgent(message, agentId),
      });
    } catch (e) {
      console.error(`[delivery] serialize failed agent=${agentId} message=${message?.id} channel=${message?.channelName}:`, e.message);
      return;
    }
    try {
      ws.send(payload);
    } catch (e) {
      console.error(`[delivery] ws.send failed agent=${agentId} message=${message?.id} seq=${seq} readyState=${ws.readyState}:`, e.message);
      queuePendingDelivery(agentId, message);
      return;
    }
    // Do NOT pre-mark as read here. Pre-marking was breaking mid-turn steering
    // for notification-mode drivers (Claude): the daemon would notify the agent
    // "N new messages waiting", the agent would call check_messages, and the
    // server would return nothing because the message was already marked read.
    // The agent's own check_messages call now advances the cursor via /receive.
    return;
  }
  const reason = ws ? `ws_state_${ws.readyState}` : "no_socket";
  console.warn(`[delivery] daemon not ready agent=${agentId} message=${message?.id} channel=${message?.channelName} reason=${reason}; queueing`);
  queuePendingDelivery(agentId, message);
}

function deliveryAgentsById() {
  const agentsById = {};
  for (const cfg of agentConfigs) {
    agentsById[cfg.id] = {
      id: cfg.id,
      name: cfg.name || cfg.id,
      displayName: cfg.displayName || cfg.name || cfg.id,
    };
  }
  for (const [agentId, runtime] of Object.entries(store.agents)) {
    const cfg = agentConfigs.find((c) => c.id === agentId);
    agentsById[agentId] = {
      id: agentId,
      ...runtime,
      name: cfg?.name || runtime.name || agentId,
      displayName: cfg?.displayName || cfg?.name || runtime.displayName || runtime.name || agentId,
    };
  }
  return agentsById;
}

function rebuildDeliveryRoutingWindows(seedMessages = []) {
  // Called at bootstrap with the last N messages loaded from DB. After boot,
  // routing windows are maintained incrementally via recordMessage on each
  // new message. Cold-start coverage = the bootstrap window size.
  agentDeliveryRouter.rebuildChannelWindows(seedMessages, {
    agentsById: deliveryAgentsById(),
  });
}

function deliverToAllAgents(message, excludeAgent = null) {
  const workspaceId = normalizeWorkspaceId(message.workspaceId || DEFAULT_WORKSPACE_ID);
  // Resolve the channel row so we can ask who's subscribed. Messages always
  // carry channelId (set at write time); fall back to name/type lookup in
  // case of old records.
  const ch = message.channelId
    ? store.channels.find((c) => c.id === message.channelId)
    : store.channels.find((c) => (
      (c.workspaceId || DEFAULT_WORKSPACE_ID) === workspaceId
      && c.name === message.channelName
      && (c.type || "channel") === (message.channelType || "channel")
    ));

  // DMs derive subscribers from the canonical party list — bypasses
  // channel_agents so a missing seed row can't strand the agent party.
  let subscribedIds;
  if (ch && (ch.type || "channel") === "dm") {
    const parties = dmChannelParties(ch.name) || [];
    subscribedIds = parties
      .map((p) => agentIdByName(p, workspaceId))
      .filter(Boolean);
  } else {
    subscribedIds = ch ? subscribedAgentIdsFor(ch.id) : [];
  }

  const isDmChannel = ch && (ch.type || "channel") === "dm";
  const activeSubscribedIds = subscribedIds.filter((agentId) => {
    const agent = store.agents[agentId];
    // DMs are party-scoped, not workspace-scoped — skip workspace filter so
    // agents in different workspace slots still receive their DMs.
    return agent && agent.status === "active" && (isDmChannel || workspaceIdFromAgent(agentId) === workspaceId);
  });

  const agentsById = deliveryAgentsById();
  const recipientIds = agentDeliveryRouter.resolveRecipients({
    message,
    visibleAgentIds: activeSubscribedIds,
    agentsById,
    excludeAgentId: excludeAgent,
  });

  for (const agentId of recipientIds) {
    deliverToAgent(agentId, message);
  }
  agentDeliveryRouter.recordMessage(message, { agentsById });
}

// ─── Express app ──────────────────────────────────────────────────

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

const PERF_HTTP_PATHS = [
  /^\/api\/messages$/,
  /^\/internal\/agent\/[^/]+\/send$/,
  /^\/internal\/agent\/[^/]+\/receive$/,
  /^\/internal\/agent\/[^/]+\/history$/,
];
app.use((req, res, next) => {
  if (!PERF_LOG_ENABLED || !PERF_HTTP_PATHS.some((re) => re.test(req.path))) {
    return next();
  }
  const started = perfNowMs();
  res.on("finish", () => {
    const durationMs = perfNowMs() - started;
    const agentPathMatch = req.path.match(/^\/internal\/agent\/([^/]+)\//);
    const requestId = req.headers["x-request-id"]
      || req.headers["x-railway-request-id"]
      || req.headers["cf-ray"]
      || req.headers["fly-request-id"];
    logPerf("http", durationMs, {
      method: req.method,
      path: req.path,
      status: res.statusCode,
      requestId,
      agentId: agentPathMatch?.[1],
      channel: req.headers["x-channel"] || req.query?.channel,
      target: req.body?.target,
      before: req.headers["x-before"] || req.query?.before,
      after: req.headers["x-after"] || req.query?.after,
      limit: req.headers["x-limit"] || req.query?.limit,
      workspaceId: req.headers["x-workspace-id"] || req.query?.workspaceId || req.body?.workspaceId,
    });
  });
  return next();
});

// k8s / docker readiness probe. Kept above auth so it stays callable when
// upstream services (Postgres, OpenViking) are degraded — health here means
// "process is up", not "dependencies are healthy".
app.get("/health", (req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

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
    const ref = { id: aid, filename: meta.filename, contentType: meta.contentType };
    // Surface image dimensions so the client can reserve aspect-ratio space
    // and avoid layout shift when the <img> loads.
    if (typeof meta.width === "number" && typeof meta.height === "number") {
      ref.width = meta.width;
      ref.height = meta.height;
    }
    return ref;
  });
}

// ─── REST API: MCP tool endpoints ─────────────────────────────────

// send_message
app.post("/internal/agent/:agentId/send", (req, res) => {
  const { agentId } = req.params;
  const { target, content, attachmentIds } = req.body;
  const workspaceId = workspaceIdFromAgent(agentId);
  // Use config-derived name (agentPayload overlays config on runtime).
  // store.agents[agentId].name may still be the raw ID for agents that
  // were already running before configs were loaded/fixed.
  const senderName = agentPayload(agentId)?.name || agentId;
  const { channelName, channelType, threadId } = parseTarget(target, senderName);
  const ch = findOrCreateChannel(channelName, channelType, workspaceId);

  const msg = {
    id: uuidv4(),
    seq: nextSeq(),
    workspaceId,
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
  broadcastToWeb({ type: "message", workspaceId, message: formatMessageForClient(msg) });

  res.json({ messageId: msg.id, recentUnread: [] });
});

// check_messages (receive)
const AGENT_RECEIVE_BATCH_LIMIT = 500;
app.get("/internal/agent/:agentId/receive", async (req, res) => {
  const { agentId } = req.params;
  const lastRead = store.agentReadSeq[agentId] || 0;
  const selfName = agentPayload(agentId)?.name || agentId;
  const workspaceId = workspaceIdFromAgent(agentId);
  const channelIds = visibleChannelIdsForAgent(agentId);
  const rows = channelIds.length > 0
    ? await readMessagesForAgent({
        workspaceId, channelIds, sinceSeq: lastRead, limit: AGENT_RECEIVE_BATCH_LIMIT,
      })
    : [];
  // Self-send suppression stays in JS — DM and channel messages can include
  // ones from the agent itself when posting on its own behalf.
  const unread = rows
    .filter((m) => m.senderName !== selfName)
    .map((m) => formatMessageForAgent(m, agentId));
  // Advance the read pointer. If we hit the batch limit there are likely
  // more — only advance to the last seq we actually fetched so the next call
  // continues from there. Otherwise we've drained everything ≤ store.seq, so
  // jump to store.seq to skip past any messages this agent can't see.
  if (rows.length >= AGENT_RECEIVE_BATCH_LIMIT) {
    store.agentReadSeq[agentId] = rows[rows.length - 1].seq;
  } else {
    store.agentReadSeq[agentId] = store.seq;
  }
  res.json({ messages: unread });
});

// list_server
app.get("/internal/agent/:agentId/server", (req, res) => {
  const { agentId } = req.params;
  const workspaceId = workspaceIdFromAgent(agentId);
  const channels = store.channels
    .filter((ch) => (ch.workspaceId || DEFAULT_WORKSPACE_ID) === workspaceId && (ch.type || "channel") === "channel")
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
    if ((p?.workspaceId || DEFAULT_WORKSPACE_ID) !== workspaceId) return null;
    return { name: p?.name || id, status: p?.status || "inactive" };
  }).filter(Boolean);
  res.json({ channels, agents, humans: store.humans });
});

// list the agent's channel memberships (subscriptions)
app.get("/internal/agent/:agentId/subscriptions", (req, res) => {
  const { agentId } = req.params;
  const workspaceId = workspaceIdFromAgent(agentId);
  const out = [];
  for (const ch of store.channels) {
    if ((ch.workspaceId || DEFAULT_WORKSPACE_ID) !== workspaceId) continue;
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
  const workspaceId = workspaceIdFromAgent(agentId);
  const { channelId, channelName, channelType = "channel", canRead, subscribed } = req.body || {};
  let ch;
  if (channelId) {
    ch = store.channels.find((c) => c.id === channelId && (c.workspaceId || DEFAULT_WORKSPACE_ID) === workspaceId);
  } else if (channelName) {
    ch = store.channels.find((c) => (
      (c.workspaceId || DEFAULT_WORKSPACE_ID) === workspaceId
      && c.name === channelName
      && (c.type || "channel") === channelType
    ));
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
app.get("/internal/agent/:agentId/history", async (req, res) => {
  const { agentId } = req.params;
  const { channel, limit = 50, before, after, around } = req.query;
  const agentName = store.agents[agentId]?.name || agentId;
  const workspaceId = workspaceIdFromAgent(agentId);
  const resolved = resolveTargetChannel(channel, agentName, workspaceId);
  if (!resolved.channel || !messageVisibleToAgent({
    workspaceId, channelId: resolved.channel.id,
    channelName: resolved.channelName, channelType: resolved.channelType,
  }, agentId)) {
    return res.json({
      messages: [], last_read_seq: store.seq,
      has_more: false, has_older: false, has_newer: false,
      historyLimited: false, historyLimitMessage: null,
    });
  }
  const channelId = resolved.channel.id;
  const threadId = resolved.threadId;
  const limitNum = parseInt(limit);

  let rows;
  if (around) {
    // around can be a message id or a numeric seq string.
    let centerSeq;
    const aroundNum = parseInt(around);
    if (Number.isFinite(aroundNum) && String(aroundNum) === String(around)) {
      centerSeq = aroundNum;
    } else {
      const centerMsg = await getMessageByIdAnywhere(around);
      centerSeq = centerMsg ? centerMsg.seq : null;
    }
    rows = centerSeq != null
      ? await readChannelHistoryAround({ workspaceId, channelId, centerSeq, limit: limitNum })
      : await readChannelHistory({ workspaceId, channelId, threadId, limit: limitNum });
  } else {
    const beforeSeq = before ? parseInt(before) : null;
    const afterSeq = after ? parseInt(after) : null;
    rows = await readChannelHistory({
      workspaceId, channelId, threadId, beforeSeq, afterSeq, limit: limitNum,
    });
  }

  res.json({
    messages: rows.map((m) => formatMessageForAgent(m, agentId)),
    last_read_seq: store.seq,
    has_more: false,
    has_older: false,
    has_newer: false,
    historyLimited: false,
    historyLimitMessage: null,
  });
});

// search_messages
app.get("/internal/agent/:agentId/search", async (req, res) => {
  const { agentId } = req.params;
  const agentName = store.agents[agentId]?.name || agentId;
  const workspaceId = workspaceIdFromAgent(agentId);
  const { q, limit = 10, channel } = req.query;
  // Pre-scope to channels the agent can read so DM/private-channel content
  // can't leak via the search path. If a target channel is given, narrow
  // further to just that channel (if visible).
  let scopedChannelIds = visibleChannelIdsForAgent(agentId);
  if (channel) {
    const resolved = resolveTargetChannel(channel, agentName, workspaceId);
    if (!resolved.channel || !scopedChannelIds.includes(resolved.channel.id)) {
      return res.json({ results: [] });
    }
    scopedChannelIds = [resolved.channel.id];
  }
  const rows = q
    ? await searchVisibleMessages({ workspaceId, channelIds: scopedChannelIds, keyword: q, limit: parseInt(limit) })
    : [];
  // searchMessages returns seq DESC (newest first); flip so the API stays
  // consistent with the old "slice(-limit)" shape (oldest first within the page).
  rows.reverse();

  res.json({
    results: rows.map((m) => ({
      ...formatMessageForClient(m),
      seq: m.seq,
      createdAt: m.createdAt,
      snippet: m.content.substring(0, 200),
    })),
  });
});

// list_tasks
app.get("/internal/agent/:agentId/tasks", (req, res) => {
  const { agentId } = req.params;
  const { channel, status } = req.query;
  const agentName = store.agents[agentId]?.name || agentId;
  const workspaceId = workspaceIdFromAgent(agentId);
  let tasks = store.tasks.filter((t) => (t.workspaceId || DEFAULT_WORKSPACE_ID) === workspaceId);
  if (channel) {
    tasks = tasks.filter((t) => taskMatchesTarget(t, channel, agentName));
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
app.post("/internal/agent/:agentId/tasks", async (req, res) => {
  const { agentId } = req.params;
  const { channel, tasks: taskDefs } = req.body;
  const agentName = store.agents[agentId]?.name || agentId;
  const workspaceId = workspaceIdFromAgent(agentId);
  const { channelName, channelType } = parseTarget(channel, agentName);
  const ch = findOrCreateChannel(channelName, channelType, workspaceId);

  const created = [];
  for (const td of taskDefs) {
    const taskNum = nextTaskNum();
    const msgId = uuidv4();
    const task = {
      taskNumber: taskNum,
      workspaceId,
      channelId: ch.id,
      channelName: ch.name,
      title: td.title,
      status: "todo",
      messageId: msgId,
      claimedByName: null,
      claimedByType: null,
      createdByName: agentName,
    };
    store.tasks.push(task);

    // Create a system message for the task
    const msg = {
      id: msgId,
      seq: nextSeq(),
      workspaceId,
      channelId: ch.id,
      channelName: ch.name,
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
    await db.saveTask(task);
    await db.saveMessage(msg);
    broadcastToWeb({ type: "message", workspaceId, message: formatMessageForClient(msg) });

    created.push({ taskNumber: taskNum, messageId: msgId, title: td.title });
  }

  res.json({ tasks: created });
});

// claim_tasks
// Claims existing tasks by task number or by backing message id.
// If a top-level message has no task yet, atomically convert it into a task
// and claim it. Thread replies remain discussion context and are not claimable.
app.post("/internal/agent/:agentId/tasks/claim", async (req, res) => {
  const { agentId } = req.params;
  const { channel, task_numbers, message_ids } = req.body;
  const agentName = store.agents[agentId]?.name || agentId;
  const workspaceId = workspaceIdFromAgent(agentId);

  const claimTask = async (task) => {
    const num = task.taskNumber;
    if (task.claimedByName && task.claimedByName !== agentName) {
      return { taskNumber: num, messageId: task.messageId, success: false, reason: `already claimed by @${task.claimedByName}` };
    }

    const alreadyClaimedBySelf = task.claimedByName === agentName && task.status === "in_progress";
    task.claimedByName = agentName;
    task.claimedByType = "agent";
    task.status = "in_progress";
    await db.saveTask(task);
    await syncTaskBackingMessage(task);

    if (!alreadyClaimedBySelf) {
      const chPayload = taskChannelPayload(task);
      const msg = {
        id: uuidv4(), seq: nextSeq(),
        ...chPayload,
        threadId: null,
        senderName: "system", senderType: "system",
        content: `📌 ${agentName} claimed #${num} "${task.title}"`,
        createdAt: now(), attachments: [], taskNumber: num, taskStatus: "in_progress",
      };
      appendMessage(msg);
      await db.saveMessage(msg);
      broadcastToWeb({ type: "message", workspaceId: msg.workspaceId || workspaceId, message: formatMessageForClient(msg) });
    }

    return { taskNumber: num, messageId: task.messageId, success: true, reason: null };
  };

  const claimMessageId = async (mid) => {
    const taskResolved = resolveUniqueByIdOrPrefix(
      store.tasks.filter((t) => (t.workspaceId || DEFAULT_WORKSPACE_ID) === workspaceId),
      mid,
      (t) => t.messageId
    );
    if (taskResolved.item) {
      return withTaskMutationLock(`task:${taskResolved.item.taskNumber}`, () => claimTask(taskResolved.item));
    }
    if (taskResolved.reason === "ambiguous id prefix") {
      return { taskNumber: null, messageId: mid, success: false, reason: "ambiguous message id prefix" };
    }

    // Resolve mid → message via in-memory index first (recent messages), then
    // DB (exact id, then 8-char prefix). Visibility / channel filtering happen
    // after the lookup so the caller's policy is enforced uniformly.
    const channelMatch = (m) => !channel || matchesTarget(m, channel, agentName);
    const visibleAndOnTarget = (m) => messageVisibleToAgent(m, agentId) && channelMatch(m);

    let message = null;
    let reason = null;
    if (typeof mid === "string" && mid.length > 0) {
      const cachedExact = messagesById.get(mid);
      if (cachedExact && visibleAndOnTarget(cachedExact)) {
        message = cachedExact;
      } else {
        const dbExact = await db.getMessageById(mid);
        if (dbExact && visibleAndOnTarget(dbExact)) {
          message = dbExact;
        } else if (mid.length >= 8 && mid.length < 36) {
          // Prefix search — agent notifications header short message IDs as 8 chars.
          const cachedShort = messagesByShortId.get(mid.slice(0, 8));
          const candidates = [];
          if (cachedShort && cachedShort.id.startsWith(mid)) candidates.push(cachedShort);
          const dbPrefix = await db.findMessagesByIdPrefix({ prefix: mid, workspaceId });
          for (const m of dbPrefix) {
            if (!candidates.some((c) => c.id === m.id)) candidates.push(m);
          }
          const visible = candidates.filter(visibleAndOnTarget);
          if (visible.length === 1) {
            message = visible[0];
          } else if (visible.length > 1) {
            reason = "ambiguous message id prefix";
          }
        }
      }
    }
    if (!message) {
      return { taskNumber: null, messageId: mid, success: false, reason: reason || "message not found" };
    }
    if (message.threadId) {
      return { taskNumber: null, messageId: message.id, success: false, reason: "thread messages cannot be claimed as tasks" };
    }

    return withTaskMutationLock(`message:${message.id}`, async () => {
      const taskAfterLock = store.tasks.find((t) => (
        t.messageId === message.id
        && (t.workspaceId || DEFAULT_WORKSPACE_ID) === workspaceId
      ));
      if (taskAfterLock) return claimTask(taskAfterLock);

      const taskNum = nextTaskNum();
      const task = {
        taskNumber: taskNum,
        workspaceId,
        channelId: message.channelId,
        channelName: message.channelName,
        title: taskTitleFromMessage(message),
        status: "todo",
        messageId: message.id,
        claimedByName: null,
        claimedByType: null,
        createdByName: message.senderName || agentName,
      };
      store.tasks.push(task);
      await db.saveTask(task);
      message.taskNumber = taskNum;
      message.taskStatus = "todo";
      message.taskAssigneeId = null;
      message.taskAssigneeType = null;
      await db.saveMessage(message);

      return claimTask(task);
    });
  };

  const results = [];
  if (task_numbers) {
    for (const num of task_numbers) {
      const task = store.tasks.find((t) => t.taskNumber === num && (t.workspaceId || DEFAULT_WORKSPACE_ID) === workspaceId);
      if (!task) {
        results.push({ taskNumber: num, messageId: null, success: false, reason: "task not found" });
        continue;
      }
      results.push(await withTaskMutationLock(`task:${num}`, () => claimTask(task)));
    }
  }
  if (message_ids) {
    for (const mid of message_ids) {
      results.push(await claimMessageId(mid));
    }
  }

  res.json({ results });
});

// unclaim_task
app.post("/internal/agent/:agentId/tasks/unclaim", async (req, res) => {
  const { agentId } = req.params;
  const { task_number } = req.body;
  const workspaceId = workspaceIdFromAgent(agentId);
  const task = store.tasks.find((t) => (
    t.taskNumber === task_number
    && (t.workspaceId || DEFAULT_WORKSPACE_ID) === workspaceId
  ));
  if (task) {
    task.claimedByName = null;
    task.claimedByType = null;
    task.status = "todo";
    await db.saveTask(task);
    await syncTaskBackingMessage(task);
  }
  res.json({ success: true });
});

// update_task_status
app.post("/internal/agent/:agentId/tasks/update-status", async (req, res) => {
  const { agentId } = req.params;
  const { task_number, status } = req.body;
  const workspaceId = workspaceIdFromAgent(agentId);
  const task = store.tasks.find((t) => (
    t.taskNumber === task_number
    && (t.workspaceId || DEFAULT_WORKSPACE_ID) === workspaceId
  ));
  if (task) {
    task.status = status;
    await db.saveTask(task);
    await syncTaskBackingMessage(task);
    const agentName = store.agents[agentId]?.name || agentId;
    const emoji = status === "done" ? "✅" : status === "in_review" ? "👀" : "🔄";

    const chPayload = taskChannelPayload(task);
    const msg = {
      id: uuidv4(), seq: nextSeq(),
      ...chPayload,
      threadId: null,
      senderName: "system", senderType: "system",
      content: `${emoji} ${agentName} moved #${task_number} "${task.title}" to ${status}`,
      createdAt: now(), attachments: [], taskNumber: task_number, taskStatus: status,
    };
    appendMessage(msg);
    await db.saveMessage(msg);
    broadcastToWeb({ type: "message", workspaceId: msg.workspaceId || workspaceId, message: formatMessageForClient(msg) });
  }
  res.json({ success: true });
});

// resolve-channel
app.post("/internal/agent/:agentId/resolve-channel", (req, res) => {
  const { agentId } = req.params;
  const agentName = store.agents[agentId]?.name || agentId;
  const workspaceId = workspaceIdFromAgent(agentId);
  const { target } = req.body;
  const { channelName, channelType } = parseTarget(target, agentName);
  const ch = findOrCreateChannel(channelName, channelType, workspaceId);
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
  const user = token ? getAuthSession(token) : null;
  const workspaceId = workspaceIdFromReq(req);
  if (!user) {
    return res.status(403).json({ error: "Authentication required. Please sign in to perform this action." });
  }
  if (!isEmbedSessionUser(user) && allowlistActive(workspaceId) && !isEmailAllowed(user.email, workspaceId)) {
    return res.status(403).json({ error: "Email not authorized to access this server." });
  }
  if (!isEmbedSessionUser(user)) ensureWorkspaceMemberForUser(user, workspaceId);
  if (!findWorkspace(workspaceId) || !userCanAccessWorkspace(user, workspaceId)) {
    return res.status(403).json({ error: "Not a member of this workspace." });
  }
  if (isEmbedSessionUser(user) && !embedApiRouteAllowed(req)) {
    return res.status(403).json({ error: "Embed session is not allowed to access this API." });
  }
  req.workspaceId = workspaceId;
  req.user = user;
  next();
}

function requireSessionAuth(req, res, next) {
  const token = req.headers.authorization?.replace("Bearer ", "");
  const user = token ? getAuthSession(token) : null;
  if (!user) {
    return res.status(403).json({ error: "Authentication required. Sign in with Google to perform this action." });
  }
  if (isEmbedSessionUser(user)) {
    return res.status(403).json({ error: "Full Zouk session required." });
  }
  if (visibleWorkspacesForUser(user).length === 0) {
    return res.status(403).json({ error: "Email not authorized to access this server." });
  }
  req.workspaceId = workspaceIdFromReq(req);
  req.user = user;
  next();
}

function requireWorkspaceRead(req, res, next) {
  const workspaceId = workspaceIdFromReq(req);
  if (!findWorkspace(workspaceId)) {
    return res.status(404).json({ error: "Workspace not found." });
  }
  const token = req.headers.authorization?.replace("Bearer ", "");
  const user = token ? getAuthSession(token) : null;
  const defaultOpenRead = !user && workspaceId === DEFAULT_WORKSPACE_ID && !allowlistActive(workspaceId);
  if (!defaultOpenRead && (!user || !userCanAccessWorkspace(user, workspaceId))) {
    return res.status(403).json({ error: "Not a member of this workspace." });
  }
  if (isEmbedSessionUser(user) && !embedApiRouteAllowed(req)) {
    return res.status(403).json({ error: "Embed session is not allowed to access this API." });
  }
  req.workspaceId = workspaceId;
  req.user = user;
  next();
}

function requireWorkspaceAdmin(req, res, next) {
  const user = req.user;
  const workspaceId = req.workspaceId || workspaceIdFromReq(req);
  if (!userCanAdminWorkspace(user, workspaceId)) {
    return res.status(403).json({ error: "Workspace root/admin required." });
  }
  next();
}

// Single insert path for human-style messages — POST /api/messages and
// POST /api/trigger both go through this so any new downstream side-effect
// (mention-fanout, broadcast, persistence) lands in lockstep.
//
// Split into persist + fanout so handlers can flush the HTTP response between
// them. If broadcast runs before res.json, a sender on a flaky network sees
// their own WS event land while the HTTP ack times out — toast 'send failed'
// despite the message being saved + delivered. Persisting first, responding,
// then fanning out preserves all downstream behavior in the same tick while
// removing that ordering trap.
function persistUserMessage({ workspaceId, channelId, channelName, channelType, threadId, senderName, senderType, content, attachments }) {
  const msg = {
    id: uuidv4(),
    seq: nextSeq(),
    workspaceId: workspaceId || DEFAULT_WORKSPACE_ID,
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
  return msg;
}

function fanoutUserMessage(msg) {
  // Regular channel delivery uses channel_agents membership; DM delivery
  // resolves parties from the canonical channel name inside deliverToAllAgents.
  deliverToAllAgents(msg);
  // Broadcast to web UI (no viewerName — includes dmParties for frontend to resolve)
  broadcastToWeb({ type: "message", workspaceId: msg.workspaceId || DEFAULT_WORKSPACE_ID, message: formatMessageForClient(msg) });
}

// Send message from web UI (human user)
app.post("/api/messages", requireAuth, (req, res) => {
  // Prefer the authenticated user's name over any body field so a stale client
  // state can't pollute canonical DM channel names (would split PM threads).
  // Falls back to the legacy body.senderName, then to "local-user" for tooling.
  const token = req.headers.authorization?.replace("Bearer ", "");
  const authedName = token ? getAuthSession(token)?.name : null;
  const { target, content, senderName: bodyName, attachmentIds } = req.body;
  const senderName = authedName || bodyName || "local-user";
  const workspaceId = req.workspaceId || DEFAULT_WORKSPACE_ID;
  const { channelName, channelType, threadId } = parseTarget(target, senderName);
  const resolved = resolveTargetChannel(target, senderName, workspaceId);
  if (isEmbedSessionUser(req.user)) {
    if (!resolved.channel || !embedCanAccessChannel(req.user, resolved.channel, workspaceId)) {
      return res.status(403).json({ error: "Embed session is not allowed to write to this channel." });
    }
  }
  const ch = resolved.channel || findOrCreateChannel(channelName, channelType, workspaceId);

  const msg = persistUserMessage({
    workspaceId,
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
  fanoutUserMessage(msg);
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
    const workspaceId = workspaceIdFromReq(req);
    if ((keyRecord.workspaceId || DEFAULT_WORKSPACE_ID) !== workspaceId) {
      return res.status(401).json({ error: "Machine key is not valid for this workspace" });
    }
    keyRecord.lastUsedAt = now();
    saveMachineKeys(machineKeys);
    db.saveMachineKey(keyRecord);
    req.machineKey = keyRecord;
  }
  next();
}

// POST /api/trigger — let external systems inject a message that behaves
// exactly like a human-sent one (full deliverToAllAgents + broadcastToWeb
// fanout, mention parsing, agent wakeup). Public channels only — no DM,
// no attachments. Sender is hardcoded to "system"; the name is reserved
// (see RESERVED_USER_NAMES) so it can't collide with a real user.
app.post("/api/trigger", requireMachineKey, (req, res) => {
  const workspaceId = workspaceIdFromReq(req);
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
  const ch = store.channels.find((c) => (
    (c.workspaceId || DEFAULT_WORKSPACE_ID) === workspaceId
    && c.name === channelName
    && (c.type || "channel") === "channel"
  ));
  if (!ch) {
    return res.status(404).json({ error: `channel #${channelName} not found` });
  }

  const msg = persistUserMessage({
    workspaceId,
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
  fanoutUserMessage(msg);
});

// Upload an attachment from the web UI. Shares the same on-disk storage the
// agent upload path writes to, so the returned id is interchangeable — clients
// pass it back via POST /api/messages { attachmentIds }.
app.post("/api/attachments", requireAuth, upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file" });
  const id = uuidv4();
  let meta;
  try {
    meta = await attachmentStorage.put(id, req.file.buffer, {
      filename: req.file.originalname,
      contentType: req.file.mimetype,
    });
  } catch (err) {
    return res.status(500).json({ error: "Failed to persist attachment", detail: err.message });
  }
  const payload = {
    id,
    filename: req.file.originalname,
    contentType: req.file.mimetype,
    sizeBytes: req.file.size,
  };
  if (typeof meta?.width === "number" && typeof meta?.height === "number") {
    payload.width = meta.width;
    payload.height = meta.height;
  }
  res.json(payload);
});

// Get messages for a channel
// The Cloudflare proxy rewrites both query strings AND path segments during
// its 307 redirect chain, so the primary web client passes the channel target
// in request headers (X-Channel, X-Limit, X-Sender) which survive untouched.
// Query-string fallback kept for backward compat (curl, daemon internal API).
app.get("/api/messages", requireWorkspaceRead, async (req, res) => {
  const workspaceId = req.workspaceId || DEFAULT_WORKSPACE_ID;
  const channel = req.headers["x-channel"] || req.query.channel || "#all";
  const limit = parseInt(req.headers["x-limit"] || req.query.limit || 100);
  const sender = req.headers["x-sender"] || req.query.sender || null;
  const before = req.headers["x-before"] || req.query.before || null;
  const after = req.headers["x-after"] || req.query.after || null;

  const resolved = resolveTargetChannel(channel, sender, workspaceId);
  if (!resolved.channel) {
    return res.json({ messages: [], hasMore: false });
  }
  if (isEmbedSessionUser(req.user) && !embedCanAccessChannel(req.user, resolved.channel, workspaceId)) {
    return res.status(403).json({ error: "Embed session is not allowed to read this channel." });
  }
  const channelId = resolved.channel.id;
  const threadId = resolved.threadId;

  // `before` / `after` are message IDs (not seqs). Resolve to seq via the
  // in-memory index when possible, else DB lookup.
  const beforeMsg = before ? await getMessageByIdAnywhere(before) : null;
  const afterMsg = after ? await getMessageByIdAnywhere(after) : null;
  const beforeSeq = beforeMsg ? beforeMsg.seq : null;
  const afterSeq = afterMsg ? afterMsg.seq : null;

  let msgs;
  let hasMore;

  if (after) {
    // Catch-up mode: WS reconnect gap-fill. Return everything newer than the
    // last message the client has, no upper bound — gaps are usually tiny.
    msgs = afterSeq != null
      ? await readChannelHistory({ workspaceId, channelId, threadId, afterSeq, limit: 500 })
      : [];
    hasMore = false;
  } else {
    msgs = await readChannelHistory({ workspaceId, channelId, threadId, beforeSeq, limit });
    hasMore = msgs.length === limit;
  }

  // Historical pages need thread reply previews to come from DB since the
  // in-memory index only covers recent messages.
  const replyOverride = await fetchThreadRepliesForPage(msgs);

  res.json({
    messages: msgs.map((m) => formatMessageForClient(m, sender, {
      includeReplies: true,
      threadReplyOverride: replyOverride,
    })),
    hasMore,
  });
});

// Get channels
app.get("/api/channels", requireWorkspaceRead, (req, res) => {
  const workspaceId = req.workspaceId || DEFAULT_WORKSPACE_ID;
  res.json({
    channels: store.channels.filter((ch) => (
      (ch.workspaceId || DEFAULT_WORKSPACE_ID) === workspaceId
      && (ch.type || "channel") === "channel"
      && (!isEmbedSessionUser(req.user) || embedCanAccessChannel(req.user, ch, workspaceId))
    )),
  });
});

// Create channel
app.post("/api/channels", requireAuth, (req, res) => {
  const { name, description } = req.body;
  const workspaceId = req.workspaceId || DEFAULT_WORKSPACE_ID;
  const ch = findOrCreateChannel(name, "channel", workspaceId);
  ch.description = description || "";
  db.saveChannel(ch);
  broadcastToWeb({ type: "channel_created", workspaceId, channel: ch });
  res.json({ channel: ch });
});

app.delete("/api/channels/:id", requireAuth, async (req, res) => {
  const { id } = req.params;
  const workspaceId = req.workspaceId || DEFAULT_WORKSPACE_ID;
  const idx = store.channels.findIndex((ch) => (
    ch.id === id
    && (ch.workspaceId || DEFAULT_WORKSPACE_ID) === workspaceId
    && (ch.type || "channel") === "channel"
  ));
  if (idx < 0) return res.status(404).json({ error: "Channel not found" });

  const [channel] = store.channels.splice(idx, 1);
  purgeChannelMemberships(channel.id);
  await db.deleteChannel(channel.id);
  broadcastToWeb({ type: "channel_deleted", workspaceId, channelId: channel.id, channelName: channel.name });
  res.json({ success: true, channel });
});

// List agents subscribed to a channel. Used by the admin UI.
app.get("/api/channels/:id/agents", requireAuth, (req, res) => {
  const { id } = req.params;
  const workspaceId = req.workspaceId || DEFAULT_WORKSPACE_ID;
  const ch = store.channels.find((c) => c.id === id && (c.workspaceId || DEFAULT_WORKSPACE_ID) === workspaceId);
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
  const workspaceId = req.workspaceId || DEFAULT_WORKSPACE_ID;
  const ch = store.channels.find((c) => c.id === id && (c.workspaceId || DEFAULT_WORKSPACE_ID) === workspaceId);
  if (!ch) return res.status(404).json({ error: "Channel not found" });
  if (workspaceIdFromAgent(agentId) !== workspaceId) return res.status(404).json({ error: "Agent not found" });
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
  const workspaceId = req.workspaceId || DEFAULT_WORKSPACE_ID;
  const ch = store.channels.find((c) => c.id === id && (c.workspaceId || DEFAULT_WORKSPACE_ID) === workspaceId);
  if (!ch) return res.status(404).json({ error: "Channel not found" });
  removeMembership(ch.id, agentId);
  res.json({ ok: true });
});

// Read-only task list for the frontend kanban. Tasks don't carry their own
// timestamps in the schema, so we derive createdAt/updatedAt from the system
// messages stamped with each task_number (create → claim → status updates).
app.get("/api/tasks", requireWorkspaceRead, (req, res) => {
  const workspaceId = req.workspaceId || DEFAULT_WORKSPACE_ID;
  // taskTimes is maintained incrementally in appendMessage and seeded at boot
  // from a dedicated DB aggregate — no full-message-table scan here.
  const tasks = store.tasks
    .filter((t) => (t.workspaceId || DEFAULT_WORKSPACE_ID) === workspaceId)
    .map((t) => {
    const times = taskTimes.get(`${workspaceId}:${t.taskNumber}`) || { createdAt: null, updatedAt: null };
    return {
      taskNumber: t.taskNumber,
      channelId: t.channelId,
      channelName: store.channels.find((c) => c.id === t.channelId && (c.workspaceId || DEFAULT_WORKSPACE_ID) === workspaceId)?.name || null,
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
app.get("/api/machines", requireWorkspaceRead, (req, res) => {
  const workspaceId = req.workspaceId || DEFAULT_WORKSPACE_ID;
  const machineList = Array.from(machines.values())
    .filter((m) => (m.workspaceId || DEFAULT_WORKSPACE_ID) === workspaceId)
    .map((m) => ({
      ...m,
      agents: m.agentIds.map((id) => agentPayload(id)).filter((agent) => agent && (agent.workspaceId || DEFAULT_WORKSPACE_ID) === workspaceId),
    }));
  res.json({ machines: machineList });
});

// Ask a daemon to enumerate installed models for a given runtime.
// Daemons that don't implement the protocol (old zouk-daemon) will stay silent,
// so we always fall back via the 5s timeout. Clients can treat
// {models: []} and a timeout identically — both mean "free-form input please".
app.get("/api/machines/:id/runtimes/:runtime/models", requireWorkspaceRead, (req, res) => {
  const { id, runtime } = req.params;
  const workspaceId = req.workspaceId || DEFAULT_WORKSPACE_ID;
  const machine = machines.get(id);
  if (!machine || (machine.workspaceId || DEFAULT_WORKSPACE_ID) !== workspaceId) {
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
app.get("/api/agents", requireWorkspaceRead, (req, res) => {
  const workspaceId = req.workspaceId || DEFAULT_WORKSPACE_ID;
  const agents = Object.keys(store.agents)
    .map((id) => agentPayload(id))
    .filter((agent) => (agent?.workspaceId || DEFAULT_WORKSPACE_ID) === workspaceId);
  const configs = sanitizedAgentConfigs().filter((config) => (
    (config.workspaceId || DEFAULT_WORKSPACE_ID) === workspaceId
  ));
  res.json({ agents, configs });
});

// Get channel memberships for any agent (running or configured).
// Used by the agent CONFIG tab to show visible channels even when the agent is offline.
app.get("/api/agents/:id/channels", requireAuth, (req, res) => {
  const agentId = req.params.id;
  if (!hasKnownAgentConfig(agentId)) {
    return res.status(404).json({ error: "unknown agent" });
  }
  if (workspaceIdFromAgent(agentId) !== (req.workspaceId || DEFAULT_WORKSPACE_ID)) {
    return res.status(404).json({ error: "unknown agent" });
  }
  res.json({ channels: agentChannelNames(agentId) });
});

// Get recent activity entries for an agent (used by the Activity tab).
app.get("/api/agents/:id/activities", requireWorkspaceRead, async (req, res) => {
  const agentId = req.params.id;
  if (!hasKnownAgentConfig(agentId)) {
    return res.status(404).json({ error: "unknown agent" });
  }
  if (workspaceIdFromAgent(agentId) !== (req.workspaceId || DEFAULT_WORKSPACE_ID)) {
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

// ─── OpenViking memory proxy ────────────────────────────────────

function resolveOvCredentials(agentId) {
  const config = agentConfigs.find((c) => c.id === agentId);
  if (!config) return null;

  const mode = config.openvikingMode === 'custom' ? 'custom' : 'provisioned';
  const agentName = config.name || agentId;

  if (mode === 'custom' && config.openvikingCustomUrl && config.openvikingCustomApiKey) {
    const decoded = decodeOvKey(config.openvikingCustomApiKey);
    return {
      url: config.openvikingCustomUrl.replace(/\/+$/, ""),
      apiKey: config.openvikingCustomApiKey,
      user: decoded.user || config.openvikingUserId || deriveOvUserId(agentId),
      account: decoded.account || "",
      agentId: agentName,
    };
  }

  if (mode === 'provisioned' && config.openvikingApiKey && OPENVIKING_URL) {
    return {
      url: OPENVIKING_URL,
      apiKey: config.openvikingApiKey,
      user: config.openvikingUserId || deriveOvUserId(agentId),
      account: OPENVIKING_ACCOUNT || "",
      agentId: agentName,
    };
  }

  // Fallback: check envVars (agents with explicit OPENVIKING_* env vars)
  const ev = config.envVars;
  if (!ev) return null;
  let url = ev.OPENVIKING_URL;
  let apiKey = ev.OPENVIKING_API_KEY;
  let user = ev.OPENVIKING_USER || "";
  let account = ev.OPENVIKING_ACCOUNT || "";
  let agentIdVal = ev.OPENVIKING_AGENT_ID || "";

  if (!url || !apiKey) {
    if (ev.OPENVIKING_CLI_CONFIG_FILE) {
      try {
        const raw = JSON.parse(fs.readFileSync(ev.OPENVIKING_CLI_CONFIG_FILE, "utf8"));
        if (raw.url && raw.api_key) {
          url = url || raw.url;
          apiKey = apiKey || raw.api_key;
          user = user || raw.user || "";
          account = account || raw.account || "";
          agentIdVal = agentIdVal || raw.agent_id || "";
        }
      } catch { /* config file not accessible from server */ }
    }
  }
  if (!url || !apiKey) return null;
  return { url: url.replace(/\/+$/, ""), apiKey, user, account, agentId: agentIdVal };
}

function isLocalUrl(urlStr) {
  try {
    const u = new URL(urlStr);
    const host = u.hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0" || host === "::1" || host.endsWith(".local");
  } catch { return false; }
}

const ovMcpSessions = new Map();

async function ovMcpCall(creds, toolName, args) {
  const mcpUrl = `${creds.url}/mcp`;
  const headers = {
    "Content-Type": "application/json",
    "Accept": "application/json, text/event-stream",
    "Authorization": `Bearer ${creds.apiKey}`,
    "X-OpenViking-Account": creds.account,
    "X-OpenViking-User": creds.user,
    "X-OpenViking-Agent": creds.agentId,
  };

  let sessionId = ovMcpSessions.get(creds.url + ":" + creds.user);
  if (!sessionId) {
    const initRes = await fetch(mcpUrl, {
      method: "POST", headers,
      body: JSON.stringify({ jsonrpc: "2.0", method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "zouk-server", version: "1.0" } }, id: 1 }),
    });
    sessionId = initRes.headers.get("mcp-session-id");
    if (sessionId) ovMcpSessions.set(creds.url + ":" + creds.user, sessionId);
  }

  if (sessionId) headers["Mcp-Session-Id"] = sessionId;
  const res = await fetch(mcpUrl, {
    method: "POST", headers,
    body: JSON.stringify({ jsonrpc: "2.0", method: "tools/call", params: { name: toolName, arguments: args }, id: Date.now() }),
  });
  const text = await res.text();
  const dataLine = text.split("\n").find((l) => l.startsWith("data: "));
  if (!dataLine) throw new Error("No data in MCP response");
  const parsed = JSON.parse(dataLine.slice(6));
  if (parsed.error) throw new Error(parsed.error.message || "MCP error");
  const content = parsed.result?.content;
  if (parsed.result?.isError) throw new Error(content?.[0]?.text || "OV tool error");
  return content?.[0]?.text || parsed.result?.structuredContent?.result || "";
}

// HTTP fallback for level-aware content reads.
// MCP `read` tool returns L2 only; OV's REST exposes /api/v1/content/{abstract|overview|read}
// for L0/L1/L2 respectively. Mirrors atlas-fs's openviking-adapter.read().
async function ovHttpReadContent(creds, uri, level) {
  const endpoint = level === "l0" ? "abstract" : level === "l1" ? "overview" : "read";
  const headers = {
    "Accept": "application/json",
    "X-API-Key": creds.apiKey,
    "X-OpenViking-Account": creds.account,
    "X-OpenViking-User": creds.user,
  };
  const res = await fetch(`${creds.url}/api/v1/content/${endpoint}?uri=${encodeURIComponent(uri)}`, {
    headers,
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText}: ${body.slice(0, 200)}`);
  }
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    const data = await res.json();
    const r = data.result;
    if (typeof r === "string") return r;
    if (r && typeof r === "object") {
      return r.content ?? r.text ?? r.markdown ?? r.abstract ?? r.overview ?? r.summary ?? JSON.stringify(r, null, 2);
    }
    return data.content ?? data.text ?? data.markdown ?? data.abstract ?? data.overview ?? data.summary ?? "";
  }
  return await res.text();
}

function parseOvListResult(text, parentUri) {
  let base = "";
  if (parentUri) {
    const i = parentUri.indexOf("://");
    const scheme = i >= 0 ? parentUri.slice(0, i + 3) : "";
    const path = i >= 0 ? parentUri.slice(i + 3).replace(/\/+$/, "") : parentUri.replace(/\/+$/, "");
    base = scheme + (path ? path + "/" : "");
  }
  return text.split("\n").filter(Boolean).map((line) => {
    const dirMatch = line.match(/^\[dir\]\s+(.+)/);
    const fileMatch = line.match(/^\[file\]\s+(.+)/);
    if (dirMatch) {
      const name = dirMatch[1].trim();
      return { uri: name.startsWith("viking://") ? name : base + name, isDir: true };
    }
    if (fileMatch) {
      const name = fileMatch[1].trim();
      return { uri: name.startsWith("viking://") ? name : base + name, isDir: false };
    }
    return null;
  }).filter(Boolean);
}

function lookupAgentCfgForOv(agentId) {
  return agentConfigs.find((c) => c.id === agentId) || store.agents[agentId] || null;
}

app.get("/api/agents/:id/ov/status", requireWorkspaceRead, (req, res) => {
  if (workspaceIdFromAgent(req.params.id) !== (req.workspaceId || DEFAULT_WORKSPACE_ID)) {
    return res.status(404).json({ error: "unknown agent" });
  }
  const cfg = lookupAgentCfgForOv(req.params.id);
  if (cfg && !isOvEnabledForAgent(cfg)) {
    return res.json({ enabled: false, reason: "disabled", user: null, url: null, local: false });
  }
  const creds = resolveOvCredentials(req.params.id);
  res.json({ enabled: !!creds, user: creds?.user || null, url: creds?.url || null, local: creds ? isLocalUrl(creds.url) : false });
});

app.get("/api/agents/:id/ov/ls", requireWorkspaceRead, async (req, res) => {
  if (workspaceIdFromAgent(req.params.id) !== (req.workspaceId || DEFAULT_WORKSPACE_ID)) {
    return res.status(404).json({ error: "unknown agent" });
  }
  const cfg = lookupAgentCfgForOv(req.params.id);
  if (cfg && !isOvEnabledForAgent(cfg)) {
    return res.status(403).json({ error: "ov_disabled", agentId: req.params.id });
  }
  const creds = resolveOvCredentials(req.params.id);
  if (!creds) return res.status(404).json({ error: "OV not configured for this agent" });
  if (isLocalUrl(creds.url)) return res.status(400).json({ error: "local_ov", message: "OV is local — use daemon WS path" });
  const uri = req.query.uri || `viking://user/${creds.user || creds.agentId}/`;
  try {
    const raw = await ovMcpCall(creds, "list", { uri });
    res.json({ entries: parseOvListResult(raw, uri) });
  } catch (e) {
    ovMcpSessions.delete(creds.url + ":" + creds.user);
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/agents/:id/ov/read", requireWorkspaceRead, async (req, res) => {
  if (workspaceIdFromAgent(req.params.id) !== (req.workspaceId || DEFAULT_WORKSPACE_ID)) {
    return res.status(404).json({ error: "unknown agent" });
  }
  const cfg = lookupAgentCfgForOv(req.params.id);
  if (cfg && !isOvEnabledForAgent(cfg)) {
    return res.status(403).json({ error: "ov_disabled", agentId: req.params.id });
  }
  const creds = resolveOvCredentials(req.params.id);
  if (!creds) return res.status(404).json({ error: "OV not configured for this agent" });
  if (isLocalUrl(creds.url)) return res.status(400).json({ error: "local_ov", message: "OV is local — use daemon WS path" });
  const uri = req.query.uri;
  if (!uri) return res.status(400).json({ error: "uri parameter required" });
  try {
    const content = await ovMcpCall(creds, "read", { uris: uri });
    res.json({ content });
  } catch (e) {
    ovMcpSessions.delete(creds.url + ":" + creds.user);
    res.status(500).json({ error: e.message });
  }
});

// ─── Agent config CRUD ───────────────────────────────────────────

// List all agent configs
app.get("/api/agent-configs", requireWorkspaceRead, (req, res) => {
  const workspaceId = req.workspaceId || DEFAULT_WORKSPACE_ID;
  res.json({
    configs: sanitizedAgentConfigs().filter((config) => (
      (config.workspaceId || DEFAULT_WORKSPACE_ID) === workspaceId
    )),
  });
});

// Mirror config fields that also live on the runtime agent record. Without
// this, edits land in agentConfigs (and the DB) but the live `store.agents`
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
  config.workspaceId = req.workspaceId || DEFAULT_WORKSPACE_ID;
  if (!config.id) config.id = `agent-${uuidv4().substring(0, 8)}`;
  const existing = agentConfigs.findIndex((c) => c.id === config.id);
  if (existing >= 0 && (agentConfigs[existing].workspaceId || DEFAULT_WORKSPACE_ID) !== config.workspaceId) {
    return res.status(404).json({ error: "Agent not found" });
  }
  if (existing >= 0) {
    // machineId is immutable — never let the payload overwrite the stored value.
    const { machineId: _ignored, ...rest } = config;
    agentConfigs[existing] = { ...agentConfigs[existing], ...rest };
  } else {
    if (!config.machineId) return res.status(400).json({ error: "machineId is required" });
    if (!isPersistentMachineId(config.machineId, config.workspaceId)) return res.status(400).json({ error: "machineId does not match any machine key" });
    agentConfigs.push(config);
  }
  const saved = agentConfigs.find((c) => c.id === config.id);
  saveAgentConfigs(agentConfigs);
  db.saveAgentConfig(saved);
  if (syncRuntimeAgentFromConfig(saved.id, saved)) {
    broadcastToWeb({ type: "agent_started", workspaceId: saved.workspaceId || DEFAULT_WORKSPACE_ID, agent: agentPayload(saved.id) });
  }
  broadcastToWeb({
    type: "config_updated",
    workspaceId: saved.workspaceId || DEFAULT_WORKSPACE_ID,
    configs: sanitizedAgentConfigs().filter((c) => (c.workspaceId || DEFAULT_WORKSPACE_ID) === (saved.workspaceId || DEFAULT_WORKSPACE_ID)),
  });
  res.json({ config: saved });
});

// Update agent config (upsert: creates config from running agent if none exists)
app.put("/api/agents/:id/config", requireAuth, (req, res) => {
  const { id } = req.params;
  const workspaceId = req.workspaceId || DEFAULT_WORKSPACE_ID;
  const updates = req.body;
  let idx = agentConfigs.findIndex((c) => c.id === id);
  if (idx >= 0 && (agentConfigs[idx].workspaceId || DEFAULT_WORKSPACE_ID) !== workspaceId) {
    return res.status(404).json({ error: "Agent not found" });
  }
  if (idx < 0) {
    const running = store.agents[id];
    if (!running) return res.status(404).json({ error: "Agent not found" });
    if (!running.machineId) return res.status(400).json({ error: "Running agent has no machineId" });
    agentConfigs.push({
      id,
      workspaceId,
      name: running.name,
      displayName: running.displayName,
      runtime: running.runtime,
      model: running.model,
      workDir: running.workDir,
      machineId: running.machineId,
    });
    idx = agentConfigs.length - 1;
  }
  // machineId is immutable. openvikingApiKey / openvikingUserId are
  // server-managed (provisioned by the agent-start handler); never let the
  // payload overwrite them.
  const {
    machineId: _ignoredMachineId,
    openvikingApiKey: _ignoredOvApiKey,
    openvikingUserId: _ignoredOvUserId,
    openvikingCustomApiKey: incomingCustomApiKey,
    openvikingMode: incomingMode,
    openvikingEnabled: incomingEnabled,
    ...rest
  } = updates;

  const merged = { ...agentConfigs[idx], ...rest };
  merged.workspaceId = workspaceId;

  // openvikingEnabled: boolean = explicit override; null = clear to follow
  // the runtime default; undefined = leave as-is.
  if (incomingEnabled === null) {
    delete merged.openvikingEnabled;
  } else if (typeof incomingEnabled === 'boolean') {
    merged.openvikingEnabled = incomingEnabled;
  }

  // openvikingMode: clamp to known values; default unchanged.
  if (incomingMode !== undefined) {
    merged.openvikingMode = incomingMode === 'custom' ? 'custom' : 'provisioned';
  }
  // openvikingCustomApiKey: empty string / undefined = keep old value (the
  // password-input "leave blank to keep" pattern). Non-empty string = replace.
  if (typeof incomingCustomApiKey === 'string' && incomingCustomApiKey.length > 0) {
    merged.openvikingCustomApiKey = incomingCustomApiKey;
  } else if (incomingCustomApiKey === null) {
    // Explicit null = clear the saved value.
    merged.openvikingCustomApiKey = null;
  }

  // Reject save if OV is enabled, mode is custom, and url/key aren't set.
  // When OV is disabled (toggle off), mode fields are inert so no validation
  // needed — user can stage custom creds without filling everything in.
  if (isOvEnabledForAgent(merged) && merged.openvikingMode === 'custom') {
    if (!merged.openvikingCustomUrl || !merged.openvikingCustomApiKey) {
      return res.status(400).json({
        error: "Custom OpenViking mode requires both openvikingCustomUrl and openvikingCustomApiKey",
      });
    }
  }

  agentConfigs[idx] = merged;
  // description is the system prompt — keep them in sync
  if (updates.description !== undefined && updates.systemPrompt === undefined) {
    agentConfigs[idx].systemPrompt = updates.description;
  }
  saveAgentConfigs(agentConfigs);
  db.saveAgentConfig(agentConfigs[idx]);
  if (syncRuntimeAgentFromConfig(id, agentConfigs[idx])) {
    broadcastToWeb({ type: "agent_started", workspaceId, agent: agentPayload(id) });
  }
  broadcastToWeb({
    type: "config_updated",
    workspaceId,
    configs: sanitizedAgentConfigs().filter((c) => (c.workspaceId || DEFAULT_WORKSPACE_ID) === workspaceId),
  });
  // Strip secrets from the response too, so saving doesn't leak the api key
  // back to the client even though it's the same client that just sent it.
  const { openvikingApiKey: _stripA, openvikingCustomApiKey: _stripB, ...safeConfig } = agentConfigs[idx];
  res.json({
    config: {
      ...safeConfig,
      openvikingProvisioned: !!agentConfigs[idx].openvikingApiKey,
      openvikingCustomConfigured: !!agentConfigs[idx].openvikingCustomApiKey,
    },
  });
});

// Delete agent config
app.delete("/api/agents/:id", requireAuth, (req, res) => {
  const { id } = req.params;
  const workspaceId = req.workspaceId || DEFAULT_WORKSPACE_ID;
  if (workspaceIdFromAgent(id) !== workspaceId) return res.status(404).json({ error: "Agent not found" });
  sendAgentStop(id);
  const idx = agentConfigs.findIndex((c) => c.id === id);
  if (idx >= 0) {
    agentConfigs.splice(idx, 1);
    saveAgentConfigs(agentConfigs);
    db.deleteAgentConfig(id);
  }
  purgeAgentMemberships(id);
  purgeUnknownAgentState(id);
  broadcastToWeb({ type: "agent_status", workspaceId, agentId: id, status: "deleted" });
  broadcastToWeb({
    type: "config_updated",
    workspaceId,
    configs: sanitizedAgentConfigs().filter((c) => (c.workspaceId || DEFAULT_WORKSPACE_ID) === workspaceId),
  });
  res.json({ success: true });
});

// ─── Profile preset pool ────────────────────────────────────────

app.get("/api/agent-profile-presets", requireWorkspaceRead, (req, res) => {
  const workspaceId = req.workspaceId || DEFAULT_WORKSPACE_ID;
  res.json({ presets: profilePresets.list(workspaceId), count: profilePresets.count(workspaceId), max: PROFILE_PRESET_MAX });
});

app.post("/api/agent-profile-presets", requireAuth, async (req, res) => {
  const { image } = req.body || {};
  const workspaceId = req.workspaceId || DEFAULT_WORKSPACE_ID;
  const result = await profilePresets.add(image, workspaceId);
  if (result.error) return res.status(400).json({ error: result.error });
  res.json({ preset: result.preset, count: profilePresets.count(workspaceId), max: PROFILE_PRESET_MAX });
});

app.delete("/api/agent-profile-presets/:id", requireAuth, async (req, res) => {
  const workspaceId = req.workspaceId || DEFAULT_WORKSPACE_ID;
  const result = await profilePresets.remove(req.params.id, workspaceId);
  if (result.error) return res.status(404).json({ error: result.error });
  res.json({ success: true, count: profilePresets.count(workspaceId), max: PROFILE_PRESET_MAX });
});

// ─── Machine API key management ─────────────────────────────────

// List machine API keys (masked)
app.get("/api/machine-keys", requireAuth, (req, res) => {
  const workspaceId = req.workspaceId || DEFAULT_WORKSPACE_ID;
  const keys = machineKeys
    .filter((k) => !k.revokedAt && (k.workspaceId || DEFAULT_WORKSPACE_ID) === workspaceId)
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
  const workspaceId = req.workspaceId || DEFAULT_WORKSPACE_ID;

  const rawKey = generateApiKey();
  const keyRecord = {
    id: `mk-${uuidv4().substring(0, 8)}`,
    workspaceId,
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
  const workspaceId = req.workspaceId || DEFAULT_WORKSPACE_ID;
  const idx = machineKeys.findIndex((k) => k.id === id && (k.workspaceId || DEFAULT_WORKSPACE_ID) === workspaceId);
  if (idx < 0) return res.status(404).json({ error: "Key not found" });
  const key = machineKeys[idx];

  // Cascade: collect agents bound to this machine, stop them, purge state.
  const orphanedAgentIds = agentConfigs
    .filter((c) => c.machineId === id && (c.workspaceId || DEFAULT_WORKSPACE_ID) === workspaceId)
    .map((c) => c.id);
  for (const agentId of orphanedAgentIds) {
    sendAgentStop(agentId);
    purgeUnknownAgentState(agentId);
    broadcastToWeb({ type: "agent_status", agentId, status: "deleted" });
  }
  for (let i = agentConfigs.length - 1; i >= 0; i--) {
    if (agentConfigs[i].machineId === id && (agentConfigs[i].workspaceId || DEFAULT_WORKSPACE_ID) === workspaceId) {
      agentConfigs.splice(i, 1);
    }
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
  broadcastToWeb({ type: "machine:disconnected", workspaceId, machineId: id });
  broadcastToWeb({
    type: "config_updated",
    workspaceId,
    configs: sanitizedAgentConfigs().filter((c) => (c.workspaceId || DEFAULT_WORKSPACE_ID) === workspaceId),
  });
  console.log(`[keys] Deleted machine key "${key.name}" (cascaded ${orphanedAgentIds.length} agent config(s))`);
  res.json({ success: true });
});

// ─── Agent lifecycle ─────────────────────────────────────────────

// Derive a stable OpenViking user_id from the zouk agent.id. We strip the
// `agent-` prefix (already present on auto-generated ids) and namespace with
// `zouk-` so the user_id is recognisable in shared OV admin views. OV user_ids
// are permanent — never derive from agent.name (which is mutable).
function deriveOvUserId(agentId) {
  const short = String(agentId || "").replace(/^agent-/, "");
  return `zouk-${short}`;
}

async function startAgentOnDaemon(id, config) {
  const runtime = config.runtime || "claude";
  const workspaceId = normalizeWorkspaceId(config.workspaceId || DEFAULT_WORKSPACE_ID);
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
    workspaceId,
    runtime,
    model: config.model,
    workDir: requestedWorkDir,
    status: "starting",
    machineId: targetWs._machineId,
  });

  // OpenViking creds: gated on the per-agent `openvikingEnabled` toggle. When
  // disabled (default for non-whitelisted runtimes), skip provisioning and
  // never hand creds to the daemon — even custom-mode creds are withheld.
  const ovEnabled = isOvEnabledForAgent({ openvikingEnabled: config.openvikingEnabled, runtime });
  const ovMode = config.openvikingMode === 'custom' ? 'custom' : 'provisioned';
  let ovUserId = config.openvikingUserId || deriveOvUserId(id);
  let ovApiKey = config.openvikingApiKey || null;
  let daemonOv = null;

  if (!ovEnabled) {
    console.log(`[ov] skipping creds for ${id} (runtime=${runtime}, openvikingEnabled=false)`);
    // Leave ovApiKey alone — DB-persisted keys for previously-enabled agents
    // remain latent so flipping the toggle back on doesn't require re-provision.
  } else if (ovMode === 'custom') {
    // User provides url + api key directly. Account/user are decoded from the
    // new-format key (or left blank — OV server can derive from key).
    if (config.openvikingCustomUrl && config.openvikingCustomApiKey) {
      const decoded = decodeOvKey(config.openvikingCustomApiKey);
      daemonOv = {
        url: config.openvikingCustomUrl,
        account: decoded.account || '',
        userId: decoded.user || ovUserId,
        apiKey: config.openvikingCustomApiKey,
      };
    }
    // else: missing creds — daemon falls back to its local ovcli.conf, same as
    // when provisioning was never enabled.
  } else {
    // Provisioned mode: lazily mint a per-agent key on first start (covers
    // both new agents and existing keyless ones). Best-effort: if the OV
    // admin call fails the agent still starts and the daemon falls back to
    // its local ovcli.conf.
    if (!ovApiKey && OV_PROVISIONING_ENABLED) {
      try {
        const res = await provisionAgentKey({
          url: OPENVIKING_URL,
          account: OPENVIKING_ACCOUNT,
          rootApiKey: OPENVIKING_ROOT_KEY,
          agentId: ovUserId,
        });
        ovApiKey = res.user_key;
        ovUserId = res.user_id;
      } catch (err) {
        console.warn(`[ov] provisioning failed for ${id}: ${err.message}`);
      }
    }
    if (ovApiKey && OPENVIKING_URL && OPENVIKING_ACCOUNT) {
      daemonOv = {
        url: OPENVIKING_URL,
        account: OPENVIKING_ACCOUNT,
        userId: ovUserId,
        apiKey: ovApiKey,
      };
    }
  }

  const daemonConfig = {
    runtime,
    model: config.model,
    systemPrompt: config.systemPrompt || config.description || "",
    serverUrl: PUBLIC_URL,
    authToken: "test",
    name: config.name || id,
    displayName: config.displayName || config.name || id,
    description: config.description || "",
    lifecycle: config.lifecycle === 'ephemeral' ? 'ephemeral' : 'persistent',
  };
  if (requestedWorkDir) daemonConfig.workDir = requestedWorkDir;
  const cachedSessionId = store.agents[id]?.sessionId;
  if (cachedSessionId) daemonConfig.sessionId = cachedSessionId;
  if (config.envVars && typeof config.envVars === 'object') {
    daemonConfig.envVars = config.envVars;
  }
  if (daemonOv) daemonConfig.openviking = daemonOv;

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
      workspaceId,
      name: config.name || id,
      displayName: config.displayName || config.name || id,
      description: config.description || "",
      systemPrompt: config.systemPrompt || config.description || "",
      runtime,
      model: config.model,
      machineId: targetWs._machineId,
      autoStart: true,
      lifecycle: config.lifecycle === 'ephemeral' ? 'ephemeral' : 'persistent',
    };
    if (requestedWorkDir) persisted.workDir = requestedWorkDir;
    if (config.envVars && typeof config.envVars === 'object') persisted.envVars = config.envVars;
    if (typeof config.openvikingEnabled === 'boolean') {
      persisted.openvikingEnabled = config.openvikingEnabled;
    }
    if (ovApiKey) {
      persisted.openvikingUserId = ovUserId;
      persisted.openvikingApiKey = ovApiKey;
    }
    const usedImages = new Set(agentConfigs.filter((c) => (c.workspaceId || DEFAULT_WORKSPACE_ID) === workspaceId).map((c) => c.picture).filter(Boolean));
    const shardedPicture = profilePresets.pickForAgent(id, usedImages, workspaceId);
    if (shardedPicture) persisted.picture = shardedPicture;
    agentConfigs.push(persisted);
    saveAgentConfigs(agentConfigs);
    db.saveAgentConfig(persisted);
    // New agent → subscribe to every regular (non-DM) channel so the legacy
    // "visible everywhere by default" behavior is preserved. Humans can
    // unsubscribe via the /subscriptions API.
    seedAgentIntoRegularChannels(id);
  } else if (ovApiKey && !agentConfigs[existingIdx].openvikingApiKey) {
    // Backfill an existing keyless agent. machineId is immutable — leave it.
    agentConfigs[existingIdx].openvikingUserId = ovUserId;
    agentConfigs[existingIdx].openvikingApiKey = ovApiKey;
    saveAgentConfigs(agentConfigs);
    db.saveAgentConfig(agentConfigs[existingIdx]);
  }
  // Existing configs: machineId is immutable — no rewrite on restart.

  broadcastToWeb({ type: "agent_started", workspaceId, agent: agentPayload(id) });
  broadcastToWeb({
    type: "config_updated",
    workspaceId,
    configs: sanitizedAgentConfigs().filter((c) => (c.workspaceId || DEFAULT_WORKSPACE_ID) === workspaceId),
  });
  console.log(`[api] Starting agent ${id} (runtime: ${runtime}) on daemon`);
  return { agentId: id, status: "starting" };
}

// Start an agent
app.post("/api/agents/start", requireAuth, async (req, res) => {
  const config = req.body;
  const workspaceId = req.workspaceId || DEFAULT_WORKSPACE_ID;
  const id = config.agentId || config.id || `agent-${uuidv4().substring(0, 8)}`;

  // If starting from a saved config, look it up. machineId on a saved config
  // is immutable, so the request body's machineId is ignored when one exists.
  const savedConfig = agentConfigs.find((c) => c.id === id);
  if (savedConfig && (savedConfig.workspaceId || DEFAULT_WORKSPACE_ID) !== workspaceId) {
    return res.status(404).json({ error: "Agent not found" });
  }
  const mergedConfig = { ...savedConfig, ...config };
  mergedConfig.workspaceId = workspaceId;
  if (savedConfig?.machineId) mergedConfig.machineId = savedConfig.machineId;

  if (store.agents[id] && store.agents[id].status === "active") {
    return res.status(400).json({ error: `Agent ${id} is already running` });
  }

  const result = await startAgentOnDaemon(id, mergedConfig);
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

// Stop an agent
app.post("/api/agents/:id/stop", requireAuth, (req, res) => {
  const { id } = req.params;
  const workspaceId = req.workspaceId || DEFAULT_WORKSPACE_ID;
  if (workspaceIdFromAgent(id) !== workspaceId) return res.status(404).json({ error: "Agent not found" });
  const ws = daemonSockets.get(id);
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({ type: "agent:stop", agentId: id }));
  }
  if (store.agents[id]) {
    store.agents[id].status = "stopping";
    broadcastToWeb({ type: "agent_status", workspaceId, agentId: id, status: "stopping" });
  }
  console.log(`[api] Stopping agent ${id}`);
  res.json({ success: true });
});

// Reset an agent's conversation context: SIGTERM the running process, wait for
// it to exit, then cold-start with a null session_id. Workspace is preserved.
app.post("/api/agents/:id/reset-context", requireAuth, async (req, res) => {
  const { id } = req.params;
  const workspaceId = req.workspaceId || DEFAULT_WORKSPACE_ID;
  const savedConfig = agentConfigs.find((c) => c.id === id);
  if (!savedConfig) return res.status(404).json({ error: "agent not found" });
  if ((savedConfig.workspaceId || DEFAULT_WORKSPACE_ID) !== workspaceId) return res.status(404).json({ error: "agent not found" });

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
        broadcastToWeb({ type: "agent_status", workspaceId, agentId: id, status: "stopping" });
      }
    });
  }

  const result = await startAgentOnDaemon(id, savedConfig);
  if (result.error) return res.status(400).json(result);
  console.log(`[api] Context reset for agent ${id}`);
  res.json({ success: true });
});

// Start all auto-start agents (called when daemon connects)
async function autoStartAgents() {
  const autoStart = agentConfigs.filter((c) => c.autoStart);
  for (const config of autoStart) {
    if (store.agents[config.id]?.status === "active") continue;
    const result = await startAgentOnDaemon(config.id, config);
    if (result.error) {
      const agentName = config.displayName || config.name || config.id;
      console.log(`[auto-start] Failed to start ${agentName} (${config.id}): ${result.error}`);
    }
  }
}

// ─── HTTP Server + WebSocket ──────────────────────────────────────

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

process.on("SIGTERM", async () => {
  console.log("[server] SIGTERM received — shutting down gracefully");
  server.close(async () => {
    await db.closePool();
    process.exit(0);
  });
  // Force-exit after 10s if active connections don't drain in time
  setTimeout(() => process.exit(0), 10_000).unref();
});

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
    if (wsToken && !hasAuthSession(wsToken)) {
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
      handleWebConnection(ws, wsAuthenticated, wsToken || null, parsed.searchParams.get("workspaceId") || DEFAULT_WORKSPACE_ID);
    });
  } else {
    socket.destroy();
  }
});

function handleDaemonConnection(ws, apiKey) {
  const keyAlias = findMachineKeyRecord(apiKey)?.name || '(unknown)';
  console.log(`[daemon] Connected: key=${apiKey?.substring(0, 8)}... alias=${keyAlias}`);
  let connectedAgents = new Set();
  daemonConnections.add(ws);
  ws._apiKey = apiKey;
  ws._runtimes = []; // store runtimes reported by this daemon
  ws._capabilities = [];
  const keyRecord = findMachineKeyRecord(apiKey);
  const machineId = resolveDaemonMachineId(apiKey);
  const workspaceId = keyRecord?.workspaceId || DEFAULT_WORKSPACE_ID;
  ws._machineId = machineId;
  ws._workspaceId = workspaceId;
  const existingMachine = machines.get(machineId);
  const machineRecord = {
    id: machineId,
    workspaceId,
    alias: keyRecord?.name || existingMachine?.alias,
    hostname: existingMachine?.hostname || 'unknown',
    os: existingMachine?.os || 'unknown',
    runtimes: existingMachine?.runtimes || [],
    capabilities: existingMachine?.capabilities || [],
    connectedAt: now(),
    agentIds: [],
  };
  machines.set(machineId, machineRecord);
  broadcastToWeb({ type: existingMachine ? 'machine:updated' : 'machine:connected', workspaceId, machine: machineRecord });

  ws.on("message", (data) => {
    try {
      const msg = JSON.parse(data);
      handleDaemonMessage(ws, msg, connectedAgents);
    } catch (e) {
      console.error("[daemon] Invalid message:", e.message);
    }
  });

  ws.on("close", () => {
    console.log(`[daemon] Disconnected: machine=${ws._machineId}`);
    daemonConnections.delete(ws);
    const replacementConnected = Array.from(daemonConnections).some((otherWs) => (
      otherWs.readyState === 1 && otherWs._machineId === ws._machineId
    ));
    if (!replacementConnected) {
      machines.delete(ws._machineId);
      broadcastToWeb({ type: 'machine:disconnected', workspaceId: ws._workspaceId || DEFAULT_WORKSPACE_ID, machineId: ws._machineId });
    }
    for (const agentId of connectedAgents) {
      if (daemonSockets.get(agentId) !== ws) continue;
      if (store.agents[agentId]) {
        store.agents[agentId].status = "inactive";
        daemonSockets.delete(agentId);
        broadcastToWeb({ type: "agent_status", agentId, status: "inactive" });
      }
    }
    // Daemon swap on the same machine: another daemon authenticated with the
    // same api key is still online, so reuse the existing autoStart path to
    // re-bind orphaned agents. autoStartAgents respects per-config autoStart
    // and startAgentOnDaemon enforces machineId match, so this can only
    // re-target the surviving same-machine daemon.
    if (replacementConnected) {
      setTimeout(() => autoStartAgents(), 500);
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
    case "daemon:health": {
      if (ws.readyState === 1) {
        ws.send(JSON.stringify({
          type: "daemon:health:ack",
          seq: msg.seq,
          reason: msg.reason,
          agentId: msg.agentId,
          launchId: msg.launchId,
          sentAt: msg.sentAt,
          serverAt: new Date().toISOString(),
          machineId: ws._machineId,
        }));
      }
      break;
    }
    case "ready": {
      console.log(`[daemon] Ready: machine=${ws._machineId} runtimes=${msg.runtimes?.join(",")} agents=${msg.runningAgents?.join(",") || "none"}`);
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
      // Reconcile stale agent state: any agent on this machine that is not
      // in runningAgents but still shows working/thinking/error activity had its
      // process die (or its turn_end event was dropped during a reconnect race)
      // without the server receiving the final activity update. Reset to 'online'
      // so it shows idle instead of stuck-working. Applies to both active and
      // inactive agents — inactive agents can carry stale activity from a
      // disconnect that happened mid-turn before they were marked inactive.
      // Running agents are skipped here; the daemon re-broadcasts their current
      // activity via agent:activity messages that follow immediately after 'ready'.
      {
        const runningSet = new Set(msg.runningAgents || []);
        for (const [agentId, agent] of Object.entries(store.agents)) {
          if (agent.machineId !== ws._machineId) continue;
          if (runningSet.has(agentId)) continue;
          if (["working", "thinking", "error"].includes(agent.activity)) {
            store.agents[agentId].activity = "online";
            store.agents[agentId].activityDetail = undefined;
            broadcastToWeb({ type: "agent_activity", agentId, activity: "online", detail: "Idle" });
          }
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
          const workspaceId = workspaceIdFromAgent(agentId);
          broadcastToWeb({
            type: "config_updated",
            workspaceId,
            configs: sanitizedAgentConfigs().filter((c) => (c.workspaceId || DEFAULT_WORKSPACE_ID) === workspaceId),
          });
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
      console.log(`[agent:${agentId}] Status: ${status} machine=${ws._machineId}`);
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
        console.warn(`[agent:${agentId}] Dropped activity=${activity} from stale connection machine=${ws._machineId} (owner=machine:${ownerWs._machineId})`);
        break;
      }
      enqueueActivity(agentId, async () => {
        const prev = store.agents[agentId]?.activity;
        if (store.agents[agentId]) {
          store.agents[agentId].activity = activity;
          store.agents[agentId].activityDetail = detail;
          if (contextUsage) {
            store.agents[agentId].contextUsage = contextUsage;
          }
        }
        if (prev !== activity) {
          console.log(`[agent:${agentId}] Activity: ${prev ?? '?'} → ${activity}${detail ? ` (${detail})` : ''}`);
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
      const workspaceId = workspaceIdFromAgent(msg.agentId);
      // Forward to web UI
      broadcastToWeb({
        type: "workspace:file_tree",
        workspaceId,
        agentId: msg.agentId,
        dirPath: msg.dirPath || "",
        workDir: msg.workDir,
        files: msg.files,
      });
      if (workDirChanged) {
        broadcastToWeb({ type: "agent_started", agent: agentPayload(msg.agentId) });
        broadcastToWeb({
          type: "config_updated",
          workspaceId,
          configs: sanitizedAgentConfigs().filter((c) => (c.workspaceId || DEFAULT_WORKSPACE_ID) === workspaceId),
        });
      }
      break;
    }
    case "agent:workspace:file_content": {
      const ownerWs = daemonSockets.get(msg.agentId);
      if (ownerWs && ownerWs !== ws) {
        console.log(`[agent:${msg.agentId}] Ignoring workspace file content from stale daemon connection on machine ${ws._machineId}`);
        break;
      }
      broadcastToWeb({ type: "workspace:file_content", workspaceId: workspaceIdFromAgent(msg.agentId), agentId: msg.agentId, requestId: msg.requestId, content: msg.content });
      break;
    }
    case "agent:memory:list_result": {
      broadcastToWeb({ type: "memory:list_result", workspaceId: workspaceIdFromAgent(msg.agentId), agentId: msg.agentId, uri: msg.uri, entries: msg.entries, error: msg.error });
      break;
    }
    case "agent:memory:content": {
      broadcastToWeb({ type: "memory:content", workspaceId: workspaceIdFromAgent(msg.agentId), agentId: msg.agentId, requestId: msg.requestId, uri: msg.uri, level: msg.level || null, content: msg.content, error: msg.error });
      break;
    }
    case "agent:skills:list_result": {
      const ownerWs = daemonSockets.get(msg.agentId);
      if (ownerWs && ownerWs !== ws) {
        console.log(`[agent:${msg.agentId}] Ignoring skills result from stale daemon connection on machine ${ws._machineId}`);
        break;
      }
      broadcastToWeb({ type: "skills:list_result", workspaceId: workspaceIdFromAgent(msg.agentId), agentId: msg.agentId, global: msg.global, workspace: msg.workspace });
      break;
    }
    case "machine:workspace:scan_result": {
      broadcastToWeb({ type: "machine:workspace:scan_result", workspaceId: ws._workspaceId || DEFAULT_WORKSPACE_ID, machineId: ws._machineId, directories: msg.directories });
      break;
    }
    case "machine:workspace:delete_result": {
      broadcastToWeb({ type: "machine:workspace:delete_result", workspaceId: ws._workspaceId || DEFAULT_WORKSPACE_ID, machineId: ws._machineId, directoryName: msg.directoryName, success: msg.success });
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

function handleWebConnection(ws, authenticated, token = null, workspaceId = DEFAULT_WORKSPACE_ID) {
  ws._authenticated = !!authenticated;
  ws._authToken = token;
  ws._workspaceId = normalizeWorkspaceId(workspaceId);
  const user = token ? getAuthSession(token) : null;
  if (user && !isEmbedSessionUser(user) && ws._workspaceId === DEFAULT_WORKSPACE_ID && findWorkspace(ws._workspaceId) && isEmailAllowed(user.email, ws._workspaceId)) {
    ensureWorkspaceMemberForUser(user, ws._workspaceId);
  }
  if ((!user && ws._workspaceId !== DEFAULT_WORKSPACE_ID) || (user && !userCanAccessWorkspace(user, ws._workspaceId)) || !findWorkspace(ws._workspaceId)) {
    ws._workspaceId = DEFAULT_WORKSPACE_ID;
  }
  // Seed from the auth session so DM broadcasts can be filtered immediately;
  // setWebPresence() will overwrite this with the canonical presence identity.
  ws._humanName = user?.name || null;
  ws._human = null;
  webSockets.add(ws);

  // Defer the init send so a burst of reconnects doesn't monopolize one tick.
  // The init payload is large (channels + agents + humans + configs + machines
  // + presets) and JSON.stringify is sync; spreading sends across ticks lets
  // unrelated HTTP requests interleave instead of queuing behind a burst.
  setImmediate(() => {
    if (ws.readyState !== 1) return;
    const canReadWorkspace = user
      ? userCanAccessWorkspace(user, ws._workspaceId)
      : ws._workspaceId === DEFAULT_WORKSPACE_ID && !allowlistActive(ws._workspaceId);
    const embedUser = isEmbedSessionUser(user);
    const embedAgentIds = embedUser ? embedVisibleAgentIds(user) : null;
    const visibleChannels = canReadWorkspace ? store.channels.filter((ch) => (
      (ch.workspaceId || DEFAULT_WORKSPACE_ID) === ws._workspaceId
      && (ch.type || "channel") === "channel"
      && (!embedUser || embedCanAccessChannel(user, ch, ws._workspaceId))
    )) : [];
    const visibleAgents = canReadWorkspace ? Object.keys(store.agents)
      .map((id) => agentPayload(id))
      .filter((agent) => (
        (agent?.workspaceId || DEFAULT_WORKSPACE_ID) === ws._workspaceId
        && (!embedAgentIds || embedAgentIds.has(agent.id))
      )) : [];
    try {
      ws.send(JSON.stringify({
        type: "init",
        workspaceId: ws._workspaceId,
        workspaces: visibleWorkspacesForUser(user),
        workspaceMembers: canReadWorkspace && !embedUser ? listWorkspaceMembers(ws._workspaceId) : [],
        workspaceAllowlistActive: allowlistActive(ws._workspaceId),
        viewerRole: user ? userWorkspaceRole(user, ws._workspaceId) : null,
        isSuperuser: !!(user && isSuperuser(user.email)),
        channels: visibleChannels,
        agents: visibleAgents,
        humans: embedUser ? [] : currentHumans(),
        configs: canReadWorkspace && !embedUser ? sanitizedAgentConfigs().filter((config) => (config.workspaceId || DEFAULT_WORKSPACE_ID) === ws._workspaceId) : [],
        machines: canReadWorkspace && !embedUser ? Array.from(machines.values()).filter((machine) => (machine.workspaceId || DEFAULT_WORKSPACE_ID) === ws._workspaceId) : [],
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
  });

  const pingInterval = setInterval(() => {
    if (ws.readyState === 1) {
      ws.send(JSON.stringify({ type: "ping" }));
    }
  }, 30000);
  ws.on("close", () => clearInterval(pingInterval));
}

function sendWebError(ws, message, extra = {}) {
  if (ws.readyState !== 1) return;
  ws.send(JSON.stringify({ type: "error", message, ...extra }));
}

function webRequestWorkspaceId(ws, msg) {
  const socketWorkspaceId = normalizeWorkspaceId(ws._workspaceId || DEFAULT_WORKSPACE_ID);
  const requestedWorkspaceId = normalizeWorkspaceId(msg.workspaceId || socketWorkspaceId);
  if (requestedWorkspaceId !== socketWorkspaceId) {
    sendWebError(ws, "Workspace mismatch. Reconnect the socket for the selected workspace.", {
      code: "workspace_mismatch",
      workspaceId: socketWorkspaceId,
      requestedWorkspaceId,
    });
    return null;
  }
  const user = ws._authToken ? getAuthSession(ws._authToken) : null;
  const defaultOpenRead = !user && requestedWorkspaceId === DEFAULT_WORKSPACE_ID && !allowlistActive(requestedWorkspaceId);
  if (!findWorkspace(requestedWorkspaceId) || (!defaultOpenRead && (!user || !userCanAccessWorkspace(user, requestedWorkspaceId)))) {
    sendWebError(ws, "Not a member of this workspace.", {
      code: "workspace_forbidden",
      workspaceId: requestedWorkspaceId,
    });
    return null;
  }
  return requestedWorkspaceId;
}

function webAgentRequest(ws, msg) {
  const workspaceId = webRequestWorkspaceId(ws, msg);
  if (!workspaceId) return null;
  const agentId = typeof msg.agentId === "string" ? msg.agentId : "";
  if (!agentId || workspaceIdFromAgent(agentId) !== workspaceId) {
    sendWebError(ws, "Agent not found in this workspace.", {
      code: "agent_not_found",
      workspaceId,
      agentId,
    });
    return null;
  }
  return { workspaceId, agentId, agentWs: daemonSockets.get(agentId) };
}

function handleWebMessage(ws, msg) {
  // Block write-type messages from unauthenticated (guest) connections
  if (WS_AUTH_REQUIRED_TYPES.has(msg.type) && !ws._authenticated) {
    ws.send(JSON.stringify({ type: "error", message: "Authentication required. Please sign in to perform this action." }));
    console.log(`[web] Blocked unauthenticated WS message: ${msg.type}`);
    return;
  }
  const user = ws._authToken ? getAuthSession(ws._authToken) : null;
  if (isEmbedSessionUser(user) && msg.type !== "presence:update" && msg.type !== "presence:clear") {
    sendWebError(ws, "Embed sessions can only use chat presence over websocket.", { code: "embed_forbidden" });
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
      const request = webAgentRequest(ws, msg);
      if (!request) break;
      const agentWs = request.agentWs;
      if (agentWs && agentWs.readyState === 1) {
        const payload = { agentId: request.agentId, dirPath: msg.dirPath || null };
        if (hasWorkspaceFsCapability(agentWs)) {
          agentWs.send(JSON.stringify({ type: "workspace:list", ...payload }));
        } else {
          agentWs.send(JSON.stringify({ type: "agent:workspace:list", ...payload }));
        }
      }
      break;
    }
    case "workspace:read": {
      const request = webAgentRequest(ws, msg);
      if (!request) break;
      const agentWs = request.agentWs;
      if (agentWs && agentWs.readyState === 1) {
        const payload = { agentId: request.agentId, requestId: msg.requestId || uuidv4(), path: msg.path };
        if (hasWorkspaceFsCapability(agentWs)) {
          agentWs.send(JSON.stringify({ type: "workspace:read", ...payload }));
        } else {
          agentWs.send(JSON.stringify({ type: "agent:workspace:read", ...payload }));
        }
      }
      break;
    }
    case "memory:list": {
      const request = webAgentRequest(ws, msg);
      if (!request) break;
      const ovCreds = resolveOvCredentials(request.agentId);
      if (ovCreds && !isLocalUrl(ovCreds.url)) {
        const uri = msg.uri || "viking://";
        ovMcpCall(ovCreds, "list", { uri })
          .then((raw) => {
            broadcastToWeb({ type: "memory:list_result", workspaceId: request.workspaceId, agentId: request.agentId, uri, entries: parseOvListResult(raw, uri) });
          })
          .catch((e) => {
            ovMcpSessions.delete(ovCreds.url + ":" + ovCreds.user);
            broadcastToWeb({ type: "memory:list_result", workspaceId: request.workspaceId, agentId: request.agentId, uri, entries: [], error: e.message });
          });
      } else {
        const agentWs = request.agentWs;
        if (agentWs && agentWs.readyState === 1) {
          agentWs.send(JSON.stringify({ type: "agent:memory:list", agentId: request.agentId, uri: msg.uri || "viking://" }));
        }
      }
      break;
    }
    case "memory:read": {
      const request = webAgentRequest(ws, msg);
      if (!request) break;
      const ovCreds = resolveOvCredentials(request.agentId);
      const level = msg.level === "l0" || msg.level === "l1" || msg.level === "l2" ? msg.level : null;
      if (ovCreds && !isLocalUrl(ovCreds.url)) {
        let uri = msg.uri;
        // L0/L1 are directory-level products; OV expects a trailing slash for dir URIs.
        // (Mirrors atlas-fs openviking-adapter.read behavior.)
        if ((level === "l0" || level === "l1") && uri && uri !== "viking://" && !uri.endsWith("/")) {
          uri = uri + "/";
        }
        const requestId = msg.requestId || uuidv4();
        const op = level
          ? ovHttpReadContent(ovCreds, uri, level)
          : ovMcpCall(ovCreds, "read", { uris: uri });
        op
          .then((content) => {
            broadcastToWeb({ type: "memory:content", workspaceId: request.workspaceId, agentId: request.agentId, requestId, uri: msg.uri, level, content, error: null });
          })
          .catch((e) => {
            if (!level) ovMcpSessions.delete(ovCreds.url + ":" + ovCreds.user);
            broadcastToWeb({ type: "memory:content", workspaceId: request.workspaceId, agentId: request.agentId, requestId, uri: msg.uri, level, content: null, error: e.message });
          });
      } else {
        const agentWs = request.agentWs;
        if (agentWs && agentWs.readyState === 1) {
          agentWs.send(JSON.stringify({ type: "agent:memory:read", agentId: request.agentId, requestId: msg.requestId || uuidv4(), uri: msg.uri, level }));
        }
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
      const request = webAgentRequest(ws, msg);
      if (!request) break;
      const agentWs = request.agentWs;
      if (agentWs && agentWs.readyState === 1) {
        agentWs.send(JSON.stringify({ type: "agent:skills:list", agentId: request.agentId, runtime: msg.runtime || null }));
      }
      break;
    }
    case "machine:workspace:scan": {
      const workspaceId = webRequestWorkspaceId(ws, msg);
      if (!workspaceId) break;
      // Target a specific machine by machineId, or broadcast to all daemons
      let sent = false;
      for (const dws of daemonConnections) {
        if (
          dws.readyState === 1
          && normalizeWorkspaceId(dws._workspaceId || DEFAULT_WORKSPACE_ID) === workspaceId
          && (!msg.machineId || dws._machineId === msg.machineId)
        ) {
          dws.send(JSON.stringify({ type: "machine:workspace:scan" }));
          sent = true;
          if (msg.machineId) break;
        }
      }
      break;
    }
    case "machine:workspace:delete": {
      const workspaceId = webRequestWorkspaceId(ws, msg);
      if (!workspaceId) break;
      for (const dws of daemonConnections) {
        if (
          dws.readyState === 1
          && normalizeWorkspaceId(dws._workspaceId || DEFAULT_WORKSPACE_ID) === workspaceId
          && (!msg.machineId || dws._machineId === msg.machineId)
        ) {
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
const MAGIC_LOGIN_CHALLENGE_TTL_MS = 5 * 60 * 1000;
const magicLoginChallenges = new Map();

function isEmbedSessionUser(user) {
  return !!user?.embed?.workspaceId;
}

function embedSessionExpired(user) {
  if (!isEmbedSessionUser(user)) return false;
  const expiresAt = Date.parse(user.embed.expiresAt || "");
  return Number.isFinite(expiresAt) && expiresAt <= Date.now();
}

function getAuthSession(token) {
  if (!token) return null;
  const user = authSessions.get(token);
  if (!user) return null;
  if (embedSessionExpired(user)) {
    authSessions.delete(token);
    return null;
  }
  return user;
}

function hasAuthSession(token) {
  return !!getAuthSession(token);
}

function publicAuthUser(user) {
  if (!user) return null;
  return {
    name: user.name,
    email: user.email || null,
    picture: user.picture || null,
    gravatarUrl: user.gravatarUrl || null,
    guest: !!user.guest,
    embed: isEmbedSessionUser(user),
  };
}

// Load sessions from PostgreSQL (when available) or local file fallback.
// Called at startup — must be awaited before server accepts requests.
async function loadAuthSessions() {
  if (db.enabled) {
    try {
      const rows = await db.loadSessions();
      if (rows) {
        for (const { token, user } of rows) authSessions.set(token, user);
        console.log(`[auth] Loaded ${authSessions.size} session(s) from database`);
        return;
      }
    } catch (e) {
      console.warn("[auth] Database session load failed, falling back to disk:", e.message);
    }
  }
  // Local file fallback (local dev without a database)
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

function pruneMagicLoginChallenges() {
  const nowMs = Date.now();
  for (const [id, challenge] of magicLoginChallenges.entries()) {
    if (!challenge || challenge.expiresAt <= nowMs) {
      magicLoginChallenges.delete(id);
    }
  }
}

function createMagicLoginChallenge(email) {
  pruneMagicLoginChallenges();
  const challenge = {
    id: crypto.randomBytes(24).toString("hex"),
    pollToken: crypto.randomBytes(24).toString("hex"),
    email: normalizeEmailInput(email),
    status: "pending",
    createdAt: Date.now(),
    expiresAt: Date.now() + MAGIC_LOGIN_CHALLENGE_TTL_MS,
    result: null,
  };
  magicLoginChallenges.set(challenge.id, challenge);
  return challenge;
}

function getMagicLoginChallenge(id) {
  if (!id || typeof id !== "string") return null;
  const challenge = magicLoginChallenges.get(id);
  if (!challenge) return null;
  if (challenge.expiresAt <= Date.now()) {
    magicLoginChallenges.delete(id);
    return { ...challenge, status: "expired" };
  }
  return challenge;
}

function completeMagicLoginChallenge(id, result) {
  const challenge = getMagicLoginChallenge(id);
  if (!challenge || challenge.status === "expired") return false;
  const resultEmail = normalizeEmailInput(result?.user?.email);
  if (challenge.email && challenge.email !== resultEmail) {
    console.warn(`[auth] Magic login challenge email mismatch for ${challenge.email}: got ${resultEmail || "none"}`);
    return false;
  }
  challenge.status = "completed";
  challenge.completedAt = Date.now();
  challenge.result = result;
  return true;
}

async function mintSessionForEmail(email, opts = {}) {
  const normalizedEmail = normalizeEmailInput(email);
  if (!normalizedEmail) {
    const err = new Error("No email in Supabase session");
    err.statusCode = 401;
    throw err;
  }
  if (!isEmailAllowedAnyWorkspace(normalizedEmail)) {
    const err = new Error("Email not authorized to access this server.");
    err.statusCode = 403;
    throw err;
  }
  const emailPrefix = normalizedEmail.split("@")[0];
  if (isReservedName(emailPrefix)) {
    const err = new Error("Reserved username — please contact an admin.");
    err.statusCode = 403;
    throw err;
  }
  const grav = gravatarUrl(normalizedEmail);
  const user = {
    name: emailPrefix,
    email: normalizedEmail,
    picture: opts.picture || null,
    gravatarUrl: grav,
  };
  const sessionToken = crypto.randomBytes(32).toString("hex");
  authSessions.set(sessionToken, user);
  if (userCanAccessWorkspace(user, DEFAULT_WORKSPACE_ID)) {
    ensureWorkspaceMemberForUser(user, DEFAULT_WORKSPACE_ID);
  }
  persistSession(sessionToken, user).catch(e => console.warn("[auth] persistSession error:", e.message));
  const changed = upsertAllTimeHuman({
    id: humanId(user.name),
    name: user.name,
    picture: user.picture || undefined,
    gravatarUrl: user.gravatarUrl || undefined,
  });
  if (changed) broadcastHumans();
  return {
    token: sessionToken,
    user,
    requestedWorkspaceId: opts.requestedWorkspaceId || DEFAULT_WORKSPACE_ID,
    accessibleWorkspaces: visibleWorkspacesForUser(user),
  };
}

app.post("/api/auth/google", async (req, res) => {
  const { credential } = req.body;
  const requestedWorkspaceId = findWorkspace(workspaceIdFromReq(req)) ? workspaceIdFromReq(req) : DEFAULT_WORKSPACE_ID;
  if (!credential) return res.status(400).json({ error: "Missing credential" });
  if (!googleClient) return res.status(501).json({ error: "Google OAuth not configured (set GOOGLE_CLIENT_ID)" });

  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    res.json(await mintSessionForEmail(payload.email, {
      picture: payload.picture || null,
      requestedWorkspaceId,
    }));
  } catch (err) {
    if (err.statusCode) {
      if (err.statusCode === 403) console.log(`[auth] Rejected login: ${err.message}`);
      return res.status(err.statusCode).json({ error: err.message });
    }
    console.error("[auth] Google token verification failed:", err.message);
    res.status(401).json({ error: "Invalid Google credential" });
  }
});

app.post("/api/auth/magic-link-challenge", (req, res) => {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return res.status(501).json({ error: "Magic link auth not configured" });
  }
  const email = normalizeEmailInput(req.body?.email);
  if (!email) return res.status(400).json({ error: "Invalid email address" });
  const challenge = createMagicLoginChallenge(email);
  res.json({
    challengeId: challenge.id,
    pollToken: challenge.pollToken,
    expiresAt: new Date(challenge.expiresAt).toISOString(),
    expiresInSeconds: Math.round(MAGIC_LOGIN_CHALLENGE_TTL_MS / 1000),
  });
});

app.get("/api/auth/magic-link-challenge/:id", (req, res) => {
  const challenge = getMagicLoginChallenge(req.params.id);
  if (!challenge || challenge.pollToken !== req.query.pollToken) {
    return res.status(404).json({ error: "Magic login challenge not found" });
  }
  if (challenge.status === "expired") {
    return res.status(410).json({ status: "expired" });
  }
  if (challenge.status === "completed" && challenge.result) {
    return res.json({
      status: "completed",
      ...challenge.result,
    });
  }
  res.json({
    status: "pending",
    expiresAt: new Date(challenge.expiresAt).toISOString(),
  });
});

// Verify a Supabase access_token (from magic link or OAuth) and mint a zouk session.
app.post("/api/auth/supabase", async (req, res) => {
  const { accessToken, magicLoginChallengeId } = req.body;
  const requestedWorkspaceId = findWorkspace(workspaceIdFromReq(req)) ? workspaceIdFromReq(req) : DEFAULT_WORKSPACE_ID;
  if (!accessToken) return res.status(400).json({ error: "Missing accessToken" });
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(501).json({ error: "Supabase auth not configured (set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY)" });
  }

  try {
    const supaRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        apikey: SUPABASE_SERVICE_ROLE_KEY,
      },
    });
    if (!supaRes.ok) {
      const body = await supaRes.json().catch(() => ({}));
      console.warn(`[auth] Supabase user lookup failed: ${supaRes.status}`, body);
      return res.status(401).json({ error: "Invalid or expired Supabase token" });
    }
    const supaUser = await supaRes.json();
    const result = await mintSessionForEmail(supaUser.email, {
      requestedWorkspaceId,
    });
    if (magicLoginChallengeId) completeMagicLoginChallenge(magicLoginChallengeId, result);
    res.json(result);
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
    console.error("[auth] Supabase token verification failed:", err.message);
    res.status(500).json({ error: "Supabase verification failed" });
  }
});

app.get("/api/auth/me", (req, res) => {
  const token = req.headers.authorization?.replace("Bearer ", "");
  const user = token ? getAuthSession(token) : null;
  if (!user) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  res.json({ user: publicAuthUser(user) });
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
  const user = getAuthSession(token);
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

app.get("/api/auth/config", (req, res) => {
  res.json({
    googleClientId: GOOGLE_CLIENT_ID || null,
    // Any workspace gating on an allowlist disables the guest button across
    // the whole deployment — otherwise default-workspace visitors could click
    // through to a per-workspace guard that immediately rejects them.
    allowlistActive: allowlistActiveAnywhere(),
    supabaseUrl: SUPABASE_URL || null,
    supabaseAnonKey: SUPABASE_ANON_KEY || null,
    ovRuntimeWhitelist: OV_RUNTIME_WHITELIST,
  });
});

app.get("/api/workspaces", requireSessionAuth, (req, res) => {
  res.json({
    workspaces: visibleWorkspacesForUser(req.user),
    activeWorkspaceId: req.workspaceId || DEFAULT_WORKSPACE_ID,
  });
});

app.post("/api/workspaces", requireSessionAuth, async (req, res) => {
  if (!req.user?.email) {
    return res.status(403).json({ error: "Authenticated email required to create a server." });
  }
  const rawName = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  const name = rawName || "New Server";
  const id = allocateWorkspaceId(req.body?.id || name, findWorkspace);
  let icon;
  try {
    icon = normalizeWorkspaceIconInput(req.body?.icon, workspaceIconFallback(name, id));
  } catch (err) {
    return res.status(err.statusCode || 400).json({ error: err.message || "invalid icon" });
  }
  const ownerEmail = req.user?.email || null;
  const workspace = ensureWorkspace({ id, name, icon, ownerEmail, createdAt: now() });
  await db.saveWorkspace(workspace);
  if (ownerEmail) {
    const member = setWorkspaceMember({
      workspaceId: id,
      email: ownerEmail,
      name: req.user.name,
      role: "root",
    });
    await db.saveWorkspaceMember(member);
    if (db.enabled) {
      const row = await db.addEmailAllowlist(ownerEmail.trim().toLowerCase(), ownerEmail, id);
      if (row && !row.dbError) {
        dbAllowEmails.set(allowlistKey(row.workspaceId, row.email), {
          workspaceId: row.workspaceId,
          email: row.email,
          addedAt: row.addedAt,
          addedBy: row.addedBy,
        });
      }
    }
  }
  const all = findOrCreateChannel("all", "channel", id);
  all.description = "General channel";
  await db.saveChannel(all);
  if (ownerEmail) broadcastWorkspaceMembers(id);
  res.json({
    workspace: workspacePayload(workspace),
    workspaces: visibleWorkspacesForUser(req.user),
  });
});

app.patch("/api/workspaces/:id", requireSessionAuth, async (req, res) => {
  const id = normalizeWorkspaceId(req.params.id);
  const workspace = findWorkspace(id);
  if (!workspace) {
    return res.status(404).json({ error: "Workspace not found." });
  }
  if (!userCanAccessWorkspace(req.user, id)) {
    return res.status(403).json({ error: "Not a member of this workspace." });
  }

  const next = { ...workspace };
  if (req.body?.name !== undefined) {
    if (!userCanAdminWorkspace(req.user, id)) {
      return res.status(403).json({ error: "Workspace root/admin required." });
    }
    const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
    if (!name) return res.status(400).json({ error: "name required" });
    next.name = name;
  }
  if (req.body?.icon !== undefined) {
    try {
      next.icon = normalizeWorkspaceIconInput(req.body.icon, workspaceIconFallback(next.name, id));
    } catch (err) {
      return res.status(err.statusCode || 400).json({ error: err.message || "invalid icon" });
    }
  }

  const updated = ensureWorkspace(next);
  await db.saveWorkspace(updated);
  const payload = workspacePayload(updated);
  broadcastToWeb({ type: "workspace_updated", workspaceId: id, workspace: payload });
  res.json({
    workspace: payload,
    workspaces: visibleWorkspacesForUser(req.user),
  });
});

app.delete("/api/workspaces/:id", requireAuth, async (req, res) => {
  const id = normalizeWorkspaceId(req.params.id);
  if (id === DEFAULT_WORKSPACE_ID) {
    return res.status(400).json({ error: "Default workspace cannot be deleted." });
  }
  if (req.workspaceId !== id) {
    return res.status(400).json({ error: "Workspace id mismatch — pass X-Workspace-Id matching the path." });
  }
  const workspace = findWorkspace(id);
  if (!workspace) {
    return res.status(404).json({ error: "Workspace not found." });
  }
  if (!userCanRootWorkspace(req.user, id)) {
    return res.status(403).json({ error: "Workspace root required." });
  }

  const payload = workspacePayload(workspace);
  const deletedInDb = await db.deleteWorkspace(id);
  if (db.enabled && !deletedInDb) {
    return res.status(500).json({ error: "Failed to delete workspace." });
  }
  removeWorkspaceFromMemory(id);
  broadcastToWeb({ type: "workspace_deleted", workspaceId: id, workspace: payload });
  res.json({
    ok: true,
    workspace: payload,
    workspaces: visibleWorkspacesForUser(req.user),
  });
});

// ─── Workspace members ──────────────────────────────────────────
// Any workspace member can list members; only admins (root/owner/admin or
// superuser) may invite, change roles, or remove. Inviting also seeds the
// per-workspace email_allowlist so requireAuth lets the invitee in next time
// they OAuth.
const VALID_MEMBER_ROLES = new Set(["root", "owner", "admin", "member"]);

app.get("/api/workspaces/:id/members", requireAuth, (req, res) => {
  const workspaceId = normalizeWorkspaceId(req.params.id);
  if (req.workspaceId !== workspaceId) {
    return res.status(400).json({ error: "Workspace id mismatch — pass X-Workspace-Id matching the path." });
  }
  res.json({ workspaceId, members: listWorkspaceMembers(workspaceId) });
});

app.post("/api/workspaces/:id/members", requireAuth, requireWorkspaceAdmin, async (req, res) => {
  const workspaceId = normalizeWorkspaceId(req.params.id);
  if (req.workspaceId !== workspaceId) {
    return res.status(400).json({ error: "Workspace id mismatch — pass X-Workspace-Id matching the path." });
  }
  const email = normalizeEmailInput(req.body?.email);
  if (!email) return res.status(400).json({ error: "Invalid email address" });
  const rawRole = typeof req.body?.role === "string" ? req.body.role.trim().toLowerCase() : "member";
  // Inviting someone as `root` would let them demote the original owner.
  // Restrict invites to admin/member; existing root/owner rows can only be
  // changed by the holder themselves (or a superuser).
  if (!["admin", "member"].includes(rawRole)) {
    return res.status(400).json({ error: "role must be 'admin' or 'member'" });
  }
  const existing = getWorkspaceMember(workspaceId, email);
  if (existing) {
    return res.status(409).json({ error: "Already a member", member: workspaceMemberPayload(existing) });
  }
  const rawName = typeof req.body?.name === "string" ? req.body.name.trim().slice(0, 100) : null;
  const member = setWorkspaceMember({
    workspaceId,
    email,
    role: rawRole,
    name: rawName || null,
  });

  // Non-default workspaces gate on per-workspace email_allowlist; without
  // this row requireAuth would still reject the invitee on their next login.
  // Default workspace does not require this — `userWorkspaceRole` falls back
  // to "member" for any authenticated email when no allowlist is active.
  if (db.enabled && workspaceId !== DEFAULT_WORKSPACE_ID) {
    const row = await db.addEmailAllowlist(email, req.user.email || null, workspaceId);
    if (row && !row.dbError) {
      dbAllowEmails.set(allowlistKey(row.workspaceId, row.email), {
        workspaceId: row.workspaceId,
        email: row.email,
        addedAt: row.addedAt,
        addedBy: row.addedBy,
      });
    }
  }

  broadcastWorkspaceMembers(workspaceId);
  res.json({ ok: true, member: workspaceMemberPayload(member) });
});

app.put("/api/workspaces/:id/members/:email", requireAuth, requireWorkspaceAdmin, async (req, res) => {
  const workspaceId = normalizeWorkspaceId(req.params.id);
  if (req.workspaceId !== workspaceId) {
    return res.status(400).json({ error: "Workspace id mismatch" });
  }
  const email = normalizeEmailInput(decodeURIComponent(req.params.email || ""));
  if (!email) return res.status(400).json({ error: "Invalid email address" });
  const target = getWorkspaceMember(workspaceId, email);
  if (!target) return res.status(404).json({ error: "Member not found" });

  const role = typeof req.body?.role === "string" ? req.body.role.trim().toLowerCase() : null;
  if (!role || !VALID_MEMBER_ROLES.has(role)) {
    return res.status(400).json({ error: "role must be one of root/owner/admin/member" });
  }

  // Only the existing root (or a superuser) may promote to root or demote the
  // workspace root. Without this gate any admin could pull root out from under
  // the workspace creator.
  const callerRole = userWorkspaceRole(req.user, workspaceId);
  const callerIsSuper = isSuperuser(req.user?.email);
  if ((target.role === "root" || role === "root") && callerRole !== "root" && !callerIsSuper) {
    return res.status(403).json({ error: "Only root or a superuser can grant or revoke the root role." });
  }
  // A root must always exist on a workspace. Block demoting the only root.
  if (target.role === "root" && role !== "root") {
    const otherRoots = [...workspaceMembersFor(workspaceId).values()]
      .filter((m) => m.email !== email && m.role === "root");
    if (otherRoots.length === 0) {
      return res.status(409).json({ error: "Cannot demote the only root — promote another member to root first." });
    }
  }

  const updated = setWorkspaceMember({
    workspaceId,
    email,
    name: target.name,
    joinedAt: target.joinedAt,
    role,
  });
  broadcastWorkspaceMembers(workspaceId);
  res.json({ ok: true, member: workspaceMemberPayload(updated) });
});

app.delete("/api/workspaces/:id/members/:email", requireAuth, requireWorkspaceAdmin, async (req, res) => {
  const workspaceId = normalizeWorkspaceId(req.params.id);
  if (req.workspaceId !== workspaceId) {
    return res.status(400).json({ error: "Workspace id mismatch" });
  }
  const email = normalizeEmailInput(decodeURIComponent(req.params.email || ""));
  if (!email) return res.status(400).json({ error: "Invalid email address" });
  if (workspaceId === DEFAULT_WORKSPACE_ID && !allowlistActive(workspaceId)) {
    return res.status(400).json({ error: "Default workspace is public; people cannot be removed unless ALLOW restricts access." });
  }
  const target = getWorkspaceMember(workspaceId, email);
  if (!target) return res.status(404).json({ error: "Member not found" });

  // Root removal: same constraints as demotion — must keep at least one root,
  // and only root or superuser can revoke another root.
  const callerRole = userWorkspaceRole(req.user, workspaceId);
  const callerIsSuper = isSuperuser(req.user?.email);
  if (target.role === "root" && callerRole !== "root" && !callerIsSuper) {
    return res.status(403).json({ error: "Only root or a superuser can remove the root member." });
  }
  if (target.role === "root") {
    const otherRoots = [...workspaceMembersFor(workspaceId).values()]
      .filter((m) => m.email !== email && m.role === "root");
    if (otherRoots.length === 0) {
      return res.status(409).json({ error: "Cannot remove the only root — promote another member to root first." });
    }
  }

  removeWorkspaceMember(workspaceId, email);
  markWorkspaceMemberRemoved(workspaceId, email, req.user?.email || null);

  // Mirror the invite path: drop the per-workspace allowlist row so the
  // removed user can't reauth their way back in. A restricted default workspace
  // gates via ALLOW env, so its durable removal gate is the tombstone above.
  if (db.enabled && workspaceId !== DEFAULT_WORKSPACE_ID) {
    const key = allowlistKey(workspaceId, email);
    if (dbAllowEmails.has(key)) {
      await db.removeEmailAllowlist(email, workspaceId);
      dbAllowEmails.delete(key);
    }
  }

  closeWorkspaceSocketsForEmail(workspaceId, email);
  if (removeAllTimeHumanIfInaccessible(email)) broadcastHumans();
  broadcastWorkspaceMembers(workspaceId);
  res.json({ ok: true });
});

// Internal diagnostics: in-memory store sizes + index counts. Auth-gated so
// random visitors can't fingerprint server load, but cheap enough to curl
// when investigating "feels slow" reports.
app.get("/api/_internal/stats", requireAuth, (_req, res) => {
  let threadReplyTotal = 0;
  for (const arr of repliesByThreadId.values()) threadReplyTotal += arr.length;
  let cachedMessageTotal = 0;
  for (const arr of store.channelMessages.values()) cachedMessageTotal += arr.length;
  res.json({
    timestamp: now(),
    seq: store.seq,
    taskSeq: store.taskSeq,
    store: {
      cachedMessages: cachedMessageTotal,
      cachedChannels: store.channelMessages.size,
      channelCacheTail: CHANNEL_CACHE_TAIL,
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
      owner = getAuthSession(entry.token) || null;
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
      sessionExists: entry.kind === "token" ? hasAuthSession(entry.token) : null,
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
    autoBlockMaxOpen: WS_RATE_BLOCK_MAX_OPEN,
    autoBlockHardThreshold: WS_RATE_HARD_BLOCK_THRESHOLD,
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
    if (hasAuthSession(tokenToKill)) {
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

function embedSettingsPayload(workspaceId) {
  const settings = embedSettings.get(workspaceId);
  const allowed = new Set(settings.allowedChannelIds || []);
  const channels = store.channels
    .filter((ch) => (
      (ch.workspaceId || DEFAULT_WORKSPACE_ID) === workspaceId
      && (ch.type || "channel") === "channel"
      && allowed.has(ch.id)
    ))
    .map((ch) => ({ id: ch.id, name: ch.name, description: ch.description || "" }));
  return { ...settings, allowedChannels: channels };
}

function parseEmbedOrigins(rawOrigins) {
  const values = Array.isArray(rawOrigins)
    ? rawOrigins
    : String(rawOrigins || "").split(/\n|,/);
  const origins = [];
  for (const raw of values) {
    const value = String(raw || "").trim();
    if (!value) continue;
    const origin = normalizeEmbedOrigin(value);
    if (!origin) {
      const err = new Error(`Invalid origin: ${value}`);
      err.statusCode = 400;
      throw err;
    }
    if (!origins.includes(origin)) origins.push(origin);
  }
  return origins;
}

// ─── Settings: external embed access ──────────────────────────────

app.get("/api/settings/embed", requireAuth, requireWorkspaceAdmin, (req, res) => {
  const workspaceId = req.workspaceId || DEFAULT_WORKSPACE_ID;
  res.json({ settings: embedSettingsPayload(workspaceId) });
});

app.put("/api/settings/embed", requireAuth, requireWorkspaceAdmin, async (req, res) => {
  const workspaceId = req.workspaceId || DEFAULT_WORKSPACE_ID;
  let allowedOrigins;
  try {
    allowedOrigins = parseEmbedOrigins(req.body?.allowedOrigins);
  } catch (e) {
    return res.status(e.statusCode || 400).json({ error: e.message });
  }
  const requestedChannelIds = Array.isArray(req.body?.allowedChannelIds) ? req.body.allowedChannelIds : [];
  const allowedChannelIds = [];
  for (const id of requestedChannelIds) {
    const channelId = String(id || "").trim();
    if (!channelId || allowedChannelIds.includes(channelId)) continue;
    const channel = store.channels.find((ch) => (
      ch.id === channelId
      && (ch.workspaceId || DEFAULT_WORKSPACE_ID) === workspaceId
      && (ch.type || "channel") === "channel"
    ));
    if (!channel) return res.status(400).json({ error: `Unknown channel id: ${channelId}` });
    allowedChannelIds.push(channelId);
  }
  if (req.body?.enabled && allowedOrigins.length === 0) {
    return res.status(400).json({ error: "At least one allowed origin is required when embed is enabled." });
  }
  if (req.body?.enabled && allowedChannelIds.length === 0) {
    return res.status(400).json({ error: "At least one channel scope is required when embed is enabled." });
  }
  const saved = await embedSettings.save(embedSettings.normalize({
    enabled: !!req.body?.enabled,
    allowedOrigins,
    allowedChannelIds,
    tokenTtlSeconds: req.body?.tokenTtlSeconds,
  }, workspaceId, req.user?.email || req.user?.name || null));
  res.json({ settings: embedSettingsPayload(saved.workspaceId) });
});

// ─── Settings: email allowlist (admin UI for the DB source) ──────
// Any authenticated user may view and edit the allowlist. Entries seeded from
// the ALLOW env are read-only here (listed with source="env") — editing them
// requires a server restart. DB entries are mutable.

app.get("/api/settings/allowlist", requireAuth, (req, res) => {
  const workspaceId = req.workspaceId || DEFAULT_WORKSPACE_ID;
  const env = workspaceId === DEFAULT_WORKSPACE_ID
    ? [...ENV_ALLOW_EMAILS].map((email) => ({ email, source: "env" }))
    : [];
  const dbList = [...dbAllowEmails.values()]
    .filter((meta) => (meta.workspaceId || DEFAULT_WORKSPACE_ID) === workspaceId)
    .map((meta) => ({
    email: meta.email,
    source: "db",
    addedAt: meta.addedAt,
    addedBy: meta.addedBy || null,
  }));
  res.json({
    workspaceId,
    env,
    db: dbList,
    allowlistActive: allowlistActive(workspaceId),
    dbWritable: db.enabled,
  });
});

app.post("/api/settings/allowlist", requireAuth, requireWorkspaceAdmin, async (req, res) => {
  if (!db.enabled) {
    return res.status(501).json({ error: "Database not configured — cannot persist allowlist entries. Use the ALLOW env var instead." });
  }
  const workspaceId = req.workspaceId || DEFAULT_WORKSPACE_ID;
  const normalized = normalizeEmailInput(req.body?.email);
  if (!normalized) {
    return res.status(400).json({ error: "Invalid email address" });
  }
  const token = req.headers.authorization?.replace("Bearer ", "");
  const addedBy = token ? getAuthSession(token)?.email || null : null;
  const row = await db.addEmailAllowlist(normalized, addedBy, workspaceId);
  if (!row || row.dbError) {
    return res.status(500).json({ error: row?.dbError || "Failed to add allowlist entry" });
  }
  dbAllowEmails.set(allowlistKey(row.workspaceId, row.email), {
    workspaceId: row.workspaceId,
    email: row.email,
    addedAt: row.addedAt,
    addedBy: row.addedBy,
  });
  setWorkspaceMember({ workspaceId, email: row.email, role: "member" });
  res.json({ ok: true, entry: { email: row.email, source: "db", addedAt: row.addedAt, addedBy: row.addedBy } });
});

app.delete("/api/settings/allowlist/:email", requireAuth, requireWorkspaceAdmin, async (req, res) => {
  if (!db.enabled) {
    return res.status(501).json({ error: "Database not configured" });
  }
  const workspaceId = req.workspaceId || DEFAULT_WORKSPACE_ID;
  const normalized = normalizeEmailInput(decodeURIComponent(req.params.email || ""));
  if (!normalized) {
    return res.status(400).json({ error: "Invalid email address" });
  }
  const key = allowlistKey(workspaceId, normalized);
  if (!dbAllowEmails.has(key)) {
    return res.status(404).json({ error: "Entry not found (env-seeded entries cannot be removed via API)" });
  }
  const ok = await db.removeEmailAllowlist(normalized, workspaceId);
  if (!ok) {
    return res.status(500).json({ error: "Failed to remove allowlist entry" });
  }
  dbAllowEmails.delete(key);
  res.json({ ok: true });
});

function resolveEmbedRequestedChannel(workspaceId, body = {}) {
  const channelId = String(body.channelId || "").trim();
  const channelName = String(body.channel || body.channelName || "").trim().replace(/^#/, "");
  if (!channelId && !channelName) return null;
  return store.channels.find((ch) => (
    (ch.workspaceId || DEFAULT_WORKSPACE_ID) === workspaceId
    && (ch.type || "channel") === "channel"
    && ((channelId && ch.id === channelId) || (channelName && ch.name === channelName))
  )) || null;
}

function sanitizeEmbedAvatarUrl(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 4096) return null;
  if (trimmed.startsWith("data:image/")) {
    return trimmed.length <= 14000 ? trimmed : null;
  }
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return trimmed;
  } catch {
    return null;
  }
}

app.post("/api/auth/embed-guest-session", (req, res) => {
  const workspaceId = workspaceIdFromReq(req);
  const workspace = findWorkspace(workspaceId);
  if (!workspace) return res.status(404).json({ error: "Workspace not found." });

  const settings = embedSettings.get(workspaceId);
  if (!settings.enabled) return res.status(403).json({ error: "Embed access is disabled for this workspace." });

  const origin = normalizeEmbedOrigin(req.headers.origin || "");
  if (!origin || !settings.allowedOrigins.includes(origin)) {
    return res.status(403).json({ error: "Origin is not allowed for this workspace embed." });
  }

  const remoteIp = (req.headers["x-forwarded-for"] || "").toString().split(",")[0].trim()
    || req.socket.remoteAddress
    || "unknown";
  const rate = embedSessionRateLimiter.check(`${workspaceId}:${origin}:${remoteIp}`);
  if (!rate.allowed) {
    res.set("Retry-After", String(rate.retryAfterSeconds));
    return res.status(429).json({ error: "Too many embed session requests." });
  }

  const configuredChannelIds = new Set(settings.allowedChannelIds || []);
  const requested = resolveEmbedRequestedChannel(workspaceId, req.body || {});
  let allowedChannelIds = [...configuredChannelIds].filter((id) => store.channels.some((ch) => (
    ch.id === id
    && (ch.workspaceId || DEFAULT_WORKSPACE_ID) === workspaceId
    && (ch.type || "channel") === "channel"
  )));
  if (requested) {
    if (!configuredChannelIds.has(requested.id)) {
      return res.status(403).json({ error: "Requested channel is not allowed for this workspace embed." });
    }
    allowedChannelIds = [requested.id];
  }
  if (allowedChannelIds.length === 0) {
    return res.status(403).json({ error: "No channel scope is configured for this workspace embed." });
  }

  const token = crypto.randomBytes(32).toString("hex");
  const baseName = sanitizeEmbedGuestName(req.body?.name);
  const stableSuffix = embedGuestSuffixForBrowser({
    browserId: req.body?.browserId || req.body?.clientId,
    workspaceId,
    origin,
    channelIds: allowedChannelIds,
  });
  const randomSuffix = stableSuffix || crypto.randomBytes(3).toString("hex");
  const name = `embed-${baseName}-${randomSuffix}`.slice(0, 64);
  const picture = sanitizeEmbedAvatarUrl(req.body?.picture);
  const gravatarUrl = sanitizeEmbedAvatarUrl(req.body?.gravatarUrl);
  const expiresAt = new Date(Date.now() + settings.tokenTtlSeconds * 1000).toISOString();
  const user = {
    name,
    email: null,
    picture,
    gravatarUrl,
    guest: true,
    embed: {
      workspaceId,
      origin,
      allowedChannelIds,
      expiresAt,
    },
  };
  authSessions.set(token, user);
  res.json({
    token,
    user: publicAuthUser(user),
    workspaceId,
    allowedChannelIds,
    allowedChannels: allowedChannelIds
      .map((id) => store.channels.find((ch) => ch.id === id))
      .filter(Boolean)
      .map((ch) => ({ id: ch.id, name: ch.name })),
    expiresAt,
  });
});

// Guest session endpoint.
// When Google OAuth is not configured (open/dev mode), issue a real session
// token so guests can post messages without hitting the requireAuth wall.
// When Google OAuth IS configured, we keep the old behaviour (token-less) so
// the "Sign in with Google" prompt still appears.
app.post("/api/auth/guest-session", async (req, res) => {
  // Email allowlist disables guest access entirely — an active allowlist implies
  // "only these humans may enter", and guests have no email to check.
  const workspaceId = workspaceIdFromReq(req);
  if (workspaceId !== DEFAULT_WORKSPACE_ID) {
    return res.status(403).json({ error: "Guest access disabled on this server." });
  }
  if (allowlistActive(workspaceId)) {
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

    const [
      maxSeq,
      maxTaskNum,
      workspaces,
      workspaceMembers,
      workspaceMemberRemovals,
      msgs,
      channels,
      tasks,
      dbConfigs,
      dbKeys,
      channelAgents,
      taskTimeRows,
    ] = await Promise.all([
      db.loadMaxSeq(),
      db.loadMaxTaskNum(),
      db.loadWorkspaces(),
      db.loadWorkspaceMembers(),
      db.loadWorkspaceMemberRemovals(),
      db.loadMessages(),
      db.loadChannels(),
      db.loadTasks(),
      db.loadAgentConfigs(),
      db.loadMachineKeys(),
      db.loadChannelAgents(),
      db.loadTaskMessageTimes(),
    ]);

    if (maxSeq > store.seq) store.seq = maxSeq;
    if (maxTaskNum > store.taskSeq) store.taskSeq = maxTaskNum;

    if (workspaces !== null && workspaces.length > 0) {
      store.workspaces = [];
      for (const workspace of workspaces) ensureWorkspace(workspace);
      console.log(`[db] Loaded ${workspaces.length} workspaces`);
    } else if (workspaces !== null) {
      await db.saveWorkspace(ensureWorkspace({ id: DEFAULT_WORKSPACE_ID, name: DEFAULT_WORKSPACE_NAME, icon: DEFAULT_WORKSPACE_ICON }));
    }

    if (workspaceMembers !== null && workspaceMembers.length > 0) {
      store.workspaceMembers.clear();
      for (const member of workspaceMembers) setWorkspaceMember(member, { persist: false });
      console.log(`[db] Loaded ${workspaceMembers.length} workspace memberships`);
    }

    if (workspaceMemberRemovals !== null && workspaceMemberRemovals.length > 0) {
      removedWorkspaceMembers.clear();
      for (const removal of workspaceMemberRemovals) {
        removedWorkspaceMembers.set(
          workspaceMemberRemovalKey(removal.workspaceId, removal.email),
          workspaceMemberRemovalPayload(removal)
        );
      }
      console.log(`[db] Loaded ${workspaceMemberRemovals.length} workspace member removal(s)`);
    }

    if (msgs.length > 0) {
      seedFromBootstrap(msgs);
      console.log(`[db] Seeded threading index + cache from ${msgs.length} recent messages`);
    }

    // taskTimes covers ALL historical messages (via a SQL aggregate), not just
    // the bootstrap window — /api/tasks needs accurate timestamps regardless of
    // how old the originating message is.
    if (taskTimeRows && taskTimeRows.length > 0) {
      for (const row of taskTimeRows) {
        taskTimes.set(`${row.workspaceId}:${row.taskNumber}`, {
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        });
      }
      console.log(`[db] Loaded ${taskTimeRows.length} task time entries`);
    }

    for (const ch of channels) {
      if (!store.channels.find((c) => c.id === ch.id)) {
        store.channels.push(ch);
      } else {
        const existing = store.channels.find((c) => c.id === ch.id);
        if (existing) Object.assign(existing, ch);
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

    // NOTE: The legacy one-time backfill (auto-subscribe all agents to channels
    // with no membership rows) has been removed. New channels intentionally
    // start with no agent visibility; agents are seeded only into #all at
    // registration time. Channels without rows stay empty by design.

    // Persist the default `all` channel if it's not already in DB — so it has
    // a row for channel_agents to FK against and doesn't drift between runs.
    const allCh = findOrCreateChannel("all", "channel", DEFAULT_WORKSPACE_ID);
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
    await embedSettings.hydrateFromDb();

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
    if (cfg.workspaceId) a.workspaceId = cfg.workspaceId;
    const changed =
      before.name !== a.name ||
      before.displayName !== a.displayName ||
      before.runtime !== a.runtime ||
      before.model !== a.model;
    if (changed) {
      broadcastToWeb({ type: "agent_started", workspaceId: cfg.workspaceId || DEFAULT_WORKSPACE_ID, agent: agentPayload(agentId) });
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
    if (visibleWorkspacesForUser(user).length === 0) continue;
    upsertAllTimeHuman({
      id: humanId(user.name),
      name: user.name,
      picture: user.picture || undefined,
      gravatarUrl: user.gravatarUrl || (user.email ? gravatarUrl(user.email) : undefined),
    });
  }
  // Backfill default-workspace membership. The default workspace is the
  // public lobby — every authenticated email implicitly has 'member' access,
  // but pre-#300 sessions may not have a workspace_members row yet. Without
  // a row, admins can't manage them (change role, remove) and they don't
  // show up with the expected ADMIN/MEMBER badge in the sidebar. Materialise
  // a 'member' row for every known email that doesn't already have one.
  let defaultBackfill = 0;
  for (const user of authSessions.values()) {
    if (!user?.email || user.guest) continue;
    if (isWorkspaceMemberRemoved(DEFAULT_WORKSPACE_ID, user.email)) continue;
    if (getWorkspaceMember(DEFAULT_WORKSPACE_ID, user.email)) continue;
    setWorkspaceMember({
      workspaceId: DEFAULT_WORKSPACE_ID,
      email: user.email,
      name: user.name || null,
      role: "member",
    });
    defaultBackfill += 1;
  }
  if (defaultBackfill > 0) {
    console.log(`[auth] Backfilled ${defaultBackfill} default-workspace member row(s) from auth sessions`);
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
      setMembership,
      getMembership,
      appendMessage,
    });
  }
  // Seed routing windows from the bootstrap cache contents (DB-loaded or
  // mock-seeded). The router maintains its own state incrementally after this.
  const seedMessages = [];
  for (const arr of store.channelMessages.values()) seedMessages.push(...arr);
  seedMessages.sort((a, b) => a.seq - b.seq);
  rebuildDeliveryRoutingWindows(seedMessages);

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
