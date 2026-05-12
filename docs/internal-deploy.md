# ByteDance Internal Deployment (SCM → ICM → TCE)

How to ship `zouk` to the intranet. Companion to `build.sh` at the repo root.

Out of scope for this doc: Feishu/Lark SSO wiring — done as a separate milestone after the SCM/ICM/TCE pipeline is green.

## 1. SCM (code → artifact)

Platform: `https://cloud.bytedance.net/scm`

Fill in the SCM web UI with:

| Field | Value |
| --- | --- |
| Source repo | the Codebase URL for this repo |
| Default branch | `main` |
| Compile image | `debian.bullseye.python311_node20` (Node 20) |
| Build command | `bash build.sh` |
| Artifact output dir | `output` |

What `build.sh` does:

1. Points `npm` at `https://bnpm.byted.org/` (override with `NPM_REGISTRY=...` for local smoke).
2. `npm ci --include=dev` at the repo root (Vite needs dev deps).
3. `npm run build --workspace=web` → `web/dist/`.
4. Stages `output/` with `server/`, `web/dist/`, `schema.sql`, trimmed `package.json`.
5. Strips test files and the `web` workspace from the artifact manifest, then runs `npm install --omit=dev --omit=optional` inside `output/` for a prod-only `node_modules/`.
6. Writes `output/bootstrap.sh` — TCE's entrypoint.

Verify locally before pushing:

```bash
NPM_REGISTRY=https://registry.npmjs.org/ bash build.sh
cd output && PORT=17777 node server/index.js   # sanity boot
curl http://localhost:17777/health             # → {"ok":true,"uptime":...}
```

## 2. ICM (artifact → image)

SCM auto-publishes the contents of `output/` to ICM after a successful build. No code changes needed. Confirm in the SCM build log that the ICM tag is produced; TCE pulls that tag.

## 3. TCE (image → running service)

Platform: `https://cloud.bytedance.net/tce`

Create a service with:

| Field | Value |
| --- | --- |
| Image source | the ICM package produced by SCM |
| Start command | `bash output/bootstrap.sh` (or `bash bootstrap.sh` depending on TCE's working dir) |
| Primary port | `7777`. Container listens on 7777; if you need to change it, set `ZOUK_PORT` (not `PORT` — see Optional ops knobs below). |
| Health check path | `/health` |
| Health check method | HTTP GET, expect 200 |
| Resource | start with `1C2G × 1` for BOE, scale on Online |

### Environment variables

Required:

| Var | Purpose |
| --- | --- |
| `PUBLIC_URL` | external base URL (e.g. `https://zouk.bytedance.net`) — used to compose OAuth callback URLs |
| `DATABASE_URL` | internal PostgreSQL connection string (Volcano RDS). Without it, the server runs in-memory and loses state on restart. |
| `ALLOW` | comma-separated allowlist; gates session minting. Each entry is either an exact email (`alice@bytedance.com`) or a domain rule starting with `@` (`@bytedance.com` lets the whole tenant in). Mix freely. |

Optional ops knobs:

| Var | Purpose |
| --- | --- |
| `ZOUK_PORT` | In-container listen port. Defaults to `7777`. **Do not use `PORT`** — TCE injects `PORT` as the dynamic host-side port when a primary port is configured, which would make Node listen on the wrong port. `bootstrap.sh` deliberately ignores `PORT` and respects `ZOUK_PORT` instead. |
| `ZOUK_LOG_DIR` | Directory for the tee'd stdout/stderr log file. Defaults to `/opt/tiger/zouk/log`, falls back to `/tmp/zouk` if that path isn't writable. Tail with `tail -f $ZOUK_LOG_DIR/server.log` from the TCE webshell. |

Feishu SSO (set both `*_APP_ID` and `*_APP_SECRET` to enable; `/api/auth/config` surfaces `feishuEnabled: true`):

| Var | Purpose |
| --- | --- |
| `FEISHU_APP_ID` | open.feishu.cn app id (`cli_…` prefix). |
| `FEISHU_APP_SECRET` | open.feishu.cn app secret. |
| `FEISHU_REDIRECT_URI` | Callback URL registered with the Feishu app. Defaults to `${PUBLIC_URL}/api/oauth2/feishu/callback`. |
| `FEISHU_AUTHORIZE_URL` | Authorize endpoint. Defaults to `https://open.feishu.cn/open-apis/authen/v1/index`; override for Lark or custom hosts. |
| `FEISHU_SCOPE` | Space-separated scope list. Defaults to `contact:user.email:readonly contact:user.employee_id:readonly` — the app's open-platform permission page must have these enabled. |

Optional (defer until needed):

| Var | Purpose |
| --- | --- |
| `ZOUK_UPLOADS_DIR` | persistent volume mount for attachments (default: `<repo>/uploads`, which is ephemeral inside a pod) |
| `ZOUK_CONFIG_DIR` | persistent volume mount for `agent-configs.json`, `sessions.json`, etc. |
| `OPENVIKING_URL` | internal OpenViking endpoint |
| `OPENVIKING_ROOT_KEY` | new-format root key (`base64url(account).base64url(user).base64url(secret)`) |
| `MAX_IN_MEMORY_MESSAGES` | message cap before LRU eviction (default 5000) |

Will be added in the Feishu SSO milestone (not needed yet): `FEISHU_CLIENT_ID`, `FEISHU_CLIENT_SECRET`, `FEISHU_REDIRECT_URI`, etc. The existing `GOOGLE_CLIENT_ID` / `SUPABASE_*` paths can stay empty — they're no-ops when unset.

### Persistence note

`server/storage.js` writes attachments to local disk, and `server/index.js` writes config JSON to `ZOUK_CONFIG_DIR`. TCE pods have ephemeral disk; either:

- Mount a persistent volume at `/data/uploads` and `/data/config`, then set `ZOUK_UPLOADS_DIR=/data/uploads` and `ZOUK_CONFIG_DIR=/data/config`, or
- Rely solely on `DATABASE_URL` for state (messages, channels, tasks) and accept that attachments uploaded between deploys are lost. Tolerable for BOE smoke; not for Online.

## 4. Post-deploy verification checklist

1. `curl https://<service>/health` → 200 `{"ok":true,...}`
2. Open the web UI in a browser — should render the frontend (served from `web/dist`).
3. WebSocket: hit `wss://<service>/ws` — should upgrade.
4. Server logs should show `[db] Loaded N messages` (PG wired correctly) instead of `[db] DATABASE_URL not set`.
5. Submit a daemon connect with `key=test` only in non-prod (`NODE_ENV` not starting with `prod`). `bootstrap.sh` sets `NODE_ENV=production` by default; override with TCE env if you want dev keys to work in BOE.

## 5. Feishu SSO

Server-driven OAuth redirect flow over the Feishu Open Platform (open.feishu.cn). Two routes (`server/index.js`):

- `GET /api/auth/feishu/start` — generates a CSRF state, 302s to `FEISHU_AUTHORIZE_URL` with `app_id` / `redirect_uri` / `scope` / `state` (note: Feishu requires `redirect_uri`, not `redirect_url`).
- `GET /api/oauth2/feishu/callback` — uses `@larksuiteoapi/node-sdk`'s `client.authen.accessToken.create({ data: { grant_type: 'authorization_code', code } })` to swap the code; the SDK transparently fetches and caches an `app_access_token` for the auth header. The same response carries `name`, `avatar_url`, `email`, `enterprise_email`, `open_id`, `user_id`, so no second `user_info` round-trip is needed.

The frontend (`web/src/App.tsx → AppWithAuth`) strips the query params and stores the token before bootstrapping the rest of the app — same shape as the Supabase magic-link path. `LoginScreen` shows a "Sign in with Feishu" button when `/api/auth/config` reports `feishuEnabled: true`.

### Registering the open.feishu.cn app

Follow the steps from "【技术方案】平台接入飞书登录" (PDF). Briefly:

1. Visit `https://open.feishu.cn`, create a **企业自建应用**, add a **网页应用** capability.
2. **网页应用 → 桌面端主页**: the service URL (e.g. `https://zouk.bytedance.net`).
3. **安全设置 → 重定向 URL**: add `${PUBLIC_URL}/api/oauth2/feishu/callback`. Multiple environments (BOE/Online) can be added side-by-side.
4. **权限管理**: enable the scopes listed in `FEISHU_SCOPE` (`contact:user.email:readonly`, `contact:user.employee_id:readonly`).
5. **应用发布 → 版本发布**: pick a 可用范围 broad enough for everyone who'll log in (default is just yourself).
6. Copy 凭证与基础信息 → `App ID` / `App Secret`, set them as `FEISHU_APP_ID` / `FEISHU_APP_SECRET` on TCE.

### Allowlist behavior with Feishu

`isEmailAllowed` runs on the email claim. Three sensible defaults:

- `ALLOW=@bytedance.com` — anyone with a `*@bytedance.com` Feishu account gets in. Recommended for a tenant-wide tool.
- `ALLOW=alice@bytedance.com,bob@bytedance.com` — explicit roster.
- Leave `ALLOW` unset — the zouk-side gate is open and the anycross app's own visibility settings (visible to specific employees / departments) are the only gate.

### Once Feishu is canonical

Delete `/api/auth/google` and `/api/auth/supabase`, drop `google-auth-library` and `@supabase/supabase-js` deps, remove the corresponding `LoginScreen` branches, and clean up `web/src/lib/supabase.ts`. Out of scope for this milestone; do it in a follow-up after Feishu has been the only login path in production for a release cycle.
