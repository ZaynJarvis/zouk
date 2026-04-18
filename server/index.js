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

function gravatarUrl(email) {
  if (!email) return null;
  const hash = crypto.createHash("md5").update(email.trim().toLowerCase()).digest("hex");
  return `https://www.gravatar.com/avatar/${hash}?s=128&d=identicon`;
}

const PORT = process.env.PORT || 7777;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const googleClient = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;
const PUBLIC_URL = process.env.PUBLIC_URL || `http://localhost:${PORT}`;
const CONFIG_DIR = path.join(__dirname, "..", "data");
const AGENT_CONFIGS_FILE = path.join(CONFIG_DIR, "agent-configs.json");
const MACHINE_KEYS_FILE = path.join(CONFIG_DIR, "machine-keys.json");
const SESSIONS_FILE = path.join(CONFIG_DIR, "sessions.json");

// ─── Agent config persistence ────────────────────────────────────

if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });

function loadAgentConfigs() {
  try {
    if (fs.existsSync(AGENT_CONFIGS_FILE)) {
      return JSON.parse(fs.readFileSync(AGENT_CONFIGS_FILE, "utf8"));
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

// Stable fingerprint for machine binding: SHA-256(hostname:os)
function computeMachineFingerprint(hostname, os) {
  const input = [hostname, os].filter(Boolean).join(':').toLowerCase();
  return crypto.createHash('sha256').update(input).digest('hex');
}

// Whether this is a debug/dev key (not subject to machine binding)
function isDebugKey(key) {
  return key === "1007" || key === "test";
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
  attachments: {}, // id -> { filename, buffer, contentType }
  agentReadSeq: {}, // agentId -> last seq delivered/read
  seq: 0,
  taskSeq: 0,
};

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
  if (type === "dm") {
    return {
      id: `dm-${name}`,
      name,
      description: "",
      type: "dm",
      members: [],
    };
  }

  let ch = store.channels.find((c) => c.name === name);
  if (!ch) {
    ch = { id: `ch-${uuidv4().substring(0, 8)}`, name, description: "", type: type || "channel", members: [] };
    store.channels.push(ch);
    db.saveChannel(ch);
  }
  return ch;
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

function formatMessageForClient(msg, viewerName) {
  const isThread = !!msg.threadId;
  // For DMs: if viewerName provided, show peer name; otherwise include dm_parties
  const resolveDmName = (name) => {
    if (!viewerName) return name; // canonical name stays, frontend resolves
    return dmPeerFrom(name, viewerName);
  };
  const parties = msg.channelType === "dm" ? dmChannelParties(msg.channelName) : null;
  return {
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

function sendAgentStop(agentId, preferredWs = null) {
  const targets = new Set();
  if (preferredWs?.readyState === 1) targets.add(preferredWs);
  const directWs = daemonSockets.get(agentId);
  if (directWs?.readyState === 1) targets.add(directWs);
  for (const ws of daemonConnections) {
    if (ws.readyState === 1) targets.add(ws);
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
    if (ws.readyState === 1) ws.send(data);
  }
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
    // Mark this message as delivered so check_messages won't return it again
    store.agentReadSeq[agentId] = Math.max(store.agentReadSeq[agentId] || 0, message.seq);
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
  const dmPeer = message.channelType === "dm" ? message.channelName.replace(/^dm-/, "") : null;

  for (const agentId of Object.keys(store.agents)) {
    if (excludeAgent && agentId === excludeAgent) continue;
    const agent = store.agents[agentId];
    if (!agent || agent.status !== "active") continue;

    if (dmPeer) {
      const isDmTarget = agent.name === dmPeer || agent.displayName === dmPeer;
      if (!isDmTarget) continue;
    }

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

const uploadDir = path.join(__dirname, "..", "uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

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
    attachments: (attachmentIds || []).map((aid) => store.attachments[aid] ? { id: aid, filename: store.attachments[aid].filename } : { id: aid, filename: "unknown" }),
  };
  store.messages.push(msg);
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
  // Return only messages after the agent's last read seq, excluding agent's own messages
  const unread = store.messages
    .filter((m) => m.seq > lastRead && m.senderName !== (agentPayload(agentId)?.name || agentId))
    .map((m) => formatMessageForAgent(m, agentId));
  // Update read position
  if (store.messages.length > 0) {
    store.agentReadSeq[agentId] = store.messages[store.messages.length - 1].seq;
  }
  res.json({ messages: unread });
});

// list_server
app.get("/internal/agent/:agentId/server", (req, res) => {
  const channels = store.channels
    .filter((ch) => (ch.type || "channel") === "channel")
    .map((ch) => ({
      name: ch.name,
      description: ch.description || "",
      joined: true,
    }));
  const agents = Object.keys(store.agents).map((id) => {
    const p = agentPayload(id);
    return { name: p?.name || id, status: p?.status || "inactive" };
  });
  res.json({ channels, agents, humans: store.humans });
});

// read_history
app.get("/internal/agent/:agentId/history", (req, res) => {
  const { agentId } = req.params;
  const { channel, limit = 50, before, after, around } = req.query;
  const agentName = store.agents[agentId]?.name || agentId;
  let msgs = store.messages.filter((m) => matchesTarget(m, channel, agentName));
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
  let msgs = store.messages;
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
    store.messages.push(msg);
    db.saveMessage(msg);
    broadcastToWeb({ type: "message", message: formatMessageForClient(msg) });

    return { taskNumber: taskNum, messageId: msgId, title: td.title };
  });

  res.json({ tasks: created });
});

// claim_tasks
app.post("/internal/agent/:agentId/tasks/claim", (req, res) => {
  const { agentId } = req.params;
  const { channel, task_numbers, message_ids } = req.body;
  const agentName = store.agents[agentId]?.name || agentId;

  // Resolve tasks from both task_numbers and message_ids
  const tasksToProcess = [];
  if (task_numbers) {
    for (const num of task_numbers) {
      const task = store.tasks.find((t) => t.taskNumber === num);
      tasksToProcess.push({ task, taskNumber: num });
    }
  }
  if (message_ids) {
    for (const mid of message_ids) {
      const task = store.tasks.find((t) => t.messageId === mid);
      tasksToProcess.push({ task, messageId: mid, taskNumber: task?.taskNumber });
    }
  }

  const results = tasksToProcess.map(({ task, taskNumber, messageId }) => {
    if (!task) return { taskNumber, messageId, success: false, reason: "task not found" };
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
    store.messages.push(msg);
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
    store.messages.push(msg);
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
app.post("/internal/agent/:agentId/upload", upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file" });
  const id = uuidv4();
  store.attachments[id] = {
    filename: req.file.originalname,
    buffer: req.file.buffer,
    contentType: req.file.mimetype,
  };
  res.json({ id, filename: req.file.originalname, sizeBytes: req.file.size });
});

// view_file (attachment download)
app.get("/api/attachments/:attachmentId", (req, res) => {
  const att = store.attachments[req.params.attachmentId];
  if (!att) return res.status(404).json({ error: "Not found" });
  res.set("Content-Type", att.contentType);
  res.send(att.buffer);
});

// ─── Web API: for the frontend ────────────────────────────────────

// Auth middleware: blocks guest (unauthenticated) users from write operations
function requireAuth(req, res, next) {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (token && authSessions.has(token)) return next();
  return res.status(403).json({ error: "Authentication required. Sign in with Google to perform this action." });
}

// Send message from web UI (human user)
app.post("/api/messages", requireAuth, (req, res) => {
  // Prefer the authenticated user's name over any body field so a stale client
  // state can't pollute canonical DM channel names (would split PM threads).
  // Falls back to the legacy body.senderName, then to "local-user" for tooling.
  const token = req.headers.authorization?.replace("Bearer ", "");
  const authedName = token ? authSessions.get(token)?.name : null;
  const { target, content, senderName: bodyName } = req.body;
  const senderName = authedName || bodyName || "local-user";
  const { channelName, channelType, threadId, dmPeer } = parseTarget(target, senderName);
  const ch = findOrCreateChannel(channelName, channelType);

  const msg = {
    id: uuidv4(),
    seq: nextSeq(),
    channelId: ch.id,
    channelName,
    channelType,
    threadId: threadId || null,
    senderName,
    senderType: "human",
    content,
    createdAt: now(),
    attachments: [],
  };
  store.messages.push(msg);
  db.saveMessage(msg);

  // For DMs, deliver only to the target agent; for channels, deliver to all
  if (channelType === "dm" && dmPeer) {
    for (const [agentId, agent] of Object.entries(store.agents)) {
      if (agent.name === dmPeer || agent.displayName === dmPeer) {
        deliverToAgent(agentId, msg);
        break;
      }
    }
  } else {
    deliverToAllAgents(msg);
  }
  // Broadcast to web UI (no viewerName — includes dmParties for frontend to resolve)
  broadcastToWeb({ type: "message", message: formatMessageForClient(msg) });

  res.json({ messageId: msg.id, message: msg });
});

// Get messages for a channel
// The Cloudflare proxy rewrites both query strings AND path segments during
// its 307 redirect chain, so the primary web client passes the channel target
// in request headers (X-Channel, X-Limit, X-Sender) which survive untouched.
// Query-string fallback kept for backward compat (curl, daemon internal API).
app.get("/api/messages", (req, res) => {
  const channel = req.headers["x-channel"] || req.query.channel || "#all";
  const limit = req.headers["x-limit"] || req.query.limit || 100;
  const sender = req.headers["x-sender"] || req.query.sender || null;
  const msgs = store.messages
    .filter((m) => matchesTarget(m, channel, sender))
    .slice(-parseInt(limit));
  res.json({ messages: msgs.map((m) => formatMessageForClient(m, sender)) });
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
    agentConfigs[existing] = { ...agentConfigs[existing], ...config };
  } else {
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
    agentConfigs.push({
      id,
      name: running.name,
      displayName: running.displayName,
      runtime: running.runtime,
      model: running.model,
      workDir: running.workDir,
    });
    idx = agentConfigs.length - 1;
  }
  agentConfigs[idx] = { ...agentConfigs[idx], ...updates };
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
  purgeUnknownAgentState(id);
  broadcastToWeb({ type: "agent_status", agentId: id, status: "deleted" });
  broadcastToWeb({ type: "config_updated", configs: agentConfigs });
  res.json({ success: true });
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

// Revoke a machine API key
app.delete("/api/machine-keys/:id", requireAuth, async (req, res) => {
  const { id } = req.params;
  const key = machineKeys.find((k) => k.id === id);
  if (!key) return res.status(404).json({ error: "Key not found" });
  key.revokedAt = now();
  saveMachineKeys(machineKeys);
  await db.saveMachineKey(key);
  console.log(`[keys] Revoked machine key "${key.name}"`);
  res.json({ success: true });
});

// ─── Agent lifecycle ─────────────────────────────────────────────

function startAgentOnDaemon(id, config) {
  const runtime = config.runtime || "claude";
  const requestedMachineId = config.machineId;

  // Find the target daemon: prefer the one matching machineId, fall back to first with runtime
  let targetWs = null;
  for (const ws of daemonConnections) {
    if (ws.readyState === 1 && ws._runtimes?.includes(runtime)) {
      if (!requestedMachineId || ws._machineId === requestedMachineId) {
        targetWs = ws;
        break;
      }
    }
  }
  // If a specific machine was requested but not found, fall back to any daemon with the runtime
  if (!targetWs && requestedMachineId) {
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
    workDir: config.workDir || process.cwd(),
    status: "starting",
    machineId: targetWs._machineId,
  });

  // Send agent:start to daemon — read from config (source of truth),
  // not store.agents (which may have fallback values).
  targetWs.send(JSON.stringify({
    type: "agent:start",
    agentId: id,
    launchId: uuidv4(),
    config: {
      runtime,
      model: config.model,
      workDir: config.workDir || store.agents[id].workDir,
      systemPrompt: config.systemPrompt || config.description || "",
      serverUrl: PUBLIC_URL,
      authToken: "test",
      name: config.name || id,
      displayName: config.displayName || config.name || id,
      description: config.description || "",
    },
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
      workDir: config.workDir || store.agents[id].workDir,
      machineId: targetWs._machineId,
      autoStart: true,
    };
    agentConfigs.push(persisted);
    saveAgentConfigs(agentConfigs);
    db.saveAgentConfig(persisted);
  }

  broadcastToWeb({ type: "agent_started", agent: agentPayload(id) });
  broadcastToWeb({ type: "config_updated", configs: agentConfigs });
  console.log(`[api] Starting agent ${id} (runtime: ${runtime}) on daemon`);
  return { agentId: id, status: "starting" };
}

// Start an agent
app.post("/api/agents/start", requireAuth, (req, res) => {
  const config = req.body;
  const id = config.agentId || config.id || `agent-${uuidv4().substring(0, 8)}`;

  // If starting from a saved config, look it up
  const savedConfig = agentConfigs.find((c) => c.id === id);
  const mergedConfig = { ...savedConfig, ...config };

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
    const wsAuthenticated = !!(wsToken && authSessions.has(wsToken));
    wss.handleUpgrade(request, socket, head, (ws) => {
      handleWebConnection(ws, wsAuthenticated);
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
  const machineId = uuidv4();
  ws._machineId = machineId;
  machines.set(machineId, { id: machineId, hostname: 'unknown', os: 'unknown', runtimes: [], capabilities: [], connectedAt: now(), agentIds: [] });
  broadcastToWeb({ type: 'machine:connected', machine: machines.get(machineId) });

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
    machines.delete(ws._machineId);
    broadcastToWeb({ type: 'machine:disconnected', machineId: ws._machineId });
    for (const agentId of connectedAgents) {
      if (store.agents[agentId]) {
        store.agents[agentId].status = "inactive";
        daemonSockets.delete(agentId);
        broadcastToWeb({ type: "agent_status", agentId, status: "inactive" });
      }
    }
  });

  // Send ping periodically
  const pingInterval = setInterval(() => {
    if (ws.readyState === 1) {
      ws.send(JSON.stringify({ type: "ping" }));
    }
  }, 30000);
  ws.on("close", () => clearInterval(pingInterval));
}

function handleDaemonMessage(ws, msg, connectedAgents) {
  switch (msg.type) {
    case "ready": {
      console.log(`[daemon] Ready. Runtimes: ${msg.runtimes?.join(", ")}. Agents: ${msg.runningAgents?.join(", ") || "none"}`);
      ws._runtimes = msg.runtimes || [];
      // Update machine record with real info from daemon
      const machine = machines.get(ws._machineId);
      if (machine) {
        machine.hostname = msg.hostname || 'unknown';
        machine.os = msg.os || 'unknown';
        machine.runtimes = msg.runtimes || [];
        machine.capabilities = msg.capabilities || [];
        broadcastToWeb({ type: 'machine:updated', machine });
      }
      // Machine binding: silently bind or reject based on hostname:os fingerprint
      if (!isDebugKey(ws._apiKey)) {
        const keyRecord = machineKeys.find((k) => k.rawKey === ws._apiKey);
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
            sendAgentStop(agentId, ws);
            continue;
          }
          connectedAgents.add(agentId);
          daemonSockets.set(agentId, ws);
          const isNew = !store.agents[agentId];
          if (isNew) {
            store.agents[agentId] = buildRuntimeAgent(agentId, { status: "active" });
          } else {
            // Refresh config fields on existing agents — they may still
            // have stale/fallback values from before configs were loaded.
            const cfg = agentConfigs.find((c) => c.id === agentId);
            if (cfg) syncRuntimeAgentFromConfig(agentId, cfg);
          }
          store.agents[agentId].status = "active";
          broadcastToWeb({ type: "agent_started", agent: agentPayload(agentId) });
          replayPendingDeliveries(agentId);
        }
      }
      break;
    }
    case "agent:status": {
      const { agentId, status } = msg;
      if (!hasKnownAgentConfig(agentId)) {
        purgeUnknownAgentState(agentId);
        sendAgentStop(agentId, ws);
        break;
      }
      const isNew = !store.agents[agentId];
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
      // Track agent in machine record
      const machine = machines.get(ws._machineId);
      if (machine && !machine.agentIds.includes(agentId)) {
        machine.agentIds.push(agentId);
      }
      if (isNew) {
        broadcastToWeb({ type: "agent_started", agent: agentPayload(agentId) });
      } else {
        broadcastToWeb({ type: "agent_status", agentId, status });
      }
      if (status === "active") {
        replayPendingDeliveries(agentId);
      }
      console.log(`[agent:${agentId}] Status: ${status}`);
      break;
    }
    case "agent:activity": {
      const { agentId, activity, detail, entries } = msg;
      if (!hasKnownAgentConfig(agentId)) {
        purgeUnknownAgentState(agentId);
        sendAgentStop(agentId, ws);
        break;
      }
      broadcastToWeb({ type: "agent_activity", agentId, activity, detail, entries });
      break;
    }
    case "agent:session": {
      const { agentId, sessionId } = msg;
      if (!hasKnownAgentConfig(agentId)) {
        purgeUnknownAgentState(agentId);
        sendAgentStop(agentId, ws);
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
      // Forward to web UI
      broadcastToWeb({ type: "workspace:file_tree", agentId: msg.agentId, dirPath: msg.dirPath, files: msg.files });
      break;
    }
    case "agent:workspace:file_content": {
      broadcastToWeb({ type: "workspace:file_content", agentId: msg.agentId, requestId: msg.requestId, content: msg.content });
      break;
    }
    case "agent:skills:list_result": {
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
  "agent:reset-workspace",
  "machine:workspace:delete",
  "machine:workspace:scan",
]);

function handleWebConnection(ws, authenticated) {
  ws._authenticated = !!authenticated;
  webSockets.add(ws);
  console.log(`[web] Client connected (authenticated: ${ws._authenticated})`);

  // Send initial state
  ws.send(JSON.stringify({
    type: "init",
    channels: store.channels.filter((ch) => (ch.type || "channel") === "channel"),
    agents: Object.keys(store.agents).map((id) => agentPayload(id)),
    humans: store.humans,
    configs: agentConfigs,
    machines: Array.from(machines.values()),
  }));

  ws.on("message", (data) => {
    try {
      const msg = JSON.parse(data);
      handleWebMessage(ws, msg);
    } catch (e) {
      console.error("[web] Invalid message:", e.message);
    }
  });

  ws.on("close", () => {
    webSockets.delete(ws);
    console.log("[web] Client disconnected");
  });
}

function handleWebMessage(ws, msg) {
  // Block write-type messages from unauthenticated (guest) connections
  if (WS_AUTH_REQUIRED_TYPES.has(msg.type) && !ws._authenticated) {
    ws.send(JSON.stringify({ type: "error", message: "Authentication required. Sign in with Google to perform this action." }));
    console.log(`[web] Blocked unauthenticated WS message: ${msg.type}`);
    return;
  }

  switch (msg.type) {
    case "workspace:list": {
      const agentWs = daemonSockets.get(msg.agentId);
      if (agentWs && agentWs.readyState === 1) {
        agentWs.send(JSON.stringify({ type: "agent:workspace:list", agentId: msg.agentId, dirPath: msg.dirPath || null }));
      }
      break;
    }
    case "workspace:read": {
      const agentWs = daemonSockets.get(msg.agentId);
      if (agentWs && agentWs.readyState === 1) {
        agentWs.send(JSON.stringify({ type: "agent:workspace:read", agentId: msg.agentId, requestId: msg.requestId || uuidv4(), path: msg.path }));
      }
      break;
    }
    case "agent:start": {
      // Trigger agent start via daemon — find a daemon with the right runtime
      let targetWs = daemonSockets.get(msg.agentId); // try existing agent socket first
      if (!targetWs) {
        for (const dws of daemonConnections) {
          if (dws.readyState === 1) { targetWs = dws; break; }
        }
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
    case "agent:reset-workspace": {
      const agentWs = daemonSockets.get(msg.agentId);
      if (agentWs && agentWs.readyState === 1) {
        agentWs.send(JSON.stringify({ type: "agent:reset-workspace", agentId: msg.agentId }));
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
    const sessionToken = crypto.randomBytes(32).toString("hex");
    // Use email prefix as default display name (e.g. "zaynjarvis" from "zaynjarvis@gmail.com")
    const emailPrefix = payload.email.split("@")[0];
    const grav = gravatarUrl(payload.email);
    const user = {
      name: emailPrefix,
      email: payload.email,
      picture: payload.picture || null,
      gravatarUrl: grav,
    };
    authSessions.set(sessionToken, user);
    persistSession(sessionToken, user).catch(e => console.warn("[auth] persistSession error:", e.message));

    // Register as human if not already present
    const existingHuman = store.humans.find((h) => h.name === user.name);
    if (existingHuman) {
      if (user.picture) existingHuman.picture = user.picture;
      existingHuman.gravatarUrl = grav;
      existingHuman.guest = false;
    } else {
      store.humans.push({ name: user.name, picture: user.picture || undefined, gravatarUrl: grav });
    }
    broadcastToWeb({ type: "humans_updated", humans: store.humans });

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
  // Update human record
  const human = store.humans.find((h) => h.name === oldName);
  // Ensure gravatarUrl is set if user has email
  if (!user.gravatarUrl && user.email) {
    user.gravatarUrl = gravatarUrl(user.email);
  }
  if (human) {
    human.name = trimmed;
    human.picture = user.picture || undefined;
    human.gravatarUrl = user.gravatarUrl || undefined;
  } else if (!store.humans.find((h) => h.name === trimmed)) {
    store.humans.push({ name: trimmed, picture: user.picture || undefined, gravatarUrl: user.gravatarUrl || undefined });
  }
  db.saveSession(token, user).catch(e => console.warn("[auth] saveSession error:", e.message));
  broadcastToWeb({ type: "humans_updated", humans: store.humans });
  res.json({ user });
});

app.get("/api/auth/config", (_req, res) => {
  res.json({ googleClientId: GOOGLE_CLIENT_ID || null });
});

// Register an unauthenticated guest identity so they surface in humans[] for
// other connected clients. Guests can't write (requireAuth blocks /api/messages
// et al.), so this is presence-only. Idempotent — repeated calls with the same
// name don't duplicate.
app.post("/api/auth/guest-session", (req, res) => {
  const { name } = req.body || {};
  if (!name || typeof name !== "string" || !name.trim()) {
    return res.status(400).json({ error: "name required" });
  }
  const trimmed = name.trim();
  if (trimmed.length > 100) return res.status(400).json({ error: "name too long (max 100)" });
  const existing = store.humans.find((h) => h.name === trimmed);
  let changed = false;
  if (!existing) {
    store.humans.push({ name: trimmed, guest: true });
    changed = true;
  } else if (existing.guest === undefined) {
    // Legacy row — don't overwrite an authenticated user with guest=true
  }
  if (changed) {
    broadcastToWeb({ type: "humans_updated", humans: store.humans });
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

    const [maxSeq, maxTaskNum, msgs, channels, tasks, dbConfigs, dbKeys] = await Promise.all([
      db.loadMaxSeq(),
      db.loadMaxTaskNum(),
      db.loadMessages(),
      db.loadChannels(),
      db.loadTasks(),
      db.loadAgentConfigs(),
      db.loadMachineKeys(),
    ]);

    if (maxSeq > store.seq) store.seq = maxSeq;
    if (maxTaskNum > store.taskSeq) store.taskSeq = maxTaskNum;

    if (msgs.length > 0) {
      store.messages = msgs;
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
  reconcileAgentsWithConfigs();

  server.listen(PORT, () => {
    console.log(`\n🚀 Zouk server running on ${PUBLIC_URL}`);
    console.log(`\n  Daemon endpoint:  ws://localhost:${PORT}/daemon/connect?key=test`);
    console.log(`  Web UI endpoint:  ws://localhost:${PORT}/ws`);
    console.log(`  REST API:         ${PUBLIC_URL}/internal/agent/{id}/...`);
    console.log(`\nTo connect a daemon:`);
    console.log(`  npx @slock-ai/daemon@latest --server-url ${PUBLIC_URL} --api-key <api_key>`);
    console.log(`  Generate additional keys via POST /api/machine-keys or the Machine Setup UI.`);
    if (!process.env.NODE_ENV?.startsWith("prod")) {
      console.log(`  Dev mode: key "test" is also accepted without registration.\n`);
    }
  });
})();
