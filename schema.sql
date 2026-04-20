-- Incremental migrations — run on every server startup.
-- Only ADD COLUMN and new-table statements; base tables are assumed to exist.
-- All statements are idempotent (IF NOT EXISTS guards).

ALTER TABLE agent_configs ADD COLUMN IF NOT EXISTS picture TEXT;
ALTER TABLE machine_keys  ADD COLUMN IF NOT EXISTS bound_fingerprint TEXT;

CREATE TABLE IF NOT EXISTS email_allowlist (
  email      TEXT PRIMARY KEY,
  added_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  added_by   TEXT
);
