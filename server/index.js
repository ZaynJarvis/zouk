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

const PORT = process.env.PORT || 7777;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const googleClient = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;
const PUBLIC_URL = process.env.PUBLIC_URL || `http://localhost:${PORT}`;
const CONFIG_DIR = path.join(__dirname, "..", "data");
const AGENT_CONFIGS_FILE = path.join(CONFIG_DIR, "agent-configs.json");
const MACHINE_KEYS_FILE = path.join(CONFIG_DIR, "machine-keys.json");

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
  // Default debug key — always accepted, never shown in UI
  if (key === "1007") return true;
  // Allow "test" key in development
  if (key === "test" && !process.env.NODE_ENV?.startsWith("prod")) return true;
  return machineKeys.some((k) => k.rawKey === key && !k.revokedAt);
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
  humans: [{ name: "local-user" }],
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
  }
  return ch;
}

function parseTarget(target) {
  // "#channel", "dm:@user", "#channel:shortid", "dm:@user:shortid"
  if (!target) return { channelName: "all", channelType: "channel", threadId: null };
  if (target.startsWith("dm:")) {
    const parts = target.substring(3).split(":");
    const peer = parts[0].replace("@", "");
    return { channelName: `dm-${peer}`, channelType: "dm", threadId: parts[1] || null, dmPeer: peer };
  }
  const parts = target.substring(1).split(":");
  return { channelName: parts[0], channelType: "channel", threadId: parts[1] || null };
}

function formatTarget(channelName, channelType, threadId) {
  let t = channelType === "dm" ? `dm:@${channelName.replace("dm-", "")}` : `#${channelName}`;
  if (threadId) t += `:${threadId}`;
  return t;
}

function matchesTarget(msg, target) {
  const { channelName, channelType, threadId } = parseTarget(target);
  return msg.channelName === channelName
    && msg.channelType === channelType
    && (threadId ? msg.threadId === threadId : !msg.threadId);
}

function formatMessageForClient(msg) {
  const isThread = !!msg.threadId;
  const normalizeDmName = (name) => name?.replace(/^dm-/, "") || name;
  return {
    id: msg.id,
    messageId: msg.id,
    senderName: msg.senderName,
    senderType: msg.senderType,
    channelName: isThread
      ? msg.threadId
      : (msg.channelType === "dm" ? normalizeDmName(msg.channelName) : msg.channelName),
    channelType: isThread ? "thread" : msg.channelType,
    parentChannelName: isThread
      ? (msg.channelType === "dm" ? normalizeDmName(msg.channelName) : msg.channelName)
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
  };
}

function formatMessageForAgent(msg) {
  const formatted = formatMessageForClient(msg);
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
      message: formatMessageForAgent(message),
    }));
    // Mark this message as delivered so check_messages won't return it again
    store.agentReadSeq[agentId] = Math.max(store.agentReadSeq[agentId] || 0, message.seq);
  }
}

function extractMentions(content) {
  const mentions = [];
  const regex = /@([\w-]+)/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    mentions.push(match[1]);
  }
  return mentions;
}

function deliverToAllAgents(message, excludeAgent = null) {
  const mentions = extractMentions(message.content || "");
  const hasSpecificMention = mentions.some((m) =>
    Object.values(store.agents).some((a) => a.name === m || a.displayName === m)
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
      const isTargeted = mentions.includes(agent.name) || mentions.includes(agent.displayName);
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
  const { channelName, channelType, threadId } = parseTarget(target);
  const ch = findOrCreateChannel(channelName, channelType);

  const msg = {
    id: uuidv4(),
    seq: nextSeq(),
    channelId: ch.id,
    channelName,
    channelType,
    threadId: threadId || null,
    senderName: store.agents[agentId]?.name || agentId,
    senderType: "agent",
    content,
    createdAt: now(),
    attachments: (attachmentIds || []).map((aid) => store.attachments[aid] ? { id: aid, filename: store.attachments[aid].filename } : { id: aid, filename: "unknown" }),
  };
  store.messages.push(msg);

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
    .filter((m) => m.seq > lastRead && m.senderName !== (store.agents[agentId]?.name || agentId))
    .map(formatMessageForAgent);
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
  const agents = Object.entries(store.agents).map(([id, a]) => ({
    name: a.name || id,
    status: a.status || "inactive",
  }));
  res.json({ channels, agents, humans: store.humans });
});

// read_history
app.get("/internal/agent/:agentId/history", (req, res) => {
  const { channel, limit = 50, before, after, around } = req.query;
  let msgs = store.messages.filter((m) => matchesTarget(m, channel));
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
    messages: msgs.map(formatMessageForClient),
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
  const { q, limit = 10, channel } = req.query;
  let msgs = store.messages;
  if (channel) {
    msgs = msgs.filter((m) => matchesTarget(m, channel));
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

    const msg = {
      id: uuidv4(), seq: nextSeq(),
      channelId: task.channelId, channelName: store.channels.find((c) => c.id === task.channelId)?.name || "all",
      channelType: "channel", threadId: null,
      senderName: "system", senderType: "system",
      content: `📌 ${agentName} claimed #${num} "${task.title}"`,
      createdAt: now(), attachments: [], taskNumber: num, taskStatus: "in_progress",
    };
    store.messages.push(msg);
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
    broadcastToWeb({ type: "message", message: formatMessageForClient(msg) });
  }
  res.json({ success: true });
});

// resolve-channel
app.post("/internal/agent/:agentId/resolve-channel", (req, res) => {
  const { target } = req.body;
  const { channelName, channelType } = parseTarget(target);
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

// Send message from web UI (human user)
app.post("/api/messages", (req, res) => {
  const { target, content, senderName = "local-user" } = req.body;
  const { channelName, channelType, threadId, dmPeer } = parseTarget(target);
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

  // For DMs, deliver only to the target agent; for channels, deliver to all
  if (channelType === "dm" && dmPeer) {
    // Find the agent by name or displayName
    for (const [agentId, agent] of Object.entries(store.agents)) {
      if (agent.name === dmPeer || agent.displayName === dmPeer) {
        deliverToAgent(agentId, msg);
        break;
      }
    }
  } else {
    deliverToAllAgents(msg);
  }
  // Broadcast to web UI
  broadcastToWeb({ type: "message", message: formatMessageForClient(msg) });

  res.json({ messageId: msg.id, message: msg });
});

// Get messages for a channel
app.get("/api/messages", (req, res) => {
  const { channel = "#all", limit = 100 } = req.query;
  const msgs = store.messages
    .filter((m) => matchesTarget(m, channel))
    .slice(-parseInt(limit));
  res.json({ messages: msgs.map(formatMessageForClient) });
});

// Get channels
app.get("/api/channels", (req, res) => {
  res.json({
    channels: store.channels.filter((ch) => (ch.type || "channel") === "channel"),
  });
});

// Create channel
app.post("/api/channels", (req, res) => {
  const { name, description } = req.body;
  const ch = findOrCreateChannel(name);
  ch.description = description || "";
  broadcastToWeb({ type: "channel_created", channel: ch });
  res.json({ channel: ch });
});

// List connected machines (daemons)
app.get("/api/machines", (req, res) => {
  const machineList = Array.from(machines.values()).map((m) => ({
    ...m,
    agents: m.agentIds.map((id) => ({ id, ...(store.agents[id] || {}) })).filter((a) => a.name).map((a) => ({
      id: a.id,
      name: a.name,
      displayName: a.displayName,
      runtime: a.runtime,
      model: a.model,
      status: a.status,
    })),
  }));
  res.json({ machines: machineList });
});

// Get agents (running + configs)
app.get("/api/agents", (req, res) => {
  const agents = Object.entries(store.agents).map(([id, a]) => ({
    id,
    name: a.name,
    displayName: a.displayName,
    runtime: a.runtime,
    model: a.model,
    status: a.status,
    machineId: a.machineId,
  }));
  res.json({ agents, configs: agentConfigs });
});

// ─── Agent config CRUD ───────────────────────────────────────────

// List all agent configs
app.get("/api/agent-configs", (req, res) => {
  res.json({ configs: agentConfigs });
});

// Create/save agent config
app.post("/api/agent-configs", (req, res) => {
  const config = req.body;
  if (!config.id) config.id = `agent-${uuidv4().substring(0, 8)}`;
  const existing = agentConfigs.findIndex((c) => c.id === config.id);
  if (existing >= 0) {
    agentConfigs[existing] = { ...agentConfigs[existing], ...config };
  } else {
    agentConfigs.push(config);
  }
  saveAgentConfigs(agentConfigs);
  broadcastToWeb({ type: "config_updated", configs: agentConfigs });
  res.json({ config: agentConfigs.find((c) => c.id === config.id) });
});

// Update agent config
app.put("/api/agents/:id/config", (req, res) => {
  const { id } = req.params;
  const updates = req.body;
  const idx = agentConfigs.findIndex((c) => c.id === id);
  if (idx < 0) return res.status(404).json({ error: "Config not found" });
  agentConfigs[idx] = { ...agentConfigs[idx], ...updates };
  saveAgentConfigs(agentConfigs);
  broadcastToWeb({ type: "config_updated", configs: agentConfigs });
  res.json({ config: agentConfigs[idx] });
});

// Delete agent config
app.delete("/api/agents/:id", (req, res) => {
  const { id } = req.params;
  const idx = agentConfigs.findIndex((c) => c.id === id);
  if (idx >= 0) {
    agentConfigs.splice(idx, 1);
    saveAgentConfigs(agentConfigs);
  }
  // Also clean up runtime state if agent exists
  if (store.agents[id]) {
    delete store.agents[id];
    daemonSockets.delete(id);
  }
  broadcastToWeb({ type: "config_updated", configs: agentConfigs });
  res.json({ success: true });
});

// ─── Machine API key management ─────────────────────────────────

// List machine API keys (masked)
app.get("/api/machine-keys", (req, res) => {
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
app.post("/api/machine-keys", (req, res) => {
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
  };
  machineKeys.push(keyRecord);
  saveMachineKeys(machineKeys);
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
app.delete("/api/machine-keys/:id", (req, res) => {
  const { id } = req.params;
  const key = machineKeys.find((k) => k.id === id);
  if (!key) return res.status(404).json({ error: "Key not found" });
  key.revokedAt = now();
  saveMachineKeys(machineKeys);
  console.log(`[keys] Revoked machine key "${key.name}"`);
  res.json({ success: true });
});

// ─── Agent lifecycle ─────────────────────────────────────────────

function startAgentOnDaemon(id, config) {
  const runtime = config.runtime || "claude";

  // Find a daemon that supports the requested runtime
  let targetWs = null;
  for (const ws of daemonConnections) {
    if (ws.readyState === 1 && ws._runtimes?.includes(runtime)) {
      targetWs = ws;
      break;
    }
  }
  if (!targetWs) return { error: "No daemon connected with the requested runtime" };

  // Register agent in store
  store.agents[id] = {
    name: config.name || id,
    displayName: config.displayName || config.name || id,
    runtime,
    model: config.model || (runtime === "claude" ? "claude-sonnet-4-20250514" : "default"),
    status: "starting",
    workDir: config.workDir || process.cwd(),
  };

  // Send agent:start to daemon
  targetWs.send(JSON.stringify({
    type: "agent:start",
    agentId: id,
    launchId: uuidv4(),
    config: {
      runtime,
      model: store.agents[id].model,
      workDir: store.agents[id].workDir,
      systemPrompt: config.systemPrompt || "",
      serverUrl: PUBLIC_URL,
      authToken: "test",
      name: store.agents[id].name,
      displayName: store.agents[id].displayName,
      description: config.description || "",
    },
  }));

  daemonSockets.set(id, targetWs);
  broadcastToWeb({ type: "agent_status", agentId: id, status: "starting" });
  console.log(`[api] Starting agent ${id} (runtime: ${runtime}) on daemon`);
  return { agentId: id, status: "starting" };
}

// Start an agent
app.post("/api/agents/start", (req, res) => {
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
app.post("/api/agents/:id/stop", (req, res) => {
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
      console.log(`[auto-start] Failed to start ${config.id}: ${result.error}`);
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
      console.log(`[daemon] Rejected connection: invalid API key (${apiKey?.substring(0, 12)}...)`);
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }
    // Track key usage
    const keyRecord = machineKeys.find((k) => k.rawKey === apiKey);
    if (keyRecord) {
      keyRecord.lastUsedAt = now();
      saveMachineKeys(machineKeys);
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      handleDaemonConnection(ws, apiKey);
    });
  } else if (parsed.pathname === "/ws") {
    // Web UI WebSocket connection
    wss.handleUpgrade(request, socket, head, (ws) => {
      handleWebConnection(ws);
    });
  } else {
    socket.destroy();
  }
});

function handleDaemonConnection(ws, apiKey) {
  console.log(`[daemon] Connected with key: ${apiKey?.substring(0, 8)}...`);
  let connectedAgents = new Set();
  daemonConnections.add(ws);
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
      // Auto-start configured agents after a short delay
      setTimeout(() => autoStartAgents(), 1000);
      // Register any running agents
      if (msg.runningAgents) {
        for (const agentId of msg.runningAgents) {
          connectedAgents.add(agentId);
          daemonSockets.set(agentId, ws);
          if (!store.agents[agentId]) {
            store.agents[agentId] = { name: agentId, displayName: agentId, runtime: "claude", model: "unknown", status: "active" };
          }
          store.agents[agentId].status = "active";
          broadcastToWeb({ type: "agent_status", agentId, status: "active" });
        }
      }
      break;
    }
    case "agent:status": {
      const { agentId, status } = msg;
      connectedAgents.add(agentId);
      daemonSockets.set(agentId, ws);
      if (!store.agents[agentId]) {
        store.agents[agentId] = { name: agentId, displayName: agentId, runtime: "claude", model: "unknown", status, machineId: ws._machineId };
      }
      store.agents[agentId].status = status;
      store.agents[agentId].machineId = ws._machineId;
      // Track agent in machine record
      const machine = machines.get(ws._machineId);
      if (machine && !machine.agentIds.includes(agentId)) {
        machine.agentIds.push(agentId);
      }
      broadcastToWeb({ type: "agent_status", agentId, status });
      console.log(`[agent:${agentId}] Status: ${status}`);
      break;
    }
    case "agent:activity": {
      const { agentId, activity, detail, entries } = msg;
      broadcastToWeb({ type: "agent_activity", agentId, activity, detail, entries });
      break;
    }
    case "agent:session": {
      const { agentId, sessionId } = msg;
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
    case "pong": {
      // Heartbeat response, no-op
      break;
    }
    default: {
      console.log(`[daemon] Unknown message type: ${msg.type}`);
    }
  }
}

function handleWebConnection(ws) {
  webSockets.add(ws);
  console.log("[web] Client connected");

  // Send initial state
  ws.send(JSON.stringify({
    type: "init",
    channels: store.channels.filter((ch) => (ch.type || "channel") === "channel"),
    agents: Object.entries(store.agents).map(([id, a]) => ({ id, ...a })),
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

// In-memory session store: token -> { name, email, picture }
const authSessions = new Map();

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
    const user = {
      name: payload.name || payload.email.split("@")[0],
      email: payload.email,
      picture: payload.picture || null,
    };
    authSessions.set(sessionToken, user);

    // Register as human if not already present
    if (!store.humans.find((h) => h.name === user.name)) {
      store.humans.push({ name: user.name });
    }

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
  if (token) authSessions.delete(token);
  res.json({ ok: true });
});

app.get("/api/auth/config", (_req, res) => {
  res.json({ googleClientId: GOOGLE_CLIENT_ID || null });
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

// ─── Start ────────────────────────────────────────────────────────

server.listen(PORT, () => {
  console.log(`\n🚀 Zouk server running on ${PUBLIC_URL}`);
  console.log(`\n  Daemon endpoint:  ws://localhost:${PORT}/daemon/connect?key=test`);
  console.log(`  Web UI endpoint:  ws://localhost:${PORT}/ws`);
  console.log(`  REST API:         ${PUBLIC_URL}/internal/agent/{id}/...`);
  console.log(`\nTo connect a daemon:`);
  console.log(`  npx @slock-ai/daemon@latest --server-url ${PUBLIC_URL} --api-key 1007`);
  console.log(`\n  Default debug key "1007" is always accepted.`);
  console.log(`  Generate additional keys via POST /api/machine-keys or the Machine Setup UI.`);
  if (!process.env.NODE_ENV?.startsWith("prod")) {
    console.log(`  Dev mode: key "test" is also accepted without registration.\n`);
  }
});
