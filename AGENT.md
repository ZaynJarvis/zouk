# AGENT.md

Shared repo guide for any coding agent working in `zouk`.

Read this first. If your runtime also auto-loads `CLAUDE.md`, treat that file as a thin Claude-specific overlay on top of this one.

## Fast Start

- Product: local-first chat workspace for humans and AI agents, with channels, DMs, tasks, attachments, and agent presence/activity.
- Stack: Node/Express + WebSocket backend in `server/`, React 18 + TypeScript + Vite + Tailwind frontend in `web/`.
- Runtime shape:
  - browser clients connect to `/ws`
  - daemon processes connect to `/daemon/connect`
  - REST mutations live under `/api/*`

## First Files By Task

| Task | Read first |
| --- | --- |
| Message routing, PM/DM delivery, wake logic | `server/index.js`, `server/db.js`, `docs/idle-agent-wake.md` |
| WebSocket reconnects, init hydration, view restore | `web/src/lib/ws.ts`, `web/src/store/appStore.ts`, `docs/ios-websocket-reconnect.md` |
| Chat composer, message list, threads, side panels | `web/src/components/MessageComposer.tsx`, `web/src/components/MessageList.tsx`, `web/src/components/ThreadPanel.tsx`, `web/src/App.tsx` |
| Agent detail, activity feed, agent state types | `web/src/components/AgentDetail.tsx`, `web/src/components/agent/AgentActivityFeed.tsx`, `web/src/types/index.ts` |
| Themes and visual polish | `web/src/themes/*`, `web/src/components/SettingsModal.tsx`, `web/src/components/WorkspaceRail.tsx`, `web/src/index.css` |
| API payload shape or naming drift | `web/src/lib/api.ts`, `web/src/types/index.ts`, `server/index.js` |
| UI smoke tests and screenshot QA | `web/tests/ui-smoke.mjs`, `web/scripts/qa-runner.mjs`, `web/scripts/qa-lib.mjs` |
| Production latency / WS storm / abuse triage | `server/index.js` (search `wsTrackers`), `web/src/components/SettingsModal.tsx` (`ConnectionsSection`), and the "Production Triage" section below |

## Repo Map

- `bin/start.js`: local dev runner for server + Vite.
- `server/index.js`: main backend entry, REST routes, browser/daemon WebSocket handling, in-memory runtime store.
- `server/db.js`: optional PostgreSQL persistence helpers.
- `schema.sql`, `SUPABASE_SETUP.sql`, `migrations/`: database schema and setup artifacts.
- `web/src/store/appStore.ts`: main frontend state machine and websocket event handling.
- `web/src/lib/ws.ts`: browser websocket client and reconnect behavior.
- `web/src/lib/api.ts`: REST client and server-to-frontend normalization.
- `docs/`: targeted deep dives for tricky platform/runtime behavior.

## Common Commands

```bash
npm install
npm run dev
npm run server
npm run web:dev
npm run build
npm run test:server
npm run test:ui                 # expects a running server, default http://localhost:7777
npm run lint --workspace=web
npm run typecheck --workspace=web
node web/scripts/qa-runner.mjs --pr <PR_NUMBER>
```

## Working Rules

- Start from the task map above instead of reading the whole repo.
- Run the smallest useful verification for the change:
  - docs-only: no runtime check required
  - server behavior: `npm run test:server`
  - frontend logic/types: `npm run typecheck --workspace=web`
  - shipped UI behavior: `npm run build`, then `npm run test:ui` or targeted `qa-runner`
- Rebuild before screenshot QA if frontend source changed. The server at `:7777` serves `web/dist`, not live Vite output.

## Task Workflow

- `claim_tasks(task_numbers=[...])` claims an existing task by task-board number.
- `claim_tasks(message_ids=[...])` only claims an existing task by the top-level task message id that already backs that task. It does not convert a regular message into a task.
- If work starts from a normal top-level message, create a new task explicitly with `create_tasks(...)`. Reword the title if needed, then reply in-channel or in the relevant thread so humans can see which new task tracks the work.
- Thread replies are discussion context, not claimable tasks.

## High-Value Conventions

- Server payloads are mostly camelCase; frontend types lean snake_case. `normalizeMessage()` in `web/src/lib/api.ts` bridges the mismatch.
- DM channel names use canonical sorted pairs such as `dm:alice,zeus`.
- Non-production daemon auth accepts API keys `"1007"` and `"test"`.
- Hover-only visibility is not enough on touch devices. If a control is hidden behind `hover:` / `group-hover:`, add a touch fallback such as `[@media(pointer:coarse)]:opacity-100` or an explicit tap path.

## Deep Dives

- `docs/ios-websocket-reconnect.md`: why iOS PWAs can keep a zombie websocket and how `visibilitychange` recovery works.
- `docs/idle-agent-wake.md`: current idle/live-idle/cached-idle wake behavior and why untargeted broadcasts are expensive.

## Production Triage (Railway)

Production server is on Railway, single replica in `asia-southeast1`. Built-in Railway metrics only cover infra (CPU / memory / network bytes); app-level signals (WS connection rate, init payload work, store sizes) are NOT visible there. Use the in-app surfaces below first.

### Live state without leaving the app

- **`Settings → CONNECTIONS`** — per-client `/ws` activity (open count, conn/min, blocked status, owner). `Revoke` deletes the auth session and force-closes any open sockets. Auto-blocks last 5 min; manual revokes 24h. All blocks live in process memory and reset on redeploy — that is expected; revoked auth sessions persist (Supabase) so the dead token stays dead.
- **`GET /api/_internal/ws-clients`** (auth required) — same data as JSON. Response includes `callerId` so a UI can mark "you".
- **`GET /api/_internal/stats`** (auth required) — store/index sizes, in-memory message cap, socket counts. Curl this first when "feels slow" reports come in (`zouk 收发消息都很慢` style).

### Railway CLI

```bash
railway link --project zouk-internal --environment production --service server
railway status --json    # latest deployment shape, status, image digest
railway logs --deployment   # runtime logs (use grep/uniq to count event types)
railway logs --build --json # build pipeline; --json so you can filter
```

Deploy *history* isn't paginated by the CLI — hit GraphQL directly with the access token from `~/.railway/config.json` against `https://backboard.railway.com/graphql/v2` (`deployments(input:{projectId,environmentId,serviceId})`). `status: "REMOVED"` = superseded by a newer deploy, NOT failed; only `FAILED` / `CRASHED` are real failures.

### Latency triage decision tree

- **Flat slow on every request** → CDN / network / origin reach. Inspect `cf-cache-status`, `x-railway-edge`, `x-cache` response headers from `curl -I`.
- **Bimodal (some fast, some pinned at the same wall-clock value, e.g. ~12s)** → event-loop block on the single replica. Requests queue behind whatever sync work is hogging the tick. Look for:
  - WS connect storms — `railway logs --deployment` for ~6s, then `sort | uniq -c` on the output. Anything above ~5/s of `[web] Client connected` is suspicious; the production incident that motivated the defense layer was ~40/s.
  - Large sync `JSON.stringify` on hot paths (the WS init payload was the offender; #191 deferred it via `setImmediate`).
  - Unbounded array scans (#190 indexed `store.messages` — `findThreadParentId` had been O(L*N) per fetch).
- **Single replica burst latency** that survives the fixes above → consider `setImmediate` to spread sync work across ticks; pattern lives in `handleWebConnection`'s init send.

### WS abuse model

The defense layer (`server/index.js`, search `wsTrackers`) classifies each `/ws` upgrade attempt into three buckets, each with its own auto-block:

| kind | Trigger | Threshold | Block | Surface |
| --- | --- | --- | --- | --- |
| `token` | Valid session token | 12 connects / 60s | 5 min, HTTP 429 | CONNECTIONS row, status `STORMING` → `AUTO-BLOCKED` |
| `ip` | No token (guest) | 12 connects / 60s | 5 min, HTTP 429 | `guest@<ip>` row |
| `invalid_token` | Token sent but unknown to authSessions | 3 strikes / 60s | 24h, HTTP 401 then 429 | `bad-token@<ip>` row, status `BAD-TOKEN` |

`invalid_token` upgrades are rejected *before* the upgrade completes — no init payload, no event-loop cost beyond the parse. Manual revokes from the UI also delete the auth session (Supabase + memory) so the dead token survives a redeploy even though the in-memory block does not.
