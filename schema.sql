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

CREATE TABLE IF NOT EXISTS workspace_member_removals (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  email        TEXT NOT NULL,
  removed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  removed_by   TEXT,
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
CREATE INDEX IF NOT EXISTS messages_thread_channel_seq_idx
  ON messages (thread_id, channel_id, seq) WHERE thread_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS messages_workspace_seq_idx ON messages (workspace_id, seq);
CREATE INDEX IF NOT EXISTS messages_workspace_channel_seq_idx ON messages (workspace_id, channel_id, seq);
-- DM reads are party-scoped (queryMessagesForAgent filters DM rows by
-- channel_id only, ignoring workspace_id) — keep a channel-only index so
-- cross-workspace DM check_messages stays index-backed.
CREATE INDEX IF NOT EXISTS messages_channel_seq_idx ON messages (channel_id, seq);

CREATE TABLE IF NOT EXISTS channels (
  id          TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL DEFAULT 'default' REFERENCES workspaces(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  type        TEXT NOT NULL DEFAULT 'channel'
);
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
  openviking_url           TEXT,
  openviking_mode          TEXT NOT NULL DEFAULT 'provisioned',
  openviking_custom_url    TEXT,
  openviking_custom_api_key TEXT,
  openviking_enabled       BOOLEAN,
  -- DEAD COLUMN. Once gated name-vs-id derivation; since every new agent uses
  -- its bare canonical handle as the OV user_id unconditionally, this no longer
  -- drives anything. Kept (not dropped) only to avoid a destructive migration;
  -- the application no longer reads or writes it.
  openviking_use_agent_name_as_user BOOLEAN NOT NULL DEFAULT false
);
-- Migration for existing deployments — server runs schema.sql on every boot
-- (db.js migrate()), so this ALTER lands automatically on the next restart.
ALTER TABLE agent_configs ADD COLUMN IF NOT EXISTS lifecycle TEXT NOT NULL DEFAULT 'persistent';
ALTER TABLE agent_configs ADD COLUMN IF NOT EXISTS env_vars JSONB NOT NULL DEFAULT '{}';
ALTER TABLE agent_configs ADD COLUMN IF NOT EXISTS openviking_user_id TEXT;
ALTER TABLE agent_configs ADD COLUMN IF NOT EXISTS openviking_api_key TEXT;
-- Per-agent URL pinning. Persisted at provision time so existing agents stay
-- on the URL their key was minted under even if the workspace admin later
-- switches the workspace OV URL. NULL on legacy rows → fall back to env URL.
ALTER TABLE agent_configs ADD COLUMN IF NOT EXISTS openviking_url TEXT;
ALTER TABLE agent_configs ADD COLUMN IF NOT EXISTS openviking_mode TEXT NOT NULL DEFAULT 'provisioned';
ALTER TABLE agent_configs ADD COLUMN IF NOT EXISTS openviking_custom_url TEXT;
ALTER TABLE agent_configs ADD COLUMN IF NOT EXISTS openviking_custom_api_key TEXT;
-- NULL means "follow the runtime default (OV_RUNTIME_WHITELIST)"; boolean is
-- an explicit per-agent override.
ALTER TABLE agent_configs ADD COLUMN IF NOT EXISTS openviking_enabled BOOLEAN;
-- Legacy flag. New agents now always use the bare canonical handle as their OV
-- user id (see openviking_session_id below), so this no longer drives
-- derivation; kept for backward compat with existing rows.
ALTER TABLE agent_configs ADD COLUMN IF NOT EXISTS openviking_use_agent_name_as_user BOOLEAN NOT NULL DEFAULT false;
-- NULL means "follow the runtime default (OV_MCP_RUNTIME_WHITELIST)"; boolean
-- is an explicit per-agent override for OV MCP server injection.
ALTER TABLE agent_configs ADD COLUMN IF NOT EXISTS ov_mcp_enabled BOOLEAN;
-- When true (default), daemon injects env vars that mute any locally-installed
-- OV plugin in the spawned agent. Prevents the host's personal OV config from
-- bleeding into managed-agent contexts. Set false on a per-agent basis to let
-- the local plugin run alongside the server-driven OV integration.
ALTER TABLE agent_configs ADD COLUMN IF NOT EXISTS disable_local_ov_plugin BOOLEAN NOT NULL DEFAULT true;
-- OV session id for server-managed agents. New agents persist their bare
-- canonical handle here so the OV session archive is human-readable. NULL on
-- legacy rows → fall back to the derived zouk-<agentId> session id (their
-- existing OV memory is never orphaned).
ALTER TABLE agent_configs ADD COLUMN IF NOT EXISTS openviking_session_id TEXT;

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

CREATE TABLE IF NOT EXISTS workspace_embed_settings (
  workspace_id       TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  enabled            BOOLEAN NOT NULL DEFAULT false,
  allowed_origins    JSONB NOT NULL DEFAULT '[]',
  allowed_channel_ids JSONB NOT NULL DEFAULT '[]',
  token_ttl_seconds  INTEGER NOT NULL DEFAULT 3600,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by         TEXT
);

-- Per-workspace OpenViking provisioning override. NULL/absent row =
-- fall back to OPENVIKING_URL / OPENVIKING_ROOT_KEY env vars. When
-- `enabled` is true and both `url` and `root_api_key` are set, agent
-- provisioning for this workspace uses these creds instead of env.
-- `root_api_key` follows the same new-format convention as the env
-- root key (base64url(account).base64url(user).base64url(secret)),
-- so `account` may be left NULL — the resolver will decode it from
-- the key. Set `account` explicitly when (a) the root key grants
-- access to multiple accounts and you want to pin one, or (b) the key
-- is a legacy hex key that can't carry an account.
CREATE TABLE IF NOT EXISTS workspace_openviking_settings (
  workspace_id   TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  enabled        BOOLEAN NOT NULL DEFAULT false,
  url            TEXT,
  root_api_key   TEXT,
  account        TEXT,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by     TEXT
);
ALTER TABLE workspace_openviking_settings ADD COLUMN IF NOT EXISTS account TEXT;
ALTER TABLE workspace_openviking_settings ADD COLUMN IF NOT EXISTS peer_enabled BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS email_allowlist (
  workspace_id TEXT NOT NULL DEFAULT 'default' REFERENCES workspaces(id) ON DELETE CASCADE,
  email      TEXT NOT NULL,
  added_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  added_by   TEXT
);
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

-- Per-agent opaque auth tokens. Lifetime tied to agent existence — no clock
-- TTL. Revoked on agent delete or explicit revoke. Used by chat-bridge for
-- REST calls and as OV proxy auth (server maps token → per-agent OV key).
CREATE TABLE IF NOT EXISTS agent_tokens (
  token        TEXT PRIMARY KEY,
  agent_id     TEXT NOT NULL REFERENCES agent_configs(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL DEFAULT 'default' REFERENCES workspaces(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS agent_tokens_agent_idx ON agent_tokens (agent_id);
