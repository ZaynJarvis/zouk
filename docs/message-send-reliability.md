# Message Send Reliability — RFC

Short design note for the next phase of the send-failed-but-message-arrived fix. Companion to the one-line server reorder (broadcast moved after `res.json`), which compresses the failure window but does not eliminate it.

## Problem

Symptom Zayn reported: web client sends a message, the message appears in chat, but the UI shows a `Failed to send message` toast and the composer keeps the draft.

Cause: HTTP send (`POST /api/messages`) and message delivery (WebSocket broadcast) travel on **two independent connections**. The server runs them back-to-back, so by the time the HTTP response is being flushed, the broadcast has usually already left the box. If the response is dropped — Safari/PWA backgrounded, flaky link, mobile NAT timeout — the client treats the send as failed even though the server stored, broadcast, and delivered the message successfully.

The server reorder (broadcast → `res.json` swapped to `res.json` → broadcast) shrinks the window but cannot fix true network failures: the response packet still has to make it back, and on a sufficiently bad link it won't.

## Goal

A send is "successful" if **either** the HTTP ack arrives **or** the WebSocket broadcast for that message arrives at the sender. Treat them as redundant signals from a single logical operation.

Non-goal: making this work in pure-WS or pure-HTTP-poll modes. We rely on both being available, which is the current deployment.

## Design

### Client message ID

Client generates a UUIDv4 `clientMsgId` before each send. Single source of identity that lets the server-issued `message.id` and the WS broadcast event refer back to the same logical operation.

```ts
// web/src/store/appStore.ts (sendMessageAction)
const clientMsgId = crypto.randomUUID();
api.sendMessage(content, target, currentUser, attachmentIds, clientMsgId);
```

POST body adds `clientMsgId`. Server echoes it on the `{ type: "message", message }` WS broadcast as `message.clientMsgId`.

### Dual-channel acknowledgement

Client tracks an in-flight set keyed by `clientMsgId`. For each pending send:

```
            ┌─ HTTP 200 ──────┐
clientMsgId ┤                  ├─ whichever fires first → resolve(success)
            └─ WS message     ─┘   matching clientMsgId

            timeout (~3s after fetch settles) → resolve(failure)
```

- Fetch resolves `200` → resolve immediately.
- Fetch rejects / non-2xx → start a short watch (~1s) on the in-flight set; resolve on matching WS event, otherwise resolve as failure.
- Fetch resolves but no WS event lands within ~3s and the user's WS is still `OPEN` → resolve as failure (stuck-server case).

Composer only clears on `success`. Toast only fires on `failure`.

### Optional: silent single retry

On `fetch reject` and no WS within ~1s, retry the POST once with the **same** `clientMsgId`. This is the extra layer that makes truly bad networks recoverable. Off by default in P1; flag-gated.

### Server: idempotent insert

Only required if we ship retries (P2). When we do:

- In-memory `Map<clientMsgId, { messageId, expiresAt }>` keyed bounded ring buffer.
- Bound: 1000 entries OR 5-minute TTL, evicted lazily.
- `persistUserMessage` checks the map; on hit, returns the existing `msg` without re-inserting and without re-running fanout.
- No SQLite change. The dedupe map is process-local; on server restart the worst case is a duplicate from the rare client retry that crosses the restart, which is no worse than today.

The map should sit behind a thin helper so the existing call sites stay clean:

```js
function persistOrReuseUserMessage(args) {
  const cached = recentSends.get(args.clientMsgId);
  if (cached) return cached;
  const msg = persistUserMessage(args);
  recentSends.set(args.clientMsgId, msg);
  return msg;
}
```

### Wire format

```jsonc
// POST /api/messages request
{
  "target": "#general",
  "content": "hi",
  "senderName": "alice",
  "attachmentIds": [],
  "clientMsgId": "0bd5…"   // NEW, optional for compat
}

// WS broadcast
{
  "type": "message",
  "message": {
    "id": "9f3a…",          // server-assigned, unchanged
    "clientMsgId": "0bd5…", // NEW, present iff client supplied one
    /* …rest unchanged */
  }
}
```

Server always echoes `clientMsgId` on the broadcast for messages that carried one. Old clients that don't send `clientMsgId` keep working unchanged — they just don't get reconciliation.

## Phasing

- **P1 (small, lands the fix)**: clientMsgId + dual-channel reconcile on the client. No retry, no dedupe table. Removes the user-visible bug for the common iOS PWA case where the WS broadcast arrives but the HTTP ack is lost.
- **P2 (defense in depth)**: silent single retry + in-memory ring-buffer dedupe. Catches harder failures (HTTP and WS both delayed, or user manually re-clicks send after toast) without producing duplicates.

## What we are deliberately NOT doing

- Persisting `clientMsgId` to SQLite. Process-local dedupe is enough; durability buys us nothing because the failure modes we care about all complete inside the live process.
- Outbox / queue on the client. Pending messages live in component state, not localStorage. Refreshing the tab during a flaky send will lose the draft, same as today.
- Acknowledged-by-receipt semantics (Telegram-style "delivered/read"). Out of scope.

## Open questions

1. The reconcile timeout (~1s after fetch reject, ~3s for stuck-server) is a guess. Worth measuring p95 fetch-vs-broadcast skew on real devices before nailing the constants.
2. If the user closes the composer/leaves the channel before reconciliation lands, do we still fire the toast? Probably no — silently drop, since we have no UI surface.
3. Whether retries should be exposed as a manual "retry" button in the toast, or kept fully silent. Manual gives the user control; silent is friendlier when network is briefly bad. Recommendation: silent in P2, add manual button only if telemetry shows residual failures.
