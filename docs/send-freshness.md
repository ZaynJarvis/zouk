# Send Freshness (Optimistic Lock on Agent Sends)

Problem: when several agents receive the same channel message, each composes a
reply without knowing the others already answered — duplicated replies (spam).
Classic optimistic-concurrency gap: the send path never checked what the sender
had actually seen.

## How it works

Every message has a global monotonic `seq`. The server keeps an in-memory
cursor per agent per scope (`store.agentSeenSeq`, scopeKey =
`channelId:threadId||""`): the highest `seq` the agent's **model** has
observed there.

Cursor advances on:

1. `agent:deliver:ack` — `deliverToAgent` attaches `cursor: {scopeKey, seq}` to
   the `agent:deliver` frame; the daemon echoes it back **when the text
   actually reaches the model** (immediately if the agent is idle or the driver
   is direct-mode; at turn end if the message was queued mid-turn). See
   zouk-daemon `AgentManager.doDeliver` / `flushDeliverAcks`.
2. `GET /internal/agent/:id/receive` and `/history` — returned rows.
3. A held send response (the unseen messages are shown in it).

Check (in `POST /internal/agent/:id/send`, `server/routes/agent-internal.js`):
if the target scope's tail cache has messages with `seq > cursor` from someone
else (excluding `senderType: "system"` task notices, which are never
push-delivered), the message is **not** posted. The response is:

```json
{ "state": "held", "reason": "newer_messages", "heldMessages": [...],
  "newMessageCount": n, "shownMessageCount": k, "omittedMessageCount": n-k,
  "seenUpToSeq": s }
```

The hold advances the cursor to `seenUpToSeq`, so the agent's next send passes
unless yet-newer messages land — no draft store or `send_anyway` flag needed:
the agent re-decides (skip / revise / resend) with the shown context. The
daemon MCP layer formats this guidance in `formatSendResult`
(zouk-daemon `src/agent-mcp/tools.ts`).

Fail-open cases (send proceeds unchecked): no cursor for the scope (fresh
agent, server restart — all state is in-memory), empty tail cache, or
`ZOUK_SEND_FRESHNESS=0`.

Retry idempotency: the daemon attaches a per-tool-call `clientMsgId` to agent
sends; the server dedupes via the same `recentSends` cache as the human path,
so an HTTP retry after a lost response can't double-post.

## Eval

`node server/eval-reply-storm.mjs` — reply-storm scenario (N scripted agents,
one human question) comparing freshness on/off; regression test in
`server/test-freshness-e2e.mjs`. Sandbox helpers:
`server/test-support/zouk-scripted-agents.mjs`.
