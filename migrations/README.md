# migrations/

Ordered, idempotent SQL files for schema changes against the Supabase database (`db.qntejbvaevjlamfsbqcr`, project `qntejbvaevjlamfsbqcr`).

`SUPABASE_SETUP.sql` in the repo root is the source-of-truth schema for a fresh project. This folder holds the incremental deltas that must be applied to deployments that were set up before each change landed.

## Applying a migration

Supabase Dashboard → SQL Editor → New Query → paste file contents → Run.

All files use `IF NOT EXISTS` / `IF EXISTS` guards and are safe to re-run.

## Files

| File | Purpose | Applied to prod? |
|---|---|---|
| `0001_agent_configs_picture.sql` | Add `picture TEXT` column to `agent_configs` so bot avatars persist (audit msg d5403cb2, item H3) | pending |
