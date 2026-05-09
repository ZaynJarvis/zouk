const DEFAULT_WINDOW_SIZE = 20;
const DEFAULT_THREAD_SCOPE_LIMIT = 20;
const DEFAULT_THREAD_TTL_MS = 8 * 60 * 60 * 1000;

function uniqueIds(agentIds) {
  return [...new Set([...agentIds].filter(Boolean))];
}

class ScopeWindow {
  constructor({ windowSize = DEFAULT_WINDOW_SIZE } = {}) {
    this.windowSize = windowSize;
    this.ring = [];
    this.counts = new Map();
  }

  record(messageId, agentIds) {
    const ids = uniqueIds(agentIds || []);
    if (!messageId) return;
    this.ring.push({ messageId, agentIds: ids });
    for (const agentId of ids) {
      this.counts.set(agentId, (this.counts.get(agentId) || 0) + 1);
    }
    while (this.ring.length > this.windowSize) {
      const evicted = this.ring.shift();
      for (const agentId of evicted.agentIds) {
        const next = (this.counts.get(agentId) || 0) - 1;
        if (next > 0) this.counts.set(agentId, next);
        else this.counts.delete(agentId);
      }
    }
  }

  hydrate(entries) {
    this.ring = [];
    this.counts.clear();
    for (const entry of entries || []) {
      this.record(entry.messageId, entry.agentIds || []);
    }
  }

  activeAgentIds() {
    return [...this.counts.keys()];
  }
}

class ActiveAgentWindowStore {
  constructor({
    windowSize = DEFAULT_WINDOW_SIZE,
    threadScopeLimit = DEFAULT_THREAD_SCOPE_LIMIT,
    threadTtlMs = DEFAULT_THREAD_TTL_MS,
    now = () => Date.now(),
  } = {}) {
    this.windowSize = windowSize;
    this.threadScopeLimit = threadScopeLimit;
    this.threadTtlMs = threadTtlMs;
    this.now = now;
    this.channelWindows = new Map();
    this.threadScopes = new Map();
  }

  channelWindow(channelId) {
    if (!channelId) return null;
    let window = this.channelWindows.get(channelId);
    if (!window) {
      window = new ScopeWindow({ windowSize: this.windowSize });
      this.channelWindows.set(channelId, window);
    }
    return window;
  }

  activeChannelAgentIds(channelId) {
    return this.channelWindows.get(channelId)?.activeAgentIds() || [];
  }

  hydrateChannel(channelId, entries) {
    const window = this.channelWindow(channelId);
    window.hydrate(entries);
  }

  recordChannelMessage(message, agentIds) {
    if (!message?.channelId || message.threadId || (message.channelType || "channel") === "dm") return;
    this.channelWindow(message.channelId).record(message.id, agentIds);
  }

  threadKey(channelId, threadId) {
    return `${channelId || ""}:${threadId || ""}`;
  }

  getThreadScope(channelId, threadId) {
    const key = this.threadKey(channelId, threadId);
    const scope = this.threadScopes.get(key);
    if (!scope) return null;
    scope.lastTouchedAt = this.now();
    this.threadScopes.delete(key);
    this.threadScopes.set(key, scope);
    return scope;
  }

  hydrateThread(channelId, threadId, { rootAgentIds = [], entries = [] } = {}) {
    if (!channelId || !threadId) return null;
    this.pruneThreadScopes();
    const key = this.threadKey(channelId, threadId);
    const scope = {
      rootAgentIds: new Set(rootAgentIds || []),
      replyWindow: new ScopeWindow({ windowSize: this.windowSize }),
      lastTouchedAt: this.now(),
    };
    scope.replyWindow.hydrate(entries);
    this.threadScopes.set(key, scope);
    this.enforceThreadScopeLimit();
    return scope;
  }

  recordThreadMessage(message, agentIds) {
    if (!message?.channelId || !message.threadId || (message.channelType || "channel") === "dm") return;
    let scope = this.getThreadScope(message.channelId, message.threadId);
    if (!scope) {
      scope = this.hydrateThread(message.channelId, message.threadId);
    }
    scope.replyWindow.record(message.id, agentIds);
  }

  activeThreadAgentIds(channelId, threadId) {
    const scope = this.getThreadScope(channelId, threadId);
    if (!scope) return [];
    return uniqueIds([...scope.rootAgentIds, ...scope.replyWindow.activeAgentIds()]);
  }

  pruneThreadScopes() {
    const cutoff = this.now() - this.threadTtlMs;
    for (const [key, scope] of this.threadScopes) {
      if (scope.lastTouchedAt < cutoff) this.threadScopes.delete(key);
    }
  }

  enforceThreadScopeLimit() {
    this.pruneThreadScopes();
    while (this.threadScopes.size > this.threadScopeLimit) {
      const oldestKey = this.threadScopes.keys().next().value;
      if (!oldestKey) break;
      this.threadScopes.delete(oldestKey);
    }
  }
}

module.exports = {
  ActiveAgentWindowStore,
  ScopeWindow,
  DEFAULT_THREAD_SCOPE_LIMIT,
  DEFAULT_THREAD_TTL_MS,
  DEFAULT_WINDOW_SIZE,
};
