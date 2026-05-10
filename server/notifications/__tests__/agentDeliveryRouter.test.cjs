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
  miles: { id: "miles", name: "miles", displayName: "Miles" },
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

test("thread-directed agents stay in thread scope for later ambient replies", () => {
  const root = msg({
    id: "root-msg-3",
    content: "bob please check this",
  });
  const threadId = root.id.slice(0, 8);
  const replies = [];
  const router = new AgentDeliveryRouter({
    getThreadRootMessage: () => root,
    getThreadReplies: () => replies,
  });
  router.recordMessage(msg({ id: "channel-active", senderType: "agent", senderName: "alice" }), { agentsById });

  const directedReply = msg({ id: "reply-directed", threadId, content: "tim should also check this" });
  assert.deepEqual(
    router.resolveRecipients({
      message: directedReply,
      visibleAgentIds: ["alice", "bob", "tim", "hela", "zeus"],
      agentsById,
    }).sort(),
    ["bob", "tim"].sort()
  );
  replies.push(directedReply);
  router.recordMessage(directedReply, { agentsById });

  assert.deepEqual(
    router.resolveRecipients({
      message: msg({ id: "reply-ambient", threadId, content: "any update?" }),
      visibleAgentIds: ["alice", "bob", "tim", "hela", "zeus"],
      agentsById,
    }).sort(),
    ["bob", "tim"].sort()
  );
});

test("agent senders enter thread scope only after participating", () => {
  const root = msg({
    id: "root-msg-4",
    content: "bob please check this",
  });
  const threadId = root.id.slice(0, 8);
  const replies = [];
  const router = new AgentDeliveryRouter({
    getThreadRootMessage: () => root,
    getThreadReplies: () => replies,
  });

  assert.deepEqual(
    router.resolveRecipients({
      message: msg({ id: "reply-before-alice", threadId, content: "any update?" }),
      visibleAgentIds: ["alice", "bob", "tim", "hela", "zeus"],
      agentsById,
    }),
    ["bob"]
  );

  const aliceReply = msg({
    id: "reply-alice",
    threadId,
    senderType: "agent",
    senderName: "alice",
    content: "I can help",
  });
  replies.push(aliceReply);
  router.recordMessage(aliceReply, { agentsById });

  assert.deepEqual(
    router.resolveRecipients({
      message: msg({ id: "reply-after-alice", threadId, content: "next update" }),
      visibleAgentIds: ["alice", "bob", "tim", "hela", "zeus"],
      agentsById,
    }).sort(),
    ["alice", "bob"].sort()
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

// Regression for the 2026-05-10 #all:31f286f7 leak: alice received a thread
// reply that did not direct her, in a channel whose visible-active count
// dipped below 4. Spec (zaynjarvis 0c6109bc): thread participants continue to
// receive subsequent messages; small and large channel thread routing must be
// identical. The current resolveSmallChannel path ignores threadId entirely
// and broadcasts to all visible agents.
test("small channel thread reply uses thread scope, not all-visible fallback", () => {
  const root = msg({
    id: "root-small-1",
    senderType: "agent",
    senderName: "miles",
    content: "ambient",
  });
  const threadId = root.id.slice(0, 8);
  const router = new AgentDeliveryRouter({
    getThreadRootMessage: () => root,
    getThreadReplies: () => [],
  });

  // Small channel: only 3 visible active agents → enters resolveSmallChannel.
  // Reply by miles, no @mention or keyword. Expected recipients: thread root
  // participant {miles}, NOT the entire visible set.
  assert.deepEqual(
    router.resolveRecipients({
      message: msg({
        id: "reply-small-1",
        threadId,
        senderType: "agent",
        senderName: "miles",
        content: "bump",
      }),
      visibleAgentIds: ["alice", "bob", "miles"],
      agentsById,
      excludeAgentId: "miles",
    }),
    []
  );
});

test("thread routing is independent of channel size (small/large symmetry)", () => {
  const root = msg({
    id: "root-sym-1",
    senderType: "agent",
    senderName: "zeus",
    content: "kickoff",
  });
  const threadId = root.id.slice(0, 8);
  const buildRouter = () => new AgentDeliveryRouter({
    getThreadRootMessage: () => root,
    getThreadReplies: () => [],
  });
  const reply = msg({
    id: "reply-sym-1",
    threadId,
    content: "ask hela too",
  });

  const smallRecipients = buildRouter().resolveRecipients({
    message: reply,
    visibleAgentIds: ["alice", "zeus", "hela"],
    agentsById,
  });
  const largeRecipients = buildRouter().resolveRecipients({
    message: reply,
    visibleAgentIds: ["alice", "bob", "tim", "zeus", "hela"],
    agentsById,
  });

  // Same thread, same reply text → recipient set must contain identical
  // thread-scope members regardless of how many other agents are subscribed
  // to the parent channel. Bob/tim/alice never participated in this thread,
  // so they should not appear in either list.
  const intersect = (list, allowed) => list.filter((id) => allowed.has(id));
  const threadParticipants = new Set(["zeus", "hela"]);
  assert.deepEqual(intersect(smallRecipients, threadParticipants).sort(), ["hela", "zeus"]);
  assert.deepEqual(intersect(largeRecipients, threadParticipants).sort(), ["hela", "zeus"]);
  // And no parent-channel-only agent (bob/tim/alice) leaks into either path.
  for (const stranger of ["alice", "bob", "tim"]) {
    assert.equal(smallRecipients.includes(stranger), false, `small leaked ${stranger}`);
    assert.equal(largeRecipients.includes(stranger), false, `large leaked ${stranger}`);
  }
});

test("agent re-enters channel active window after replying once they aged out", () => {
  const router = new AgentDeliveryRouter();
  const visible = ["alice", "bob", "tim", "hela", "zeus"];

  // alice was active 21 messages ago, then 20 unrelated top-level messages
  // pushed her out of the latest-20 ring.
  router.recordMessage(
    msg({ id: "old", senderType: "agent", senderName: "alice", content: "early" }),
    { agentsById }
  );
  for (let i = 0; i < 20; i += 1) {
    router.recordMessage(msg({ id: `pad-${i}`, content: "" }), { agentsById });
  }

  // Next undirected top-level message must NOT route to alice — she aged out.
  assert.deepEqual(
    router.resolveRecipients({
      message: msg({ id: "after-aging", content: "" }),
      visibleAgentIds: visible,
      agentsById,
    }),
    []
  );

  // alice replies → her involvement re-enters the window.
  router.recordMessage(
    msg({ id: "alice-back", senderType: "agent", senderName: "alice", content: "back" }),
    { agentsById }
  );

  // Now an undirected top-level message routes to alice again.
  assert.deepEqual(
    router.resolveRecipients({
      message: msg({ id: "after-return", content: "" }),
      visibleAgentIds: visible,
      agentsById,
    }),
    ["alice"]
  );
});
