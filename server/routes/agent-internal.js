// MCP tool endpoints — /internal/agent/:agentId/*
//
// Extracted from index.js. All external dependencies are accessed via the `ctx`
// object passed to createAgentInternalRouter(). No implicit closure captures.

const { Router } = require("express");
const { v4: uuidv4 } = require("uuid");
const sharp = require("sharp");

const AGENT_RECEIVE_BATCH_LIMIT = 500;

function createAgentInternalRouter(ctx) {
  const router = Router({ mergeParams: true });

  // Agent token validation middleware
  router.use("/:agentId", (req, res, next) => {
    const header = req.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) return next();
    if (token.startsWith("sat_")) {
      const record = ctx.agentAuth.resolve(token);
      if (!record) return res.status(401).json({ error: "Invalid agent token" });
      if (req.params.agentId && req.params.agentId !== record.agentId) {
        return res.status(403).json({ error: "Token does not match agent" });
      }
      req.agentId = record.agentId;
      req.agentWorkspaceId = record.workspaceId;
    }
    next();
  });

  // send_message
  router.post("/:agentId/send", (req, res) => {
    const { agentId } = req.params;
    const { target, content, attachmentIds } = req.body;
    const workspaceId = ctx.workspaceIdFromAgent(agentId);
    const senderName = ctx.agentPayload(agentId)?.name || agentId;
    const { channelName, channelType, threadId } = ctx.parseTarget(target, senderName);
    const ch = ctx.findOrCreateChannel(channelName, channelType, workspaceId);

    const msg = {
      id: uuidv4(),
      seq: ctx.nextSeq(),
      workspaceId,
      channelId: ch.id,
      channelName,
      channelType,
      threadId: threadId || null,
      senderName,
      senderType: "agent",
      content,
      createdAt: ctx.now(),
      attachments: ctx.resolveAttachmentRefs(attachmentIds),
    };
    ctx.appendMessage(msg);
    ctx.db.saveMessage(msg);
    ctx.deliverToAllAgents(msg, agentId);
    ctx.broadcastToWeb({ type: "message", workspaceId, message: ctx.formatMessageForClient(msg) });

    // OV auto-capture: log agent's response to OV session (fire-and-forget)
    if (ctx.ovLifecycle) {
      ctx.ovLifecycle.autoCapture(agentId, msg.channelId, null, content).catch(() => {});
    }

    res.json({ messageId: msg.id, recentUnread: [] });
  });

  // check_messages (receive)
  router.get("/:agentId/receive", async (req, res) => {
    const { agentId } = req.params;
    const lastRead = ctx.store.agentReadSeq[agentId] || 0;
    const selfName = ctx.agentPayload(agentId)?.name || agentId;
    const workspaceId = ctx.workspaceIdFromAgent(agentId);
    const channelIds = ctx.visibleChannelIdsForAgent(agentId);
    const rows = channelIds.length > 0
      ? await ctx.readMessagesForAgent({ workspaceId, channelIds, sinceSeq: lastRead, limit: AGENT_RECEIVE_BATCH_LIMIT })
      : [];
    const unread = rows
      .filter((m) => m.senderName !== selfName)
      .map((m) => ctx.formatMessageForAgent(m, agentId));
    if (rows.length >= AGENT_RECEIVE_BATCH_LIMIT) {
      ctx.store.agentReadSeq[agentId] = rows[rows.length - 1].seq;
    } else {
      ctx.store.agentReadSeq[agentId] = ctx.store.seq;
    }
    res.json({ messages: unread });
  });

  // list_server
  router.get("/:agentId/server", (req, res) => {
    const { agentId } = req.params;
    const workspaceId = ctx.workspaceIdFromAgent(agentId);
    const channels = ctx.store.channels
      .filter((ch) => (ch.workspaceId || ctx.DEFAULT_WORKSPACE_ID) === workspaceId && (ch.type || "channel") === "channel")
      .map((ch) => {
        const row = ctx.getMembership(ch.id, agentId);
        return { name: ch.name, description: ch.description || "", joined: !!(row && row.canRead), subscribed: !!(row && row.subscribed) };
      });
    const agents = Object.keys(ctx.store.agents).map((id) => {
      const p = ctx.agentPayload(id);
      if ((p?.workspaceId || ctx.DEFAULT_WORKSPACE_ID) !== workspaceId) return null;
      return { name: p?.name || id, status: p?.status || "inactive" };
    }).filter(Boolean);
    res.json({ channels, agents, humans: ctx.store.humans });
  });

  // list subscriptions
  router.get("/:agentId/subscriptions", (req, res) => {
    const { agentId } = req.params;
    const workspaceId = ctx.workspaceIdFromAgent(agentId);
    const out = [];
    for (const ch of ctx.store.channels) {
      if ((ch.workspaceId || ctx.DEFAULT_WORKSPACE_ID) !== workspaceId) continue;
      const row = ctx.getMembership(ch.id, agentId);
      if (!row) continue;
      out.push({ channelId: ch.id, channelName: ch.name, channelType: ch.type || "channel", canRead: !!row.canRead, subscribed: !!row.subscribed });
    }
    res.json({ subscriptions: out });
  });

  // update subscription
  router.patch("/:agentId/subscriptions", (req, res) => {
    const { agentId } = req.params;
    const workspaceId = ctx.workspaceIdFromAgent(agentId);
    const { channelId, channelName, channelType = "channel", canRead, subscribed } = req.body || {};
    let ch;
    if (channelId) {
      ch = ctx.store.channels.find((c) => c.id === channelId && (c.workspaceId || ctx.DEFAULT_WORKSPACE_ID) === workspaceId);
    } else if (channelName) {
      ch = ctx.store.channels.find((c) => (c.workspaceId || ctx.DEFAULT_WORKSPACE_ID) === workspaceId && c.name === channelName && (c.type || "channel") === channelType);
    }
    if (!ch) return res.status(404).json({ error: "channel_not_found" });
    const existing = ctx.getMembership(ch.id, agentId) || { canRead: true, subscribed: true };
    const next = { canRead: canRead === undefined ? existing.canRead : !!canRead, subscribed: subscribed === undefined ? existing.subscribed : !!subscribed };
    if (!next.canRead && !next.subscribed) {
      ctx.removeMembership(ch.id, agentId);
      return res.json({ ok: true, membership: null });
    }
    ctx.setMembership(ch.id, agentId, next);
    res.json({ ok: true, membership: { channelId: ch.id, channelName: ch.name, ...next } });
  });

  // read_history
  router.get("/:agentId/history", async (req, res) => {
    const { agentId } = req.params;
    const { channel, limit = 50, before, after, around } = req.query;
    const agentName = ctx.store.agents[agentId]?.name || agentId;
    const workspaceId = ctx.workspaceIdFromAgent(agentId);
    const resolved = ctx.resolveTargetChannel(channel, agentName, workspaceId);
    if (!resolved.channel || !ctx.messageVisibleToAgent({
      workspaceId, channelId: resolved.channel.id, channelName: resolved.channelName, channelType: resolved.channelType,
    }, agentId)) {
      return res.json({ messages: [], last_read_seq: ctx.store.seq, has_more: false, has_older: false, has_newer: false, historyLimited: false, historyLimitMessage: null });
    }
    const channelId = resolved.channel.id;
    const threadId = resolved.threadId;
    const limitNum = parseInt(limit);

    let rows;
    if (around) {
      let centerSeq;
      const aroundNum = parseInt(around);
      if (Number.isFinite(aroundNum) && String(aroundNum) === String(around)) {
        centerSeq = aroundNum;
      } else {
        const centerMsg = await ctx.getMessageByIdAnywhere(around);
        centerSeq = centerMsg ? centerMsg.seq : null;
      }
      rows = centerSeq != null
        ? await ctx.readChannelHistoryAround({ workspaceId, channelId, centerSeq, limit: limitNum })
        : await ctx.readChannelHistory({ workspaceId, channelId, threadId, limit: limitNum });
    } else {
      const beforeSeq = before ? parseInt(before) : null;
      const afterSeq = after ? parseInt(after) : null;
      rows = await ctx.readChannelHistory({ workspaceId, channelId, threadId, beforeSeq, afterSeq, limit: limitNum });
    }
    res.json({ messages: rows.map((m) => ctx.formatMessageForAgent(m, agentId)), last_read_seq: ctx.store.seq, has_more: false, has_older: false, has_newer: false, historyLimited: false, historyLimitMessage: null });
  });

  // search_messages
  router.get("/:agentId/search", async (req, res) => {
    const { agentId } = req.params;
    const agentName = ctx.store.agents[agentId]?.name || agentId;
    const workspaceId = ctx.workspaceIdFromAgent(agentId);
    const { q, limit = 10, channel } = req.query;
    let scopedChannelIds = ctx.visibleChannelIdsForAgent(agentId);
    if (channel) {
      const resolved = ctx.resolveTargetChannel(channel, agentName, workspaceId);
      if (!resolved.channel || !scopedChannelIds.includes(resolved.channel.id)) return res.json({ results: [] });
      scopedChannelIds = [resolved.channel.id];
    }
    const rows = q ? await ctx.searchVisibleMessages({ workspaceId, channelIds: scopedChannelIds, keyword: q, limit: parseInt(limit) }) : [];
    rows.reverse();
    res.json({
      results: rows.map((m) => ({ ...ctx.formatMessageForClient(m), seq: m.seq, createdAt: m.createdAt, snippet: m.content.substring(0, 200) })),
    });
  });

  // list_tasks
  router.get("/:agentId/tasks", (req, res) => {
    const { agentId } = req.params;
    const { channel, status } = req.query;
    const agentName = ctx.store.agents[agentId]?.name || agentId;
    const workspaceId = ctx.workspaceIdFromAgent(agentId);
    let tasks = ctx.store.tasks.filter((t) => (t.workspaceId || ctx.DEFAULT_WORKSPACE_ID) === workspaceId);
    if (channel) tasks = tasks.filter((t) => ctx.taskMatchesTarget(t, channel, agentName));
    if (status && status !== "all") tasks = tasks.filter((t) => t.status === status);
    res.json({
      tasks: tasks.map((t) => ({ taskNumber: t.taskNumber, title: t.title, status: t.status, messageId: t.messageId, claimedByName: t.claimedByName || null, createdByName: t.createdByName, isLegacy: false })),
    });
  });

  // create_tasks
  router.post("/:agentId/tasks", async (req, res) => {
    const { agentId } = req.params;
    const { channel, tasks: taskDefs } = req.body;
    const agentName = ctx.store.agents[agentId]?.name || agentId;
    const workspaceId = ctx.workspaceIdFromAgent(agentId);
    const { channelName, channelType } = ctx.parseTarget(channel, agentName);
    const ch = ctx.findOrCreateChannel(channelName, channelType, workspaceId);
    const created = [];
    for (const td of taskDefs) {
      const taskNum = ctx.nextTaskNum();
      const msgId = uuidv4();
      const task = { taskNumber: taskNum, workspaceId, channelId: ch.id, channelName: ch.name, title: td.title, status: "todo", messageId: msgId, claimedByName: null, claimedByType: null, createdByName: agentName };
      ctx.store.tasks.push(task);
      const msg = { id: msgId, seq: ctx.nextSeq(), workspaceId, channelId: ch.id, channelName: ch.name, channelType, threadId: null, senderName: "system", senderType: "system", content: `📋 New task #${taskNum}: ${td.title}`, createdAt: ctx.now(), attachments: [], taskNumber: taskNum, taskStatus: "todo" };
      ctx.appendMessage(msg);
      await ctx.db.saveTask(task);
      await ctx.db.saveMessage(msg);
      ctx.broadcastToWeb({ type: "message", workspaceId, message: ctx.formatMessageForClient(msg) });
      created.push({ taskNumber: taskNum, messageId: msgId, title: td.title });
    }
    res.json({ tasks: created });
  });

  // claim_tasks
  router.post("/:agentId/tasks/claim", async (req, res) => {
    const { agentId } = req.params;
    const { channel, task_numbers, message_ids } = req.body;
    const agentName = ctx.store.agents[agentId]?.name || agentId;
    const workspaceId = ctx.workspaceIdFromAgent(agentId);

    const claimTask = async (task) => {
      const num = task.taskNumber;
      if (task.claimedByName && task.claimedByName !== agentName) {
        return { taskNumber: num, messageId: task.messageId, success: false, reason: `already claimed by @${task.claimedByName}` };
      }
      const alreadyClaimedBySelf = task.claimedByName === agentName && task.status === "in_progress";
      task.claimedByName = agentName;
      task.claimedByType = "agent";
      task.status = "in_progress";
      await ctx.db.saveTask(task);
      await ctx.syncTaskBackingMessage(task);
      if (!alreadyClaimedBySelf) {
        const chPayload = ctx.taskChannelPayload(task);
        const msg = { id: uuidv4(), seq: ctx.nextSeq(), ...chPayload, threadId: null, senderName: "system", senderType: "system", content: `📌 ${agentName} claimed #${num} "${task.title}"`, createdAt: ctx.now(), attachments: [], taskNumber: num, taskStatus: "in_progress" };
        ctx.appendMessage(msg);
        await ctx.db.saveMessage(msg);
        ctx.broadcastToWeb({ type: "message", workspaceId: msg.workspaceId || workspaceId, message: ctx.formatMessageForClient(msg) });
      }
      return { taskNumber: num, messageId: task.messageId, success: true, reason: null };
    };

    const claimMessageId = async (mid) => {
      const taskResolved = ctx.resolveUniqueByIdOrPrefix(
        ctx.store.tasks.filter((t) => (t.workspaceId || ctx.DEFAULT_WORKSPACE_ID) === workspaceId),
        mid, (t) => t.messageId
      );
      if (taskResolved.item) return ctx.withTaskMutationLock(`task:${taskResolved.item.taskNumber}`, () => claimTask(taskResolved.item));
      if (taskResolved.reason === "ambiguous id prefix") return { taskNumber: null, messageId: mid, success: false, reason: "ambiguous message id prefix" };

      const channelMatch = (m) => !channel || ctx.matchesTarget(m, channel, agentName);
      const visibleAndOnTarget = (m) => ctx.messageVisibleToAgent(m, agentId) && channelMatch(m);
      let message = null;
      let reason = null;
      if (typeof mid === "string" && mid.length > 0) {
        const cachedExact = ctx.messagesById.get(mid);
        if (cachedExact && visibleAndOnTarget(cachedExact)) {
          message = cachedExact;
        } else {
          const dbExact = await ctx.db.getMessageById(mid);
          if (dbExact && visibleAndOnTarget(dbExact)) {
            message = dbExact;
          } else if (mid.length >= 8 && mid.length < 36) {
            const cachedShort = ctx.messagesByShortId.get(mid.slice(0, 8));
            const candidates = [];
            if (cachedShort && cachedShort.id.startsWith(mid)) candidates.push(cachedShort);
            const dbPrefix = await ctx.db.findMessagesByIdPrefix({ prefix: mid, workspaceId });
            for (const m of dbPrefix) { if (!candidates.some((c) => c.id === m.id)) candidates.push(m); }
            const visible = candidates.filter(visibleAndOnTarget);
            if (visible.length === 1) message = visible[0];
            else if (visible.length > 1) reason = "ambiguous message id prefix";
          }
        }
      }
      if (!message) return { taskNumber: null, messageId: mid, success: false, reason: reason || "message not found" };
      if (message.threadId) return { taskNumber: null, messageId: message.id, success: false, reason: "thread messages cannot be claimed as tasks" };

      return ctx.withTaskMutationLock(`message:${message.id}`, async () => {
        const taskAfterLock = ctx.store.tasks.find((t) => t.messageId === message.id && (t.workspaceId || ctx.DEFAULT_WORKSPACE_ID) === workspaceId);
        if (taskAfterLock) return claimTask(taskAfterLock);
        const taskNum = ctx.nextTaskNum();
        const task = { taskNumber: taskNum, workspaceId, channelId: message.channelId, channelName: message.channelName, title: ctx.taskTitleFromMessage(message), status: "todo", messageId: message.id, claimedByName: null, claimedByType: null, createdByName: message.senderName || agentName };
        ctx.store.tasks.push(task);
        await ctx.db.saveTask(task);
        message.taskNumber = taskNum;
        message.taskStatus = "todo";
        message.taskAssigneeId = null;
        message.taskAssigneeType = null;
        await ctx.db.saveMessage(message);
        return claimTask(task);
      });
    };

    const results = [];
    if (task_numbers) {
      for (const num of task_numbers) {
        const task = ctx.store.tasks.find((t) => t.taskNumber === num && (t.workspaceId || ctx.DEFAULT_WORKSPACE_ID) === workspaceId);
        if (!task) { results.push({ taskNumber: num, messageId: null, success: false, reason: "task not found" }); continue; }
        results.push(await ctx.withTaskMutationLock(`task:${num}`, () => claimTask(task)));
      }
    }
    if (message_ids) {
      for (const mid of message_ids) results.push(await claimMessageId(mid));
    }
    res.json({ results });
  });

  // unclaim_task
  router.post("/:agentId/tasks/unclaim", async (req, res) => {
    const { agentId } = req.params;
    const { task_number } = req.body;
    const workspaceId = ctx.workspaceIdFromAgent(agentId);
    const task = ctx.store.tasks.find((t) => t.taskNumber === task_number && (t.workspaceId || ctx.DEFAULT_WORKSPACE_ID) === workspaceId);
    if (task) {
      task.claimedByName = null;
      task.claimedByType = null;
      task.status = "todo";
      await ctx.db.saveTask(task);
      await ctx.syncTaskBackingMessage(task);
    }
    res.json({ success: true });
  });

  // update_task_status
  router.post("/:agentId/tasks/update-status", async (req, res) => {
    const { agentId } = req.params;
    const { task_number, status } = req.body;
    const workspaceId = ctx.workspaceIdFromAgent(agentId);
    const task = ctx.store.tasks.find((t) => t.taskNumber === task_number && (t.workspaceId || ctx.DEFAULT_WORKSPACE_ID) === workspaceId);
    if (task) {
      task.status = status;
      await ctx.db.saveTask(task);
      await ctx.syncTaskBackingMessage(task);
      const agentName = ctx.store.agents[agentId]?.name || agentId;
      const emoji = status === "done" ? "✅" : status === "in_review" ? "👀" : "🔄";
      const chPayload = ctx.taskChannelPayload(task);
      const msg = { id: uuidv4(), seq: ctx.nextSeq(), ...chPayload, threadId: null, senderName: "system", senderType: "system", content: `${emoji} ${agentName} moved #${task_number} "${task.title}" to ${status}`, createdAt: ctx.now(), attachments: [], taskNumber: task_number, taskStatus: status };
      ctx.appendMessage(msg);
      await ctx.db.saveMessage(msg);
      ctx.broadcastToWeb({ type: "message", workspaceId: msg.workspaceId || workspaceId, message: ctx.formatMessageForClient(msg) });
    }
    res.json({ success: true });
  });

  // resolve-channel
  router.post("/:agentId/resolve-channel", (req, res) => {
    const { agentId } = req.params;
    const agentName = ctx.store.agents[agentId]?.name || agentId;
    const workspaceId = ctx.workspaceIdFromAgent(agentId);
    const { target } = req.body;
    const { channelName, channelType } = ctx.parseTarget(target, agentName);
    const ch = ctx.findOrCreateChannel(channelName, channelType, workspaceId);
    res.json({ channelId: ch.id });
  });

  // upload
  router.post("/:agentId/upload", ctx.upload.single("file"), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No file" });
    const id = uuidv4();
    try {
      await ctx.attachmentStorage.put(id, req.file.buffer, { filename: req.file.originalname, contentType: req.file.mimetype });
    } catch (err) {
      return res.status(500).json({ error: "Failed to persist attachment", detail: err.message });
    }
    res.json({ id, filename: req.file.originalname, sizeBytes: req.file.size });
  });

  // update_profile
  router.post("/:agentId/profile", ctx.upload.single("picture"), async (req, res) => {
    const { agentId } = req.params;
    const workspaceId = ctx.workspaceIdFromAgent(agentId);
    const rawDisplayName = req.body?.display_name;
    const rawDescription = req.body?.description;
    const clearPicture = req.body?.clear_picture === "1" || req.body?.clear_picture === "true";
    const hasFile = !!req.file;
    if (!hasFile && !clearPicture && rawDisplayName === undefined && rawDescription === undefined) {
      return res.status(400).json({ error: "At least one of picture, clear_picture, display_name, description is required" });
    }
    if (hasFile && clearPicture) return res.status(400).json({ error: "picture and clear_picture are mutually exclusive" });

    let displayName;
    if (rawDisplayName !== undefined) {
      if (typeof rawDisplayName !== "string") return res.status(400).json({ error: "display_name must be a string" });
      const trimmed = rawDisplayName.trim();
      if (!trimmed) return res.status(400).json({ error: "display_name cannot be empty" });
      if (trimmed.length > ctx.MAX_AGENT_DISPLAYNAME_LEN) return res.status(400).json({ error: `display_name exceeds ${ctx.MAX_AGENT_DISPLAYNAME_LEN} chars` });
      if (ctx.isReservedName(trimmed)) return res.status(400).json({ error: `display_name "${trimmed}" is reserved` });
      displayName = trimmed;
    }

    let description;
    if (rawDescription !== undefined) {
      if (typeof rawDescription !== "string") return res.status(400).json({ error: "description must be a string" });
      if (rawDescription.length > ctx.MAX_AGENT_DESCRIPTION_LEN) return res.status(400).json({ error: `description exceeds ${ctx.MAX_AGENT_DESCRIPTION_LEN} chars` });
      description = rawDescription;
    }

    let pictureDataUri;
    if (hasFile) {
      if (!ctx.AGENT_PICTURE_MIME_RE.test(req.file.mimetype || "")) return res.status(415).json({ error: "picture must be png/jpeg/webp/gif" });
      try {
        let buf = await sharp(req.file.buffer, { failOn: "error" }).rotate().resize(ctx.AGENT_PICTURE_DIM, ctx.AGENT_PICTURE_DIM, { fit: "cover", position: "centre" }).webp({ quality: 80 }).toBuffer();
        if (buf.byteLength > ctx.MAX_AGENT_PICTURE_OUTPUT_BYTES) {
          buf = await sharp(req.file.buffer).rotate().resize(ctx.AGENT_PICTURE_DIM, ctx.AGENT_PICTURE_DIM, { fit: "cover", position: "centre" }).webp({ quality: 50 }).toBuffer();
        }
        if (buf.byteLength > ctx.MAX_AGENT_PICTURE_OUTPUT_BYTES) return res.status(413).json({ error: `picture exceeds ${ctx.MAX_AGENT_PICTURE_OUTPUT_BYTES} bytes after resize` });
        pictureDataUri = `data:image/webp;base64,${buf.toString("base64")}`;
      } catch (err) {
        return res.status(422).json({ error: "Failed to decode picture", detail: err.message });
      }
    }

    let idx = ctx.agentConfigs.findIndex((c) => c.id === agentId);
    if (idx >= 0 && (ctx.agentConfigs[idx].workspaceId || ctx.DEFAULT_WORKSPACE_ID) !== workspaceId) return res.status(404).json({ error: "Agent not found" });
    if (idx < 0) {
      const running = ctx.store.agents[agentId];
      if (!running) return res.status(404).json({ error: "Agent not found" });
      if (!running.machineId) return res.status(400).json({ error: "Running agent has no machineId" });
      ctx.agentConfigs.push({ id: agentId, workspaceId, name: running.name, displayName: running.displayName, runtime: running.runtime, model: running.model, workDir: running.workDir, machineId: running.machineId });
      idx = ctx.agentConfigs.length - 1;
    }

    const merged = { ...ctx.agentConfigs[idx] };
    const changed = [];
    if (displayName !== undefined) { merged.displayName = displayName; changed.push("displayName"); }
    if (description !== undefined) { merged.description = description; merged.systemPrompt = description; changed.push("description"); }
    if (pictureDataUri !== undefined) { merged.picture = pictureDataUri; changed.push("picture"); }
    if (clearPicture) { merged.picture = null; changed.push("picture"); }

    ctx.agentConfigs[idx] = merged;
    ctx.saveAgentConfigs(ctx.agentConfigs);
    ctx.db.saveAgentConfig(merged);
    if (ctx.syncRuntimeAgentFromConfig(agentId, merged)) {
      ctx.broadcastToWeb({ type: "agent_started", workspaceId, agent: ctx.agentPayload(agentId) });
    }
    ctx.broadcastToWeb({ type: "config_updated", workspaceId, configs: ctx.sanitizedAgentConfigs().filter((c) => (c.workspaceId || ctx.DEFAULT_WORKSPACE_ID) === workspaceId) });
    res.json({ ok: true, updated: changed, pictureBytes: pictureDataUri ? Buffer.byteLength(pictureDataUri, "utf8") : 0, agent: ctx.agentPayload(agentId) });
  });

  return router;
}

module.exports = { createAgentInternalRouter };
