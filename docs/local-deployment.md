# Local Deployment

End-to-end recipe for running zouk-server locally against a real PostgreSQL
backend (not the in-memory fallback). Verified on macOS 25 / Apple Silicon
with PostgreSQL 16 from Homebrew and Node 25.

The default-workspace guest path keeps working out of the box, so you don't
need Google OAuth or Supabase to log in. If you want a guest session to behave
like a workspace owner (manage members, allowlist, settings), flip the
`ZOUK_GUEST_ELEVATED` env flag described below.

## 1. Prerequisites

- macOS / Linux with Node ≥ 20 and `npm`.
- Homebrew (macOS) or your distro's package manager.
- ~150 MB free for PostgreSQL.

## 2. Install and start PostgreSQL

```bash
brew install postgresql@16
brew services start postgresql@16

# Sanity check
/opt/homebrew/opt/postgresql@16/bin/psql -d postgres -c "SELECT version();"
```

Linux equivalent: `apt install postgresql-16` (or your distro's package),
`sudo systemctl start postgresql`, then `sudo -u postgres psql`.

## 3. Create the `zouk` database

```bash
# macOS Homebrew installs PG with the current $USER as superuser, no password.
/opt/homebrew/opt/postgresql@16/bin/createdb zouk
```

Schema migration is automatic — `server/db.js migrate()` runs every statement
in `schema.sql` on each server boot. No manual `psql -f schema.sql` needed.

## 4. Install JS dependencies and build the frontend

```bash
cd zouk-server
npm install            # installs root + server + web workspaces
npm run build          # builds web/dist (Express serves this in single-port mode)
```

`npm run build` is only needed if you plan to hit the server's public URL
(`http://localhost:7777/`) directly. If you run `npm run dev`, Vite serves the
frontend separately at `:5173` and the build step is optional.

## 5. Configure environment variables

Create `zouk-server/.env.local` (or export inline) with:

```bash
# Required for persistence
DATABASE_URL="postgresql://$USER@localhost:5432/zouk"
DATABASE_SSL=false       # local PG has no TLS; default is rejectUnauthorized:false

# Optional: bump server port from 7777
PORT=7777

# Optional: let guest sessions admin the default workspace (see §7)
ZOUK_GUEST_ELEVATED=1
```

The server uses `process.env` directly (no dotenv autoload), so either
`source` the file or pass the vars on the CLI:

```bash
export $(grep -v '^#' .env.local | xargs)
```

Variables you can ignore unless you actually need them:

| Var | Purpose |
| --- | --- |
| `GOOGLE_CLIENT_ID` | Enables Google OAuth login. Leave unset for guest-only mode. |
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` | Enables Supabase magic-link login. |
| `ALLOW` | Comma-separated email allowlist. Setting this disables guest login entirely. |
| `ZOUK_SUPERUSERS` | Comma-separated emails granted root on every workspace. |

## 6. Start the server

Single-port mode (Express serves `web/dist`):

```bash
npm run server
# or
node server/index.js
```

You should see:

```
[db] PostgreSQL persistence enabled
[auth] ZOUK_GUEST_ELEVATED=1 — guest sessions get root on default workspace (dev only)
[db] Auto-migration complete — all tables verified
🚀 Zouk server running on http://localhost:7777
```

Two-port dev mode (Vite hot-reload on `:5173`, API on `:7777`):

```bash
npm run dev
```

Open `http://localhost:7777` (or `http://localhost:5173` in dev mode) and
click **Continue as Guest**. With no `GOOGLE_CLIENT_ID` set, the server mints
a real session token even for guests, so you can send messages, claim tasks,
and manage agents without OAuth.

## 7. Elevated guest mode (optional)

By default, guests are workspace members on `default` — they can chat and run
agents but cannot invite, manage allowlist, or admin the workspace.

Set `ZOUK_GUEST_ELEVATED=1` to promote any guest session to `root` on the
default workspace. This is gated behind an explicit env flag because it
opens up admin operations to anyone with network access to the port. Never
set this in production.

What changes when the flag is on:

- Guests pass `requireWorkspaceAdmin` / `requireAuth` for default-workspace
  routes.
- Guests can invite members (`POST /api/workspaces/default/members`), manage
  the email allowlist, change workspace name/icon.
- Guests still cannot create *new* workspaces (`POST /api/workspaces` requires
  an email so the workspace can have a recorded owner). Use Google OAuth /
  Supabase magic link for multi-workspace flows.

The flag only takes effect for the `default` workspace and only when no
allowlist is active. If you set `ALLOW`, guest login is rejected before this
flag is even consulted.

## 8. Smoke test

```bash
# Mint a guest session
TOKEN=$(curl -sS -X POST http://localhost:7777/api/auth/guest-session \
  -H 'Content-Type: application/json' \
  -d '{"name":"dev-tester"}' | jq -r .token)

# Send a message to #all
curl -sS -X POST http://localhost:7777/api/messages \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"channelName":"all","channelType":"channel","content":"hello"}'

# Confirm it landed in PG
/opt/homebrew/opt/postgresql@16/bin/psql -d zouk \
  -c "SELECT seq, sender_name, content FROM messages ORDER BY seq DESC LIMIT 3;"
```

If `ZOUK_GUEST_ELEVATED=1`, also try the admin path:

```bash
curl -sS -X POST http://localhost:7777/api/workspaces/default/members \
  -H "Authorization: Bearer $TOKEN" \
  -H 'X-Workspace-Id: default' \
  -H 'Content-Type: application/json' \
  -d '{"email":"someone@example.com","role":"member"}'
```

Expect `{"ok":true,"member":{...}}`. Without the env flag the same request
returns `Workspace root/admin required.`

## 9. Connect a daemon (optional)

```bash
# In a separate clone of zouk-daemon
cd ../zouk-daemon
npx tsx src/index.ts --server-url http://localhost:7777 --api-key test
```

Dev keys `test` and `1007` are accepted without registration when
`NODE_ENV !== 'production'`. Once daemons are connected, the Machine Setup UI
in **Settings → Machines** can mint persistent `sk_machine_...` keys.

## 10. Reset / teardown

```bash
# Wipe all data, keep the schema (cheaper than dropdb)
/opt/homebrew/opt/postgresql@16/bin/psql -d zouk -c "
  TRUNCATE messages, channels, tasks, agent_configs, machine_keys,
    agent_profile_presets, email_allowlist, sessions, workspace_members,
    channel_agents, agent_activities RESTART IDENTITY CASCADE;
"

# Full reset
/opt/homebrew/opt/postgresql@16/bin/dropdb zouk
/opt/homebrew/opt/postgresql@16/bin/createdb zouk

# Stop PG
brew services stop postgresql@16
```

## Troubleshooting

- **`[db] DATABASE_URL not set — running in-memory only`** — Express is up but
  every write disappears on restart. Re-check the env var is exported in the
  same shell that runs `node server/index.js`.
- **`getaddrinfo ENOTFOUND [::1]`** — `pg` 8.x mishandles IPv6 bracket
  literals; `server/db.js buildPoolConfig()` strips brackets, but if you
  bypassed it use `127.0.0.1` instead of `localhost`.
- **`role "postgres" does not exist`** — Homebrew installs PG as your `$USER`,
  not `postgres`. Use `$USER@localhost` in `DATABASE_URL`.
- **Guest login button missing** — the frontend hides it when `ALLOW` is set,
  because an active allowlist implies "members only" and guests have no
  email to check. Unset `ALLOW` or use OAuth.
- **Stale frontend after editing `web/src`** — Express serves `web/dist`, not
  live Vite output. Re-run `npm run build` or use `npm run dev` for HMR.
