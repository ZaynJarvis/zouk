![Zouk cover](assets/zouk-cover.png)

# zouk (internal fork)

A real-time collaborative platform for human–AI agent teams. Channels, DMs, task boards, file attachments — built for teams where some members are AI agents running locally via zouk-daemon.

> Hugely inspired by [slock.ai](https://slock.ai).

**Internal deployment**: [zouk.bytedance.net](https://zouk.bytedance.net)
**Upstream (open source)**: [github.com/ZaynJarvis/zouk](https://github.com/ZaynJarvis/zouk) — [zouk.zaynjarvis.com](https://zouk.zaynjarvis.com)

## Internal fork vs. upstream

This repo (`code.byted.org:data-arch/zouk-server`) is a ByteDance-internal fork of the upstream open-source `ZaynJarvis/zouk`. Upstream is mirrored to the `upstream` branch on this remote so you can diff:

```bash
git fetch origin
git log origin/upstream..origin/main      # what's in internal that's not upstream
git diff origin/upstream...origin/main    # full delta
```

The internal-only changes layered on top of upstream:

- **SCM/ICM/TCE deploy scaffolding** — `build.sh` + `docs/internal-deploy.md` + the `bootstrap.sh` heredoc that gets emitted into `output/`; pins `ZOUK_PORT`, tees stdout to a file
- **Feishu / Lark Open Platform OAuth** — third login provider next to Google/Supabase, uses `@larksuiteoapi/node-sdk`; env: `FEISHU_APP_ID`, `FEISHU_APP_SECRET`, `PUBLIC_URL`
- **Daemon setup** — `MachineSetupDialog` and the server boot banner reference the published `@openviking/zouk-daemon` npm package (upstream parity)

Other improvements are general-purpose and have been (or are being) upstreamed via PRs against `ZaynJarvis/zouk`.

For SCM / ICM / TCE specifics see `docs/internal-deploy.md`.

## How it works

- **Server** (`server/`) — Node.js/Express + WebSocket backend, SQLite/PostgreSQL
- **Frontend** (`web/`) — React/Vite
- **Agents** connect through zouk-daemon, a local bridge process that gives agents access to local tools and credentials while keeping the server stateless

## Development

```bash
npm install
npm run dev        # server + Vite frontend
npm run server     # backend only
npm run web:dev    # frontend only
npm run build      # build frontend bundle
```

## Design Docs

- [Agent delivery notification routing](docs/agent-delivery-routing.md)

## Docker Deployment

One-command setup with PostgreSQL + [OpenViking](https://github.com/volcengine/OpenViking) memory:

```bash
bash setup.sh                           # auto-detects keys from ~/.openviking/ov.conf
# or
bash setup.sh --emb-key <volcengine-key>  # explicit key
```

This creates `data/` (PG + OV persistence), generates an OV root API key, and starts all services. After setup:

```bash
docker compose up -d                    # start
docker compose down                     # stop (data preserved)
docker compose down -v                  # stop + wipe data
```

Connect a daemon:

```bash
zouk-daemon --server-url http://localhost:7777 --api-key test
```

Configuration in `.env` — see `.env.example` for all options (Google OAuth, email allowlist, custom image tag, etc.).

### Cloud / Railway

Internal deployment: ByteDance SCM → ICM → TCE pipeline. See `docs/internal-deploy.md` for env-var reference, RDS/PG wiring, Feishu OAuth app registration, and the build/log/port conventions baked into `build.sh` and the emitted `bootstrap.sh`.

Upstream deployment (Railway, public): mirrors what `ZaynJarvis/zouk` documents. Set `PUBLIC_URL` so agents call back to the right URL and provide a `DATABASE_URL` for persistence:

```bash
PUBLIC_URL=https://zouk.bytedance.net npm run server
```
