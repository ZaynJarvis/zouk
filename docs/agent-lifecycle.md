# Agent Lifecycle

Agents have a `lifecycle` field, configurable per-agent in the CONFIG tab:

- **`persistent`** (default) — the agent's CLI session is preserved across the
  idle-cached state, so the next wake resumes the same conversation via
  `--resume <sessionId>`.
- **`ephemeral`** — the CLI session is dropped once the agent enters the
  idle-cached state, so the next wake starts fresh. Useful for QA / review /
  single-topic agents that should reset between tasks.

Setting `lifecycle = ephemeral` does NOT mean every turn ends in a reset.
Multi-turn within an active conversation still works. The reset happens only
once the agent transitions into "idle-cached" — i.e., between conversations.

## Runtime status and activity model

Zouk tracks two related but separate concepts for each agent:

| Concept | Values | Owner | Meaning |
|---------|--------|-------|---------|
| **Lifecycle status** | `active`, `stopping`, `inactive` | server, mirrored from daemon `agent:status` | Whether the server should consider this agent routable and bound to a daemon runtime. |
| **Activity** | `thinking`, `working`, `online`, `offline`, `error` | daemon, reconciled by server | What the user should see the agent doing right now. |

The important rule: **`status` is the coarse lifecycle gate; `activity` is the
fine-grained UI signal.** They must never contradict each other in server
state or frontend rendering.

Current invariants:

- `status !== active` always implies `activity = offline` and no
  `activityDetail`.
- frontend "live" and "online" indicators must require `status === active`
  before trusting `activity`.
- late non-offline activity from an inactive/stopping agent is ignored for
  runtime state and broadcast, though attached activity-log entries may still
  be persisted for diagnostics.
- activity from a stale daemon connection is dropped when a different
  connection currently owns the agent.
- `agent_idle` lifecycle health from the owner daemon is allowed to reconcile
  a stale busy activity back to `online` / `Idle`.

This means "idle" is not a server lifecycle status. An idle but wakeable agent
is still `status = active`; its visible activity should be `online` with an
idle detail, or `offline` only when the runtime is explicitly stopped or the
server marks it non-active.

## Runtime event flow

The normal path is:

1. Server sends `agent:start` to the daemon selected by the agent config.
2. Daemon starts the runtime, sends `agent:status active`, then emits
   `agent:activity` frames as the runtime thinks, uses tools, or writes output.
3. The server records the daemon socket as the current owner for that agent and
   broadcasts `agent_started`, `agent_status`, and `agent_activity` to clients.
4. At turn completion, the daemon emits `agent:activity online` with an idle
   detail and sends `daemon:health` with `reason = agent_idle`.
5. The daemon keeps stdin-capable runtimes around for the idle timeout window.
   If no new message/activity arrives, it caches the idle state and stops the
   process.

`daemon:health reason=agent_idle` is intentionally reused as a lifecycle
reconciliation signal. We do not need a separate websocket message just to say
"this agent is idle"; the existing health frame already carries the agent id,
reason, daemon owner, and ack path. The server should use it only as a
reconciliation hint from the current owner, not as a replacement for normal
activity frames.

## Codex versus Claude runtime behavior

Claude Code and Codex do not have the same process lifecycle:

- Claude Code often exits after a result. The daemon can observe process close
  soon after the turn and cache the idle state.
- Codex `app-server` can remain alive after `turn/completed`. For Codex,
  `turn/completed` maps to daemon `turn_end`; it does **not** mean the process
  exited.

Therefore Zouk correctness must not depend on "process exited" as the only
idle signal. The daemon must explicitly mark the turn idle (`online` / `Idle`),
send `agent_idle` health, and later stop/cache the process on the stdin idle
timeout if it remains unused.

Reset follows the same server/daemon contract: server reset is
`agent:stop` followed by `agent:start`. It is not Codex `turn/interrupt` or a
thread rollback. The old runtime must be stopped or made unable to write before
the new runtime becomes authoritative.

## Stale status/activity failure modes

The debugging pattern that led to this doc was an agent visibly stuck in
`working (Checking messages...)` after the daemon had already observed an idle
turn. The root cause was stale writer behavior, not an absence of a new
lifecycle state:

- an old Codex app-server/chat-bridge process survived beyond the daemon state
  that had marked it idle/stopped;
- that old process later received a no-op wake/check and emitted busy activity;
- the server accepted the late busy activity, overwriting the correct idle
  activity;
- in other cases, a daemon reconnect can leave older websocket connections or
  activity frames racing with the current owner.

The fixes and safeguards are layered:

1. Server non-active transitions normalize activity to `offline` and broadcast
   the offline activity frame with the status change.
2. Frontend live/online derivation requires `status === active`; raw activity
   alone is not enough.
3. Server drops late non-offline activity while `status !== active`.
4. Server drops activity from stale daemon websocket owners.
5. Owner daemon `agent_idle` health reconciles active stale-busy state to
   `online` / `Idle`.
6. Daemon process management must guard stdout/stderr and busy heartbeat writes
   by current process ownership, terminate descendant process trees on
   stop/idle-timeout, and reap orphan local runtimes with the same
   `--agent-id` + `--server-url` before start/reset restart.

The last item is a defensive cleanup/backstop, not the primary lifecycle
mechanism. Normal correctness should come from tracked stop/start sequencing,
current-owner guards, and server-side state reconciliation. The orphan sweep is
still valuable because daemon crashes/restarts lose in-memory process tracking.

## Debugging checklist for wrong status/activity

When an agent appears stuck, first determine whether the contradiction is in
server state, daemon state, or a stale local process.

1. Identify the agent id, configured machine, and current server state:
   `status`, `activity`, `activityDetail`, `machineId`.
2. Check server logs for the relevant sequence:
   `agent:status`, `agent:activity`, `daemon:health reason=agent_idle`,
   daemon `ready`, stale-owner drops, and non-active activity drops.
3. Check daemon logs for the same agent:
   `agent:start`, `agent:deliver`, runtime result/`turn_end`,
   `agent_idle` health, idle timeout, process exit, and reconnect/no-inbound
   watchdog lines.
4. Inspect local processes on the owning machine for runtime chains with the
   same `--agent-id` and `--server-url`. A suspicious chain usually contains
   `codex app-server` or a runtime process plus `chat-bridge`.
5. Distinguish daemon-managed runtimes from unrelated manual terminals. A
   bare `codex` or `codex resume` process without `--agent-id` and without a
   Zouk `chat-bridge` is not a Zouk activity writer.
6. If a daemon had repeated `No inbound traffic for 70s` reconnect loops,
   debug websocket liveness separately from agent process cleanup. A daemon may
   still send health/start upstream while downlink delivery is broken or routed
   to a stale connection.

Do not fix a wrong status by adding another status enum unless the existing
status/activity/health signals cannot express the state. Most observed wrong
status bugs so far were caused by stale writers, missing reconciliation, or UI
derivation that trusted activity without checking lifecycle status.

## Visual cue

Ephemeral agent avatars render with a **dashed border** and **slightly reduced
saturation** so they are visually distinguishable from persistent agents
without being noisy. The cue applies to all avatar render sites
(ChannelSidebar, AgentPanel, AgentProfilePanel, AgentDetail, MembersPanel).

## When the toggle takes effect

The `lifecycle` field is sent to the daemon via the `agent:start` payload, so
**a value change takes effect on the next agent restart**. The avatar filter
re-renders immediately (it reads from `agent.lifecycle` on every paint), but
the daemon-side reset behavior only updates when the agent process is
re-launched.

## How agents enter idle-cached state

### stdin-true drivers (claude / codex / hermes / kimi / coco / opencode)

These drivers keep one long-lived CLI process alive across many turns. After
`turn_end`, the daemon starts a **70-second idle timeout**. If no new message
or activity arrives before the timer fires, the daemon kills the process
(SIGTERM). The close handler then caches the agent's `sessionId` in
`idleAgentConfigs` — the agent is now idle-cached.

Default timeout: **70 seconds**. Configurable via:

- `AgentProcessManagerOptions.stdinIdleTimeoutMs` (constructor option, used
  by tests)
- `ZOUK_STDIN_IDLE_TIMEOUT_MS` env var (override at daemon startup)

The timer is cancelled whenever the agent receives a message or emits any
activity event (thinking, text, tool_call).

### stdin-false drivers (gemini / cursor / copilot / vikingbot)

These drivers exit with code 0 at every `turn_end`. The daemon caches the
agent into `idleAgentConfigs` immediately on exit.

## Idle delivery and wake policy

There are two idle flavors:

| Flavor | Subprocess | Daemon-side state | Server-side `status` |
|--------|------------|-------------------|----------------------|
| **Live idle** | alive, waiting on stdin | process is idle | `active` |
| **Cached idle** | stopped | config parked in `idleAgentConfigs` | `active` |

Both states are wakeable, so both remain `active` on the server. A targeted DM
or `@mention` can wake either form. The difference is cost:

- live idle wake is cheap: send a stdin notification to an existing process.
- cached idle wake restarts the runtime and spends a full turn.

Current delivery routing selects recipients before the daemon decides how to
wake them. If the router selects a cached-idle agent, the daemon restarts it.
Future routing may choose to avoid restarting cached-idle agents for
unmentioned channel broadcasts and instead rely on queued delivery or unread
summary at the next explicit wake. That optimization belongs in delivery
routing; it should not introduce a new lifecycle status.

## How ephemeral vs persistent differs

The **only** behavioral difference between `persistent` and `ephemeral` is
what happens at **wake time** (not cache time):

- **persistent**: the cached `sessionId` is passed to the new process via
  `--resume <sessionId>`, continuing the previous conversation.
- **ephemeral**: the cached `sessionId` is discarded; the agent starts a
  fresh session.

The idle cache always stores the real `sessionId` regardless of lifecycle.
This keeps the design simple and avoids separate code paths for
stdin-true vs stdin-false ephemeral agents.

## Where the code lives

| Concern | File |
|---------|------|
| Daemon: lifecycle field | `zouk-daemon/src/drivers/types.ts` |
| Daemon: cache policy | `zouk-daemon/src/agentProcessManager.ts` (`cacheIdleAgent`, `clearIdleAgent`) |
| Daemon: tests | `zouk-daemon/tests/agent-lifecycle-ephemeral.test.ts` |
| Server: schema | `zouk/schema.sql` (`agent_configs.lifecycle`). Auto-loaded on every server boot via `db.js migrate()`; the `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` line lands automatically on existing deployments. |
| Server: persistence | `zouk/server/db.js` (`saveAgentConfig`, `loadAgentConfigs`) |
| Server: agent:start payload | `zouk/server/index.js` (`startAgentOnDaemon`) |
| Server: web broadcast | `zouk/server/index.js` (`agentPayload`) |
| Web: types | `zouk/web/src/types/index.ts` (`ServerAgent.lifecycle`, `AgentConfig.lifecycle`) |
| Web: settings UI | `zouk/web/src/components/AgentDetail.tsx` (LIFECYCLE toggle in CONFIG tab) |
| Web: avatar filter | `zouk/web/src/lib/avatarStatus.ts` (`avatarPaletteClass(..., lifecycle)`, `agentLifecycle()`) |

## Storage of `sessionId`

Verified 2026-04-26: agent CLI `sessionId` lives **purely in memory** across
both daemon and server. It is **not** persisted to the agent_configs table or
any other DB table. There are three storage points, all in-memory:

1. `zouk-daemon/src/agentProcessManager.ts` `agentProcesses[id].sessionId`
   (active process)
2. `zouk-daemon/src/agentProcessManager.ts` `idleAgentConfigs` (idle cache)
3. `zouk/server/index.js` `store.agents[id].sessionId` (runtime mirror)

This means:

- Daemon restart = automatic fresh session for **all** agents (regardless of
  lifecycle).
- The ephemeral lifecycle's "drop sessionId" logic therefore only needs to
  touch the daemon-side cache. No server-side schema / payload change is
  needed for the reset itself — the schema column exists only to let the user
  configure the policy.
