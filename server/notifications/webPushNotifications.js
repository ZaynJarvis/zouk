const DEFAULT_WORKSPACE_ID = "default";

function normalizeName(value) {
  return String(value || "").trim().toLowerCase();
}

function dmPartiesFromMessage(message) {
  const parties = message?.dmParties || message?.dm_parties;
  if (Array.isArray(parties)) return parties.map(String).filter(Boolean);
  const channelName = message?.channelName || message?.channel_name || "";
  if (typeof channelName === "string" && channelName.startsWith("dm:")) {
    return channelName.substring(3).split(",").map((p) => p.trim()).filter(Boolean);
  }
  return [];
}

function extractAtMentions(content) {
  const mentions = [];
  const regex = /@([\p{L}\p{N}_-]+)/gu;
  let match;
  while ((match = regex.exec(String(content || ""))) !== null) {
    mentions.push(normalizeName(match[1]));
  }
  return mentions;
}

function mentionAliases(userName, userEmail) {
  const aliases = new Set();
  const add = (value) => {
    const trimmed = String(value || "").trim();
    if (!trimmed) return;
    aliases.add(normalizeName(trimmed));
    aliases.add(normalizeName(trimmed.replace(/\s+/g, "_")));
  };
  add(userName);
  const email = String(userEmail || "").trim();
  if (email.includes("@")) add(email.split("@")[0]);
  return aliases;
}

function mentionsUser(content, userName, userEmail) {
  const aliases = mentionAliases(userName, userEmail);
  if (aliases.size === 0) return false;
  return extractAtMentions(content).some((mention) => aliases.has(mention));
}

function messageTargetsUser(message, user, { notifyAllChannelMessages = false } = {}) {
  if (!message || !user?.name) return false;
  if (normalizeName(message.senderName || message.sender_name) === normalizeName(user.name)) return false;
  if ((message.senderType || message.sender_type) === "system") return false;

  const channelType = message.channelType || message.channel_type || "channel";
  const parentChannelType = message.parentChannelType || message.parent_channel_type || null;
  const isDm = channelType === "dm" || parentChannelType === "dm";
  if (isDm) {
    const parties = dmPartiesFromMessage(message).map(normalizeName);
    return parties.includes(normalizeName(user.name));
  }

  if (mentionsUser(message.content, user.name, user.email)) return true;
  return !!notifyAllChannelMessages;
}

function stripForNotification(content, maxLength = 160) {
  const text = String(content || "")
    .replace(/```[\s\S]*?```/g, "[code]")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function notificationChannelLabel(message, userName) {
  const channelType = message.channelType || message.channel_type || "channel";
  const parentChannelType = message.parentChannelType || message.parent_channel_type || null;
  const isThread = !!(message.threadId || message.thread_id || channelType === "thread");
  const isDm = channelType === "dm" || parentChannelType === "dm";
  if (isDm) {
    const parties = dmPartiesFromMessage(message);
    const peer = parties.find((p) => normalizeName(p) !== normalizeName(userName));
    return peer ? `@${peer}` : "DM";
  }
  const name = message.parentChannelName || message.parent_channel_name || message.channelName || message.channel_name || "all";
  return `${isThread ? "Thread in " : ""}#${String(name).replace(/^#/, "")}`;
}

function workspaceUrl(publicUrl, workspaceId) {
  const base = String(publicUrl || "").replace(/\/+$/, "");
  const id = encodeURIComponent(workspaceId || DEFAULT_WORKSPACE_ID);
  return `${base || ""}/z/${id}`;
}

function buildPushPayload(message, user, { publicUrl = "", icon = "/icon-192.png" } = {}) {
  const sender = message.senderName || message.sender_name || "Zouk";
  const workspaceId = message.workspaceId || message.workspace_id || DEFAULT_WORKSPACE_ID;
  const label = notificationChannelLabel(message, user?.name);
  return {
    title: `${sender} · ${label}`,
    body: stripForNotification(message.content) || "New message",
    icon,
    badge: icon,
    tag: `zouk:${workspaceId}:${message.channelId || message.channel_id || message.channelName || message.channel_name || "message"}`,
    url: workspaceUrl(publicUrl, workspaceId),
    messageId: message.id || message.messageId || message.message_id || null,
    workspaceId,
  };
}

module.exports = {
  buildPushPayload,
  dmPartiesFromMessage,
  mentionsUser,
  messageTargetsUser,
  notificationChannelLabel,
  stripForNotification,
};
