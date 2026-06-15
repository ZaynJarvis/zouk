// Auth session management + auth/workspace-CRUD routes.
//
// Extracted from index.js. All external dependencies are accessed via the `ctx`
// object passed to createAuthModule(). No implicit closure captures.

const { Router } = require("express");
const crypto = require("crypto");
const fs = require("fs");

function createAuthModule(ctx) {
  const {
    db, store, SESSIONS_FILE,
    GOOGLE_CLIENT_ID, googleClient,
    SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY,
    feishuEnabled, FEISHU_APP_ID, FEISHU_REDIRECT_URI, FEISHU_AUTHORIZE_URL, FEISHU_SCOPE, getLarkClient,
    OV_RUNTIME_DENYLIST, OV_MCP_RUNTIME_DENYLIST,
    DEFAULT_WORKSPACE_ID,
    gravatarUrl, isReservedName, isValidUsername, normalizeToUsernameCharset, isNameTaken, uniquifyUsername, normalizeEmailInput,
    isEmailAllowedAnyWorkspace, allowlistActiveAnywhere,
    onlineHumans, allTimeHumans, webSockets,
    upsertAllTimeHuman, broadcastHumans, broadcastToWeb,
    humanId, findWorkspace, ensureWorkspace, workspacePayload,
    removeWorkspaceFromMemory, normalizeWorkspaceIconInput, workspaceIconFallback,
    workspaceIdFromReq, normalizeWorkspaceId, allocateWorkspaceId,
    userCanAccessWorkspace, userCanAdminWorkspace, userCanRootWorkspace,
    visibleWorkspacesForUser, ensureWorkspaceMemberForUser,
    setWorkspaceMember, inviteWorkspaceMember, dbAllowEmails, allowlistKey, broadcastWorkspaceMembers,
    findOrCreateChannel, now,
    requireAuth, requireSessionAuth,
  } = ctx;

  const router = Router();

  // Session store: token -> { name, email, picture }
  // Persisted to data/sessions.json so sessions survive server restarts.
  const authSessions = new Map();
  const MAGIC_LOGIN_CHALLENGE_TTL_MS = 5 * 60 * 1000;
  const magicLoginChallenges = new Map();

  // Feishu OAuth redirect state — state token -> { createdAt, returnTo }.
  const FEISHU_STATE_TTL_MS = 5 * 60 * 1000;
  const feishuStates = new Map();
  function gcFeishuStates() {
    const cutoff = Date.now() - FEISHU_STATE_TTL_MS;
    for (const [state, info] of feishuStates) {
      if (info.createdAt < cutoff) feishuStates.delete(state);
    }
  }

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

  // Return the display name a returning email already chose, by scanning live
  // (DB-loaded) sessions for a non-guest, non-embed session on the same email.
  // Sessions of one email are kept in sync on profile rename (see PUT
  // /api/auth/profile), so any match carries the latest custom name.
  function findExistingDisplayNameForEmail(email) {
    if (!email) return null;
    for (const u of authSessions.values()) {
      if (u && !u.guest && !isEmbedSessionUser(u) && u.email === email && u.name) {
        return u.name;
      }
    }
    return null;
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
    // The @-prefix becomes the default display name (and thus the OV peer_id), so
    // fold it into the username charset — an address like `alice+tag@x.com` would
    // otherwise default to an invalid `alice+tag`. There is no user-input moment
    // to reject at here; the first-login customization (PUT /api/auth/profile)
    // does the rejecting. Fall back to a stable, charset-safe id if nothing maps.
    const rawPrefix = normalizedEmail.split("@")[0];
    const emailPrefix = normalizeToUsernameCharset(rawPrefix)
      || `user-${crypto.createHash("sha256").update(normalizedEmail).digest("hex").slice(0, 8)}`;
    if (isReservedName(emailPrefix)) {
      const err = new Error("Reserved username — please contact an admin.");
      err.statusCode = 403;
      throw err;
    }
    // First login for this email → default to the @-prefix and let the client
    // offer a one-time username customization. Returning emails keep whatever
    // name they last chose so a fresh OAuth round-trip doesn't reset it.
    const existingName = findExistingDisplayNameForEmail(normalizedEmail);
    const firstLogin = !existingName;
    // OAuth login can't reject + re-prompt, so a first-login default that collides
    // with an existing name (another registered user or an agent) is auto-suffixed
    // instead. Returning users keep their own previously chosen name verbatim.
    const name = existingName || uniquifyUsername(emailPrefix, { workspaceId: DEFAULT_WORKSPACE_ID });
    const grav = gravatarUrl(normalizedEmail);
    const user = {
      name,
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
      firstLogin,
      requestedWorkspaceId: opts.requestedWorkspaceId || DEFAULT_WORKSPACE_ID,
      accessibleWorkspaces: visibleWorkspacesForUser(user),
    };
  }

  // ─── Routes ──────────────────────────────────────────────────────

  router.post("/api/auth/google", async (req, res) => {
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

  router.post("/api/auth/magic-link-challenge", (req, res) => {
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

  router.get("/api/auth/magic-link-challenge/:id", (req, res) => {
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
  router.post("/api/auth/supabase", async (req, res) => {
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

  // Feishu / Lark Open Platform OAuth — redirect flow. /start 302s the browser
  // to Feishu's authorize page; after the user approves, Feishu 302s back to
  // /callback?code=…&state=…. We swap the code via the official SDK (which
  // transparently manages app_access_token) and mint a zouk session, reusing
  // the shared mintSessionForEmail path (allowlist + reserved-name guards).
  router.get("/api/auth/feishu/start", async (req, res) => {
    if (!feishuEnabled) {
      return res.status(501).send("Feishu OAuth not configured (set FEISHU_APP_ID / FEISHU_APP_SECRET)");
    }
    gcFeishuStates();
    const state = crypto.randomBytes(24).toString("hex");
    const rawReturn = typeof req.query.return_to === "string" ? req.query.return_to : "/";
    const returnTo = rawReturn.startsWith("/") && !rawReturn.startsWith("//") ? rawReturn : "/";
    feishuStates.set(state, { createdAt: Date.now(), returnTo });
    // Note Feishu's quirk: query param is `redirect_uri`, not `redirect_url`.
    const u = new URL(FEISHU_AUTHORIZE_URL);
    u.searchParams.set("app_id", FEISHU_APP_ID);
    u.searchParams.set("redirect_uri", FEISHU_REDIRECT_URI);
    u.searchParams.set("scope", FEISHU_SCOPE);
    u.searchParams.set("state", state);
    res.redirect(u.toString());
  });

  router.get("/api/oauth2/feishu/callback", async (req, res) => {
    if (!feishuEnabled) {
      return res.status(501).send("Feishu OAuth not configured");
    }
    const { code, state, error: errParam, error_description } = req.query;
    if (errParam) {
      return res.status(400).send(`Feishu auth error: ${errParam} ${error_description || ""}`);
    }
    if (typeof code !== "string" || typeof state !== "string") {
      return res.status(400).send("Missing code or state");
    }
    const stateInfo = feishuStates.get(state);
    if (!stateInfo || Date.now() - stateInfo.createdAt > FEISHU_STATE_TTL_MS) {
      feishuStates.delete(state);
      return res.status(400).send("Invalid or expired state");
    }
    feishuStates.delete(state);

    try {
      const client = getLarkClient();
      // v1/access_token response carries the user profile (name/email/avatar_url
      // /open_id/user_id) alongside the access_token, so we don't need a
      // separate authen.userInfo.get round-trip.
      const tokenRes = await client.authen.accessToken.create({
        data: { grant_type: "authorization_code", code },
      });
      if (tokenRes?.code !== 0) {
        console.error("[auth/feishu] token exchange returned non-zero:", tokenRes?.code, tokenRes?.msg);
        return res.status(502).send(`Feishu token exchange failed: ${tokenRes?.msg || "unknown"}`);
      }
      const profile = tokenRes.data || {};
      const email = (profile.enterprise_email || profile.email || "").trim().toLowerCase();
      if (!email) {
        return res
          .status(401)
          .send("Feishu did not return an email (check scope contact:user.email:readonly).");
      }
      const result = await mintSessionForEmail(email, {
        picture:
          typeof profile.avatar_url === "string" && profile.avatar_url
            ? profile.avatar_url
            : null,
      });
      const sep = stateInfo.returnTo.includes("?") ? "&" : "?";
      const firstParam = result.firstLogin ? "&first=1" : "";
      res.redirect(`${stateInfo.returnTo}${sep}auth=feishu&token=${result.token}${firstParam}`);
    } catch (err) {
      if (err.statusCode) {
        if (err.statusCode === 403) console.log(`[auth/feishu] rejected: ${err.message}`);
        return res.status(err.statusCode).send(err.message);
      }
      console.error("[auth/feishu] callback failed:", err?.message || err);
      res.status(500).send("Feishu auth callback failed: " + (err?.message || "unknown"));
    }
  });

  router.get("/api/auth/me", (req, res) => {
    const token = req.headers.authorization?.replace("Bearer ", "");
    const user = token ? getAuthSession(token) : null;
    if (!user) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    res.json({ user: publicAuthUser(user) });
  });

  router.post("/api/auth/logout", (req, res) => {
    const token = req.headers.authorization?.replace("Bearer ", "");
    if (token) {
      authSessions.delete(token);
      removeSession(token).catch(e => console.warn("[auth] removeSession error:", e.message));
    }
    res.json({ ok: true });
  });

  router.put("/api/auth/profile", requireAuth, (req, res) => {
    const token = req.headers.authorization?.replace("Bearer ", "");
    const { name, picture } = req.body;
    if (!name || typeof name !== "string" || !name.trim()) {
      return res.status(400).json({ error: "name required" });
    }
    const trimmed = name.trim();
    // The display name doubles as this user's OV peer_id, so it must fit the
    // peer_id charset (see USERNAME_CHARSET in index.js). This also covers the
    // first-login username picker, which posts here.
    if (!isValidUsername(trimmed)) {
      return res.status(400).json({ error: "Username may only contain letters, digits, and _ . @ - (no spaces)." });
    }
    if (isReservedName(trimmed)) {
      return res.status(400).json({ error: `"${trimmed}" is a reserved username and cannot be used.` });
    }
    const user = getAuthSession(token);
    if (!user) return res.status(401).json({ error: "Not authenticated" });
    // Uniqueness: a rename can't shadow an agent, a registered human, or anyone
    // currently online. selfName excludes the caller's own name (a no-op or
    // case-only rename is allowed).
    if (isNameTaken(trimmed, { selfName: user.name })) {
      return res.status(409).json({ error: `"${trimmed}" is already taken — choose another name.` });
    }
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
    // Keep every session for this email on the same display name, so a later
    // fresh OAuth login (findExistingDisplayNameForEmail) reuses the latest
    // chosen name regardless of which session it happens to match first.
    if (user.email && oldName !== trimmed) {
      for (const [otherToken, otherUser] of authSessions) {
        if (otherToken === token) continue;
        if (otherUser && !otherUser.guest && otherUser.email === user.email && otherUser.name !== trimmed) {
          otherUser.name = trimmed;
          db.saveSession(otherToken, otherUser).catch(e => console.warn("[auth] saveSession (sibling) error:", e.message));
        }
      }
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

  router.get("/api/auth/config", (req, res) => {
    res.json({
      googleClientId: GOOGLE_CLIENT_ID || null,
      // Any workspace gating on an allowlist disables the guest button across
      // the whole deployment — otherwise default-workspace visitors could click
      // through to a per-workspace guard that immediately rejects them.
      allowlistActive: allowlistActiveAnywhere(),
      supabaseUrl: SUPABASE_URL || null,
      supabaseAnonKey: SUPABASE_ANON_KEY || null,
      feishuEnabled: !!feishuEnabled,
      // Denylist semantics: OV + MCP injection default ON for every runtime;
      // these list the runtimes (if any) opted out of the default.
      ovRuntimeDenylist: OV_RUNTIME_DENYLIST,
      ovMcpRuntimeDenylist: OV_MCP_RUNTIME_DENYLIST,
    });
  });

  router.get("/api/workspaces", requireSessionAuth, (req, res) => {
    res.json({
      workspaces: visibleWorkspacesForUser(req.user),
      activeWorkspaceId: req.workspaceId || DEFAULT_WORKSPACE_ID,
    });
  });

  router.post("/api/workspaces", requireSessionAuth, async (req, res) => {
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
      try {
        // inviteWorkspaceMember writes the member row via
        // saveWorkspaceMemberStrict (single source of truth, awaited).
        // The previous redundant `await db.saveWorkspaceMember(member)`
        // here ran through dbExec which swallows errors — it looked like
        // belt-and-suspenders but actually defeated strict atomicity by
        // queueing a second write that could land after a rollback.
        await inviteWorkspaceMember({
          workspaceId: id,
          email: ownerEmail,
          role: "root",
          name: req.user.name,
          addedBy: ownerEmail,
        });
      } catch (e) {
        // Roll back the new workspace row so the creator isn't stranded
        // owning a server they can't enter (allowlist missing → bounce).
        try { removeWorkspaceFromMemory(id); } catch { /* ignore */ }
        try { await db.deleteWorkspace(id); } catch { /* ignore */ }
        return res.status(500).json({ error: `Failed to provision workspace membership: ${e.message}` });
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

  router.patch("/api/workspaces/:id", requireSessionAuth, async (req, res) => {
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

  router.delete("/api/workspaces/:id", requireAuth, async (req, res) => {
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

  return {
    authSessions,
    getAuthSession,
    hasAuthSession,
    isEmbedSessionUser,
    embedSessionExpired,
    publicAuthUser,
    loadAuthSessions,
    persistSession,
    removeSession,
    router,
  };
}

module.exports = { createAuthModule };
