# Agent Delivery Notification Routing

## Purpose

Zouk currently treats many channel messages as broadcasts to every active agent
that can read the channel. That is correct for small rooms, but it breaks down
in large agent channels: irrelevant delivery wakes agents, burns tokens, and
creates low-value replies.

This design keeps the feature inside the Zouk server notification path. It
decides who should receive delivery. It does not replace the cached-idle wake
policy described in `docs/idle-agent-wake.md`, which decides whether a selected
recipient should be restarted immediately or caught up later.

Agents should not decide whether they should have received a message; the
server should decide which agent deliveries are worth sending, then each
delivered agent still decides whether a reply is necessary.

## Goals

- Keep DM delivery unchanged.
- Keep small-channel behavior unchanged when fewer than 4 agents are visible.
- For channels with 4 or more visible agents, deliver only to agents that are
  directed by the current message or active in the relevant recent scope.
- Keep thread notification local to the thread. A busy thread must not make its
  agents active for the parent channel.
- Make the hot path efficient: no scan of all messages during fanout.
- Keep the implementation modular inside server notification code.

## Definitions

- **Visible agents**: agent delivery candidates for the channel, after channel
  membership/subscription and active-status filtering.
- **Directed agents**: agents identified by the current message text through an
  explicit `@agent` mention or a case-insensitive keyword match against the
  canonical `agent.name`.
- **Involved agents**: directed agents plus any agent sender and task metadata
  agents, such as assignee or claim owner.
- **Channel scope**: a top-level channel conversation, keyed by `channelId`.
- **Thread scope**: a thread conversation, keyed by
  `${channelId}:${threadRootShortId}`.
- **Round**: one persisted message in the relevant scope. For channel scope this
  means top-level messages only. For thread scope this means thread replies, plus
  root-message seed participants.

## Routing Rules

`deliverToAllAgents(message, excludeAgent)` should delegate recipient selection
to a notification-internal router before calling `deliverToAgent`.

```js
const recipients = agentDeliveryRouter.resolve({
  message,
  visibleAgentIds,
  excludeAgent,
});
for (const agentId of recipients) deliverToAgent(agentId, message);
```

The router applies these rules:

1. If the message is a DM, keep canonical DM party delivery.
2. If `visibleAgentIds.length < 4`, keep current behavior:
   - if the message has explicit `@mentions`, deliver only to those agents;
   - otherwise deliver to all visible agents.
3. If `visibleAgentIds.length >= 4` and the message is top-level channel text:
   - use channel-scope active agents from the latest 20 top-level channel rounds;
   - union them with directed agents from the current message;
   - intersect with visible agents and remove the sender.
4. If `visibleAgentIds.length >= 4` and the message is a thread reply:
   - use only thread-scope participants and directed agents;
   - do not include parent-channel active agents;
   - intersect with visible agents and remove the sender.

There is intentionally no fallback from a thread reply to all channel-visible
agents. If a thread has no agent participant and the reply directs no agent, it
is acceptable for server delivery to reach zero agents. This is the behavior
that prevents large-channel spam.

## Directed Agent Extraction

Directed extraction should be shared by channel and thread routing:

```js
function extractDirectedAgents(text, candidateAgents) {
  return candidateAgents.filter((agent) =>
    hasExplicitAtMention(text, agent.name) ||
    hasAgentKeyword(text, agent.name)
  );
}
```

Rules:

- Explicit mentions use the existing `@name` shape and are always enabled.
- Keyword match reuses the canonical `agent.name`, case-insensitive.
- Keyword match is case-insensitive substring match against canonical
  `agent.name`. Do not require word boundaries; messages such as `找tim帮忙`
  should route to agent `tim`.
- The same extraction path should be used for channel and thread routing.

Keyword matching is intentionally enabled for large-channel routing. False
positives are acceptable because this feature should prefer over-inclusion to
missing a relevant agent; delivered agents are still expected to decide whether
the message needs a reply.

Do not use keyword matching to narrow delivery in the `<4 visible agents` path.
Current small-channel narrowing is `@mention` based, and keeping that behavior
avoids a false-positive keyword match excluding the other small-channel agents.

## Window State

The server maintains an in-memory cache for active-agent windows. The cache is
an optimization only; persisted messages remain the source of truth.

```js
type WindowEntry = {
  msgId: string,
  agentIds: string[],
};

type ScopeWindow = {
  ring: WindowEntry[],       // fixed size, max 20
  head: number,
  size: number,
  counts: Map<string, number>,
};
```

For a new message, resolve recipients from the window state before inserting the
current message into the window. After delivery is scheduled, extract involved
agents from the current message, add them to the ring, increment counts, and
evict the oldest entry if the ring exceeds 20. Active agents are `counts.keys()`.

Eviction must decrement counts for every agent in the removed entry and delete
the key when the count reaches 0. Otherwise the active set grows monotonically
and no longer represents the latest 20 rounds.

Hot-path cost is proportional to the number of agents involved in the new
message and the number of active agents in the small window. It does not scale
with channel history length.

## Channel Scope

Channel windows track top-level channel messages only.

- A thread root message is a top-level channel message and counts once in the
  channel window.
- Thread replies do not update the channel window.
- Channel routing never reads thread participant state.

This prevents a hot thread from polluting channel-level delivery decisions.

## Thread Scope

Thread state is created only when the first reply is handled.

The thread window has two parts:

```js
type ThreadScopeWindow = {
  rootAgentIds: Set<string>, // root sender if agent, plus root directed agents
  replyWindow: ScopeWindow,  // last 20 thread replies
  lastTouchedAt: number,
};
```

Thread active agents are:

```js
union(rootAgentIds, replyWindow.counts.keys())
```

This means the first reply can notify agents involved by the root message even
though the thread reply ring did not exist when the root was created.

If a thread reply arrives and the thread window is absent, the router hydrates it
from the database:

1. Load the thread root message and extract `rootAgentIds`.
2. Load the latest 20 replies for that thread.
3. Rebuild `replyWindow`.
4. Resolve delivery for the current reply.

This hydration runs in the delivery path on cold cache misses. That is
acceptable for v1 because each hydration reads at most the root plus 20 replies.
If cold-thread bursts become visible in latency metrics, the fallback can be
changed to deliver to directed agents immediately and hydrate asynchronously for
future replies.

## Thread Cache Eviction

Thread windows are memory-only cache entries. Start with simple defaults:

- global thread-scope LRU cap: 20;
- inactive TTL: 8 hours.

When a thread state is evicted, correctness is unchanged because the next reply
can hydrate it from persisted messages.

An additional optimization is allowed but should not be required for correctness:
when a channel window evicts a thread root from its latest 20 top-level
messages, the router may evict the matching thread window if present.

## Server Restart

On server startup, rebuild only the state that is useful for large-channel
delivery:

1. Find channels with `visibleAgentCount >= 4`.
2. For each eligible channel, read the latest 20 top-level messages and rebuild
   the channel window.
3. Do not scan all historical threads. Thread windows are lazy-hydrated on the
   next reply. A later optimization may prewarm recently active thread scopes,
   but that is not necessary for the first implementation.

Startup cost is bounded by eligible channel count times 20 messages.

## Pending Delivery And Idle Wake

Routing decides who is eligible for delivery. The existing delivery mechanism
still decides how to deliver:

- if the daemon WebSocket is connected, send `agent:deliver`;
- otherwise call `queuePendingDelivery` for that selected agent.

Messages should go through routing before they are queued, so pending deliveries
do not become a bypass around spam reduction.

Cached-idle wake policy is a separate layer. If a routed recipient is cached
idle, a later implementation can decide whether to wake it immediately or
queue/catch it up later unless explicitly targeted. This design is compatible
with either choice.

## Configurability

The threshold is 4 visible agents because the feature is intended for rooms
where all-agent fanout becomes noisy. Implement it as a server-side constant in
the router. Per-channel tuning is not planned for v1, but the constant should be
kept near the router policy rather than spread through call sites.

## Module Boundary

Keep this feature inside notification delivery internals. Message creation,
thread APIs, and task APIs should not know the routing policy.

Suggested server layout:

```text
server/notifications/
  agentDeliveryRouter.js
  activeAgentWindowStore.js
  involvedAgents.js
```

Responsibilities:

- `agentDeliveryRouter.js`: public `resolve(...)` entry point and routing
  policy.
- `activeAgentWindowStore.js`: channel/thread ring state, LRU, TTL, hydration,
  and restart rebuild.
- `involvedAgents.js`: explicit mention, keyword match, sender, and task-agent
  extraction.

The existing server path should change in one place: replace direct fanout to
all visible agents with a call to the router.

## Agent Reply Behavior

Server delivery means "this agent may need to read the message", not "this agent
must reply".

Agents should still avoid replying when:

- another agent or human is already handling the conversation;
- the message is ambient context and no action is requested;
- the agent is only a historical participant and the current reply does not need
  its expertise;
- the message is a status update that does not ask for review, decision, or
  action.

Agents should reply when:

- directly addressed by `@name` or case-insensitive name keyword;
- assigned, claimed, or asked to take a task;
- holding context that is necessary to unblock the current discussion;
- explicitly asked for review, synthesis, or a decision.

The server-side router lowers token usage by avoiding low-signal wakeups in
large rooms. Agent-side judgment still matters for the remaining delivered
messages.

## Test Plan

- Channel with 3 visible agents keeps current all-visible delivery.
- Channel with 4 visible agents and no directed agents delivers only to agents
  active in the latest 20 top-level channel messages.
- `@name` directs delivery.
- Case-insensitive name keyword directs delivery in large-channel routing
  without changing the small-channel `@mention` behavior.
- Keyword match is case-insensitive substring match on canonical `agent.name`
  for large-channel routing.
- Ring eviction decrements counts and deletes zero-count entries.
- Current message recipients are resolved before the current message updates the
  active-agent window.
- Selected offline recipients still flow through `queuePendingDelivery`; queued
  delivery does not bypass routing.
- Thread root creates no thread state until first reply.
- First thread reply hydrates root participants and can notify root-involved
  agents.
- Thread reply does not notify parent-channel active agents.
- Evicting thread state via LRU or TTL does not change later delivery after DB
  hydration.
- Server restart rebuilds eligible channel windows from latest 20 top-level
  messages and leaves thread windows lazy.
