-- PostgreSQL schema for Zouk server.
-- Idempotent — safe to run on every server startup.
-- All statements are guarded by IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS messages (
  id                 TEXT PRIMARY KEY,
  seq                INTEGER NOT NULL,
  channel_name       TEXT NOT NULL,
  channel_type       TEXT NOT NULL DEFAULT 'channel',
  thread_id          TEXT,
  sender_name        TEXT NOT NULL,
  sender_type        TEXT NOT NULL DEFAULT 'human',
  content            TEXT NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  attachments        JSONB NOT NULL DEFAULT '[]',
  task_number        INTEGER,
  task_status        TEXT,
  task_assignee_id   TEXT,
  task_assignee_type TEXT
);

CREATE INDEX IF NOT EXISTS messages_seq_idx     ON messages (seq);
CREATE INDEX IF NOT EXISTS messages_channel_idx ON messages (channel_name, channel_type);
CREATE INDEX IF NOT EXISTS messages_thread_idx  ON messages (thread_id) WHERE thread_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS channels (
  id          TEXT PRIMARY KEY,
  name        TEXT UNIQUE NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  type        TEXT NOT NULL DEFAULT 'channel'
);

CREATE TABLE IF NOT EXISTS tasks (
  task_number     INTEGER PRIMARY KEY,
  channel_id      TEXT,
  channel_name    TEXT,
  title           TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'todo',
  message_id      TEXT,
  claimed_by_name TEXT,
  claimed_by_type TEXT,
  created_by_name TEXT
);

CREATE TABLE IF NOT EXISTS machine_keys (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  raw_key           TEXT UNIQUE NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at      TIMESTAMPTZ,
  revoked_at        TIMESTAMPTZ,
  bound_fingerprint TEXT
);

CREATE TABLE IF NOT EXISTS agent_configs (
  id                   TEXT PRIMARY KEY,
  machine_id           TEXT NOT NULL REFERENCES machine_keys(id) ON DELETE CASCADE,
  name                 TEXT NOT NULL,
  display_name         TEXT,
  description          TEXT,
  runtime              TEXT NOT NULL DEFAULT 'claude',
  model                TEXT,
  system_prompt        TEXT,
  instructions         TEXT,
  work_dir             TEXT,
  picture              TEXT,
  visibility           TEXT,
  max_concurrent_tasks INTEGER,
  auto_start           BOOLEAN NOT NULL DEFAULT false,
  skills               JSONB NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  email      TEXT NOT NULL,
  picture    TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agent_profile_presets (
  id         TEXT PRIMARY KEY,
  image      TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS email_allowlist (
  email      TEXT PRIMARY KEY,
  added_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  added_by   TEXT
);
