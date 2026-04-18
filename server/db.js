/**
 * Supabase persistence layer for Zouk server.
 *
 * Required env vars:
 *   SUPABASE_URL          - https://<project>.supabase.co
 *   SUPABASE_SERVICE_KEY  - service_role JWT (from Supabase Dashboard → Settings → API)
 *
 * Falls back gracefully to in-memory-only mode when env vars are absent.
 */

const { createClient } = require('@supabase/supabase-js');
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';
const DATABASE_URL = process.env.DATABASE_URL || '';
// Keep only a recent working set in memory on startup. This is enough for
// channel history views and search context without bloating initial render/load.
const MESSAGE_BOOTSTRAP_LIMIT = parseInt(process.env.MESSAGE_BOOTSTRAP_LIMIT || '800', 10);

const enabled = Boolean(SUPABASE_URL && SUPABASE_SERVICE_KEY);
const db = enabled
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false },
    })
  : null;

if (enabled) {
  console.log('[db] Supabase persistence enabled');
} else {
  console.warn('[db] Supabase env vars missing — running in-memory only');
}

// ─── Schema migration ─────────────────────────────────────────────

async function migrate() {
  if (!db) return;
  if (!DATABASE_URL) {
    console.warn('[db] DATABASE_URL not set — skipping auto-migration (tables must exist)');
    return;
  }
  const pg = new Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
  try {
    await pg.connect();
    const sqlPath = path.join(__dirname, '..', 'SUPABASE_SETUP.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');
    await pg.query(sql);
    console.log('[db] Auto-migration complete — all tables verified');
  } catch (e) {
    console.error('[db] Auto-migration error:', e.message);
  } finally {
    await pg.end().catch(() => {});
  }
}

// ─── Messages ─────────────────────────────────────────────────────

async function saveMessage(msg) {
  if (!db) return;
  const { error } = await db.from('messages').upsert({
    id: msg.id,
    seq: msg.seq,
    channel_name: msg.channelName,
    channel_type: msg.channelType,
    thread_id: msg.threadId || null,
    sender_name: msg.senderName,
    sender_type: msg.senderType,
    content: msg.content,
    created_at: msg.createdAt,
    attachments: msg.attachments || [],
    task_number: msg.taskNumber || null,
    task_status: msg.taskStatus || null,
    task_assignee_id: msg.taskAssigneeId || null,
    task_assignee_type: msg.taskAssigneeType || null,
  }, { onConflict: 'id' });
  if (error) console.error('[db] saveMessage error:', error.message);
}

async function loadMessages(limit = MESSAGE_BOOTSTRAP_LIMIT) {
  if (!db) return [];
  const { data, error } = await db
    .from('messages')
    .select('*')
    .order('seq', { ascending: false })
    .limit(limit);
  if (error) {
    console.error('[db] loadMessages error:', error.message);
    return [];
  }
  return (data || []).reverse().map(rowToMessage);
}

function rowToMessage(row) {
  return {
    id: row.id,
    seq: row.seq,
    channelId: `ch-${row.channel_name}`,
    channelName: row.channel_name,
    channelType: row.channel_type,
    threadId: row.thread_id || null,
    senderName: row.sender_name,
    senderType: row.sender_type,
    content: row.content,
    createdAt: row.created_at,
    attachments: row.attachments || [],
    taskNumber: row.task_number || null,
    taskStatus: row.task_status || null,
    taskAssigneeId: row.task_assignee_id || null,
    taskAssigneeType: row.task_assignee_type || null,
  };
}

// ─── Channels ────────────────────────────────────────────────────

async function saveChannel(ch) {
  if (!db) return;
  const { error } = await db.from('channels').upsert({
    id: ch.id,
    name: ch.name,
    description: ch.description || '',
    type: ch.type || 'channel',
  }, { onConflict: 'id' });
  if (error) console.error('[db] saveChannel error:', error.message);
}

async function deleteChannel(id) {
  if (!db) return;
  const { error } = await db.from('channels').delete().eq('id', id);
  if (error) console.error('[db] deleteChannel error:', error.message);
}

async function loadChannels() {
  if (!db) return [];
  const { data, error } = await db
    .from('channels')
    .select('*')
    .order('name', { ascending: true });
  if (error) {
    console.error('[db] loadChannels error:', error.message);
    return [];
  }
  return (data || []).map(row => ({
    id: row.id,
    name: row.name,
    description: row.description || '',
    type: row.type || 'channel',
    members: [],
  }));
}

// ─── Tasks ───────────────────────────────────────────────────────

async function saveTask(task) {
  if (!db) return;
  const { error } = await db.from('tasks').upsert({
    task_number: task.taskNumber,
    channel_id: task.channelId || null,
    channel_name: task.channelName || null,
    title: task.title,
    status: task.status || 'todo',
    message_id: task.messageId || null,
    claimed_by_name: task.claimedByName || null,
    claimed_by_type: task.claimedByType || null,
    created_by_name: task.createdByName || null,
  }, { onConflict: 'task_number' });
  if (error) console.error('[db] saveTask error:', error.message);
}

async function loadTasks() {
  if (!db) return [];
  const { data, error } = await db
    .from('tasks')
    .select('*')
    .order('task_number', { ascending: true });
  if (error) {
    console.error('[db] loadTasks error:', error.message);
    return [];
  }
  return (data || []).map(row => ({
    taskNumber: row.task_number,
    channelId: row.channel_id,
    channelName: row.channel_name,
    title: row.title,
    status: row.status,
    messageId: row.message_id,
    claimedByName: row.claimed_by_name,
    claimedByType: row.claimed_by_type,
    createdByName: row.created_by_name,
  }));
}

// ─── Sequence ────────────────────────────────────────────────────

async function loadMaxSeq() {
  if (!db) return 0;
  const { data, error } = await db
    .from('messages')
    .select('seq')
    .order('seq', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error('[db] loadMaxSeq error:', error.message);
    return 0;
  }
  return data?.seq || 0;
}

async function loadMaxTaskNum() {
  if (!db) return 0;
  const { data, error } = await db
    .from('tasks')
    .select('task_number')
    .order('task_number', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error('[db] loadMaxTaskNum error:', error.message);
    return 0;
  }
  return data?.task_number || 0;
}

// ─── Agent configs ────────────────────────────────────────────────

async function saveAgentConfig(config) {
  if (!db) return;
  const { error } = await db.from('agent_configs').upsert({
    id: config.id,
    name: config.name,
    display_name: config.displayName || config.name,
    runtime: config.runtime || 'claude',
    model: config.model || null,
    system_prompt: config.systemPrompt || config.description || null,
    skills: config.skills || [],
    work_dir: config.workDir || null,
    description: config.description || null,
    auto_start: config.autoStart || false,
    picture: config.picture || null,
    config_json: config,
  }, { onConflict: 'id' });
  if (error) console.error('[db] saveAgentConfig error:', error.message);
}

async function deleteAgentConfig(id) {
  if (!db) return;
  const { error } = await db.from('agent_configs').delete().eq('id', id);
  if (error) console.error('[db] deleteAgentConfig error:', error.message);
}

async function loadAgentConfigs() {
  if (!db) return null; // null = not available, caller falls back to file
  const { data, error } = await db
    .from('agent_configs')
    .select('config_json')
    .order('name', { ascending: true });
  if (error) {
    console.error('[db] loadAgentConfigs error:', error.message);
    return null;
  }
  return (data || []).map(row => row.config_json);
}

// ─── Machine keys ─────────────────────────────────────────────────

async function saveMachineKey(key) {
  if (!db) return;
  const { error } = await db.from('machine_keys').upsert({
    id: key.id,
    name: key.name,
    raw_key: key.rawKey,
    created_at: key.createdAt,
    last_used_at: key.lastUsedAt || null,
    revoked_at: key.revokedAt || null,
    bound_fingerprint: key.boundFingerprint || null,
  }, { onConflict: 'id' });
  if (error) console.error('[db] saveMachineKey error:', error.message);
}

async function loadMachineKeys() {
  if (!db) return null; // null = not available, caller falls back to file
  const { data, error } = await db
    .from('machine_keys')
    .select('*')
    .order('created_at', { ascending: true });
  if (error) {
    console.error('[db] loadMachineKeys error:', error.message);
    return null;
  }
  return (data || []).map(row => ({
    id: row.id,
    name: row.name,
    rawKey: row.raw_key,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at || null,
    revokedAt: row.revoked_at || null,
    boundFingerprint: row.bound_fingerprint || null,
  }));
}

// ─── Auth sessions ────────────────────────────────────────────────

async function saveSession(token, user) {
  if (!db) return;
  const { error } = await db.from('sessions').upsert({
    token,
    name: user.name,
    email: user.email,
    picture: user.picture || null,
  }, { onConflict: 'token' });
  if (error) console.error('[db] saveSession error:', error.message);
}

async function deleteSession(token) {
  if (!db) return;
  const { error } = await db.from('sessions').delete().eq('token', token);
  if (error) console.error('[db] deleteSession error:', error.message);
}

async function loadSessions() {
  if (!db) return null;
  const { data, error } = await db.from('sessions').select('token,name,email,picture');
  if (error) {
    console.error('[db] loadSessions error:', error.message);
    return null;
  }
  return (data || []).map(row => ({
    token: row.token,
    user: { name: row.name, email: row.email, picture: row.picture || null },
  }));
}

module.exports = {
  enabled,
  migrate,
  saveMessage,
  loadMessages,
  saveChannel,
  deleteChannel,
  loadChannels,
  saveTask,
  loadTasks,
  loadMaxSeq,
  loadMaxTaskNum,
  saveAgentConfig,
  deleteAgentConfig,
  loadAgentConfigs,
  saveMachineKey,
  loadMachineKeys,
  saveSession,
  deleteSession,
  loadSessions,
};
