// Email allowlist + superuser + guest-elevated logic.
// Extracted from index.js — all auth-gating state lives here.
//
// Usage:
//   const { createAllowlistManager } = require("./lib/auth-allowlist");
//   const allow = createAllowlistManager({ db, DEFAULT_WORKSPACE_ID, normalizeWorkspaceId });
//   // Later, once isWorkspaceMemberRemoved is available:
//   allow.setIsWorkspaceMemberRemoved(isWorkspaceMemberRemoved);

"use strict";

function createAllowlistManager({ db, DEFAULT_WORKSPACE_ID, normalizeWorkspaceId }) {
  // ─── Email allowlist ───────────────────────────────────────────
  // Union of two sources, all granting equal access:
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

  // Late-bound dependency: isWorkspaceMemberRemoved is defined in index.js
  // after the allowlist manager is created, so we accept it via setter.
  let _isWorkspaceMemberRemoved = () => false;
  function setIsWorkspaceMemberRemoved(fn) {
    _isWorkspaceMemberRemoved = fn;
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
    if (!_isWorkspaceMemberRemoved(DEFAULT_WORKSPACE_ID, norm)) {
      if (ENV_ALLOW_EMAILS.has(norm)) return true;
      const at = norm.lastIndexOf("@");
      if (at >= 0 && ENV_ALLOW_DOMAINS.has(norm.slice(at))) return true;
    }
    for (const meta of dbAllowEmails.values()) {
      if ((meta.email || "").trim().toLowerCase() !== norm) continue;
      if (_isWorkspaceMemberRemoved(meta.workspaceId || DEFAULT_WORKSPACE_ID, norm)) continue;
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

  // ─── Superusers ────────────────────────────────────────────────
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

  // ─── Guest elevated ────────────────────────────────────────────
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

  // ─── DB loader ─────────────────────────────────────────────────
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

  return {
    // State (exposed for direct manipulation by route handlers)
    ENV_ALLOW_EMAILS,
    ENV_ALLOW_DOMAINS,
    dbAllowEmails,
    GUEST_ELEVATED,

    // Functions
    allowlistKey,
    allowlistActive,
    isEmailAllowed,
    isEmailAllowedAnyWorkspace,
    allowlistActiveAnywhere,
    normalizeEmailInput,
    isSuperuser,
    loadEmailAllowlistFromDb,
    setIsWorkspaceMemberRemoved,
  };
}

module.exports = { createAllowlistManager };
