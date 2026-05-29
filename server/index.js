const express = require("express");
const http = require("http");
const { WebSocketServer } = require("ws");
const cors = require("cors");
const { v4: uuidv4 } = require("uuid");
const multer = require("multer");
const sharp = require("sharp");
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
const { createWorkspaceOpenvikingSettingsStore } = require("./workspaceOpenvikingSettings");
const { createAgentAuthStore } = require("./agent-auth");
const { createOvProxy } = require("./ov-proxy");
const { createPromptTemplateEngine } = require("./prompt-templates");
const { generateToolDefinitions } = require("./tool-definitions");
const { createOvLifecycleManager } = require("./ov-lifecycle");
const { makeResolveAgentOvCreds } = require("./ov-creds");
const { fetchOvTools, callOvTool, invalidateSession: invalidateOvMcpSession } = require("./ov-mcp-proxy");
const { AgentDeliveryRouter } = require("./notifications/agentDeliveryRouter");
const { DEFAULT_WORKSPACE_ID, allocateWorkspaceId, normalizeWorkspaceId } = require("./workspaceIds");
const {
  wsTrackers, tokenFingerprint,
  recordWsConnectAttempt, recordInvalidTokenAttempt,
  recordWsDisconnect, pruneOldWsTrackers,
  WS_REVOKE_BLOCK_MS,
} = require("./lib/ws-tracker");
const { createAllowlistManager } = require("./lib/auth-allowlist");
const {
  dmChannelName, dmChannelParties, canonicalizeDmChannelName, dmPeerFrom,
  parseTarget, formatTarget, matchesTarget,
  taskMatchesTarget: _taskMatchesTarget,
  resolveTargetChannel: _resolveTargetChannel,
} = require("./lib/dm-channels");

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
// Agent profile (avatar / displayName / description) — used by both the human-edit
// PUT /api/agents/:id/config path and the agent-self-edit POST /internal/agent/:id/profile path.
const MAX_AGENT_PICTURE_INPUT_BYTES = 5 * 1024 * 1024; // before sharp resize
const MAX_AGENT_PICTURE_OUTPUT_BYTES = 12 * 1024;       // after resize+webp; aligns with workspace icon cap
const AGENT_PICTURE_DIM = 128;                          // 128x128 cover crop, matches frontend resize
const MAX_AGENT_DISPLAYNAME_LEN = 64;
const MAX_AGENT_DESCRIPTION_LEN = 500;
const AGENT_PICTURE_MIME_RE = /^image\/(png|jpe?g|webp|gif)$/i;
// customLauncher: per-agent override that replaces the daemon driver's default
// binary (e.g. "/usr/local/bin/codex" or "env LANG=C claude"). Whitespace-split into argv on
// the daemon side. Not honored by vikingbot (internal node worker).
const CUSTOM_LAUNCHER_MAX = 256;
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
const OV_RUNTIME_WHITELIST = (process.env.OV_RUNTIME_WHITELIST || "claude,codex")
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
// Runtimes that get OV MCP server injected by default. Claude/Codex excluded
// because the OV plugin handles it; VikingBot excluded (no MCP support).
const OV_MCP_RUNTIME_WHITELIST = (process.env.OV_MCP_RUNTIME_WHITELIST || "hermes,coco,opencode,kimi,copilot,cursor")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
function ovMcpDefaultForRuntime(runtime) {
  return !!runtime && OV_MCP_RUNTIME_WHITELIST.includes(runtime);
}
function isOvMcpEnabledForAgent(cfg) {
  if (cfg && typeof cfg.ovMcpEnabled === "boolean") return cfg.ovMcpEnabled;
  return ovMcpDefaultForRuntime(cfg && cfg.runtime);
}
// Runtimes where the agent's own plugin handles OV lifecycle (auto-recall,
// auto-capture, auto-commit). Server skips its managed operations for these.
const OV_PLUGIN_RUNTIME_WHITELIST = (process.env.OV_PLUGIN_RUNTIME_WHITELIST || "claude,codex")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
function ovPluginDefaultForRuntime(runtime) {
  return !!runtime && OV_PLUGIN_RUNTIME_WHITELIST.includes(runtime);
}
function isOvPluginForAgent(cfg) {
  if (cfg && typeof cfg.ovLifecycleMode === "string") return cfg.ovLifecycleMode === "plugin";
  return ovPluginDefaultForRuntime(cfg && cfg.runtime);
}
// Normalize / validate a customLauncher update payload. Returns
// `{ ok: true, value: <trimmed-string-or-null> }` on success (null = clear),
// or `{ ok: false, err: <reason> }` on validation failure.
function validateCustomLauncher(value, runtime) {
  if (value === null || value === undefined || value === "") return { ok: true, value: null };
  if (typeof value !== "string") return { ok: false, err: "customLauncher must be a string" };
  const trimmed = value.trim();
  if (!trimmed) return { ok: true, value: null };
  if (trimmed.length > CUSTOM_LAUNCHER_MAX) return { ok: false, err: `customLauncher exceeds ${CUSTOM_LAUNCHER_MAX} chars` };
  if (/[\x00-\x1f\x7f]/.test(trimmed)) return { ok: false, err: "customLauncher contains control chars" };
  if (runtime === "vikingbot") return { ok: false, err: "customLauncher is not supported for vikingbot runtime" };
  return { ok: true, value: trimmed };
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
const OV_ENV_PROVISIONING_ENABLED = !!(OPENVIKING_URL && OPENVIKING_ROOT_KEY && OPENVIKING_ACCOUNT);
if (OPENVIKING_ROOT_KEY && !OV_ENV_PROVISIONING_ENABLED) {
  console.warn(
    "[ov] root key is legacy format — please use a new-format key from POST /api/v1/admin/accounts/{acct}/users; env provisioning disabled"
  );
} else if (OV_ENV_PROVISIONING_ENABLED) {
  console.log(`[ov] env provisioning enabled (account=${OPENVIKING_ACCOUNT}, url=${OPENVIKING_URL})`);
}

// Workspace-level provisioning override. A workspace with `enabled=true` and
// both url + root key set takes precedence over the env. Anything missing or
// disabled falls back to env. Returns null when neither source is usable.
//
// Account resolution order: explicit ws.account > decoded from ws.rootApiKey.
// The explicit override unblocks (a) multi-account root keys and (b) legacy
// hex keys that can't carry an account in the key itself.
function resolveProvisioningCreds(workspaceId) {
  const wsId = normalizeWorkspaceId(workspaceId || DEFAULT_WORKSPACE_ID);
  const ws = workspaceOvSettings.get(wsId);
  if (ws && ws.enabled && ws.url && ws.rootApiKey) {
    const account = ws.account || decodeAccountFromKey(ws.rootApiKey);
    if (account) {
      return {
        url: ws.url.replace(/\/+$/, ""),
        rootApiKey: ws.rootApiKey,
        account,
        source: "workspace",
      };
    }
    // No account anywhere — set account explicitly to use this workspace.
    console.warn(`[ov] workspace ${wsId} has no account (key can't carry one and no explicit override); falling back to env`);
  }
  if (OV_ENV_PROVISIONING_ENABLED) {
    return {
      url: OPENVIKING_URL,
      rootApiKey: OPENVIKING_ROOT_KEY,
      account: OPENVIKING_ACCOUNT,
      source: "env",
    };
  }
  return null;
}

// Optional OpenViking user_id strategy: when enabled for an agent, derive from
// agent.name. Convention: `name[suffix]` collapses to `name` so clones share
// memory with their root (e.g. `alice[1]` reuses `alice`'s OV namespace).
// The resulting user_id is persisted into agent_configs.openviking_user_id on
// first provision and frozen thereafter — renaming the agent does NOT move OV
// memory.
function deriveOvUserId(agentId) {
  const short = String(agentId || "").replace(/^agent-/, "");
  return `zouk-${short}`;
}

// Canonical agent handle → bare OV id. The handle is a validated slug at
// creation (see isValidAgentHandle), so this is mostly an identity map; the
// sanitizer is a safety net for handles created via paths that bypass
// validation (e.g. daemon adoption). Returns "" when nothing usable remains.
function canonicalOvId(name) {
  const raw = typeof name === "string" ? name : "";
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

// Agent handle rules: lowercase slug, starts alphanumeric, 1-48 chars of
// [a-z0-9_-]. The handle backs the OV user_id/session_id directly, so it must
// be a path-safe identifier. Enforced at creation only.
const AGENT_HANDLE_RE = /^[a-z0-9][a-z0-9_-]{0,47}$/;
function isValidAgentHandle(name) {
  return typeof name === "string" && AGENT_HANDLE_RE.test(name);
}

// Whether a handle is already in use by another agent. Case-insensitive and
// GLOBAL (across all workspaces) because the OV account may be shared, so two
// same-named agents would collide in OV. Distinct from agentIdByName, which is
// workspace-scoped and also matches displayName.
function isAgentNameTaken(name, excludeId = null) {
  const lowered = String(name || "").trim().toLowerCase();
  if (!lowered) return false;
  for (const cfg of agentConfigs) {
    if (cfg.id === excludeId) continue;
    if ((cfg.name || "").trim().toLowerCase() === lowered) return true;
  }
  for (const [id, a] of Object.entries(store.agents)) {
    if (id === excludeId) continue;
    if ((a.name || "").trim().toLowerCase() === lowered) return true;
  }
  return false;
}

// Initial OV user_id for a NEW agent: the bare canonical handle. Existing
// agents never reach this (their persisted openvikingUserId wins upstream).
// Falls back to the zouk-<hash> id only when the handle is empty/unusable.
function resolveInitialOvUserId(config, agentId) {
  return canonicalOvId(config?.name) || deriveOvUserId(agentId);
}

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

const {
  ENV_ALLOW_EMAILS, ENV_ALLOW_DOMAINS, dbAllowEmails, GUEST_ELEVATED,
  allowlistKey, allowlistActive, isEmailAllowed, isEmailAllowedAnyWorkspace,
  allowlistActiveAnywhere, normalizeEmailInput, isSuperuser,
  loadEmailAllowlistFromDb, setIsWorkspaceMemberRemoved: _setIsWorkspaceMemberRemoved,
} = createAllowlistManager({ db, DEFAULT_WORKSPACE_ID, normalizeWorkspaceId });
const CONFIG_DIR = process.env.ZOUK_CONFIG_DIR || path.join(__dirname, "..", "data");
const AGENT_CONFIGS_FILE = path.join(CONFIG_DIR, "agent-configs.json");
const MACHINE_KEYS_FILE = path.join(CONFIG_DIR, "machine-keys.json");
const SESSIONS_FILE = path.join(CONFIG_DIR, "sessions.json");
const AGENT_PROFILE_PRESETS_FILE = path.join(CONFIG_DIR, "agent-profile-presets.json");
const WORKSPACE_EMBED_SETTINGS_FILE = path.join(CONFIG_DIR, "workspace-embed-settings.json");
const WORKSPACE_OPENVIKING_SETTINGS_FILE = path.join(CONFIG_DIR, "workspace-openviking-settings.json");

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
      ovMcpEnabled: ovMcpDefaultForRuntime(runtime),
      ovMcpEnabledIsDefault: true,
      ovMcpDefault: ovMcpDefaultForRuntime(runtime),
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
    openvikingUseAgentNameAsUser: cfg.openvikingUseAgentNameAsUser === true,
    ovEnabled: isOvEnabledForAgent(cfg),
    ovEnabledIsDefault: typeof cfg.openvikingEnabled !== 'boolean',
    ovDefault: ovDefaultForRuntime(cfg.runtime || a.runtime),
    ovMcpEnabled: isOvMcpEnabledForAgent(cfg),
    ovMcpEnabledIsDefault: typeof cfg.ovMcpEnabled !== 'boolean',
    ovMcpDefault: ovMcpDefaultForRuntime(cfg.runtime || a.runtime),
    disableLocalOvPlugin: cfg.disableLocalOvPlugin !== false,
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
    ovMcpEnabled: isOvMcpEnabledForAgent(rest),
    ovMcpEnabledIsDefault: typeof rest.ovMcpEnabled !== 'boolean',
    ovMcpDefault: ovMcpDefaultForRuntime(rest.runtime),
    disableLocalOvPlugin: rest.disableLocalOvPlugin !== false,
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
_setIsWorkspaceMemberRemoved(isWorkspaceMemberRemoved);

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
  return _taskMatchesTarget(task, target, agentName, channelForTask);
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

// ─── DM channel helpers (see server/lib/dm-channels.js) ──────────
// Pure helpers: dmChannelName, dmChannelParties, canonicalizeDmChannelName,
// dmPeerFrom, parseTarget, formatTarget, matchesTarget — imported at top.
// Store-dependent wrappers below bind store.channels so callers stay unchanged.

function resolveTargetChannel(target, requesterName, workspaceId = DEFAULT_WORKSPACE_ID) {
  return _resolveTargetChannel(target, requesterName, workspaceId, store.channels);
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

function embedCanAccessAgentEvent(user, event, ws = null) {
  if (!isEmbedSessionUser(user)) return true;
  const agentId = event?.agent?.id || event?.agentId;
  if (!agentId) return false;
  const snapshot = ws?._embedAgentIds;
  if (snapshot?.has?.(agentId)) return true;
  return embedVisibleAgentIds(user)?.has(agentId) || false;
}

function embedApiRouteAllowed(req) {
  const method = String(req.method || "").toUpperCase();
  // Use originalUrl so the check works both when the middleware runs on
  // app-level routes and inside sub-routers mounted at /api.
  const url = (req.originalUrl || req.path || "").split("?")[0];
  if (url === "/api/messages" && (method === "GET" || method === "POST")) return true;
  if (url === "/api/channels" && method === "GET") return true;
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

// ─── WebSocket: daemon connections ────────────────────────────────

const daemonSockets = new Map(); // agentId -> ws
const daemonConnections = new Set(); // all daemon ws connections (for sending agent:start before any agent is registered)
const webSockets = new Set(); // web UI connections
const machines = new Map(); // machineId -> { id, hostname, os, runtimes, capabilities, connectedAt, agentIds }
const pendingRuntimeModelRequests = new Map(); // requestId -> { resolve, timer }
const pendingContextResets = new Map(); // agentId -> resolver (fires on daemon agent:status=inactive, for reset-context orchestration)

// Forward references — assigned when createDaemonHandler / createAgentLifecycle
// are wired up (after all Express routes are mounted). Safe because every call
// site is inside a function that only executes at runtime.
let sendAgentStop;
let normalizeInactiveAgentState;
let broadcastAgentStatus;
let startAgentOnDaemon;
let autoStartAgents;

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
    const scopedEvent = eventForWebViewer(event, ws);
    ws.send(scopedEvent === event ? data : JSON.stringify(scopedEvent));
  }
}

function eventForWebViewer(event, ws) {
  const viewerUser = ws._authToken ? getAuthSession(ws._authToken) : null;
  if (!isEmbedSessionUser(viewerUser)) return event;
  if (event.type === "agent_activity") {
    const { type, agentId, activity, detail } = event;
    return { type, agentId, activity, detail };
  }
  return event;
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
    return (
      (event.type === "agent_started" || event.type === "agent_status" || event.type === "agent_activity")
      && embedCanAccessAgentEvent(viewerUser, event, ws)
    );
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
const workspaceOvSettings = createWorkspaceOpenvikingSettingsStore({
  filePath: WORKSPACE_OPENVIKING_SETTINGS_FILE,
  db,
  defaultWorkspaceId: DEFAULT_WORKSPACE_ID,
});
const embedSessionRateLimiter = createEmbedRateLimiter();
const agentAuth = createAgentAuthStore({ db });
const promptEngine = createPromptTemplateEngine({
  sectionsFilePath: path.join(__dirname, "..", "data", "prompt-sections.json"),
});
// Single mode-aware resolver: returns the agent's effective OV creds whether
// it's in 'custom' (user-supplied URL+key) or 'provisioned' (server-minted)
// mode. All runtime paths that hit OV must go through this — the proxy, the
// lifecycle manager, the tool endpoint, and the memory panel.
const resolveAgentOvCreds = makeResolveAgentOvCreds({
  decodeOvKey, deriveOvUserId, OPENVIKING_URL, OPENVIKING_ACCOUNT,
});
function getAgentOvCredsById(agentId) {
  return resolveAgentOvCreds(agentConfigs.find((c) => c.id === agentId));
}

const ovLifecycle = createOvLifecycleManager({
  getAgentOvCreds(agentId) {
    return getAgentOvCredsById(agentId);
  },
  resolveOvUrl(agentId) {
    const cfg = agentConfigs.find((c) => c.id === agentId);
    const creds = resolveProvisioningCreds(cfg?.workspaceId);
    return creds?.url || null;
  },
});

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
  workspaceOvSettings.removeWorkspace(id);
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

async function deliverToAgent(agentId, message) {
  const ws = daemonSockets.get(agentId);
  if (ws && ws.readyState === 1) {
    const seq = nextSeq();
    const formatted = formatMessageForAgent(message, agentId);

    // OV managed lifecycle: send auto-recall context BEFORE agent:deliver so
    // daemon's pendingDeliveries already has it. Race-free even if daemon's
    // wait window is short. Capped at 1.5s — beyond that, deliver without
    // context rather than blocking the message.
    const agentCfg = agentConfigs.find((c) => c.id === agentId);
    if (agentCfg?.openvikingApiKey && message.content && !isOvPluginForAgent(agentCfg)) {
      ovLifecycle.autoCapture(agentId, message.content, null, {
        channelName: message.channelName,
        channelType: message.channelType,
        threadId: message.threadId,
        senderName: message.senderName,
        senderType: message.senderType || "human",
        messageId: message.id,
        timestamp: message.createdAt,
      }).catch(() => {});
      try {
        const recallStart = Date.now();
        let timedOut = false;
        const ovContext = await Promise.race([
          ovLifecycle.autoRecall(agentId, message.content),
          new Promise((resolve) => setTimeout(() => { timedOut = true; resolve(null); }, 1500)),
        ]);
        const dur = Date.now() - recallStart;
        if (ovContext && ws.readyState === 1) {
          ws.send(JSON.stringify({ type: "agent:deliver:context", agentId, seq, ovContext }));
          console.log(`[ov-deliver] ${agentId} seq=${seq} context sent (${dur}ms)`);
        } else if (timedOut) {
          console.warn(`[ov-deliver] ${agentId} seq=${seq} autoRecall timed out (>1500ms)`);
        }
      } catch (err) {
        console.warn(`[ov-deliver] ${agentId} seq=${seq} autoRecall error: ${err?.message || err}`);
      }
    }

    let payload;
    try {
      payload = JSON.stringify({ type: "agent:deliver", agentId, seq, message: formatted });
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

// ─── OV transparent proxy ─────────────────────────────────────────
// Agents hit /ov/* with their agent token; we substitute per-agent OV creds
// and forward to the real OV server.
app.use("/ov", createOvProxy({
  agentAuth,
  getAgentOvCreds(agentId) {
    return getAgentOvCredsById(agentId);
  },
  resolveOvUrl(workspaceId) {
    const creds = resolveProvisioningCreds(workspaceId);
    return creds?.url || null;
  },
}));

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
// Extracted to routes/agent-internal.js. Mounted here with shared context.

const { createAgentInternalRouter } = require("./routes/agent-internal");
app.use("/internal/agent", createAgentInternalRouter({
  store, agentConfigs, db, agentAuth, attachmentStorage, upload,
  DEFAULT_WORKSPACE_ID,
  MAX_AGENT_DISPLAYNAME_LEN, MAX_AGENT_DESCRIPTION_LEN,
  AGENT_PICTURE_DIM, AGENT_PICTURE_MIME_RE, MAX_AGENT_PICTURE_OUTPUT_BYTES,
  agentPayload, appendMessage, broadcastToWeb, deliverToAllAgents,
  findOrCreateChannel, formatMessageForAgent, formatMessageForClient,
  getMembership, setMembership, removeMembership,
  getMessageByIdAnywhere, matchesTarget, messageVisibleToAgent,
  nextSeq, nextTaskNum, now, parseTarget,
  readChannelHistory, readChannelHistoryAround, readMessagesForAgent,
  resolveAttachmentRefs, resolveTargetChannel, resolveUniqueByIdOrPrefix,
  sanitizedAgentConfigs, saveAgentConfigs, searchVisibleMessages,
  get syncRuntimeAgentFromConfig() { return syncRuntimeAgentFromConfig; },
  syncTaskBackingMessage,
  taskChannelPayload, taskMatchesTarget, taskTitleFromMessage,
  visibleChannelIdsForAgent, withTaskMutationLock,
  workspaceIdFromAgent, isReservedName,
  messagesById, messagesByShortId,
  ovLifecycle, isOvPluginForAgent, agentConfigs,
}));

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

// ─── Generic tool execution endpoint (v2 MCP proxy target) ──────
// Daemon's thin MCP proxy forwards tool calls here. The server processes
// each tool and returns MCP-compatible content blocks.
// For now this endpoint is a stub — it will delegate to the existing internal
// routes or handle tools directly as Phase 2 progresses.

app.post("/api/agent/:agentId/tool/:toolName", async (req, res) => {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Missing agent token" });
  const record = agentAuth.resolve(token);
  if (!record) return res.status(401).json({ error: "Invalid agent token" });
  if (req.params.agentId !== record.agentId) {
    return res.status(403).json({ error: "Token does not match agent" });
  }

  const { agentId, toolName } = req.params;
  const { input } = req.body || {};

  // Forward to OV /mcp tools/call with the agent's OV creds. Mode-aware:
  // custom-mode agents bring their own URL+key, provisioned use server-minted.
  const resolved = getAgentOvCredsById(agentId);
  if (!resolved?.apiKey || !resolved?.url) {
    return res.status(404).json({ error: "OV not configured for this agent" });
  }
  const creds = {
    url: resolved.url,
    apiKey: resolved.apiKey,
    account: resolved.account,
    user: resolved.userId,
    agentId,
  };
  if (!creds.url) return res.status(500).json({ error: "OV URL not configured" });

  // Strip the `openviking_` namespace prefix before forwarding to OV /mcp.
  const ovToolName = toolName.startsWith("openviking_") ? toolName.slice("openviking_".length) : toolName;

  try {
    const result = await callOvTool(creds, ovToolName, input || {});
    res.json(result);
  } catch (err) {
    invalidateOvMcpSession(creds);
    res.status(500).json({ error: err.message, content: [{ type: "text", text: `Error: ${err.message}` }] });
  }
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

// Extracted to routes/web-api.js. Mounted here with shared context.
// Auth functions (getAuthSession, isEmbedSessionUser, etc.) are late-bound:
// they're set on webApiCtx after the auth module initializes (below).
const { createWebApiRouter } = require("./routes/web-api");
const webApiCtx = {
  requireAuth, requireWorkspaceRead, requireMachineKey,
  persistUserMessage, fanoutUserMessage,
  store, db, machines, daemonConnections, taskTimes,
  machineKeys, pendingRuntimeModelRequests,
  attachmentStorage, upload,
  DEFAULT_WORKSPACE_ID,
  agentPayload, broadcastToWeb, deliverToAllAgents,
  findOrCreateChannel, formatMessageForClient,
  getMembership, setMembership, removeMembership,
  getMessageByIdAnywhere,
  parseTarget, resolveTargetChannel, resolveAttachmentRefs,
  readChannelHistory, fetchThreadRepliesForPage,
  sanitizedAgentConfigs, agentChannelNames, hasKnownAgentConfig,
  purgeChannelMemberships,
  validateApiKey, findMachineKeyRecord, saveMachineKeys,
  now, workspaceIdFromAgent, workspaceIdFromReq,
};
app.use("/api", createWebApiRouter(webApiCtx));


// ─── OpenViking memory proxy (extracted) ────────────────────────
const { createOvMemoryRouter } = require("./routes/ov-memory");
const ovMemory = createOvMemoryRouter({
  requireWorkspaceRead,
  agentConfigs, store,
  DEFAULT_WORKSPACE_ID,
  workspaceIdFromAgent,
  isOvEnabledForAgent,
  resolveAgentOvCreds,
});
const {
  resolveOvCredentials, isLocalUrl, ovHttpList,
  parseOvListResult, ovHttpReadContent,
} = ovMemory;
app.use("/api", ovMemory.router);

// ─── Agent config CRUD + Profile presets + Machine keys (extracted)
const { createAgentConfigRouter } = require("./routes/agent-config");
const agentConfigModule = createAgentConfigRouter({
  requireAuth, requireWorkspaceRead,
  store, db, agentConfigs,
  machineKeys, machines, daemonConnections,
  DEFAULT_WORKSPACE_ID,
  agentPayload, broadcastToWeb, sanitizedAgentConfigs,
  saveAgentConfigs, saveMachineKeys,
  workspaceIdFromAgent,
  get sendAgentStop() { return sendAgentStop; },
  agentAuth, purgeAgentMemberships, purgeUnknownAgentState,
  validateCustomLauncher, isOvEnabledForAgent, isOvPluginForAgent, isPersistentMachineId,
  isValidAgentHandle, isAgentNameTaken, isReservedName,
  profilePresets, PROFILE_PRESET_MAX,
  generateApiKey, now,
  ovLifecycle,
});
const { syncRuntimeAgentFromConfig } = agentConfigModule;
app.use("/api", agentConfigModule.router);

// ─── Agent lifecycle (extracted) ─────────────────────────────────
const { createAgentLifecycle } = require("./lib/agent-lifecycle");
const agentLifecycle = createAgentLifecycle({
  store, agentConfigs, db, agentAuth,
  daemonConnections, daemonSockets, machines,
  normalizeWorkspaceId, DEFAULT_WORKSPACE_ID,
  validateCustomLauncher, decodeOvKey,
  isOvEnabledForAgent, isOvMcpEnabledForAgent, isOvPluginForAgent,
  resolveProvisioningCreds, resolveInitialOvUserId,
  resolveAgentOvCreds,
  isValidAgentHandle, isAgentNameTaken, isReservedName,
  OPENVIKING_URL, OPENVIKING_ACCOUNT,
  provisionAgentKey,
  buildRuntimeAgent, agentPayload, sanitizedAgentConfigs,
  broadcastToWeb, workspaceIdFromAgent,
  saveAgentConfigs,
  PUBLIC_URL,
  promptEngine, generateToolDefinitions, fetchOvTools,
  profilePresets, seedAgentIntoRegularChannels,
  pendingContextResets,
  ovLifecycle,
  requireAuth,
  get normalizeInactiveAgentState() { return normalizeInactiveAgentState; },
  get broadcastAgentStatus() { return broadcastAgentStatus; },
});
startAgentOnDaemon = agentLifecycle.startAgentOnDaemon;
autoStartAgents = agentLifecycle.autoStartAgents;
app.use(agentLifecycle.router);

// ─── Auth + workspace routes (extracted) ────────────────────────
const { createAuthModule } = require("./lib/auth");
const authModule = createAuthModule({
  db, store, SESSIONS_FILE,
  GOOGLE_CLIENT_ID, googleClient,
  SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY,
  OV_RUNTIME_WHITELIST, OV_MCP_RUNTIME_WHITELIST, OV_PLUGIN_RUNTIME_WHITELIST,
  DEFAULT_WORKSPACE_ID,
  gravatarUrl, isReservedName, normalizeEmailInput,
  isEmailAllowedAnyWorkspace, allowlistActiveAnywhere,
  onlineHumans, allTimeHumans, webSockets,
  upsertAllTimeHuman, broadcastHumans, broadcastToWeb,
  humanId, findWorkspace, ensureWorkspace, workspacePayload,
  removeWorkspaceFromMemory, normalizeWorkspaceIconInput, workspaceIconFallback,
  workspaceIdFromReq, normalizeWorkspaceId, allocateWorkspaceId,
  userCanAccessWorkspace, userCanAdminWorkspace, userCanRootWorkspace,
  visibleWorkspacesForUser, ensureWorkspaceMemberForUser,
  setWorkspaceMember, dbAllowEmails, allowlistKey, broadcastWorkspaceMembers,
  findOrCreateChannel, now,
  requireAuth, requireSessionAuth,
});
const {
  authSessions, getAuthSession, hasAuthSession,
  isEmbedSessionUser, embedSessionExpired, publicAuthUser,
  loadAuthSessions, persistSession, removeSession,
} = authModule;
app.use(authModule.router);
// Late-bind auth functions into webApiCtx (web-api router reads these at request time)
webApiCtx.getAuthSession = getAuthSession;
webApiCtx.isEmbedSessionUser = isEmbedSessionUser;
webApiCtx.embedCanAccessChannel = embedCanAccessChannel;

const { createWorkspaceRouter } = require("./routes/workspace");
app.use(createWorkspaceRouter({
  db, store,
  DEFAULT_WORKSPACE_ID,
  GOOGLE_CLIENT_ID,
  OV_ENV_PROVISIONING_ENABLED, OPENVIKING_URL, OPENVIKING_ACCOUNT,
  normalizeWorkspaceId, normalizeEmailInput,
  isReservedName, isSuperuser, allowlistActive,
  dbAllowEmails, allowlistKey, ENV_ALLOW_EMAILS,
  onlineHumans, webSockets, daemonSockets, pendingDeliveries,
  messagesById, messagesByShortId, repliesByThreadId,
  CHANNEL_CACHE_TAIL,
  broadcastToWeb, broadcastHumans, broadcastWorkspaceMembers,
  getAuthSession, hasAuthSession, authSessions,
  isEmbedSessionUser, publicAuthUser,
  persistSession, removeSession,
  getWorkspaceMember, setWorkspaceMember, listWorkspaceMembers,
  workspaceMemberPayload, workspaceMembersFor,
  userWorkspaceRole, removeWorkspaceMember, markWorkspaceMemberRemoved,
  closeWorkspaceSocketsForEmail, removeAllTimeHumanIfInaccessible,
  embedSettings, embedSessionRateLimiter,
  workspaceOvSettings, resolveProvisioningCreds, decodeAccountFromKey,
  workspaceIdFromReq, findWorkspace,
  now,
  requireAuth, requireWorkspaceAdmin,
}));


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

// ─── HTTP Server + WebSocket (extracted) ─────────────────────────
const { createDaemonHandler } = require("./lib/daemon-handler");
const daemonHandler = createDaemonHandler({
  app, db,
  store, agentConfigs,
  daemonConnections, daemonSockets, webSockets, machines,
  pendingRuntimeModelRequests, pendingContextResets,
  DEFAULT_WORKSPACE_ID, normalizeWorkspaceId,
  validateApiKey, findMachineKeyRecord, resolveDaemonMachineId,
  isDebugKey, computeMachineFingerprint,
  machineKeys, saveMachineKeys,
  hasKnownAgentConfig, purgeUnknownAgentState,
  evaluateAgentMachineAffinity,
  buildRuntimeAgent,
  get syncRuntimeAgentFromConfig() { return syncRuntimeAgentFromConfig; },
  agentPayload, sanitizedAgentConfigs,
  workspaceIdFromAgent, updateAgentWorkDir,
  broadcastToWeb,
  hydrateAgentContextUsage,
  replayPendingDeliveries,
  hasWorkspaceFsCapability,
  now,
  recordWsConnectAttempt, recordInvalidTokenAttempt, recordWsDisconnect,
  PUBLIC_URL,
  ovLifecycle, isOvPluginForAgent,
  // Late-bound auth functions (assigned by auth module wiring above)
  get hasAuthSession() { return hasAuthSession; },
  get getAuthSession() { return getAuthSession; },
  get isEmbedSessionUser() { return isEmbedSessionUser; },
  get isEmailAllowed() { return isEmailAllowed; },
  get allowlistActive() { return allowlistActive; },
  get isSuperuser() { return isSuperuser; },
  get findWorkspace() { return findWorkspace; },
  get userCanAccessWorkspace() { return userCanAccessWorkspace; },
  get userWorkspaceRole() { return userWorkspaceRole; },
  get ensureWorkspaceMemberForUser() { return ensureWorkspaceMemberForUser; },
  get listWorkspaceMembers() { return listWorkspaceMembers; },
  get visibleWorkspacesForUser() { return visibleWorkspacesForUser; },
  get embedVisibleAgentIds() { return embedVisibleAgentIds; },
  get embedCanAccessChannel() { return embedCanAccessChannel; },
  get currentHumans() { return currentHumans; },
  get setWebPresence() { return setWebPresence; },
  get removeHumanPresence() { return removeHumanPresence; },
  get resolveOvCredentials() { return resolveOvCredentials; },
  get isLocalUrl() { return isLocalUrl; },
  get ovHttpList() { return ovHttpList; },
  get parseOvListResult() { return parseOvListResult; },
  get ovHttpReadContent() { return ovHttpReadContent; },
  get autoStartAgents() { return autoStartAgents; },
});
const { server } = daemonHandler;
sendAgentStop = daemonHandler.sendAgentStop;
normalizeInactiveAgentState = daemonHandler.normalizeInactiveAgentState;
broadcastAgentStatus = daemonHandler.broadcastAgentStatus;

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
    await workspaceOvSettings.hydrateFromDb();
    await agentAuth.hydrateFromDb();

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

  // Boot-time OV session sweep: every offline agent that has OV creds gets
  // a force-commit so any conversation pending from a previous crashed run
  // (server killed / daemon died / power loss) rolls into an archive
  // instead of sitting forever in the in-flight buffer.
  let sweepCount = 0;
  for (const cfg of agentConfigs) {
    if (!cfg.openvikingApiKey || isOvPluginForAgent(cfg)) continue;
    ovLifecycle.commitSession(cfg.id).catch(() => {});
    sweepCount++;
  }
  if (sweepCount > 0) console.log(`[ov] boot sweep: force-commit ${sweepCount} OV session(s)`);

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
