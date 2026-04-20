# Idle Agent Wake Behavior — Current State & Concern

## Terminology

Server-side status values (`server/index.js`): `starting` / `active` / `stopping` / `inactive`. There is **no `idle` status on the server**.

"Idle" is a daemon-side concept with two distinct flavors:

| Flavor | Subprocess | Daemon-side state | Server-side `status` |
|---|---|---|---|
| **Live idle** | Alive, waiting on stdin | `ap.isIdle = true` | `active` |
| **Cached idle** | Killed by watchdog on clean exit | Config parked in `idleAgentConfigs`, no `ap` | `active` |

When the watchdog kills the subprocess on a clean exit (code 0), the daemon sends `agent:activity` with `activity: 'online', detail: 'Process idle'` (`zouk-daemon/src/agentProcessManager.ts:451`). It does **not** send `agent:status: 'inactive'`. Inactive is reserved for crashes and explicit stops.

## Current wake behavior

`deliverToAllAgents` (`server/index.js:598`) filters by `status !== "active"` only. Both live-idle and cached-idle agents pass the filter.

Routing rules on a channel message:

1. **With `@mention` matching a live agent** → delivery narrowed to mentioned agents.
2. **Without a matching mention** → delivered to **every active agent**, including cached-idle ones.

On delivery, the daemon's `deliverMessage` (`zouk-daemon/src/agentProcessManager.ts:546`):
- Live-idle: wakes subprocess via stdin notification (cheap).
- Cached-idle: **restarts the subprocess** with the message as wake prompt (`agentProcessManager.ts:555-562`).

## The concern

Every unmentioned channel broadcast resurrects every cached-idle agent in that channel, burning a full LLM turn per agent just to read a message that may not concern them. This defeats the watchdog's purpose of releasing resources on idle.

The asymmetry is in the wake cost, not the current gating logic:
- Live-idle wake ≈ free (stdin notify, no process startup, no fresh LLM context).
- Cached-idle wake = full subprocess restart + LLM turn.

But the server treats them identically.

## Possible future improvement

Gate cached-idle restarts behind explicit targeting:
- `@mention` or DM → restart from cache (current behavior preserved for targeted messages).
- Unmentioned channel broadcast → **skip** cached-idle agents; queue via `pendingDeliveries` or rely on unread summary at next explicit wake.

Tradeoff: cached-idle agents lose ambient channel awareness between wakes. The unread-summary path (`buildUnreadSummary` in `agentProcessManager.ts`) already exists to catch them up on next restart, so the information loss is recoverable.

Implementation sketch:
- Server: in `deliverToAllAgents`, track whether the recipient is cached-idle (needs a new signal from the daemon, e.g., `agent:activity: 'online'` flips a flag on `store.agents[id]`).
- Skip delivery to cached-idle recipients when `!hasSpecificMention` and not a DM.
- Queue to `pendingDeliveries` so the unread summary on next explicit wake still includes them.
