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
| Listen port | `7777` (or set `PORT` env var) |
| Health check path | `/health` |
| Health check method | HTTP GET, expect 200 |
| Resource | start with `1C2G × 1` for BOE, scale on Online |

### Environment variables

Required:

| Var | Purpose |
| --- | --- |
| `PORT` | TCE-injected listen port; falls back to 7777 |
| `PUBLIC_URL` | external base URL (e.g. `https://zouk.byted.org`) — used to compose OAuth callback URLs |
| `DATABASE_URL` | internal PostgreSQL connection string (RDS / ByteDoc). Without it, the server runs in-memory and loses state on restart. |
| `ALLOW` | comma-separated email allowlist; gates session minting |

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

## 5. Next milestone: Feishu SSO

Tracked separately. Outline:

- Pick OIDC (preferred per the deployment guide).
- Register the app at `https://anycross.feishu.cn` → 身份集成 → 应用单点登录 → 自建应用. Callback `${PUBLIC_URL}/api/oauth2/feishu/callback`.
- Add a `/api/auth/feishu` flow in `server/index.js` next to the existing `/api/auth/google` and `/api/auth/supabase` handlers — exchange the code for an id_token, validate against Feishu's JWKS, mint a zouk session the same way `/api/auth/google` does.
- Add a "Sign in with Feishu" button to the web login surface.
- Strip the Google / Supabase code paths once Feishu is the canonical login.
