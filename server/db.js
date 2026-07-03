/**
 * PostgreSQL persistence layer for Zouk server.
 *
 * Required env var:
 *   DATABASE_URL  - PostgreSQL connection string
 *                   e.g. postgresql://user:pass@host:5432/dbname
 *
 * Falls back gracefully to in-memory-only mode when DATABASE_URL is absent.
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const DATABASE_URL = process.env.DATABASE_URL || '';
// Boot-from-DB only seeds the in-memory threading index and delivery routing
// windows; it is NOT a read cache. History fetches always go to DB now, so 500
// is enough to cover recent active threads / agents without slowing startup.
const MESSAGE_BOOTSTRAP_LIMIT = parseInt(process.env.MESSAGE_BOOTSTRAP_LIMIT || '500', 10);
const DEFAULT_WORKSPACE_ID = 'default';
// Test-only fault-injection state for saveWorkspaceMemberStrict. Module-scoped
// counters so a test can pre-set the fail-at threshold via env at spawn time,
// then drive the call sequence through real HTTP/WS endpoints. Both branches
// in saveWorkspaceMemberStrict are gated on NODE_ENV=test.
const testSaveMemberFailAtCall = parseInt(process.env.ZOUK_TEST_FORCE_MEMBER_PERSIST_FAIL_AT || '0', 10);
let testSaveMemberCallCount = 0;

// pg 8.x's connection-string parser leaks the surrounding `[...]` brackets
// of an IPv6 literal into the host string, and getaddrinfo then refuses
// `"[::1]"`-shaped inputs with ENOTFOUND. Use pg-connection-string directly
// (so we keep its query-string mapping for sslmode, application_name,
// connect_timeout, etc.) and just strip the brackets off the host field.
function buildPoolConfig(databaseUrl) {
  const sslOption = process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false };
  let parsed;
  try {
    parsed = require('pg-connection-string').parse(databaseUrl);
  } catch {
    // Fall back to letting pg parse the raw string at Pool construction time
    // — same behavior as before this helper existed.
    return { connectionString: databaseUrl, ssl: sslOption };
  }
  if (parsed.host && parsed.host.startsWith('[') && parsed.host.endsWith(']')) {
    parsed.host = parsed.host.slice(1, -1);
  }
  // Process-level kill switch wins over whatever the URL says, otherwise
  // default to lenient TLS verification (matches the pre-helper behavior).
  parsed.ssl = sslOption;
  return parsed;
}

const enabled = Boolean(DATABASE_URL);
const pool = enabled ? new Pool(buildPoolConfig(DATABASE_URL)) : null;
const PERF_LOG_MODE = String(process.env.ZOUK_DB_PERF_LOG || process.env.ZOUK_PERF_LOG || "slow").trim().toLowerCase();
const PERF_LOG_ENABLED = ["1", "true", "yes", "slow", "verbose", "all"].includes(PERF_LOG_MODE);
const PERF_LOG_VERBOSE = ["verbose", "all"].includes(PERF_LOG_MODE);
const PERF_SLOW_MS = Math.max(1, parseInt(process.env.ZOUK_DB_PERF_SLOW_MS || process.env.ZOUK_PERF_SLOW_MS || "1000", 10) || 1000);

function perfNowMs() {
  return Number(process.hrtime.bigint()) / 1e6;
}

function logDbPerf(label, durationMs, fields = {}, { force = false } = {}) {
  if (!PERF_LOG_ENABLED) return;
  if (!force && !PERF_LOG_VERBOSE && durationMs < PERF_SLOW_MS) return;
  const parts = [`[db:perf] ${label}`, `duration_ms=${durationMs.toFixed(1)}`];
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null || value === "") continue;
    parts.push(`${key}=${JSON.stringify(value)}`);
  }
  console.warn(parts.join(" "));
}

if (enabled) {
  console.log('[db] PostgreSQL persistence enabled');
} else {
  console.warn('[db] DATABASE_URL not set — running in-memory only');
}

// ─── Schema migration ─────────────────────────────────────────────

function splitSqlStatements(sql) {
  const withoutLineComments = sql
    .split('\n')
    .map((line) => line.replace(/^\s*--.*$/, ''))
    .join('\n');

  return withoutLineComments
    .split(';')
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

async function migrate() {
  if (!pool) return;
  const client = await pool.connect();
  try {
    const sqlPath = path.join(__dirname, '..', 'schema.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');
    // Run each statement individually — PgBouncer and some poolers reject
    // multi-statement queries sent as a single string.
    const statements = splitSqlStatements(sql);
    let errors = 0;
    for (const stmt of statements) {
      try {
        await client.query(stmt);
      } catch (e) {
        console.error('[db] Migration statement error:', e.message, '\n  SQL:', stmt.slice(0, 120));
        errors++;
      }
    }
    if (errors === 0) {
      console.log('[db] Auto-migration complete — all tables verified');
    } else {
      console.warn(`[db] Auto-migration completed with ${errors} error(s) — check logs above`);
    }
  } finally {
    client.release();
  }
}

// ─── Query helpers ───────────────────────────────────────────────
// Eliminate the repeated if(!pool)/try/catch/perfLog boilerplate.

async function dbExec(label, sql, params, perfFields) {
  if (!pool) return;
  const started = perfNowMs();
  try {
    await pool.query(sql, params);
    logDbPerf(label, perfNowMs() - started, perfFields || {});
  } catch (e) {
    console.error(`[db] ${label} error:`, e.message);
  }
}

async function dbQuery(label, sql, params, mapper = (r) => r, fallback = []) {
  if (!pool) return fallback;
  const started = perfNowMs();
  try {
    const { rows } = await pool.query(sql, params);
    logDbPerf(label, perfNowMs() - started, {});
    return mapper === null ? rows : rows.map(mapper);
  } catch (e) {
    console.error(`[db] ${label} error:`, e.message);
    return fallback;
  }
}

async function dbQueryOne(label, sql, params, mapper = (r) => r) {
  const rows = await dbQuery(label, sql, params, null, null);
  if (rows === null) return null;
  return rows.length > 0 ? mapper(rows[0]) : null;
}

// ─── Messages ─────────────────────────────────────────────────────

function saveMessage(msg) {
  return dbExec("saveMessage",
    `INSERT INTO messages (id, seq, workspace_id, channel_id, channel_name, channel_type, thread_id, sender_name, sender_type, content, created_at, attachments, task_number, task_status, task_assignee_id, task_assignee_type)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
     ON CONFLICT (id) DO UPDATE SET seq = EXCLUDED.seq, workspace_id = EXCLUDED.workspace_id,
       channel_id = EXCLUDED.channel_id, channel_name = EXCLUDED.channel_name, channel_type = EXCLUDED.channel_type,
       thread_id = EXCLUDED.thread_id, sender_name = EXCLUDED.sender_name, sender_type = EXCLUDED.sender_type,
       content = EXCLUDED.content, created_at = EXCLUDED.created_at, attachments = EXCLUDED.attachments,
       task_number = EXCLUDED.task_number, task_status = EXCLUDED.task_status,
       task_assignee_id = EXCLUDED.task_assignee_id, task_assignee_type = EXCLUDED.task_assignee_type`,
    [msg.id, msg.seq, msg.workspaceId || DEFAULT_WORKSPACE_ID, msg.channelId || null,
     msg.channelName, msg.channelType, msg.threadId || null, msg.senderName, msg.senderType,
     msg.content, msg.createdAt, JSON.stringify(msg.attachments || []),
     msg.taskNumber || null, msg.taskStatus || null, msg.taskAssigneeId || null, msg.taskAssigneeType || null],
    { workspaceId: msg.workspaceId || DEFAULT_WORKSPACE_ID, channelId: msg.channelId, channelType: msg.channelType, thread: !!msg.threadId });
}

// Bootstrap-only: returns the last N messages globally (seq ASC) to seed the
// in-memory threading index, per-channel cache tails, and delivery routing.
// Read paths do NOT use this — use the cursor-based helpers below instead.
function loadMessages(limit = MESSAGE_BOOTSTRAP_LIMIT) {
  return dbQuery("loadMessages",
    `SELECT * FROM (SELECT * FROM messages ORDER BY seq DESC LIMIT $1) sub ORDER BY seq ASC`,
    [limit], rowToMessage);
}

// Resolve a message by full id. Used to translate the `before`/`after` message
// ID params on /api/messages into a seq cursor before paginating, and for task
// claim's by-id lookup.
function getMessageById(id) {
  if (!id) return Promise.resolve(null);
  return dbQueryOne("getMessageById", 'SELECT * FROM messages WHERE id = $1 LIMIT 1', [id], rowToMessage);
}

// Prefix lookup over `messages.id` — backs the agent's 8-char-shortid claim
// path. The PK btree supports LIKE 'prefix%' efficiently. Caller checks
// ambiguity (rows.length > 1) and visibility.
async function findMessagesByIdPrefix({ prefix, workspaceId = null, limit = 2 }) {
  if (!pool || !prefix) return [];
  try {
    const pattern = `${prefix}%`;
    const { rows } = workspaceId
      ? await pool.query(
          `SELECT * FROM messages WHERE workspace_id = $1 AND id LIKE $2 ORDER BY seq DESC LIMIT $3`,
          [workspaceId, pattern, limit]
        )
      : await pool.query(
          `SELECT * FROM messages WHERE id LIKE $1 ORDER BY seq DESC LIMIT $2`,
          [pattern, limit]
        );
    return rows.map(rowToMessage);
  } catch (e) {
    console.error('[db] findMessagesByIdPrefix error:', e.message);
    return [];
  }
}

// Collect all attachment ids referenced by messages younger than `sinceDays`.
// Uses jsonb_array_elements to unnest the attachments JSONB array so we get a
// flat set of ids. Returns a plain array of id strings (deduplicated).
// Used by the attachment pruner to shield blobs that are still referenced.
async function getReferencedAttachmentIds(sinceDays = 30) {
  if (!pool) return [];
  const cutoff = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
  const rows = await dbQuery(
    "getReferencedAttachmentIds",
    `SELECT DISTINCT elem->>'id' AS id
     FROM messages, jsonb_array_elements(attachments) AS elem
     WHERE created_at >= $1
       AND jsonb_typeof(attachments) = 'array'
       AND elem->>'id' IS NOT NULL`,
    [cutoff.toISOString()],
    (r) => r.id,
    []
  );
  return rows;
}

// Primary history-fetch helper. Returns messages in seq ASC order so callers
// can append as a contiguous page. `beforeSeq` / `afterSeq` are exclusive
// bounds; pass null/undefined to skip the bound. Uses the composite
// (workspace_id, channel_id, seq) index.
async function queryMessages({ workspaceId, channelId, threadId = null, threadIdFilter = 'auto', beforeSeq = null, afterSeq = null, limit = 100 }) {
  if (!pool) return [];
  const started = perfNowMs();
  try {
    const wsId = workspaceId || DEFAULT_WORKSPACE_ID;
    // threadIdFilter semantics:
    //   'auto' (default): if threadId provided → filter to that thread; else
    //     filter to main-channel messages only (thread_id IS NULL). Matches
    //     parseTarget+matchesTarget behavior — main view excludes replies.
    //   'any': no thread filter (return both main + reply messages). Used by
    //     paths that don't care, like agent /search.
    let threadClause = '';
    const params = [wsId, channelId];
    if (threadIdFilter === 'auto') {
      if (threadId) {
        params.push(threadId);
        threadClause = `AND thread_id = $${params.length}`;
      } else {
        threadClause = 'AND thread_id IS NULL';
      }
    }
    params.push(beforeSeq);
    const beforeIdx = params.length;
    params.push(afterSeq);
    const afterIdx = params.length;
    params.push(limit);
    const limitIdx = params.length;
    // Inner ORDER BY DESC + outer ORDER BY ASC gives us "last N before cursor"
    // returned oldest-first, matching what frontend expects to prepend/append.
    const { rows } = await pool.query(
      `SELECT * FROM (
         SELECT * FROM messages
          WHERE workspace_id = $1 AND channel_id = $2
            ${threadClause}
            AND ($${beforeIdx}::bigint IS NULL OR seq < $${beforeIdx})
            AND ($${afterIdx}::bigint IS NULL OR seq > $${afterIdx})
          ORDER BY seq DESC LIMIT $${limitIdx}
       ) sub ORDER BY seq ASC`,
      params
    );
    logDbPerf('queryMessages', perfNowMs() - started, {
      workspaceId: wsId,
      channelId,
      thread: !!threadId,
      before: beforeSeq != null,
      after: afterSeq != null,
      limit,
      rows: rows.length,
    });
    return rows.map(rowToMessage);
  } catch (e) {
    console.error('[db] queryMessages error:', e.message);
    return [];
  }
}

// Window-around-a-message variant for the agent /history `around` mode. Returns
// up to `limit` messages centered on `centerSeq` (half before, half after,
// inclusive of the center message itself).
async function queryMessagesAround({ workspaceId, channelId, centerSeq, limit = 50 }) {
  if (!pool) return [];
  const started = perfNowMs();
  try {
    const half = Math.floor(limit / 2);
    const wsId = workspaceId || DEFAULT_WORKSPACE_ID;
    const { rows } = await pool.query(
      `(SELECT * FROM messages
         WHERE workspace_id = $1 AND channel_id = $2 AND seq < $3
         ORDER BY seq DESC LIMIT $4)
       UNION ALL
       (SELECT * FROM messages
         WHERE workspace_id = $1 AND channel_id = $2 AND seq >= $3
         ORDER BY seq ASC LIMIT $5)
       ORDER BY seq ASC`,
      [wsId, channelId, centerSeq, half, half + 1]
    );
    logDbPerf('queryMessagesAround', perfNowMs() - started, {
      workspaceId: wsId,
      channelId,
      centerSeq,
      limit,
      rows: rows.length,
    });
    return rows.map(rowToMessage);
  } catch (e) {
    console.error('[db] queryMessagesAround error:', e.message);
    return [];
  }
}

// Agent receive (check_messages) helper. Returns messages newer than `sinceSeq`
// across the agent's subscribed channels, in seq ASC order. Visibility filtering
// (DM membership, self-exclusion) still happens in-process after fetch.
async function queryMessagesForAgent({ workspaceId, channelIds, sinceSeq = 0, limit = 200 }) {
  if (!pool || !Array.isArray(channelIds) || channelIds.length === 0) return [];
  const started = perfNowMs();
  try {
    const wsId = workspaceId || DEFAULT_WORKSPACE_ID;
    // DM messages are party-scoped — match them by channel_id regardless of
    // the sender's workspace. Non-DM rows still gate on workspace_id so we
    // don't leak cross-workspace channel history.
    const { rows } = await pool.query(
      `SELECT * FROM messages
        WHERE channel_id = ANY($2::text[])
          AND (workspace_id = $1 OR channel_type = 'dm')
          AND seq > $3
        ORDER BY seq ASC LIMIT $4`,
      [wsId, channelIds, sinceSeq, limit]
    );
    logDbPerf('queryMessagesForAgent', perfNowMs() - started, {
      workspaceId: wsId,
      channels: channelIds.length,
      sinceSeq,
      limit,
      rows: rows.length,
    });
    return rows.map(rowToMessage);
  } catch (e) {
    console.error('[db] queryMessagesForAgent error:', e.message);
    return [];
  }
}

// Keyword search across an agent's visible channels. ILIKE on a 1M-row table
// without a trigram/FTS index runs ~100ms at our scale — acceptable for the
// low-QPS agent search path. Add a GIN trgm index later if it gets hot.
async function searchMessages({ workspaceId, channelIds, keyword, limit = 50 }) {
  if (!pool || !keyword) return [];
  try {
    const wsId = workspaceId || DEFAULT_WORKSPACE_ID;
    const hasChannelFilter = Array.isArray(channelIds) && channelIds.length > 0;
    // Mirror queryMessagesForAgent: DM rows match by channel_id only.
    const sql = hasChannelFilter
      ? `SELECT * FROM messages
           WHERE channel_id = ANY($2::text[])
             AND (workspace_id = $1 OR channel_type = 'dm')
             AND content ILIKE $3
           ORDER BY seq DESC LIMIT $4`
      : `SELECT * FROM messages
           WHERE workspace_id = $1 AND content ILIKE $2
           ORDER BY seq DESC LIMIT $3`;
    const params = hasChannelFilter
      ? [wsId, channelIds, `%${keyword}%`, limit]
      : [wsId, `%${keyword}%`, limit];
    const { rows } = await pool.query(sql, params);
    return rows.map(rowToMessage);
  } catch (e) {
    console.error('[db] searchMessages error:', e.message);
    return [];
  }
}

// Thread reply lookup for the cache-miss path in formatMessageForClient /
// agentDeliveryRouter (when the parent is older than the bootstrap window).
function queryThreadReplies({ threadId, channelId, limit = 50 }) {
  if (!threadId) return Promise.resolve([]);
  return dbQuery("queryThreadReplies",
    `SELECT * FROM messages WHERE thread_id = $1 AND channel_id = $2 ORDER BY seq ASC LIMIT $3`,
    [threadId, channelId, limit], rowToMessage);
}

async function queryThreadRepliesBatch({ pairs, limit = 50 }) {
  if (!pool || !Array.isArray(pairs) || pairs.length === 0) return [];
  const started = perfNowMs();
  const unique = [];
  const seen = new Set();
  for (const pair of pairs) {
    if (!pair?.threadId || !pair?.channelId) continue;
    const key = `${pair.threadId}:${pair.channelId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push({ threadId: pair.threadId, channelId: pair.channelId });
  }
  if (unique.length === 0) return [];
  try {
    const threadIds = unique.map((pair) => pair.threadId);
    const channelIds = unique.map((pair) => pair.channelId);
    const { rows } = await pool.query(
      `WITH pairs AS (
         SELECT * FROM unnest($1::text[], $2::text[]) AS p(thread_id, channel_id)
       ),
       ranked AS (
         SELECT m.*,
                row_number() OVER (
                  PARTITION BY m.thread_id, m.channel_id
                  ORDER BY m.seq ASC
                ) AS reply_rank
           FROM messages m
           JOIN pairs p ON p.thread_id = m.thread_id AND p.channel_id = m.channel_id
       )
       SELECT *
         FROM ranked
        WHERE reply_rank <= $3
        ORDER BY seq ASC`,
      [threadIds, channelIds, limit]
    );
    logDbPerf('queryThreadRepliesBatch', perfNowMs() - started, {
      pairs: unique.length,
      limit,
      rows: rows.length,
    }, {
      force: PERF_LOG_MODE !== "slow" && unique.length >= 10,
    });
    return rows.map(rowToMessage);
  } catch (e) {
    console.error('[db] queryThreadRepliesBatch error:', e.message);
    return [];
  }
}

// Targeted UPDATE for task-related message columns. Replaces the previous
// read-mutate-save pattern that depended on the message being in store.messages.
function updateMessageTaskFields({ id, taskNumber, taskStatus, taskAssigneeId, taskAssigneeType }) {
  if (!id) return Promise.resolve();
  return dbExec("updateMessageTaskFields",
    `UPDATE messages SET task_number = $1, task_status = $2, task_assignee_id = $3, task_assignee_type = $4 WHERE id = $5`,
    [taskNumber || null, taskStatus || null, taskAssigneeId || null, taskAssigneeType || null, id]);
}

// One-shot aggregate for /api/tasks createdAt/updatedAt derivation. Bootstrap
// only — incremental updates happen in-process in appendMessage.
async function loadTaskMessageTimes(workspaceId = null) {
  if (!pool) return [];
  try {
    const { rows } = workspaceId
      ? await pool.query(
          `SELECT task_number, MIN(created_at) AS created_at, MAX(created_at) AS updated_at
             FROM messages
            WHERE task_number IS NOT NULL AND workspace_id = $1
            GROUP BY task_number`,
          [workspaceId]
        )
      : await pool.query(
          `SELECT workspace_id, task_number, MIN(created_at) AS created_at, MAX(created_at) AS updated_at
             FROM messages
            WHERE task_number IS NOT NULL
            GROUP BY workspace_id, task_number`
        );
    return rows.map((row) => ({
      workspaceId: row.workspace_id || workspaceId || DEFAULT_WORKSPACE_ID,
      taskNumber: row.task_number,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  } catch (e) {
    console.error('[db] loadTaskMessageTimes error:', e.message);
    return [];
  }
}

function rowToMessage(row) {
  return {
    id: row.id,
    seq: row.seq,
    workspaceId: row.workspace_id || DEFAULT_WORKSPACE_ID,
    channelId: row.channel_id || `ch-${row.channel_name}`,
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

function saveChannel(ch) {
  return dbExec("saveChannel",
    `INSERT INTO channels (id, workspace_id, name, description, type)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (id) DO UPDATE SET
       workspace_id = EXCLUDED.workspace_id, name = EXCLUDED.name,
       description = EXCLUDED.description, type = EXCLUDED.type`,
    [ch.id, ch.workspaceId || DEFAULT_WORKSPACE_ID, ch.name, ch.description || '', ch.type || 'channel']);
}

function deleteChannel(id) {
  return dbExec("deleteChannel", 'DELETE FROM channels WHERE id = $1', [id]);
}

function loadChannels() {
  return dbQuery("loadChannels",
    'SELECT * FROM channels ORDER BY name ASC', [],
    (row) => ({
      id: row.id,
      workspaceId: row.workspace_id || DEFAULT_WORKSPACE_ID,
      name: row.name,
      description: row.description || '',
      type: row.type || 'channel',
      members: [],
    }));
}

// ─── Channel ↔ Agent membership ──────────────────────────────────

function saveChannelAgent({ workspaceId = DEFAULT_WORKSPACE_ID, channelId, agentId, canRead = true, subscribed = true }) {
  return dbExec("saveChannelAgent",
    `INSERT INTO channel_agents (workspace_id, channel_id, agent_id, can_read, subscribed, updated_at)
     VALUES ($1,$2,$3,$4,$5, now())
     ON CONFLICT (channel_id, agent_id) DO UPDATE SET
       workspace_id = EXCLUDED.workspace_id, can_read = EXCLUDED.can_read,
       subscribed = EXCLUDED.subscribed, updated_at = now()`,
    [workspaceId || DEFAULT_WORKSPACE_ID, channelId, agentId, !!canRead, !!subscribed]);
}

function deleteChannelAgent(channelId, agentId) {
  return dbExec("deleteChannelAgent",
    'DELETE FROM channel_agents WHERE channel_id = $1 AND agent_id = $2',
    [channelId, agentId]);
}

function loadChannelAgents() {
  return dbQuery("loadChannelAgents",
    'SELECT workspace_id, channel_id, agent_id, can_read, subscribed FROM channel_agents', [],
    (row) => ({
      workspaceId: row.workspace_id || DEFAULT_WORKSPACE_ID,
      channelId: row.channel_id,
      agentId: row.agent_id,
      canRead: row.can_read,
      subscribed: row.subscribed,
    }));
}

// ─── Tasks ───────────────────────────────────────────────────────

function saveTask(task) {
  return dbExec("saveTask",
    `INSERT INTO tasks (task_number, workspace_id, channel_id, channel_name, title, status, message_id, claimed_by_name, claimed_by_type, created_by_name)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (task_number) DO UPDATE SET
       workspace_id = EXCLUDED.workspace_id, channel_id = EXCLUDED.channel_id,
       channel_name = EXCLUDED.channel_name, title = EXCLUDED.title,
       status = EXCLUDED.status, message_id = EXCLUDED.message_id,
       claimed_by_name = EXCLUDED.claimed_by_name, claimed_by_type = EXCLUDED.claimed_by_type,
       created_by_name = EXCLUDED.created_by_name`,
    [task.taskNumber, task.workspaceId || DEFAULT_WORKSPACE_ID, task.channelId || null,
     task.channelName || null, task.title, task.status || 'todo', task.messageId || null,
     task.claimedByName || null, task.claimedByType || null, task.createdByName || null]);
}

function loadTasks() {
  return dbQuery("loadTasks",
    'SELECT * FROM tasks ORDER BY task_number ASC', [],
    (row) => ({
      taskNumber: row.task_number,
      workspaceId: row.workspace_id || DEFAULT_WORKSPACE_ID,
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
  const row = await dbQueryOne("loadMaxSeq", 'SELECT seq FROM messages ORDER BY seq DESC LIMIT 1', []);
  return row?.seq || 0;
}

async function loadMaxTaskNum() {
  const row = await dbQueryOne("loadMaxTaskNum", 'SELECT task_number FROM tasks ORDER BY task_number DESC LIMIT 1', []);
  return row?.task_number || 0;
}

// ─── Agent configs ────────────────────────────────────────────────

async function saveAgentConfig(config) {
  if (!pool) return;
  // machine_id is required. A config without one is a deletion signal.
  if (!config.machineId) return deleteAgentConfig(config.id);
  try {
    // machine_id is deliberately excluded from DO UPDATE SET — once an agent
    // is bound to a machine, that binding is immutable.
    await pool.query(
      `INSERT INTO agent_configs (
         id, workspace_id, machine_id, name, display_name, description, runtime, model,
         system_prompt, instructions, work_dir, picture, visibility,
         max_concurrent_tasks, auto_start, skills, lifecycle, env_vars,
         openviking_user_id, openviking_api_key, openviking_url,
         openviking_mode, openviking_custom_url, openviking_custom_api_key,
         openviking_enabled, ov_mcp_enabled,
         disable_local_ov_plugin, openviking_session_id
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28)
       ON CONFLICT (id) DO UPDATE SET
         workspace_id                 = EXCLUDED.workspace_id,
         name                       = EXCLUDED.name,
         display_name               = EXCLUDED.display_name,
         description                = EXCLUDED.description,
         runtime                    = EXCLUDED.runtime,
         model                      = EXCLUDED.model,
         system_prompt              = EXCLUDED.system_prompt,
         instructions               = EXCLUDED.instructions,
         work_dir                   = EXCLUDED.work_dir,
         picture                    = EXCLUDED.picture,
         visibility                 = EXCLUDED.visibility,
         max_concurrent_tasks       = EXCLUDED.max_concurrent_tasks,
         auto_start                 = EXCLUDED.auto_start,
         skills                     = EXCLUDED.skills,
         lifecycle                  = EXCLUDED.lifecycle,
         env_vars                   = EXCLUDED.env_vars,
         openviking_user_id         = EXCLUDED.openviking_user_id,
         openviking_api_key         = EXCLUDED.openviking_api_key,
         openviking_url             = EXCLUDED.openviking_url,
         openviking_mode            = EXCLUDED.openviking_mode,
         openviking_custom_url      = EXCLUDED.openviking_custom_url,
         openviking_custom_api_key  = EXCLUDED.openviking_custom_api_key,
         openviking_enabled         = EXCLUDED.openviking_enabled,
         ov_mcp_enabled             = EXCLUDED.ov_mcp_enabled,
         disable_local_ov_plugin    = EXCLUDED.disable_local_ov_plugin,
         openviking_session_id      = EXCLUDED.openviking_session_id`,
      [
        config.id,
        config.workspaceId || DEFAULT_WORKSPACE_ID,
        config.machineId,
        config.name,
        config.displayName || config.name,
        config.description || null,
        config.runtime || 'claude',
        config.model || null,
        config.systemPrompt || null,
        config.instructions || null,
        config.workDir || null,
        config.picture || null,
        config.visibility || null,
        Number.isFinite(config.maxConcurrentTasks) ? config.maxConcurrentTasks : null,
        config.autoStart || false,
        JSON.stringify(config.skills || []),
        config.lifecycle === 'ephemeral' ? 'ephemeral' : 'persistent',
        JSON.stringify(config.envVars || {}),
        config.openvikingUserId || null,
        config.openvikingApiKey || null,
        config.openvikingUrl || null,
        config.openvikingMode === 'custom' ? 'custom' : 'provisioned',
        config.openvikingCustomUrl || null,
        config.openvikingCustomApiKey || null,
        // null = follow runtime default; boolean = explicit override.
        typeof config.openvikingEnabled === 'boolean' ? config.openvikingEnabled : null,
        typeof config.ovMcpEnabled === 'boolean' ? config.ovMcpEnabled : null,
        // Default true (disable local plugin) — only persisted as false when
        // the user explicitly opts in to letting the host's plugin run.
        config.disableLocalOvPlugin !== false,
        config.openvikingSessionId || null,
      ]
    );
  } catch (e) {
    console.error('[db] saveAgentConfig error:', e.message);
  }
}

function deleteAgentConfig(id) {
  return dbExec("deleteAgentConfig", 'DELETE FROM agent_configs WHERE id = $1', [id]);
}

async function loadAgentConfigs() {
  if (!pool) return null;
  try {
    const { rows } = await pool.query(
      `SELECT id, machine_id, name, display_name, description, runtime, model,
              workspace_id,
              system_prompt, instructions, work_dir, picture, visibility,
              max_concurrent_tasks, auto_start, skills, lifecycle, env_vars,
              openviking_user_id, openviking_api_key, openviking_url,
              openviking_mode, openviking_custom_url, openviking_custom_api_key,
              openviking_enabled, ov_mcp_enabled,
              disable_local_ov_plugin, openviking_session_id
         FROM agent_configs
         ORDER BY name ASC`
    );
    return rows.map(row => ({
      id: row.id,
      workspaceId: row.workspace_id || DEFAULT_WORKSPACE_ID,
      machineId: row.machine_id,
      name: row.name,
      displayName: row.display_name || row.name,
      description: row.description || '',
      runtime: row.runtime || 'claude',
      model: row.model || null,
      systemPrompt: row.system_prompt || '',
      instructions: row.instructions || '',
      workDir: row.work_dir || null,
      picture: row.picture || null,
      visibility: row.visibility || null,
      maxConcurrentTasks: row.max_concurrent_tasks ?? null,
      autoStart: row.auto_start === true,
      skills: Array.isArray(row.skills) ? row.skills : [],
      lifecycle: row.lifecycle === 'ephemeral' ? 'ephemeral' : 'persistent',
      envVars: row.env_vars && typeof row.env_vars === 'object' ? row.env_vars : {},
      openvikingUserId: row.openviking_user_id || null,
      openvikingSessionId: row.openviking_session_id || null,
      openvikingApiKey: row.openviking_api_key || null,
      openvikingUrl: row.openviking_url || null,
      openvikingMode: row.openviking_mode === 'custom' ? 'custom' : 'provisioned',
      openvikingCustomUrl: row.openviking_custom_url || null,
      openvikingCustomApiKey: row.openviking_custom_api_key || null,
      // SQL NULL → undefined so isOvEnabledForAgent falls back to the runtime
      // default; boolean → explicit override.
      openvikingEnabled: typeof row.openviking_enabled === 'boolean' ? row.openviking_enabled : undefined,
      ovMcpEnabled: typeof row.ov_mcp_enabled === 'boolean' ? row.ov_mcp_enabled : undefined,
      // Column is NOT NULL with default true, but cope with older rows that
      // may have been backfilled to NULL during partial migrations.
      disableLocalOvPlugin: row.disable_local_ov_plugin !== false,
    }));
  } catch (e) {
    console.error('[db] loadAgentConfigs error:', e.message);
    return null;
  }
}

// ─── Machine keys ─────────────────────────────────────────────────

async function saveMachineKey(key) {
  if (!pool) return;
  try {
    await pool.query(
      `INSERT INTO machine_keys (id, workspace_id, name, raw_key, created_at, last_used_at, revoked_at, bound_fingerprint)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (id) DO UPDATE SET
         workspace_id = EXCLUDED.workspace_id,
         name = EXCLUDED.name,
         raw_key = EXCLUDED.raw_key,
         created_at = EXCLUDED.created_at,
         last_used_at = EXCLUDED.last_used_at,
         revoked_at = EXCLUDED.revoked_at,
         bound_fingerprint = EXCLUDED.bound_fingerprint`,
      [
        key.id,
        key.workspaceId || DEFAULT_WORKSPACE_ID,
        key.name,
        key.rawKey,
        key.createdAt,
        key.lastUsedAt || null,
        key.revokedAt || null,
        key.boundFingerprint || null,
      ]
    );
  } catch (e) {
    console.error('[db] saveMachineKey error:', e.message);
  }
}

async function deleteMachineKey(id) {
  if (!pool) return;
  try {
    // agent_configs.machine_id has ON DELETE CASCADE → rows are auto-removed.
    await pool.query('DELETE FROM machine_keys WHERE id = $1', [id]);
  } catch (e) {
    console.error('[db] deleteMachineKey error:', e.message);
  }
}

async function loadMachineKeys() {
  if (!pool) return null;
  try {
    const { rows } = await pool.query('SELECT * FROM machine_keys ORDER BY created_at ASC');
    return rows.map(row => ({
      id: row.id,
      workspaceId: row.workspace_id || DEFAULT_WORKSPACE_ID,
      name: row.name,
      rawKey: row.raw_key,
      createdAt: row.created_at,
      lastUsedAt: row.last_used_at || null,
      revokedAt: row.revoked_at || null,
      boundFingerprint: row.bound_fingerprint || null,
    }));
  } catch (e) {
    console.error('[db] loadMachineKeys error:', e.message);
    return null;
  }
}

// ─── Agent profile presets ───────────────────────────────────────

function saveProfilePreset(preset) {
  return dbExec("saveProfilePreset",
    `INSERT INTO agent_profile_presets (id, workspace_id, image, created_at) VALUES ($1,$2,$3,$4)
     ON CONFLICT (id) DO UPDATE SET workspace_id = EXCLUDED.workspace_id, image = EXCLUDED.image, created_at = EXCLUDED.created_at`,
    [preset.id, preset.workspaceId || DEFAULT_WORKSPACE_ID, preset.image, preset.createdAt]);
}

function deleteProfilePreset(id) {
  return dbExec("deleteProfilePreset", 'DELETE FROM agent_profile_presets WHERE id = $1', [id]);
}

function loadProfilePresets() {
  return dbQuery("loadProfilePresets",
    'SELECT * FROM agent_profile_presets ORDER BY created_at ASC', [],
    (row) => ({ id: row.id, workspaceId: row.workspace_id || DEFAULT_WORKSPACE_ID, image: row.image, createdAt: row.created_at }),
    null);
}

// ─── Email allowlist ─────────────────────────────────────────────

async function loadEmailAllowlist(workspaceId = null) {
  if (!pool) return null;
  try {
    const { rows } = workspaceId
      ? await pool.query(
          'SELECT workspace_id, email, added_at, added_by FROM email_allowlist WHERE workspace_id = $1 ORDER BY email ASC',
          [workspaceId]
        )
      : await pool.query('SELECT workspace_id, email, added_at, added_by FROM email_allowlist ORDER BY workspace_id ASC, email ASC');
    return rows.map(row => ({
      workspaceId: row.workspace_id || DEFAULT_WORKSPACE_ID,
      email: row.email,
      addedAt: row.added_at,
      addedBy: row.added_by || null,
    }));
  } catch (e) {
    console.error('[db] loadEmailAllowlist error:', e.message);
    return null;
  }
}

async function addEmailAllowlist(email, addedBy, workspaceId = DEFAULT_WORKSPACE_ID) {
  if (!pool) return { dbError: 'Database pool not initialised' };
  try {
    const { rows } = await pool.query(
      `INSERT INTO email_allowlist (workspace_id, email, added_by)
       VALUES ($1,$2,$3)
       ON CONFLICT (workspace_id, email) DO UPDATE SET added_by = EXCLUDED.added_by
       RETURNING workspace_id, email, added_at, added_by`,
      [workspaceId || DEFAULT_WORKSPACE_ID, email, addedBy || null]
    );
    const row = rows[0];
    if (!row) return { dbError: 'INSERT returned no rows' };
    return {
      workspaceId: row.workspace_id || DEFAULT_WORKSPACE_ID,
      email: row.email,
      addedAt: row.added_at,
      addedBy: row.added_by || null,
    };
  } catch (e) {
    console.error('[db] addEmailAllowlist error:', e.message);
    return { dbError: e.message };
  }
}

async function removeEmailAllowlist(email, workspaceId = DEFAULT_WORKSPACE_ID) {
  if (!pool) return false;
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM email_allowlist WHERE workspace_id = $1 AND email = $2',
      [workspaceId || DEFAULT_WORKSPACE_ID, email]
    );
    return rowCount > 0;
  } catch (e) {
    console.error('[db] removeEmailAllowlist error:', e.message);
    return false;
  }
}

// ─── Workspaces ──────────────────────────────────────────────────

function saveWorkspace(workspace) {
  return dbExec("saveWorkspace",
    `INSERT INTO workspaces (id, name, icon, owner_email, created_at) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, icon = EXCLUDED.icon, owner_email = EXCLUDED.owner_email`,
    [workspace.id, workspace.name, workspace.icon || 'z', workspace.ownerEmail || null, workspace.createdAt || new Date().toISOString()]);
}

function loadWorkspaces() {
  return dbQuery("loadWorkspaces",
    'SELECT id, name, icon, owner_email, created_at FROM workspaces ORDER BY created_at ASC, name ASC', [],
    (row) => ({ id: row.id, name: row.name, icon: row.icon || 'z', ownerEmail: row.owner_email || null, createdAt: row.created_at }),
    null);
}

async function deleteWorkspace(id) {
  if (!pool) return false;
  try {
    const { rowCount } = await pool.query('DELETE FROM workspaces WHERE id = $1', [id || DEFAULT_WORKSPACE_ID]);
    return rowCount > 0;
  } catch (e) {
    console.error('[db] deleteWorkspace error:', e.message);
    return false;
  }
}

function saveWorkspaceMember(member) {
  return dbExec("saveWorkspaceMember",
    `INSERT INTO workspace_members (workspace_id, email, role, name, joined_at) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (workspace_id, email) DO UPDATE SET role = EXCLUDED.role, name = EXCLUDED.name`,
    [member.workspaceId || DEFAULT_WORKSPACE_ID, member.email, member.role || 'member', member.name || null, member.joinedAt || new Date().toISOString()]);
}

// Same write as saveWorkspaceMember but rethrows the DB error instead of
// swallowing it. The invite path uses this to keep the member row + the
// allowlist row in lock-step: a silent DB failure on the member row would
// leave the post-restart state inconsistent (allowlist row present, member
// row missing) and re-introduce the bouncing bug from the other side.
async function saveWorkspaceMemberStrict(member) {
  // Test-only fault-injection hooks. Let the invite-atomicity regression
  // tests exercise the strict-fail rollback branches without needing a live
  // DB (the tests run with DATABASE_URL='', so pool is null). Both hooks are
  // gated on NODE_ENV=test so the prod hot path can never trip them.
  if (process.env.NODE_ENV === 'test') {
    // (a) Unconditional fail — used by the "all invites bomb the rollback"
    //     test that just needs to see 500s.
    if (process.env.ZOUK_TEST_FORCE_MEMBER_PERSIST_FAIL === '1') {
      throw new Error('test-injected member persist failure');
    }
    // (b) Fail at call #N — lets a test set up real state (workspace create,
    //     initial invite, removal) before flipping the switch on the
    //     re-invite. Counter is module-scoped so the test reads/sets it via
    //     env and we tick it inside the call. Used by the tombstone-clear
    //     ordering regression for louise post-#395 review.
    if (testSaveMemberFailAtCall > 0) {
      testSaveMemberCallCount++;
      if (testSaveMemberCallCount >= testSaveMemberFailAtCall) {
        throw new Error('test-injected member persist failure at call #' + testSaveMemberCallCount);
      }
    }
  }
  if (!pool) return; // no DB configured: in-memory state is authoritative
  await pool.query(
    `INSERT INTO workspace_members (workspace_id, email, role, name, joined_at) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (workspace_id, email) DO UPDATE SET role = EXCLUDED.role, name = EXCLUDED.name`,
    [member.workspaceId || DEFAULT_WORKSPACE_ID, member.email, member.role || 'member', member.name || null, member.joinedAt || new Date().toISOString()],
  );
}

function deleteWorkspaceMember(workspaceId, email) {
  return dbExec("deleteWorkspaceMember",
    'DELETE FROM workspace_members WHERE workspace_id=$1 AND email=$2',
    [workspaceId || DEFAULT_WORKSPACE_ID, String(email || '').trim().toLowerCase()]);
}

function loadWorkspaceMembers() {
  return dbQuery("loadWorkspaceMembers",
    'SELECT workspace_id, email, role, name, joined_at FROM workspace_members ORDER BY workspace_id ASC, email ASC', [],
    (row) => ({ workspaceId: row.workspace_id || DEFAULT_WORKSPACE_ID, email: row.email, role: row.role || 'member', name: row.name || null, joinedAt: row.joined_at }),
    null);
}

function saveWorkspaceMemberRemoval(removal) {
  return dbExec("saveWorkspaceMemberRemoval",
    `INSERT INTO workspace_member_removals (workspace_id, email, removed_at, removed_by) VALUES ($1,$2,$3,$4)
     ON CONFLICT (workspace_id, email) DO UPDATE SET removed_at = EXCLUDED.removed_at, removed_by = EXCLUDED.removed_by`,
    [removal.workspaceId || DEFAULT_WORKSPACE_ID, String(removal.email || '').trim().toLowerCase(), removal.removedAt || new Date().toISOString(), removal.removedBy || null]);
}

function deleteWorkspaceMemberRemoval(workspaceId, email) {
  return dbExec("deleteWorkspaceMemberRemoval",
    'DELETE FROM workspace_member_removals WHERE workspace_id=$1 AND email=$2',
    [workspaceId || DEFAULT_WORKSPACE_ID, String(email || '').trim().toLowerCase()]);
}

function loadWorkspaceMemberRemovals() {
  return dbQuery("loadWorkspaceMemberRemovals",
    'SELECT workspace_id, email, removed_at, removed_by FROM workspace_member_removals ORDER BY workspace_id ASC, email ASC', [],
    (row) => ({ workspaceId: row.workspace_id || DEFAULT_WORKSPACE_ID, email: row.email, removedAt: row.removed_at, removedBy: row.removed_by || null }),
    null);
}

// ─── Workspace embed settings ─────────────────────────────────────

function saveWorkspaceEmbedSettings(settings) {
  return dbExec("saveWorkspaceEmbedSettings",
    `INSERT INTO workspace_embed_settings (workspace_id, enabled, allowed_origins, allowed_channel_ids, token_ttl_seconds, updated_at, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (workspace_id) DO UPDATE SET enabled = EXCLUDED.enabled, allowed_origins = EXCLUDED.allowed_origins,
       allowed_channel_ids = EXCLUDED.allowed_channel_ids, token_ttl_seconds = EXCLUDED.token_ttl_seconds,
       updated_at = EXCLUDED.updated_at, updated_by = EXCLUDED.updated_by`,
    [settings.workspaceId || DEFAULT_WORKSPACE_ID, !!settings.enabled,
     JSON.stringify(settings.allowedOrigins || []), JSON.stringify(settings.allowedChannelIds || []),
     settings.tokenTtlSeconds || 3600, settings.updatedAt || new Date().toISOString(), settings.updatedBy || null]);
}

function loadWorkspaceEmbedSettings() {
  return dbQuery("loadWorkspaceEmbedSettings",
    `SELECT workspace_id, enabled, allowed_origins, allowed_channel_ids, token_ttl_seconds, updated_at, updated_by
     FROM workspace_embed_settings ORDER BY workspace_id ASC`, [],
    (row) => ({
      workspaceId: row.workspace_id || DEFAULT_WORKSPACE_ID, enabled: !!row.enabled,
      allowedOrigins: Array.isArray(row.allowed_origins) ? row.allowed_origins : [],
      allowedChannelIds: Array.isArray(row.allowed_channel_ids) ? row.allowed_channel_ids : [],
      tokenTtlSeconds: row.token_ttl_seconds || 3600, updatedAt: row.updated_at, updatedBy: row.updated_by || null,
    }), null);
}

// ─── Workspace OpenViking settings ────────────────────────────────

function saveWorkspaceOpenvikingSettings(settings) {
  return dbExec("saveWorkspaceOpenvikingSettings",
    `INSERT INTO workspace_openviking_settings (workspace_id, enabled, url, root_api_key, account, peer_disabled, updated_at, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (workspace_id) DO UPDATE SET enabled = EXCLUDED.enabled, url = EXCLUDED.url,
       root_api_key = EXCLUDED.root_api_key, account = EXCLUDED.account, peer_disabled = EXCLUDED.peer_disabled,
       updated_at = EXCLUDED.updated_at, updated_by = EXCLUDED.updated_by`,
    [settings.workspaceId || DEFAULT_WORKSPACE_ID, !!settings.enabled, settings.url || null,
     settings.rootApiKey || null, settings.account || null, settings.peerEnabled === false,
     settings.updatedAt || new Date().toISOString(), settings.updatedBy || null]);
}

function loadWorkspaceOpenvikingSettings() {
  return dbQuery("loadWorkspaceOpenvikingSettings",
    `SELECT workspace_id, enabled, url, root_api_key, account, peer_disabled, updated_at, updated_by
     FROM workspace_openviking_settings ORDER BY workspace_id ASC`, [],
    (row) => ({
      workspaceId: row.workspace_id || DEFAULT_WORKSPACE_ID, enabled: !!row.enabled,
      url: row.url || '', rootApiKey: row.root_api_key || '', account: row.account || '',
      // peer_disabled is the inverted store; absent/false → peer enabled (default on).
      peerEnabled: !row.peer_disabled,
      updatedAt: row.updated_at, updatedBy: row.updated_by || null,
    }), null);
}

// ─── Agent activities ─────────────────────────────────────────────

const ACTIVITY_KEEP_LIMIT = 100;

async function saveActivityEntries(agentId, activity, detail, entries) {
  if (!pool || !agentId || !Array.isArray(entries) || entries.length === 0) return;
  try {
    const placeholders = entries
      .map((_, i) => `($1, $2, $3, $${i + 4}::jsonb)`)
      .join(',');
    const params = [agentId, activity || null, detail || null, ...entries.map(e => JSON.stringify(e))];
    await pool.query(
      `INSERT INTO agent_activities (agent_id, activity, detail, entry)
       VALUES ${placeholders}`,
      params
    );
  } catch (e) {
    console.error('[db] saveActivityEntries error:', e.message);
  }
}

async function loadAgentActivities(agentId, keep = ACTIVITY_KEEP_LIMIT) {
  if (!pool || !agentId) return [];
  try {
    const { rows } = await pool.query(
      `SELECT entry FROM agent_activities
       WHERE agent_id = $1
       ORDER BY id DESC
       LIMIT $2`,
      [agentId, keep]
    );
    // Return oldest-first so frontend can append in order.
    return rows.map(r => r.entry).reverse();
  } catch (e) {
    console.error('[db] loadAgentActivities error:', e.message);
    return [];
  }
}

async function loadLatestContextUsage(agentId) {
  if (!pool || !agentId) return null;
  try {
    const { rows } = await pool.query(
      `SELECT entry FROM agent_activities
       WHERE agent_id = $1
         AND entry->>'kind' = 'context_usage'
       ORDER BY id DESC
       LIMIT 1`,
      [agentId]
    );
    const entry = rows[0]?.entry;
    return entry?.contextUsage || null;
  } catch (e) {
    console.error('[db] loadLatestContextUsage error:', e.message);
    return null;
  }
}

async function trimAgentActivities(agentId, keep = ACTIVITY_KEEP_LIMIT) {
  if (!pool || !agentId) return;
  try {
    await pool.query(
      `DELETE FROM agent_activities
       WHERE agent_id = $1
         AND id <= COALESCE((
           SELECT id FROM agent_activities
           WHERE agent_id = $1
           ORDER BY id DESC
           OFFSET $2 LIMIT 1
         ), 0)`,
      [agentId, keep]
    );
  } catch (e) {
    console.error('[db] trimAgentActivities error:', e.message);
  }
}

async function trimAllAgentActivities(keep = ACTIVITY_KEEP_LIMIT) {
  if (!pool) return;
  try {
    await pool.query(
      `DELETE FROM agent_activities a
       USING (
         SELECT agent_id, id,
                row_number() OVER (PARTITION BY agent_id ORDER BY id DESC) AS rn
         FROM agent_activities
       ) ranked
       WHERE a.id = ranked.id AND ranked.rn > $1`,
      [keep]
    );
  } catch (e) {
    console.error('[db] trimAllAgentActivities error:', e.message);
  }
}

// ─── Auth sessions ────────────────────────────────────────────────

function saveSession(token, user) {
  return dbExec("saveSession",
    `INSERT INTO sessions (token, name, email, picture) VALUES ($1,$2,$3,$4)
     ON CONFLICT (token) DO UPDATE SET name = EXCLUDED.name, email = EXCLUDED.email, picture = EXCLUDED.picture`,
    [token, user.name, user.email, user.picture || null]);
}

function deleteSession(token) {
  return dbExec("deleteSession", 'DELETE FROM sessions WHERE token = $1', [token]);
}

function loadSessions() {
  return dbQuery("loadSessions",
    'SELECT token, name, email, picture FROM sessions', [],
    (row) => ({ token: row.token, user: { name: row.name, email: row.email, picture: row.picture || null } }),
    null);
}

// ─── Agent tokens ───────────────────────────────────────────────

function saveAgentToken({ token, agentId, workspaceId }) {
  return dbExec("saveAgentToken",
    `INSERT INTO agent_tokens (token, agent_id, workspace_id) VALUES ($1, $2, $3) ON CONFLICT (token) DO NOTHING`,
    [token, agentId, workspaceId]);
}

function revokeAgentToken(agentId) {
  return dbExec("revokeAgentToken",
    `UPDATE agent_tokens SET revoked_at = now() WHERE agent_id = $1 AND revoked_at IS NULL`,
    [agentId]);
}

function loadAgentTokens() {
  return dbQuery("loadAgentTokens",
    `SELECT token, agent_id AS "agentId", workspace_id AS "workspaceId", revoked_at AS "revokedAt" FROM agent_tokens`,
    [], (r) => r);
}

async function closePool() {
  if (pool) await pool.end();
}

module.exports = {
  enabled,
  migrate,
  closePool,
  splitSqlStatements,
  saveMessage,
  loadMessages,
  getMessageById,
  findMessagesByIdPrefix,
  getReferencedAttachmentIds,
  queryMessages,
  queryMessagesAround,
  queryMessagesForAgent,
  searchMessages,
  queryThreadReplies,
  queryThreadRepliesBatch,
  updateMessageTaskFields,
  loadTaskMessageTimes,
  saveChannel,
  deleteChannel,
  loadChannels,
  saveChannelAgent,
  deleteChannelAgent,
  loadChannelAgents,
  saveWorkspace,
  loadWorkspaces,
  deleteWorkspace,
  saveWorkspaceMember,
  saveWorkspaceMemberStrict,
  deleteWorkspaceMember,
  loadWorkspaceMembers,
  saveWorkspaceMemberRemoval,
  deleteWorkspaceMemberRemoval,
  loadWorkspaceMemberRemovals,
  saveWorkspaceEmbedSettings,
  loadWorkspaceEmbedSettings,
  saveWorkspaceOpenvikingSettings,
  loadWorkspaceOpenvikingSettings,
  saveTask,
  loadTasks,
  loadMaxSeq,
  loadMaxTaskNum,
  saveAgentConfig,
  deleteAgentConfig,
  loadAgentConfigs,
  saveMachineKey,
  deleteMachineKey,
  loadMachineKeys,
  saveProfilePreset,
  deleteProfilePreset,
  loadProfilePresets,
  saveSession,
  deleteSession,
  loadSessions,
  loadEmailAllowlist,
  addEmailAllowlist,
  removeEmailAllowlist,
  saveActivityEntries,
  loadAgentActivities,
  loadLatestContextUsage,
  trimAgentActivities,
  trimAllAgentActivities,
  saveAgentToken,
  revokeAgentToken,
  loadAgentTokens,
  dbExec,
  dbQuery,
  dbQueryOne,
};
