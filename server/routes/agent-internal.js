// MCP tool endpoints — /internal/agent/:agentId/*
//
// Extracted from index.js. All external dependencies are accessed via the `ctx`
// object passed to createAgentInternalRouter(). No implicit closure captures.

const { Router } = require("express");
const { v4: uuidv4 } = require("uuid");
const sharp = require("sharp");

const AGENT_RECEIVE_BATCH_LIMIT = 500;
// Newest unseen messages shown inline in a held-send response. Older unseen
// ones are counted (omittedMessageCount) but still marked seen — the shown
// tail is the operative context.
const HELD_MESSAGES_SHOWN_LIMIT = 5;

// Per-agent send rate limiter: sliding window, in-memory.
// Default: 20 sends per 10s window (burst 20, sustained ~2/s).
// Overridable via ZOUK_AGENT_SEND_RATE (max per window) and
// ZOUK_AGENT_SEND_WINDOW_MS (window in milliseconds).
// Map capped at AGENT_SEND_RATE_LIMIT_MAX_AGENTS with lazy sweep.
const AGENT_SEND_RATE_LIMIT_MAX = parseInt(process.env.ZOUK_AGENT_SEND_RATE, 10) || 20;
const AGENT_SEND_RATE_LIMIT_WINDOW_MS = parseInt(process.env.ZOUK_AGENT_SEND_WINDOW_MS, 10) || 10_000;
const AGENT_SEND_RATE_LIMIT_MAX_AGENTS = 500;

function createAgentSendRateLimiter({ max = AGENT_SEND_RATE_LIMIT_MAX, windowMs = AGENT_SEND_RATE_LIMIT_WINDOW_MS, maxAgents = AGENT_SEND_RATE_LIMIT_MAX_AGENTS } = {}) {
  const timestamps = new Map();

  function sweepExpired(nowMs) {
    for (const [agentId, stamps] of timestamps) {
      const fresh = stamps.filter((t) => nowMs - t < windowMs);
      if (fresh.length === 0) {
        timestamps.delete(agentId);
      } else if (fresh.length !== stamps.length) {
        timestamps.set(agentId, fresh);
      }
    }
  }

  return {
    check(agentId) {
      const nowMs = Date.now();
      // Lazy sweep when map grows beyond the cap: evict all expired entries,
      // then if still over cap, drop oldest agent entries by last-activity.
      if (timestamps.size >= maxAgents) {
        sweepExpired(nowMs);
        if (timestamps.size >= maxAgents) {
          // Drop agents with the oldest most-recent timestamp until under cap.
          const sorted = [...timestamps.entries()].sort(
            (a, b) => a[1][a[1].length - 1] - b[1][b[1].length - 1]
          );
          const toRemove = sorted.slice(0, timestamps.size - maxAgents + 1);
          for (const [id] of toRemove) timestamps.delete(id);
        }
      }

      const stamps = timestamps.get(agentId) || [];
      const fresh = stamps.filter((t) => nowMs - t < windowMs);
      fresh.push(nowMs);
      timestamps.set(agentId, fresh);

      const allowed = fresh.length <= max;
      // retryAfter: seconds until the oldest timestamp in the current window
      // falls out, freeing one slot. If not yet limited, 0.
      let retryAfterSeconds = 0;
      if (!allowed && fresh.length > 0) {
        const oldest = fresh[0];
        retryAfterSeconds = Math.max(1, Math.ceil((oldest + windowMs - nowMs) / 1000));
      }
      return { allowed, count: fresh.length, retryAfterSeconds };
    },
  };
}

function createAgentInternalRouter(ctx) {
  const router = Router({ mergeParams: true });

  const agentSendRateLimiter = createAgentSendRateLimiter();

  function agentNameFor(agentId) {
    return ctx.agentPayload(agentId)?.name
      || ctx.store.agents[agentId]?.name
      || ctx.agentConfigs.find((c) => c.id === agentId)?.name
      || agentId;
  }

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
  router.post("/:agentId/send", async (req, res) => {
    const { agentId } = req.params;

    // Per-agent send rate limit — check BEFORE dedupe so a looping agent
    // that mints a fresh clientMsgId per send is still capped.
    // Held freshness responses still count as a send attempt; that's fine
    // because holds are bounded by the unseen-message window.
    const rate = agentSendRateLimiter.check(agentId);
    if (!rate.allowed) {
      res.set("Retry-After", String(rate.retryAfterSeconds));
      return res.status(429).json({ error: "Too many agent send requests.", retryAfter: rate.retryAfterSeconds });
    }

    const { target, content, attachmentIds, clientMsgId } = req.body;
    const workspaceId = ctx.workspaceIdFromAgent(agentId);
    const senderName = agentNameFor(agentId);
    const { channelName, channelType, threadId } = ctx.parseTarget(target, senderName);
    const ch = await ctx.findOrCreateChannel(channelName, channelType, workspaceId);

    // Retry idempotency (same mechanism as the human send path): a daemon
    // HTTP retry after a lost response must not insert a second message.
    const dedupeKey = clientMsgId ? ctx.recentSendsKey(workspaceId, senderName, clientMsgId) : null;
    if (dedupeKey) {
      const cached = ctx.recentSendsGet(dedupeKey);
      if (cached) return res.json({ messageId: cached.msg.id, recentUnread: [], deduplicated: true });
    }

    // Optimistic lock: hold the send when the target scope has messages the
    // agent's model hasn't observed (per agent:deliver:ack / receive /
    // history). The hold response shows the unseen tail and advances the seen
    // cursor, so a considered re-send passes unless yet-newer messages land.
    // Fails open when no cursor exists (fresh agent, server restart) or the
    // channel tail cache is empty.
    if (ctx.SEND_FRESHNESS_ENABLED) {
      const scopeKey = `${ch.id}:${threadId || ""}`;
      const seenSeq = ctx.agentSeenSeqFor(agentId, scopeKey);
      if (seenSeq !== undefined) {
        const tail = ctx.store.channelMessages.get(ch.id) || [];
        // senderType "system" rows (task lifecycle notices) are excluded: they
        // are never push-delivered to agents, so they'd otherwise sit above
        // every cursor and hold every send in channels with task activity.
        const unseen = tail.filter((m) =>
          (m.threadId || null) === (threadId || null)
          && m.seq > seenSeq
          && m.senderName !== senderName
          && m.senderType !== "system"
        );
        if (unseen.length > 0) {
          const latestSeq = unseen[unseen.length - 1].seq;
          ctx.advanceAgentSeen(agentId, scopeKey, latestSeq);
          const shown = unseen.slice(-HELD_MESSAGES_SHOWN_LIMIT);
          console.log(`[freshness] held send agent=${agentId} target=${target} seen=${seenSeq} latest=${latestSeq} unseen=${unseen.length}`);
          return res.json({
            state: "held",
            reason: "newer_messages",
            target,
            heldMessages: shown.map((m) => ctx.formatMessageForAgent(m, agentId)),
            newMessageCount: unseen.length,
            shownMessageCount: shown.length,
            omittedMessageCount: unseen.length - shown.length,
            seenUpToSeq: latestSeq,
          });
        }
      }
    }

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
    ctx.deliverToAllAgents(msg, agentId).catch(() => {});
    ctx.broadcastToWeb({ type: "message", workspaceId, message: ctx.formatMessageForClient(msg) });

    // OV managed auto-capture: log agent's response (skip for native agents)
    const agentCfg = ctx.agentConfigs.find((c) => c.id === agentId);
    if (ctx.ovLifecycle && agentCfg?.openvikingApiKey && !ctx.isOvPluginForAgent(agentCfg)) {
      ctx.ovLifecycle.autoCapture(agentId, null, content, {
        channelName: msg.channelName,
        channelType: msg.channelType,
        threadId: msg.threadId,
        agentName: senderName,
        senderType: "agent",
        messageId: msg.id,
        timestamp: msg.createdAt,
      }).catch(() => {});
    }

    if (dedupeKey) ctx.recentSendsSet(dedupeKey, msg, null);
    res.json({ messageId: msg.id, recentUnread: [] });
  });

  // check_messages (receive)
  router.get("/:agentId/receive", async (req, res) => {
    const { agentId } = req.params;
    const lastRead = ctx.store.agentReadSeq[agentId] || 0;
    const selfName = agentNameFor(agentId);
    const workspaceId = ctx.workspaceIdFromAgent(agentId);
    const channelIds = ctx.visibleChannelIdsForAgent(agentId);
    const rows = channelIds.length > 0
      ? await ctx.readMessagesForAgent({ workspaceId, channelIds, sinceSeq: lastRead, limit: AGENT_RECEIVE_BATCH_LIMIT })
      : [];
    const unread = rows
      .filter((m) => m.senderName !== selfName)
      .map((m) => ctx.formatMessageForAgent(m, agentId));
    // Everything returned here is now in the agent's context — advance the
    // per-scope seen cursors used by the send freshness check.
    for (const m of rows) {
      ctx.advanceAgentSeen(agentId, ctx.messageScopeKey(m), m.seq);
    }
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
      const cfg = ctx.agentConfigs.find((c) => c.id === id);
      const agentName = p?.name || id;
      // Find tasks claimed by this agent
      const claimedTasks = ctx.store.tasks
        .filter((t) => (t.workspaceId || ctx.DEFAULT_WORKSPACE_ID) === workspaceId && t.claimedByName === agentName)
        .map((t) => ({ taskNumber: t.taskNumber, title: t.title, status: t.status }));
      // Find channel names this agent subscribes to
      const subscribedChannels = ctx.store.channels
        .filter((ch) => {
          if ((ch.workspaceId || ctx.DEFAULT_WORKSPACE_ID) !== workspaceId) return false;
          if ((ch.type || "channel") !== "channel") return false;
          const row = ctx.getMembership(ch.id, id);
          return !!(row && row.subscribed);
        })
        .map((ch) => ch.name);
      return {
        name: agentName,
        displayName: p?.displayName || agentName,
        description: cfg?.description || "",
        runtime: p?.runtime || null,
        model: p?.model || null,
        status: p?.status || "inactive",
        activity: p?.activity || null,
        activityDetail: p?.activityDetail || null,
        claimedTasks,
        channels: subscribedChannels,
      };
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
  router.patch("/:agentId/subscriptions", async (req, res) => {
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
      await ctx.removeMembership(ch.id, agentId);
      return res.json({ ok: true, membership: null });
    }
    await ctx.setMembership(ch.id, agentId, next);
    res.json({ ok: true, membership: { channelId: ch.id, channelName: ch.name, ...next } });
  });

  // read_history
  router.get("/:agentId/history", async (req, res) => {
    const { agentId } = req.params;
    const { channel, limit = 50, before, after, around } = req.query;
    const agentName = agentNameFor(agentId);
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
    for (const m of rows) {
      ctx.advanceAgentSeen(agentId, ctx.messageScopeKey(m), m.seq);
    }
    res.json({ messages: rows.map((m) => ctx.formatMessageForAgent(m, agentId)), last_read_seq: ctx.store.seq, has_more: false, has_older: false, has_newer: false, historyLimited: false, historyLimitMessage: null });
  });

  // search_messages
  router.get("/:agentId/search", async (req, res) => {
    const { agentId } = req.params;
    const agentName = agentNameFor(agentId);
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
    const agentName = agentNameFor(agentId);
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
    const { channel, tasks: taskDefs, assignee } = req.body;
    const agentName = agentNameFor(agentId);
    const workspaceId = ctx.workspaceIdFromAgent(agentId);
    const { channelName, channelType } = ctx.parseTarget(channel, agentName);
    const ch = await ctx.findOrCreateChannel(channelName, channelType, workspaceId);

    // Resolve assignee (if provided) to agent id
    let assigneeId = null;
    let assigneeName = null;
    if (assignee) {
      const clean = String(assignee).replace(/^@/, "").trim();
      // Search agentConfigs and store.agents for a matching name
      const lowered = clean.toLowerCase();
      const cfgMatch = ctx.agentConfigs.find((c) => {
        if ((c.workspaceId || ctx.DEFAULT_WORKSPACE_ID) !== workspaceId) return false;
        return (c.name || "").toLowerCase() === lowered || (c.displayName || "").toLowerCase() === lowered;
      });
      if (cfgMatch) {
        assigneeId = cfgMatch.id;
        assigneeName = cfgMatch.name || cfgMatch.displayName;
      } else {
        for (const [id, a] of Object.entries(ctx.store.agents)) {
          if (ctx.workspaceIdFromAgent(id) !== workspaceId) continue;
          if ((a.name || "").toLowerCase() === lowered || (a.displayName || "").toLowerCase() === lowered) {
            assigneeId = id;
            assigneeName = a.name || a.displayName || id;
            break;
          }
        }
      }
      if (!assigneeId) {
        return res.status(404).json({ error: `assignee_not_found: no agent named "${clean}" in this workspace` });
      }
    }

    const created = [];
    for (const td of taskDefs) {
      const taskNum = ctx.nextTaskNum();
      const msgId = uuidv4();
      const task = {
        taskNumber: taskNum,
        workspaceId,
        channelId: ch.id,
        channelName: ch.name,
        title: td.title,
        status: assigneeName ? "in_progress" : "todo",
        messageId: msgId,
        claimedByName: assigneeName || null,
        claimedByType: assigneeName ? "agent" : null,
        createdByName: agentName,
      };
      ctx.store.tasks.push(task);
      const msg = {
        id: msgId,
        seq: ctx.nextSeq(),
        workspaceId,
        channelId: ch.id,
        channelName: ch.name,
        channelType,
        threadId: null,
        senderName: "system",
        senderType: "system",
        content: assigneeName
          ? `📋 New task #${taskNum}: ${td.title} (assigned to @${assigneeName})`
          : `📋 New task #${taskNum}: ${td.title}`,
        createdAt: ctx.now(),
        attachments: [],
        taskNumber: taskNum,
        taskStatus: assigneeName ? "in_progress" : "todo",
      };
      ctx.appendMessage(msg);
      await ctx.db.saveTask(task);
      await ctx.db.saveMessage(msg);
      ctx.broadcastToWeb({ type: "message", workspaceId, message: ctx.formatMessageForClient(msg) });

      // If assignee is set: wake them with a DM about the assigned task
      if (assigneeId && assigneeName) {
        const dmChannelName = `dm:${[agentName, assigneeName].sort().join(",")}`;
        const dmCh = await ctx.findOrCreateChannel(dmChannelName, "dm", workspaceId);
        const dmMsg = {
          id: uuidv4(),
          seq: ctx.nextSeq(),
          workspaceId,
          channelId: dmCh.id,
          channelName: dmCh.name,
          channelType: "dm",
          threadId: null,
          senderName: agentName,
          senderType: "agent",
          content: `You've been assigned task #${taskNum} in #${ch.name}: "${td.title}". Please claim it (if not already) and start working on it. Reply here when done or if you need clarification.`,
          createdAt: ctx.now(),
          attachments: [],
        };
        ctx.appendMessage(dmMsg);
        await ctx.db.saveMessage(dmMsg);
        ctx.deliverToAllAgents(dmMsg, agentId).catch(() => {});
        ctx.broadcastToWeb({ type: "message", workspaceId, message: ctx.formatMessageForClient(dmMsg) });
      }

      created.push({ taskNumber: taskNum, messageId: msgId, title: td.title, assignedTo: assigneeName || null });
    }
    res.json({ tasks: created });
  });

  // claim_tasks
  router.post("/:agentId/tasks/claim", async (req, res) => {
    const { agentId } = req.params;
    const { channel, task_numbers, message_ids } = req.body;
    const agentName = agentNameFor(agentId);
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
      const agentName = agentNameFor(agentId);
      const emoji = status === "done" ? "✅" : status === "in_review" ? "👀" : "🔄";
      const chPayload = ctx.taskChannelPayload(task);
      const msg = { id: uuidv4(), seq: ctx.nextSeq(), ...chPayload, threadId: null, senderName: "system", senderType: "system", content: `${emoji} ${agentName} moved #${task_number} "${task.title}" to ${status}`, createdAt: ctx.now(), attachments: [], taskNumber: task_number, taskStatus: status };
      ctx.appendMessage(msg);
      await ctx.db.saveMessage(msg);
      ctx.broadcastToWeb({ type: "message", workspaceId: msg.workspaceId || workspaceId, message: ctx.formatMessageForClient(msg) });

      // Result-collection contract: if the task creator is an agent (and not
      // the same agent who just updated status), notify them via DM.
      if (task.createdByName && task.createdByName !== agentName && (status === "done" || status === "in_review")) {
        const creatorLowered = task.createdByName.toLowerCase();
        let creatorId = null;
        const cfgMatch = ctx.agentConfigs.find((c) => {
          if ((c.workspaceId || ctx.DEFAULT_WORKSPACE_ID) !== workspaceId) return false;
          return (c.name || "").toLowerCase() === creatorLowered || (c.displayName || "").toLowerCase() === creatorLowered;
        });
        if (cfgMatch) {
          creatorId = cfgMatch.id;
        } else {
          for (const [id, a] of Object.entries(ctx.store.agents)) {
            if (ctx.workspaceIdFromAgent(id) !== workspaceId) continue;
            if ((a.name || "").toLowerCase() === creatorLowered || (a.displayName || "").toLowerCase() === creatorLowered) {
              creatorId = id;
              break;
            }
          }
        }
        if (creatorId) {
          const dmChannelName = `dm:${[task.createdByName, agentName].sort().join(",")}`;
          const dmCh = await ctx.findOrCreateChannel(dmChannelName, "dm", workspaceId);
          const dmMsg = {
            id: uuidv4(),
            seq: ctx.nextSeq(),
            workspaceId,
            channelId: dmCh.id,
            channelName: dmCh.name,
            channelType: "dm",
            threadId: null,
            senderName: agentName,
            senderType: "agent",
            content: `Task #${task_number} "${task.title}" was moved to ${status} by @${agentName}.${status === "done" ? " The work is complete." : " It is ready for review."}`,
            createdAt: ctx.now(),
            attachments: [],
          };
          ctx.appendMessage(dmMsg);
          await ctx.db.saveMessage(dmMsg);
          ctx.deliverToAllAgents(dmMsg, agentId).catch(() => {});
          ctx.broadcastToWeb({ type: "message", workspaceId, message: ctx.formatMessageForClient(dmMsg) });
        }
      }
    }
    res.json({ success: true });
  });

  // resolve-channel
  router.post("/:agentId/resolve-channel", async (req, res) => {
    const { agentId } = req.params;
    const agentName = agentNameFor(agentId);
    const workspaceId = ctx.workspaceIdFromAgent(agentId);
    const { target } = req.body;
    const { channelName, channelType } = ctx.parseTarget(target, agentName);
    const ch = await ctx.findOrCreateChannel(channelName, channelType, workspaceId);
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
