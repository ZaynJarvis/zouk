const {
  directedAgentIds,
  explicitMentionAgentIds,
  messageInvolvedAgentIds,
} = require("./involvedAgents");
const {
  ActiveAgentWindowStore,
  DEFAULT_WINDOW_SIZE,
} = require("./activeAgentWindowStore");

const LARGE_CHANNEL_AGENT_THRESHOLD = 4;

function asSet(ids) {
  return new Set((ids || []).filter(Boolean));
}

function intersect(ids, allowed) {
  const out = [];
  for (const id of ids || []) {
    if (allowed.has(id)) out.push(id);
  }
  return [...new Set(out)];
}

class AgentDeliveryRouter {
  constructor({
    windowStore = new ActiveAgentWindowStore(),
    largeChannelAgentThreshold = LARGE_CHANNEL_AGENT_THRESHOLD,
    getThreadRootMessage = () => null,
    getThreadReplies = () => [],
  } = {}) {
    this.windowStore = windowStore;
    this.largeChannelAgentThreshold = largeChannelAgentThreshold;
    this.getThreadRootMessage = getThreadRootMessage;
    this.getThreadReplies = getThreadReplies;
  }

  resolveRecipients({
    message,
    visibleAgentIds,
    agentsById,
    excludeAgentId = null,
  }) {
    const visible = asSet(visibleAgentIds);
    if (excludeAgentId) visible.delete(excludeAgentId);
    if (!message || visible.size === 0) return [];

    if ((message.channelType || "channel") === "dm") {
      return [...visible];
    }

    // Thread replies always route via thread-scope, regardless of how many
    // agents are visible in the parent channel. The small-channel "deliver to
    // all visible" fallback is for top-level channel messages only — applying
    // it to thread replies leaks thread-only conversations to non-participants
    // (regression: 2026-05-10 #all:31f286f7).
    if (message.threadId) {
      const directed = directedAgentIds(message.content || "", agentsById, { includeKeyword: true });
      const active = this.resolveThreadActiveIds(message, agentsById);
      return intersect([...active, ...directed], visible);
    }

    if ((visibleAgentIds || []).length < this.largeChannelAgentThreshold) {
      return this.resolveSmallChannel(message, visible, agentsById);
    }

    const directed = directedAgentIds(message.content || "", agentsById, { includeKeyword: true });
    const active = this.windowStore.activeChannelAgentIds(message.channelId);
    return intersect([...active, ...directed], visible);
  }

  resolveSmallChannel(message, visible, agentsById) {
    const mentioned = explicitMentionAgentIds(message.content || "", agentsById);
    if (mentioned.size === 0) return [...visible];
    return intersect(mentioned, visible);
  }

  resolveThreadActiveIds(message, agentsById) {
    this.ensureThreadHydrated(message, agentsById);
    return this.windowStore.activeThreadAgentIds(message.channelId, message.threadId);
  }

  ensureThreadHydrated(message, agentsById) {
    if (!message?.channelId || !message.threadId) return;
    if (this.windowStore.getThreadScope(message.channelId, message.threadId)) return;

    const root = this.getThreadRootMessage(message.threadId);
    const rootAgentIds = root
      ? [...messageInvolvedAgentIds(root, agentsById, { includeKeyword: true })]
      : [];
    const replies = (this.getThreadReplies(message.threadId, message.channelId) || [])
      .filter((reply) => reply && reply.id !== message.id)
      .slice(-DEFAULT_WINDOW_SIZE);
    const entries = replies.map((reply) => ({
      messageId: reply.id,
      agentIds: [...messageInvolvedAgentIds(reply, agentsById, { includeKeyword: true })],
    }));

    this.windowStore.hydrateThread(message.channelId, message.threadId, {
      rootAgentIds,
      entries,
    });
  }

  recordMessage(message, { agentsById } = {}) {
    if (!message || (message.channelType || "channel") === "dm") return;
    const agentIds = [...messageInvolvedAgentIds(message, agentsById, { includeKeyword: true })];
    if (message.threadId) {
      this.ensureThreadHydrated(message, agentsById);
      this.windowStore.recordThreadMessage(message, agentIds);
    } else {
      this.windowStore.recordChannelMessage(message, agentIds);
    }
  }

  rebuildChannelWindows(messages, { agentsById } = {}) {
    const byChannel = new Map();
    for (const message of messages || []) {
      if (!message?.channelId || message.threadId || (message.channelType || "channel") === "dm") continue;
      let arr = byChannel.get(message.channelId);
      if (!arr) {
        arr = [];
        byChannel.set(message.channelId, arr);
      }
      arr.push(message);
    }
    for (const [channelId, channelMessages] of byChannel) {
      const entries = channelMessages.slice(-DEFAULT_WINDOW_SIZE).map((message) => ({
        messageId: message.id,
        agentIds: [...messageInvolvedAgentIds(message, agentsById, { includeKeyword: true })],
      }));
      this.windowStore.hydrateChannel(channelId, entries);
    }
  }
}

module.exports = {
  AgentDeliveryRouter,
  LARGE_CHANNEL_AGENT_THRESHOLD,
};
