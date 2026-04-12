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

-- Disable RLS for service-role access (server uses service key)
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks    ENABLE ROW LEVEL SECURITY;

-- Allow service role full access
CREATE POLICY "service role all" ON messages FOR ALL USING (true);
CREATE POLICY "service role all" ON channels FOR ALL USING (true);
CREATE POLICY "service role all" ON tasks    FOR ALL USING (true);
