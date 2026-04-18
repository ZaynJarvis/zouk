-- Run this in: Supabase Dashboard → SQL Editor → New Query

-- Messages table
CREATE TABLE IF NOT EXISTS messages (
  id           TEXT PRIMARY KEY,
  seq          INTEGER NOT NULL,
  channel_name TEXT NOT NULL,
  channel_type TEXT NOT NULL DEFAULT 'channel',
  thread_id    TEXT,
  sender_name  TEXT NOT NULL,
  sender_type  TEXT NOT NULL DEFAULT 'human',
  content      TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  attachments  JSONB NOT NULL DEFAULT '[]',
  task_number  INTEGER,
  task_status  TEXT,
  task_assignee_id   TEXT,
  task_assignee_type TEXT
);

CREATE INDEX IF NOT EXISTS messages_seq_idx          ON messages (seq);
CREATE INDEX IF NOT EXISTS messages_channel_idx      ON messages (channel_name, channel_type);
CREATE INDEX IF NOT EXISTS messages_thread_idx       ON messages (thread_id) WHERE thread_id IS NOT NULL;

-- Channels table
CREATE TABLE IF NOT EXISTS channels (
  id          TEXT PRIMARY KEY,
  name        TEXT UNIQUE NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  type        TEXT NOT NULL DEFAULT 'channel'
);

-- Tasks table
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

-- Agent configs table (replaces data/agent-configs.json for Railway)
CREATE TABLE IF NOT EXISTS agent_configs (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  display_name TEXT,
  runtime      TEXT NOT NULL DEFAULT 'claude',
  model        TEXT,
  system_prompt TEXT,
  skills       JSONB NOT NULL DEFAULT '[]',
  work_dir     TEXT,
  description  TEXT,
  auto_start   BOOLEAN NOT NULL DEFAULT false,
  picture      TEXT,
  config_json  JSONB NOT NULL DEFAULT '{}'
);
-- Migration: add picture to existing deployments
ALTER TABLE agent_configs ADD COLUMN IF NOT EXISTS picture TEXT;

-- Auth sessions table (survives server restarts and deploys)
CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  email      TEXT NOT NULL,
  picture    TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service role all" ON sessions FOR ALL USING (true);

-- Agent profile presets — a pool of reusable avatars that the server hashes
-- new agents into on first boot. Image is stored as a data URL (base64 webp).
CREATE TABLE IF NOT EXISTS agent_profile_presets (
  id         TEXT PRIMARY KEY,
  image      TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent_profile_presets_created_idx ON agent_profile_presets (created_at);

ALTER TABLE agent_profile_presets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service role all" ON agent_profile_presets FOR ALL USING (true);

-- Machine API keys table (replaces data/machine-keys.json for Railway)
CREATE TABLE IF NOT EXISTS machine_keys (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  raw_key     TEXT UNIQUE NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ,
  revoked_at  TIMESTAMPTZ,
  bound_fingerprint TEXT
);
-- Migration: add bound_fingerprint to existing deployments
ALTER TABLE machine_keys ADD COLUMN IF NOT EXISTS bound_fingerprint TEXT;

-- Disable RLS for service-role access (server uses service key)
ALTER TABLE messages      ENABLE ROW LEVEL SECURITY;
ALTER TABLE channels      ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks         ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE machine_keys  ENABLE ROW LEVEL SECURITY;

-- Allow service role full access
CREATE POLICY "service role all" ON messages      FOR ALL USING (true);
CREATE POLICY "service role all" ON channels      FOR ALL USING (true);
CREATE POLICY "service role all" ON tasks         FOR ALL USING (true);
CREATE POLICY "service role all" ON agent_configs FOR ALL USING (true);
CREATE POLICY "service role all" ON machine_keys  FOR ALL USING (true);
