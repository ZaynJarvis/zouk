// Workspace members, settings, and guest session routes.
//
// Extracted from index.js. All external dependencies are accessed via the `ctx`
// object passed to createWorkspaceRouter(). No implicit closure captures.

const { Router } = require("express");
const crypto = require("crypto");
const { URL } = require("url");
const {
  normalizeOrigin: normalizeEmbedOrigin,
  sanitizeEmbedGuestName,
  embedGuestSuffixForBrowser,
} = require("../embedSessions");
const {
  wsTrackers, tokenFingerprint,
  pruneRecentConnects,
  WS_RATE_WINDOW_MS, WS_RATE_BLOCK_THRESHOLD, WS_RATE_BLOCK_MAX_OPEN,
  WS_RATE_HARD_BLOCK_THRESHOLD, WS_BLOCK_DURATION_MS,
  WS_REVOKE_BLOCK_MS,
} = require("../lib/ws-tracker");

function createWorkspaceRouter(ctx) {
  const {
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
  } = ctx;

  const router = Router();

  // ─── Workspace members ──────────────────────────────────────────
  // Any workspace member can list members; only admins (root/owner/admin or
  // superuser) may invite, change roles, or remove. Inviting also seeds the
  // per-workspace email_allowlist so requireAuth lets the invitee in next time
  // they OAuth.
  const VALID_MEMBER_ROLES = new Set(["root", "owner", "admin", "member"]);

  router.get("/api/workspaces/:id/members", requireAuth, (req, res) => {
    const workspaceId = normalizeWorkspaceId(req.params.id);
    if (req.workspaceId !== workspaceId) {
      return res.status(400).json({ error: "Workspace id mismatch — pass X-Workspace-Id matching the path." });
    }
    res.json({ workspaceId, members: listWorkspaceMembers(workspaceId) });
  });

  router.post("/api/workspaces/:id/members", requireAuth, requireWorkspaceAdmin, async (req, res) => {
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

  router.put("/api/workspaces/:id/members/:email", requireAuth, requireWorkspaceAdmin, async (req, res) => {
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

  router.delete("/api/workspaces/:id/members/:email", requireAuth, requireWorkspaceAdmin, async (req, res) => {
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
  router.get("/api/_internal/stats", requireAuth, (_req, res) => {
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
  router.get("/api/_internal/ws-clients", requireAuth, (req, res) => {
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
  router.post("/api/_internal/ws-clients/:id/revoke", requireAuth, (req, res) => {
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
  router.post("/api/_internal/ws-clients/:id/unblock", requireAuth, (req, res) => {
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

  router.get("/api/settings/embed", requireAuth, requireWorkspaceAdmin, (req, res) => {
    const workspaceId = req.workspaceId || DEFAULT_WORKSPACE_ID;
    res.json({ settings: embedSettingsPayload(workspaceId) });
  });

  router.put("/api/settings/embed", requireAuth, requireWorkspaceAdmin, async (req, res) => {
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

  // ─── Settings: per-workspace OpenViking provisioning ─────────────
  // root_api_key is write-only — GET returns `rootConfigured` boolean instead
  // of echoing the key back. Send `clearRootApiKey: true` on PUT to wipe it.
  // The key is the same flavor as OPENVIKING_ROOT_KEY: new-format
  // (account.user.secret); the account is decoded from the key, never sent
  // separately by the client.

  function workspaceOvSettingsPayload(workspaceId) {
    const ws = workspaceOvSettings.get(workspaceId);
    const env = OV_ENV_PROVISIONING_ENABLED
      ? { url: OPENVIKING_URL, account: OPENVIKING_ACCOUNT }
      : null;
    const effective = resolveProvisioningCreds(workspaceId);
    const decodedFromKey = ws?.rootApiKey ? decodeAccountFromKey(ws.rootApiKey) : null;
    return {
      workspaceId,
      enabled: !!ws?.enabled,
      url: ws?.url || '',
      rootConfigured: !!(ws?.rootApiKey),
      account: ws?.account || '', // explicit override; empty = decode from key
      accountFromKey: decodedFromKey || null, // hint for the UI: what we'd use if account is left blank
      updatedAt: ws?.updatedAt || null,
      updatedBy: ws?.updatedBy || null,
      env, // server-wide env fallback (read-only mirror)
      effective: effective
        ? { url: effective.url, account: effective.account, source: effective.source }
        : null,
    };
  }

  router.get("/api/settings/openviking", requireAuth, requireWorkspaceAdmin, (req, res) => {
    const workspaceId = req.workspaceId || DEFAULT_WORKSPACE_ID;
    res.json({ settings: workspaceOvSettingsPayload(workspaceId) });
  });

  router.put("/api/settings/openviking", requireAuth, requireWorkspaceAdmin, async (req, res) => {
    const workspaceId = req.workspaceId || DEFAULT_WORKSPACE_ID;
    const current = workspaceOvSettings.get(workspaceId);

    const rawUrl = typeof req.body?.url === 'string' ? req.body.url.trim() : '';
    const url = rawUrl.replace(/\/+$/, '');
    const wantsClearKey = !!req.body?.clearRootApiKey;
    const incomingKey = typeof req.body?.rootApiKey === 'string' ? req.body.rootApiKey.trim() : '';
    // Empty string = keep existing key (so the user can re-save url without
    // re-typing the secret). Explicit clear flag wipes.
    let rootApiKey = current.rootApiKey || '';
    if (wantsClearKey) rootApiKey = '';
    else if (incomingKey) rootApiKey = incomingKey;

    // Account: optional explicit override. Empty string in the payload means
    // "no override — decode from the key" (different from "keep existing").
    // Send `account` to set/replace, omit the field to keep the current value.
    let account = current.account || '';
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'account')) {
      account = typeof req.body.account === 'string' ? req.body.account.trim() : '';
    }

    const enabled = !!req.body?.enabled;
    if (enabled) {
      if (!url) return res.status(400).json({ error: "URL is required when OpenViking is enabled." });
      if (!rootApiKey) return res.status(400).json({ error: "Root API key is required when OpenViking is enabled." });
      const accountFromKey = decodeAccountFromKey(rootApiKey);
      if (!account && !accountFromKey) {
        return res.status(400).json({
          error: "Account is required: paste a new-format root key (account.user.secret) so the account can be decoded, or set the Account field explicitly (e.g. for legacy hex keys or multi-account roots).",
        });
      }
    }

    const saved = await workspaceOvSettings.save(workspaceOvSettings.normalize({
      enabled,
      url,
      rootApiKey,
      account,
    }, workspaceId, req.user?.email || req.user?.name || null));
    res.json({ settings: workspaceOvSettingsPayload(saved.workspaceId) });
  });

  // ─── Settings: email allowlist (admin UI for the DB source) ──────
  // Any authenticated user may view and edit the allowlist. Entries seeded from
  // the ALLOW env are read-only here (listed with source="env") — editing them
  // requires a server restart. DB entries are mutable.

  router.get("/api/settings/allowlist", requireAuth, (req, res) => {
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

  router.post("/api/settings/allowlist", requireAuth, requireWorkspaceAdmin, async (req, res) => {
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

  router.delete("/api/settings/allowlist/:email", requireAuth, requireWorkspaceAdmin, async (req, res) => {
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

  router.post("/api/auth/embed-guest-session", (req, res) => {
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
  router.post("/api/auth/guest-session", async (req, res) => {
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
    // Guest names are forced to a `guest-` prefix. Strip any prefix the client
    // already added (so we never produce `guest-guest-…`), then re-apply it.
    // An empty remainder falls back to a random suffix.
    const base = name.trim().replace(/^(?:guest-+)+/i, "").trim();
    const guestName = base ? `guest-${base}` : `guest-${crypto.randomBytes(3).toString("hex")}`;
    if (guestName.length > 100) return res.status(400).json({ error: "name too long (max 100)" });
    if (isReservedName(guestName)) {
      return res.status(400).json({ error: `"${guestName}" is a reserved username and cannot be used.` });
    }

    // In open/dev mode (no Google OAuth), mint a real session so guests aren't
    // blocked from write operations (sending messages, etc.).
    if (!GOOGLE_CLIENT_ID) {
      const token = crypto.randomBytes(24).toString("hex");
      const user = { name: guestName, email: `guest_${token.slice(0, 8)}@local`, picture: null, guest: true };
      authSessions.set(token, user);
      await persistSession(token, user);
      return res.json({ ok: true, name: guestName, token, user });
    }

    res.json({ ok: true, name: guestName });
  });

  return router;
}

module.exports = { createWorkspaceRouter };
