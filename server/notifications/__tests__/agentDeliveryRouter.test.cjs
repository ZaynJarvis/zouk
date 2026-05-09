const test = require("node:test");
const assert = require("node:assert/strict");

const { AgentDeliveryRouter } = require("../agentDeliveryRouter");
const { ActiveAgentWindowStore, ScopeWindow } = require("../activeAgentWindowStore");

const agentsById = {
  alice: { id: "alice", name: "alice", displayName: "Alice" },
  bob: { id: "bob", name: "bob", displayName: "Bob" },
  tim: { id: "tim", name: "tim", displayName: "Tim" },
  hela: { id: "hela", name: "hela", displayName: "Hela" },
  zeus: { id: "zeus", name: "zeus", displayName: "Zeus" },
};

function msg(overrides) {
  return {
    id: overrides.id || `msg-${Math.random()}`,
    channelId: overrides.channelId || "ch-main",
    channelType: overrides.channelType || "channel",
    channelName: overrides.channelName || "main",
    threadId: overrides.threadId || null,
    senderName: overrides.senderName || "zaynjarvis",
    senderType: overrides.senderType || "human",
    content: overrides.content || "",
    ...overrides,
  };
}

test("small channels keep current mention-only narrowing", () => {
  const router = new AgentDeliveryRouter();
  const visible = ["alice", "tim", "zeus"];

  assert.deepEqual(
    router.resolveRecipients({
      message: msg({ content: "找tim帮忙" }),
      visibleAgentIds: visible,
      agentsById,
    }).sort(),
    visible.sort()
  );

  assert.deepEqual(
    router.resolveRecipients({
      message: msg({ content: "cc @tim please" }),
      visibleAgentIds: visible,
      agentsById,
    }),
    ["tim"]
  );
});

test("large top-level channels deliver to recent active agents plus current directed agents", () => {
  const router = new AgentDeliveryRouter();
  const visible = ["alice", "bob", "tim", "hela", "zeus"];

  router.recordMessage(msg({ id: "m1", senderType: "agent", senderName: "bob", content: "I can take this" }), { agentsById });
  router.recordMessage(msg({ id: "m2", content: "please review @alice" }), { agentsById });

  assert.deepEqual(
    router.resolveRecipients({
      message: msg({ id: "m3", content: "next update" }),
      visibleAgentIds: visible,
      agentsById,
    }).sort(),
    ["alice", "bob"].sort()
  );

  assert.deepEqual(
    router.resolveRecipients({
      message: msg({ id: "m4", content: "找tim帮忙" }),
      visibleAgentIds: visible,
      agentsById,
    }).sort(),
    ["alice", "bob", "tim"].sort()
  );
});

test("large-channel keyword routing is case-insensitive substring on canonical agent name", () => {
  const router = new AgentDeliveryRouter();

  assert.deepEqual(
    router.resolveRecipients({
      message: msg({ content: "找TiM帮忙" }),
      visibleAgentIds: ["alice", "bob", "tim", "hela"],
      agentsById,
    }),
    ["tim"]
  );
});

test("current message does not affect its own large-channel recipient resolution", () => {
  const router = new AgentDeliveryRouter();
  const current = msg({
    id: "self-record-check",
    senderType: "agent",
    senderName: "bob",
    content: "ambient update",
  });

  assert.deepEqual(
    router.resolveRecipients({
      message: current,
      visibleAgentIds: ["alice", "bob", "tim", "hela"],
      agentsById,
      excludeAgentId: "bob",
    }),
    []
  );

  router.recordMessage(current, { agentsById });
  assert.deepEqual(
    router.resolveRecipients({
      message: msg({ id: "after-self-record", content: "next update" }),
      visibleAgentIds: ["alice", "bob", "tim", "hela"],
      agentsById,
    }),
    ["bob"]
  );
});

test("thread first reply hydrates root participants and ignores parent channel active agents", () => {
  const root = msg({
    id: "root-msg-1",
    senderType: "agent",
    senderName: "zeus",
    content: "请tim看一下",
  });
  const threadId = root.id.slice(0, 8);
  const currentReply = msg({
    id: "reply-1",
    threadId,
    content: "bump",
  });
  const router = new AgentDeliveryRouter({
    getThreadRootMessage: () => root,
    getThreadReplies: () => [currentReply],
  });
  router.recordMessage(msg({ id: "channel-active", senderType: "agent", senderName: "bob" }), { agentsById });

  assert.deepEqual(
    router.resolveRecipients({
      message: currentReply,
      visibleAgentIds: ["alice", "bob", "tim", "hela", "zeus"],
      agentsById,
    }).sort(),
    ["tim", "zeus"].sort()
  );
});

test("thread replies route to thread participants plus thread-local directed agents", () => {
  const root = msg({
    id: "root-msg-2",
    senderType: "agent",
    senderName: "zeus",
    content: "thread root",
  });
  const threadId = root.id.slice(0, 8);
  const router = new AgentDeliveryRouter({
    getThreadRootMessage: () => root,
    getThreadReplies: () => [],
  });
  router.recordMessage(msg({ id: "channel-active", senderType: "agent", senderName: "bob" }), { agentsById });

  assert.deepEqual(
    router.resolveRecipients({
      message: msg({ id: "reply-2", threadId, content: "ask hela too" }),
      visibleAgentIds: ["alice", "bob", "tim", "hela", "zeus"],
      agentsById,
    }).sort(),
    ["hela", "zeus"].sort()
  );
});

test("scope window eviction decrements counts and empty messages still age out old agents", () => {
  const window = new ScopeWindow({ windowSize: 2 });
  window.record("m1", ["alice"]);
  window.record("m2", []);
  window.record("m3", ["bob"]);

  assert.deepEqual(window.activeAgentIds(), ["bob"]);
});

test("channel window rebuild uses only the latest 20 top-level messages", () => {
  const router = new AgentDeliveryRouter();
  const messages = [];
  messages.push(msg({ id: "old-agent", senderType: "agent", senderName: "alice" }));
  for (let i = 0; i < 20; i += 1) {
    messages.push(msg({ id: `human-${i}`, content: "" }));
  }
  router.rebuildChannelWindows(messages, { agentsById });

  assert.deepEqual(
    router.resolveRecipients({
      message: msg({ id: "after-rebuild" }),
      visibleAgentIds: ["alice", "bob", "tim", "hela"],
      agentsById,
    }),
    []
  );
});

test("thread scope cache enforces global LRU cap and TTL", () => {
  let now = 1_000;
  const store = new ActiveAgentWindowStore({
    threadScopeLimit: 2,
    threadTtlMs: 100,
    now: () => now,
  });

  store.hydrateThread("ch", "t1", { rootAgentIds: ["alice"] });
  store.hydrateThread("ch", "t2", { rootAgentIds: ["bob"] });
  store.getThreadScope("ch", "t1");
  store.hydrateThread("ch", "t3", { rootAgentIds: ["tim"] });

  assert.deepEqual(store.activeThreadAgentIds("ch", "t1"), ["alice"]);
  assert.deepEqual(store.activeThreadAgentIds("ch", "t2"), []);
  assert.deepEqual(store.activeThreadAgentIds("ch", "t3"), ["tim"]);

  now = 1_200;
  store.pruneThreadScopes();
  assert.deepEqual(store.activeThreadAgentIds("ch", "t1"), []);
  assert.deepEqual(store.activeThreadAgentIds("ch", "t3"), []);
});
