-- PostgreSQL schema for Zouk server.
-- Idempotent — safe to run on every server startup.
-- All statements are guarded by IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS workspaces (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  icon        TEXT NOT NULL DEFAULT 'z',
  owner_email TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO workspaces (id, name, icon)
VALUES ('default', 'Default', 'z')
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS workspace_members (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  email        TEXT NOT NULL,
  role         TEXT NOT NULL DEFAULT 'member',
  name         TEXT,
  joined_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, email)
);

CREATE TABLE IF NOT EXISTS messages (
  id                 TEXT PRIMARY KEY,
  seq                INTEGER NOT NULL,
  workspace_id       TEXT NOT NULL DEFAULT 'default' REFERENCES workspaces(id) ON DELETE CASCADE,
  channel_id         TEXT,
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
CREATE INDEX IF NOT EXISTS messages_workspace_seq_idx ON messages (workspace_id, seq);
CREATE INDEX IF NOT EXISTS messages_workspace_channel_seq_idx ON messages (workspace_id, channel_id, seq);

CREATE TABLE IF NOT EXISTS channels (
  id          TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL DEFAULT 'default' REFERENCES workspaces(id) ON DELETE CASCADE,
  name        TEXT UNIQUE NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  type        TEXT NOT NULL DEFAULT 'channel'
);
ALTER TABLE channels ADD COLUMN IF NOT EXISTS workspace_id TEXT NOT NULL DEFAULT 'default' REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE channels DROP CONSTRAINT IF EXISTS channels_name_key;
CREATE UNIQUE INDEX IF NOT EXISTS channels_workspace_type_name_unique_idx
  ON channels (workspace_id, type, name);

CREATE TABLE IF NOT EXISTS tasks (
  task_number     INTEGER PRIMARY KEY,
  workspace_id    TEXT NOT NULL DEFAULT 'default' REFERENCES workspaces(id) ON DELETE CASCADE,
  channel_id      TEXT,
  channel_name    TEXT,
  title           TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'todo',
  message_id      TEXT,
  claimed_by_name TEXT,
  claimed_by_type TEXT,
  created_by_name TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS tasks_message_id_unique_idx
  ON tasks (message_id)
  WHERE message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS tasks_workspace_status_idx
  ON tasks (workspace_id, status, task_number);

CREATE TABLE IF NOT EXISTS machine_keys (
  id                TEXT PRIMARY KEY,
  workspace_id      TEXT NOT NULL DEFAULT 'default' REFERENCES workspaces(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  raw_key           TEXT UNIQUE NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at      TIMESTAMPTZ,
  revoked_at        TIMESTAMPTZ,
  bound_fingerprint TEXT
);

CREATE TABLE IF NOT EXISTS agent_configs (
  id                       TEXT PRIMARY KEY,
  workspace_id             TEXT NOT NULL DEFAULT 'default' REFERENCES workspaces(id) ON DELETE CASCADE,
  machine_id               TEXT NOT NULL REFERENCES machine_keys(id) ON DELETE CASCADE,
  name                     TEXT NOT NULL,
  display_name             TEXT,
  description              TEXT,
  runtime                  TEXT NOT NULL DEFAULT 'claude',
  model                    TEXT,
  system_prompt            TEXT,
  instructions             TEXT,
  work_dir                 TEXT,
  picture                  TEXT,
  visibility               TEXT,
  max_concurrent_tasks     INTEGER,
  auto_start               BOOLEAN NOT NULL DEFAULT false,
  skills                   JSONB NOT NULL DEFAULT '[]',
  lifecycle                TEXT NOT NULL DEFAULT 'persistent',
  openviking_user_id       TEXT,
  openviking_api_key       TEXT,
  openviking_mode          TEXT NOT NULL DEFAULT 'provisioned',
  openviking_custom_url    TEXT,
  openviking_custom_api_key TEXT
);
-- Migration for existing deployments — server runs schema.sql on every boot
-- (db.js migrate()), so this ALTER lands automatically on the next restart.
ALTER TABLE agent_configs ADD COLUMN IF NOT EXISTS lifecycle TEXT NOT NULL DEFAULT 'persistent';
ALTER TABLE agent_configs ADD COLUMN IF NOT EXISTS env_vars JSONB NOT NULL DEFAULT '{}';
ALTER TABLE agent_configs ADD COLUMN IF NOT EXISTS openviking_user_id TEXT;
ALTER TABLE agent_configs ADD COLUMN IF NOT EXISTS openviking_api_key TEXT;
ALTER TABLE agent_configs ADD COLUMN IF NOT EXISTS openviking_mode TEXT NOT NULL DEFAULT 'provisioned';
ALTER TABLE agent_configs ADD COLUMN IF NOT EXISTS openviking_custom_url TEXT;
ALTER TABLE agent_configs ADD COLUMN IF NOT EXISTS openviking_custom_api_key TEXT;

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  email      TEXT NOT NULL,
  picture    TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agent_profile_presets (
  id         TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL DEFAULT 'default' REFERENCES workspaces(id) ON DELETE CASCADE,
  image      TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS email_allowlist (
  workspace_id TEXT NOT NULL DEFAULT 'default' REFERENCES workspaces(id) ON DELETE CASCADE,
  email      TEXT NOT NULL,
  added_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  added_by   TEXT
);
ALTER TABLE email_allowlist ADD COLUMN IF NOT EXISTS workspace_id TEXT NOT NULL DEFAULT 'default' REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE email_allowlist DROP CONSTRAINT IF EXISTS email_allowlist_pkey;
CREATE UNIQUE INDEX IF NOT EXISTS email_allowlist_workspace_email_unique_idx
  ON email_allowlist (workspace_id, email);

CREATE TABLE IF NOT EXISTS agent_activities (
  id         BIGSERIAL PRIMARY KEY,
  agent_id   TEXT NOT NULL REFERENCES agent_configs(id) ON DELETE CASCADE,
  activity   TEXT,
  detail     TEXT,
  entry      JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agent_activities_agent_id_idx
  ON agent_activities (agent_id, id DESC);

-- channel_agents — N:M membership between channels and agents. Drives who
-- receives WS push (`subscribed`) and who can read history / check_messages
-- (`can_read`). Without a row for (channel, agent), the agent is treated as
-- NOT a member of that channel.
CREATE TABLE IF NOT EXISTS channel_agents (
  workspace_id TEXT NOT NULL DEFAULT 'default' REFERENCES workspaces(id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  agent_id   TEXT NOT NULL REFERENCES agent_configs(id) ON DELETE CASCADE,
  can_read   BOOLEAN NOT NULL DEFAULT true,
  subscribed BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (channel_id, agent_id)
);

CREATE INDEX IF NOT EXISTS channel_agents_agent_idx
  ON channel_agents (agent_id);
CREATE INDEX IF NOT EXISTS channel_agents_workspace_agent_idx
  ON channel_agents (workspace_id, agent_id);

-- First-version multi-server bootstrap. This intentionally keeps old rows in
-- the default server so deploy one can migrate data, and deploy two can remove
-- the one-shot backfill once all rows are explicitly scoped.
ALTER TABLE messages ADD COLUMN IF NOT EXISTS workspace_id TEXT NOT NULL DEFAULT 'default' REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS channel_id TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS workspace_id TEXT NOT NULL DEFAULT 'default' REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE machine_keys ADD COLUMN IF NOT EXISTS workspace_id TEXT NOT NULL DEFAULT 'default' REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE agent_configs ADD COLUMN IF NOT EXISTS workspace_id TEXT NOT NULL DEFAULT 'default' REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE agent_profile_presets ADD COLUMN IF NOT EXISTS workspace_id TEXT NOT NULL DEFAULT 'default' REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE channel_agents ADD COLUMN IF NOT EXISTS workspace_id TEXT NOT NULL DEFAULT 'default' REFERENCES workspaces(id) ON DELETE CASCADE;
UPDATE channels SET workspace_id = 'default' WHERE workspace_id IS NULL;
UPDATE messages SET workspace_id = 'default' WHERE workspace_id IS NULL;
UPDATE tasks SET workspace_id = 'default' WHERE workspace_id IS NULL;
UPDATE machine_keys SET workspace_id = 'default' WHERE workspace_id IS NULL;
UPDATE agent_configs SET workspace_id = 'default' WHERE workspace_id IS NULL;
UPDATE agent_profile_presets SET workspace_id = 'default' WHERE workspace_id IS NULL;
UPDATE email_allowlist SET workspace_id = 'default' WHERE workspace_id IS NULL;
UPDATE channel_agents SET workspace_id = 'default' WHERE workspace_id IS NULL;
UPDATE messages m
SET channel_id = c.id
FROM channels c
WHERE m.channel_id IS NULL
  AND c.workspace_id = m.workspace_id
  AND c.name = m.channel_name
  AND c.type = m.channel_type;
