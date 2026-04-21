# CLAUDE.md

Claude Code entrypoint for `zouk`.

Read order:
1. `AGENT.md`
2. Only the files named in the relevant `First Files By Task` row

Keep repo facts in `AGENT.md`. Keep this file short and Claude-specific.

## Claude Workflow

- Prefer an isolated worktree from `origin/main` when the main clone is dirty or parked on another feature.
- Do not re-scan the whole repository once `AGENT.md` has narrowed the task to a small file set.
- Before browser screenshots or smoke QA, rebuild the frontend if web source changed. `http://localhost:7777` serves `web/dist`.
- Pick the smallest verification that matches the edit:
  - docs-only: none
  - server logic: `npm run test:server`
  - frontend logic: `npm run typecheck --workspace=web`
  - user-visible UI flow: `npm run build`, then `npm run test:ui` or `node web/scripts/qa-runner.mjs --pr <PR_NUMBER>`

## When Updating Agent Docs

- `AGENT.md` is the shared repository index for all coding agents.
- `CLAUDE.md` should only contain Claude-specific workflow notes or deviations.
- If new repo knowledge is generally useful, add it to `AGENT.md` and link out instead of duplicating long explanations here.
