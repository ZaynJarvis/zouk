-- 0001_agent_configs_picture.sql
-- Adds the `picture` column to `agent_configs` so bot avatars persist across server restarts.
-- Context: server/db.js:232 upserts `picture` but the column was missing from the table, so
-- Supabase silently dropped the field. Audit ref: #all msg d5403cb2 item H3.
--
-- Apply against the prod Supabase project (db.qntejbvaevjlamfsbqcr) via:
--   Supabase Dashboard → SQL Editor → New Query → paste this file → Run
-- Idempotent: safe to re-run.

ALTER TABLE agent_configs ADD COLUMN IF NOT EXISTS picture TEXT;
