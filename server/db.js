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

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';

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
  try {
    // Use raw SQL via RPC for DDL — Supabase JS client doesn't have DDL helpers
    const { error } = await db.rpc('run_migrations', {}).maybeSingle();
    // If the RPC doesn't exist, create tables via the REST API workaround below
    if (error && error.code === '42883') {
      await createTablesViaInsert();
    }
  } catch (e) {
    await createTablesViaInsert();
  }
}

// Create tables by trying to insert and catching "table doesn't exist" errors.
// The real DDL must be run in the Supabase SQL editor (see SUPABASE_SETUP.md).
async function createTablesViaInsert() {
  // No-op: tables must be created via Supabase SQL editor.
  // This function is intentionally empty — see SUPABASE_SETUP.md.
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

async function loadMessages(limit = 500) {
  if (!db) return [];
  const { data, error } = await db
    .from('messages')
    .select('*')
    .order('seq', { ascending: true })
    .limit(limit);
  if (error) {
    console.error('[db] loadMessages error:', error.message);
    return [];
  }
  return (data || []).map(rowToMessage);
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

module.exports = {
  enabled,
  migrate,
  saveMessage,
  loadMessages,
  saveChannel,
  loadChannels,
  saveTask,
  loadTasks,
  loadMaxSeq,
  loadMaxTaskNum,
};
