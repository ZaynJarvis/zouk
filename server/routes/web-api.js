// Web API routes — /api/* endpoints consumed by the frontend.
//
// Extracted from index.js. All external dependencies are accessed via the `ctx`
// object passed to createWebApiRouter(). No implicit closure captures.

const { Router } = require("express");
const { v4: uuidv4 } = require("uuid");

function createWebApiRouter(ctx) {
  const router = Router();

  // Destructure ctx for readability inside handlers.
  const {
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
  } = ctx;

  // Send message from web UI (human user)
  router.post("/messages", requireAuth, (req, res) => {
    // Prefer the authenticated user's name over any body field so a stale client
    // state can't pollute canonical DM channel names (would split PM threads).
    // Falls back to the legacy body.senderName, then to "local-user" for tooling.
    const token = req.headers.authorization?.replace("Bearer ", "");
    const authedName = token ? ctx.getAuthSession(token)?.name : null;
    const { target, content, senderName: bodyName, attachmentIds, clientMsgId } = req.body;
    const senderName = authedName || bodyName || "local-user";
    const workspaceId = req.workspaceId || DEFAULT_WORKSPACE_ID;

    // Idempotency: if the same clientMsgId was already processed for this
    // workspace+sender, return the existing message + delivery without
    // re-inserting or re-fanouting. Prevents duplicates when the client
    // retries a POST whose first response was lost (iOS PWA backgrounding,
    // NAT timeout, etc.).
    if (clientMsgId && typeof clientMsgId === "string") {
      const dedupeKey = ctx.recentSendsKey(workspaceId, senderName, clientMsgId);
      const cached = ctx.recentSendsGet(dedupeKey);
      if (cached) {
        return res.json({
          messageId: cached.msg.id,
          message: ctx.formatMessageForClient(cached.msg),
          clientMsgId: cached.msg.clientMsgId,
          delivery: cached.delivery,
          deduplicated: true,
        });
      }
    }

    const { channelName, channelType, threadId } = parseTarget(target, senderName);
    const resolved = resolveTargetChannel(target, senderName, workspaceId);
    if (ctx.isEmbedSessionUser(req.user)) {
      if (!resolved.channel || !ctx.embedCanAccessChannel(req.user, resolved.channel, workspaceId)) {
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
      clientMsgId: clientMsgId || undefined,
    });

    const delivery = fanoutUserMessage(msg);

    // Cache for idempotent retry. TTL + cap are enforced by the server-side
    // helper (evictExpiredRecentSends).
    if (clientMsgId && typeof clientMsgId === "string") {
      ctx.recentSendsSet(ctx.recentSendsKey(workspaceId, senderName, clientMsgId), msg, delivery);
    }

    res.json({
      messageId: msg.id,
      message: msg,
      clientMsgId: msg.clientMsgId || null,
      delivery,
    });
  });

  // POST /api/trigger — let external systems inject a message that behaves
  // exactly like a human-sent one (full deliverToAllAgents + broadcastToWeb
  // fanout, mention parsing, agent wakeup). Public channels only — no DM,
  // no attachments. Sender is hardcoded to "system"; the name is reserved
  // (see RESERVED_USER_NAMES) so it can't collide with a real user.
  router.post("/trigger", requireMachineKey, (req, res) => {
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
  router.post("/attachments", requireAuth, upload.single("file"), async (req, res) => {
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
  router.get("/messages", requireWorkspaceRead, async (req, res) => {
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
    if (ctx.isEmbedSessionUser(req.user) && !ctx.embedCanAccessChannel(req.user, resolved.channel, workspaceId)) {
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
  router.get("/channels", requireWorkspaceRead, (req, res) => {
    const workspaceId = req.workspaceId || DEFAULT_WORKSPACE_ID;
    res.json({
      channels: store.channels.filter((ch) => (
        (ch.workspaceId || DEFAULT_WORKSPACE_ID) === workspaceId
        && (ch.type || "channel") === "channel"
        && (!ctx.isEmbedSessionUser(req.user) || ctx.embedCanAccessChannel(req.user, ch, workspaceId))
      )),
    });
  });

  // Create channel
  router.post("/channels", requireAuth, (req, res) => {
    const { name, description } = req.body;
    const workspaceId = req.workspaceId || DEFAULT_WORKSPACE_ID;
    const ch = findOrCreateChannel(name, "channel", workspaceId);
    ch.description = description || "";
    db.saveChannel(ch);
    broadcastToWeb({ type: "channel_created", workspaceId, channel: ch });
    res.json({ channel: ch });
  });

  router.delete("/channels/:id", requireAuth, async (req, res) => {
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
  router.get("/channels/:id/agents", requireAuth, (req, res) => {
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
  router.patch("/channels/:id/agents/:agentId", requireAuth, (req, res) => {
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

  router.delete("/channels/:id/agents/:agentId", requireAuth, (req, res) => {
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
  router.get("/tasks", requireWorkspaceRead, (req, res) => {
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
  router.get("/machines", requireWorkspaceRead, (req, res) => {
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
  router.get("/machines/:id/runtimes/:runtime/models", requireWorkspaceRead, (req, res) => {
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
  router.get("/agents", requireWorkspaceRead, (req, res) => {
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
  router.get("/agents/:id/channels", requireAuth, (req, res) => {
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
  router.get("/agents/:id/activities", requireWorkspaceRead, async (req, res) => {
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

  return router;
}

module.exports = { createWebApiRouter };
