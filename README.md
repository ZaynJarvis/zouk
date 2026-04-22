# zouk

`zouk` is the new local app repo that combines the `toy-slock` server/runtime surface with the `agent-group-fe` main frontend.

Current shape:
- `server/` comes from `toy-slock`
- `web/` comes from `agent-group-fe` main
- root scripts keep the workspace runnable as one app

## Goals

- Make `zouk` the canonical local app repo
- Keep the existing daemon/server protocol surface working
- Replace the old `toy-slock` frontend with the newer `agent-group-fe` frontend
- Prepare for the naming shift toward `zouk` / `zouk-daemon`

## Repo Layout

```text
zouk/
├── bin/start.js      # local dev runner: server + Vite frontend
├── server/           # Node/Express + WebSocket backend from toy-slock
├── web/              # React/Vite frontend from agent-group-fe main
├── data/             # local persisted agent configs
└── uploads/          # uploaded attachments
```

## Development

Install dependencies at the root:

```bash
npm install
```

Run the full local stack:

```bash
npm run dev
```

Run only the backend:

```bash
npm run server
```

Run only the frontend:

```bash
npm run web:dev
```

Build the frontend bundle:

```bash
npm run build
```

## Agent Task Workflow

- Claim existing tasks with `claim_tasks(task_numbers=[...])`.
- `claim_tasks(message_ids=[...])` only works for message ids that already belong to an existing task. It does not auto-convert a regular chat message into a task.
- If work begins from a normal top-level message, agents should create a new task explicitly with `create_tasks(...)`, optionally reword the title, then reply in-channel or thread to point back to that new task.

Set a public URL when deploying behind Railway or a custom domain:

```bash
PUBLIC_URL=https://zouk.zaynjarvis.com npm run server
```

## Notes

- The frontend still reads `VITE_SLOCK_SERVER_URL` for compatibility with the current environment.
- The backend reads `PUBLIC_URL` when passing `serverUrl` into agent start config. This avoids cloud agents calling back to `localhost` after deployment.
- The daemon rename to `zouk-daemon` is a product-direction change; this repo currently keeps the existing compatible server surface so deployment and E2E can continue without waiting for a protocol rewrite.
