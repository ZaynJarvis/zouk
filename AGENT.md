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
