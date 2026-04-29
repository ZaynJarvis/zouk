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
