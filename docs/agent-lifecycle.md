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

## Design compromise: stdin-true vs stdin-false drivers

The two driver families implement the "drop sessionId on entering idle cached"
semantic differently. This asymmetry is intentional.

### stdin-true drivers (claude / codex / hermes / kimi / coco / opencode)

These drivers keep one long-lived CLI process alive across many turns. The
process only dies on:

- explicit stopAgent (UI stop button or `agent:stop` message)
- daemon shutdown / restart
- a crash

For ephemeral lifecycle, the daemon does **not** force-kill these processes
mid-conversation. The "idle cached" transition for stdin-true is the moment
the process actually dies — and at that moment the daemon's close handler
caches `sessionId: null`. So the reset is **deferred until natural process
death**.

> **Practical implication**: an ephemeral claude agent will multi-turn for as
> long as you keep talking to it (or until daemon restart / stop). It does NOT
> auto-reset after N idle minutes. That is the trade-off — we don't want to
> kill an actively engaged Claude session just because there's a lull.

### stdin-false drivers (gemini / cursor / copilot / vikingbot)

These drivers exit with code 0 at every `turn_end`. The daemon caches the
agent into `idleAgentConfigs` for the next wake, with `--resume <sessionId>`
preserved.

For ephemeral lifecycle, the daemon arms an **idle cleanup timer** when it
enters this cached state. If a new message arrives before the timer fires
(e.g. you reply within 5 minutes), the timer is cancelled and multi-turn
continues normally with `--resume`. If the timer fires first, the cached
`sessionId` is overwritten with `null`, and the next wake cold-starts a fresh
session.

Default delay: **5 minutes**. Configurable via:

- `AgentProcessManagerOptions.ephemeralIdleCleanupMs` (constructor option, used
  by tests)
- `ZOUK_EPHEMERAL_IDLE_CLEANUP_MS` env var (override at daemon startup)

### Why the asymmetry

In one sentence: **we never want to force-kill a long-lived stdin-true
process just to reset its session.** The cost of killing a multi-tool, warm
Claude/Codex session mid-conversation outweighs the benefit of a fixed-window
auto-reset. For stdin-false drivers there's no such cost — the process exits
on every turn anyway — so a timer-based reset is essentially free.

The user-facing consequence is that ephemeral semantics are stricter on
stdin-false agents (auto-reset after 5min idle) and looser on stdin-true
agents (reset on natural process death only). If you need a hard reset on a
stdin-true agent, click STOP_AGENT in the CONFIG tab; the next start will be
fresh.

## Where the code lives

| Concern | File |
|---------|------|
| Daemon: lifecycle field | `zouk-daemon/src/drivers/types.ts` |
| Daemon: cache policy | `zouk-daemon/src/agentProcessManager.ts` (`cacheIdleAgent`, `clearIdleAgent`) |
| Daemon: tests | `zouk-daemon/tests/agent-lifecycle-ephemeral.test.ts` |
| Server: schema | `zouk/SUPABASE_SETUP.sql` (`agent_configs.lifecycle`) |
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
