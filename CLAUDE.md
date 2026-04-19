# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is Zouk

Zouk is a local-first agent collaboration platform — a Slack-like chat UI where humans and AI agents communicate in channels and DMs. It combines a Node/Express + WebSocket backend with a React/Vite frontend in a monorepo.

## Commands

```bash
npm install          # install all workspace dependencies (root, server, web)
npm run dev          # start both server (:7777) and frontend (:5173) via bin/start.js
npm run server       # server only
npm run web:dev      # frontend only (Vite dev server)
npm run build        # build frontend bundle (web workspace)

# Frontend-specific (run from web/):
npm run lint         # ESLint (flat config, TS + React)
npm run typecheck    # tsc --noEmit against tsconfig.app.json
```

There are no test suites configured.

## Architecture

**Monorepo structure** — npm workspaces: `server` and `web`. Root package.json orchestrates both.

### Server (`server/`)

Plain Node.js (CommonJS, no transpilation). Single entry point `index.js`.

- **Express REST API** at `/api/*` — messages, channels, agents, attachments, auth, machine keys
- **WebSocket** on the same HTTP server — two connection paths:
  - `/ws` for browser clients (receives `init` payload with full state on connect)
  - `/daemon/connect` for daemon processes (authenticated via API key query param)
- **In-memory store** (`store` object in index.js) — channels, messages, agents, tasks, attachments. This is the source of truth at runtime.
- **Supabase persistence** (`db.js`) — optional. When `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` are set, messages/channels/tasks/configs are persisted. Falls back to in-memory + JSON files in `data/` when absent.
- **Agent lifecycle** — agents register via daemon WebSocket, server tracks status/activity and broadcasts to browser clients. Agent configs are persisted to `data/agent-configs.json` (or Supabase).
- **Auth** — optional Google OAuth (`GOOGLE_CLIENT_ID`). Without it, the app runs in open/anonymous mode.

### Frontend (`web/`)

React 18 + TypeScript + Vite + Tailwind CSS.

- **State management** — single `useAppStore` hook (`store/appStore.ts`) wrapped in React Context (`store/AppContext.tsx`). All global state lives here. Access via `useApp()`.
- **WebSocket client** — `lib/ws.ts` (`SlockWebSocket` class). Connects to server, handles reconnection, dispatches typed events. The store listens to WS events and updates state.
- **REST client** — `lib/api.ts`. All API calls go through exported functions here. `normalizeMessage()` converts between server camelCase and frontend snake_case.
- **Theming** — three themes (night-city, brutalist, washington-post) in `themes/`. Applied via `data-theme` attribute on `<html>`. Each theme has its own CSS and `ThemeSelectButton` component. Default is `night-city`.
- **Views** — `viewMode` state drives what renders in the main area: `channel`, `dm`, `threads`, or `agents`.
- **Components** — flat structure in `components/`. Key ones: `MessageList`/`MessageComposer` (chat), `ChannelSidebar` (nav), `AgentPanel` (agent management), `WorkspaceRail` (left icon bar).

### Communication Flow

Browser connects via WebSocket -> receives `init` event with channels/agents/humans/configs/machines -> store hydrates -> REST API for mutations (send message, create channel, start agent) -> server broadcasts changes to all connected WS clients.

## Environment Variables

| Variable | Where | Purpose |
|---|---|---|
| `VITE_SLOCK_SERVER_URL` | web | Override server URL (defaults to same origin) |
| `PUBLIC_URL` | server | Public URL for agent callbacks (defaults to `http://localhost:PORT`) |
| `SUPABASE_URL` | server | Enable Supabase persistence |
| `SUPABASE_SERVICE_KEY` | server | Supabase service role key |
| `GOOGLE_CLIENT_ID` | server | Enable Google OAuth login |
| `PORT` / `SERVER_PORT` | server | Server port (default 7777) |
| `WEB_PORT` | bin/start.js | Vite dev port (default 5173) |

## QA Testing

Playwright-based automated UI tests live in `web/scripts/`.

### Quick run
```bash
cd web
node scripts/qa-runner.mjs                    # all 9 tests (runs in parallel, ~40s)
node scripts/qa-runner.mjs --pr 61,62         # tests for specific PRs only
node scripts/qa-runner.mjs --url http://localhost:7777 --out /tmp/qa
```

### Before running — always rebuild first
The server at `:7777` serves `web/dist/`. If source has changed since the last build, screenshots reflect stale code:
```bash
cd web && npm run build   # then restart the server (kill + node bin/start.js &)
```

### How it works
- Single `chromium` browser; each test gets its own context running **in parallel**
- WebSocket `init` event is mocked via `routeWebSocket` — no real daemon needed
- Auth token `qa-test-token-2026` injected via `localStorage` (token pre-loaded in `data/sessions.json`)
- One screenshot per test (final assertion only); console prints one line per PASS, details on FAIL
- Exit code 1 if any test fails (CI-friendly)
- Shared helpers in `web/scripts/qa-lib.mjs`: `loadApp()`, `mockWS()`, `setupAuth()`, fake data constants

### Adding a test
1. Write `async function testNN(page, out) → { pass, note, screenshotPath? }` in `qa-runner.mjs`
2. Register it in the `TESTS` array: `{ id: NN, prs: [PR_NUMBER], name: '...', fn: testNN }`
3. Rebuild the frontend before running if the test targets new UI changes

### Selector gotchas (lessons learned)
- `hasText` filter is **case-insensitive** — use `getByRole('button', { name: 'X', exact: true })` when you need exact match (e.g. CONFIG tab vs "Configs (2)")
- AgentDetail `SettingsTab` only mounts when the CONFIG tab is active; inputs inside won't appear until then
- The file `<input type="file" class="hidden">` is in the DOM but not visible — skip with `input:visible` or filter by value
- Some inputs lack a `type` attribute (default=text) — `input[type="text"]` won't match them; filter by value or placeholder instead
- WorkspaceRail renders multiple theme-variant branches; count only **visible** settings gear buttons

## Known Platform Gotchas

- **iOS WebSocket silent disconnect** — iOS kills WebSocket TCP connections when the PWA is backgrounded without firing `onclose`. `readyState` stays `OPEN` but no frames arrive. Fix: `visibilitychange` listener in `web/src/lib/ws.ts`. Full explanation + proof links in `docs/ios-websocket-reconnect.md`.

## Key Conventions

- Server uses **camelCase** internally; frontend types use **snake_case**. The `normalizeMessage()` function in `lib/api.ts` bridges the two.
- The `"1007"` and `"test"` API keys are accepted for daemon auth in non-production mode.
- Agent configs survive restarts via `data/agent-configs.json` (file-based) or Supabase `agent_configs` table.
- DM channel names use canonical sorted pairs: `dm:alice,zeus`.
