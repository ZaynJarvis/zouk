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
const MESSAGE_BOOTSTRAP_LIMIT = parseInt(process.env.MESSAGE_BOOTSTRAP_LIMIT || '800', 10);
const DEFAULT_WORKSPACE_ID = 'default';

const enabled = Boolean(DATABASE_URL);
const pool = enabled
  ? new Pool({
      connectionString: DATABASE_URL,
      ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
    })
  : null;

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

// ─── Messages ─────────────────────────────────────────────────────

async function saveMessage(msg) {
  if (!pool) return;
  try {
    await pool.query(
      `INSERT INTO messages (id, seq, workspace_id, channel_id, channel_name, channel_type, thread_id, sender_name, sender_type, content, created_at, attachments, task_number, task_status, task_assignee_id, task_assignee_type)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       ON CONFLICT (id) DO UPDATE SET
         seq = EXCLUDED.seq,
         workspace_id = EXCLUDED.workspace_id,
         channel_id = EXCLUDED.channel_id,
         channel_name = EXCLUDED.channel_name,
         channel_type = EXCLUDED.channel_type,
         thread_id = EXCLUDED.thread_id,
         sender_name = EXCLUDED.sender_name,
         sender_type = EXCLUDED.sender_type,
         content = EXCLUDED.content,
         created_at = EXCLUDED.created_at,
         attachments = EXCLUDED.attachments,
         task_number = EXCLUDED.task_number,
         task_status = EXCLUDED.task_status,
         task_assignee_id = EXCLUDED.task_assignee_id,
         task_assignee_type = EXCLUDED.task_assignee_type`,
      [
        msg.id,
        msg.seq,
        msg.workspaceId || DEFAULT_WORKSPACE_ID,
        msg.channelId || null,
        msg.channelName,
        msg.channelType,
        msg.threadId || null,
        msg.senderName,
        msg.senderType,
        msg.content,
        msg.createdAt,
        JSON.stringify(msg.attachments || []),
        msg.taskNumber || null,
        msg.taskStatus || null,
        msg.taskAssigneeId || null,
        msg.taskAssigneeType || null,
      ]
    );
  } catch (e) {
    console.error('[db] saveMessage error:', e.message);
  }
}

async function loadMessages(limit = MESSAGE_BOOTSTRAP_LIMIT) {
  if (!pool) return [];
  try {
    const { rows } = await pool.query(
      `SELECT * FROM (SELECT * FROM messages ORDER BY seq DESC LIMIT $1) sub ORDER BY seq ASC`,
      [limit]
    );
    return rows.map(rowToMessage);
  } catch (e) {
    console.error('[db] loadMessages error:', e.message);
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

async function saveChannel(ch) {
  if (!pool) return;
  try {
    await pool.query(
      `INSERT INTO channels (id, workspace_id, name, description, type)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (id) DO UPDATE SET
         workspace_id = EXCLUDED.workspace_id,
         name = EXCLUDED.name,
         description = EXCLUDED.description,
         type = EXCLUDED.type`,
      [ch.id, ch.workspaceId || DEFAULT_WORKSPACE_ID, ch.name, ch.description || '', ch.type || 'channel']
    );
  } catch (e) {
    console.error('[db] saveChannel error:', e.message);
  }
}

async function deleteChannel(id) {
  if (!pool) return;
  try {
    await pool.query('DELETE FROM channels WHERE id = $1', [id]);
  } catch (e) {
    console.error('[db] deleteChannel error:', e.message);
  }
}

async function loadChannels() {
  if (!pool) return [];
  try {
    const { rows } = await pool.query('SELECT * FROM channels ORDER BY name ASC');
    return rows.map(row => ({
      id: row.id,
      workspaceId: row.workspace_id || DEFAULT_WORKSPACE_ID,
      name: row.name,
      description: row.description || '',
      type: row.type || 'channel',
      members: [],
    }));
  } catch (e) {
    console.error('[db] loadChannels error:', e.message);
    return [];
  }
}

// ─── Channel ↔ Agent membership ──────────────────────────────────

async function saveChannelAgent({ workspaceId = DEFAULT_WORKSPACE_ID, channelId, agentId, canRead = true, subscribed = true }) {
  if (!pool) return;
  try {
    await pool.query(
      `INSERT INTO channel_agents (workspace_id, channel_id, agent_id, can_read, subscribed, updated_at)
       VALUES ($1,$2,$3,$4,$5, now())
       ON CONFLICT (channel_id, agent_id) DO UPDATE SET
         workspace_id = EXCLUDED.workspace_id,
         can_read   = EXCLUDED.can_read,
         subscribed = EXCLUDED.subscribed,
         updated_at = now()`,
      [workspaceId || DEFAULT_WORKSPACE_ID, channelId, agentId, !!canRead, !!subscribed]
    );
  } catch (e) {
    console.error('[db] saveChannelAgent error:', e.message);
  }
}

async function deleteChannelAgent(channelId, agentId) {
  if (!pool) return;
  try {
    await pool.query(
      'DELETE FROM channel_agents WHERE channel_id = $1 AND agent_id = $2',
      [channelId, agentId]
    );
  } catch (e) {
    console.error('[db] deleteChannelAgent error:', e.message);
  }
}

async function loadChannelAgents() {
  if (!pool) return [];
  try {
    const { rows } = await pool.query(
      'SELECT workspace_id, channel_id, agent_id, can_read, subscribed FROM channel_agents'
    );
    return rows.map(row => ({
      workspaceId: row.workspace_id || DEFAULT_WORKSPACE_ID,
      channelId: row.channel_id,
      agentId: row.agent_id,
      canRead: row.can_read,
      subscribed: row.subscribed,
    }));
  } catch (e) {
    console.error('[db] loadChannelAgents error:', e.message);
    return [];
  }
}

// ─── Tasks ───────────────────────────────────────────────────────

async function saveTask(task) {
  if (!pool) return;
  try {
    await pool.query(
      `INSERT INTO tasks (task_number, workspace_id, channel_id, channel_name, title, status, message_id, claimed_by_name, claimed_by_type, created_by_name)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (task_number) DO UPDATE SET
         workspace_id = EXCLUDED.workspace_id,
         channel_id = EXCLUDED.channel_id,
         channel_name = EXCLUDED.channel_name,
         title = EXCLUDED.title,
         status = EXCLUDED.status,
         message_id = EXCLUDED.message_id,
         claimed_by_name = EXCLUDED.claimed_by_name,
         claimed_by_type = EXCLUDED.claimed_by_type,
         created_by_name = EXCLUDED.created_by_name`,
      [
        task.taskNumber,
        task.workspaceId || DEFAULT_WORKSPACE_ID,
        task.channelId || null,
        task.channelName || null,
        task.title,
        task.status || 'todo',
        task.messageId || null,
        task.claimedByName || null,
        task.claimedByType || null,
        task.createdByName || null,
      ]
    );
  } catch (e) {
    console.error('[db] saveTask error:', e.message);
  }
}

async function loadTasks() {
  if (!pool) return [];
  try {
    const { rows } = await pool.query('SELECT * FROM tasks ORDER BY task_number ASC');
    return rows.map(row => ({
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
  } catch (e) {
    console.error('[db] loadTasks error:', e.message);
    return [];
  }
}

// ─── Sequence ────────────────────────────────────────────────────

async function loadMaxSeq() {
  if (!pool) return 0;
  try {
    const { rows } = await pool.query('SELECT seq FROM messages ORDER BY seq DESC LIMIT 1');
    return rows[0]?.seq || 0;
  } catch (e) {
    console.error('[db] loadMaxSeq error:', e.message);
    return 0;
  }
}

async function loadMaxTaskNum() {
  if (!pool) return 0;
  try {
    const { rows } = await pool.query('SELECT task_number FROM tasks ORDER BY task_number DESC LIMIT 1');
    return rows[0]?.task_number || 0;
  } catch (e) {
    console.error('[db] loadMaxTaskNum error:', e.message);
    return 0;
  }
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
         openviking_user_id, openviking_api_key,
         openviking_mode, openviking_custom_url, openviking_custom_api_key
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
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
         openviking_mode            = EXCLUDED.openviking_mode,
         openviking_custom_url      = EXCLUDED.openviking_custom_url,
         openviking_custom_api_key  = EXCLUDED.openviking_custom_api_key`,
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
        config.openvikingMode === 'custom' ? 'custom' : 'provisioned',
        config.openvikingCustomUrl || null,
        config.openvikingCustomApiKey || null,
      ]
    );
  } catch (e) {
    console.error('[db] saveAgentConfig error:', e.message);
  }
}

async function deleteAgentConfig(id) {
  if (!pool) return;
  try {
    await pool.query('DELETE FROM agent_configs WHERE id = $1', [id]);
  } catch (e) {
    console.error('[db] deleteAgentConfig error:', e.message);
  }
}

async function loadAgentConfigs() {
  if (!pool) return null;
  try {
    const { rows } = await pool.query(
      `SELECT id, machine_id, name, display_name, description, runtime, model,
              workspace_id,
              system_prompt, instructions, work_dir, picture, visibility,
              max_concurrent_tasks, auto_start, skills, lifecycle, env_vars,
              openviking_user_id, openviking_api_key,
              openviking_mode, openviking_custom_url, openviking_custom_api_key
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
      openvikingApiKey: row.openviking_api_key || null,
      openvikingMode: row.openviking_mode === 'custom' ? 'custom' : 'provisioned',
      openvikingCustomUrl: row.openviking_custom_url || null,
      openvikingCustomApiKey: row.openviking_custom_api_key || null,
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

async function saveProfilePreset(preset) {
  if (!pool) return;
  try {
    await pool.query(
      `INSERT INTO agent_profile_presets (id, workspace_id, image, created_at)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (id) DO UPDATE SET
         workspace_id = EXCLUDED.workspace_id,
         image = EXCLUDED.image,
         created_at = EXCLUDED.created_at`,
      [preset.id, preset.workspaceId || DEFAULT_WORKSPACE_ID, preset.image, preset.createdAt]
    );
  } catch (e) {
    console.error('[db] saveProfilePreset error:', e.message);
  }
}

async function deleteProfilePreset(id) {
  if (!pool) return;
  try {
    await pool.query('DELETE FROM agent_profile_presets WHERE id = $1', [id]);
  } catch (e) {
    console.error('[db] deleteProfilePreset error:', e.message);
  }
}

async function loadProfilePresets() {
  if (!pool) return null;
  try {
    const { rows } = await pool.query('SELECT * FROM agent_profile_presets ORDER BY created_at ASC');
    return rows.map(row => ({
      id: row.id,
      workspaceId: row.workspace_id || DEFAULT_WORKSPACE_ID,
      image: row.image,
      createdAt: row.created_at,
    }));
  } catch (e) {
    console.error('[db] loadProfilePresets error:', e.message);
    return null;
  }
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

async function saveWorkspace(workspace) {
  if (!pool) return;
  try {
    await pool.query(
      `INSERT INTO workspaces (id, name, icon, owner_email, created_at)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         icon = EXCLUDED.icon,
         owner_email = EXCLUDED.owner_email`,
      [
        workspace.id,
        workspace.name,
        workspace.icon || 'z',
        workspace.ownerEmail || null,
        workspace.createdAt || new Date().toISOString(),
      ]
    );
  } catch (e) {
    console.error('[db] saveWorkspace error:', e.message);
  }
}

async function loadWorkspaces() {
  if (!pool) return null;
  try {
    const { rows } = await pool.query(
      'SELECT id, name, icon, owner_email, created_at FROM workspaces ORDER BY created_at ASC, name ASC'
    );
    return rows.map(row => ({
      id: row.id,
      name: row.name,
      icon: row.icon || 'z',
      ownerEmail: row.owner_email || null,
      createdAt: row.created_at,
    }));
  } catch (e) {
    console.error('[db] loadWorkspaces error:', e.message);
    return null;
  }
}

async function saveWorkspaceMember(member) {
  if (!pool) return;
  try {
    await pool.query(
      `INSERT INTO workspace_members (workspace_id, email, role, name, joined_at)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (workspace_id, email) DO UPDATE SET
         role = EXCLUDED.role,
         name = EXCLUDED.name`,
      [
        member.workspaceId || DEFAULT_WORKSPACE_ID,
        member.email,
        member.role || 'member',
        member.name || null,
        member.joinedAt || new Date().toISOString(),
      ]
    );
  } catch (e) {
    console.error('[db] saveWorkspaceMember error:', e.message);
  }
}

async function loadWorkspaceMembers() {
  if (!pool) return null;
  try {
    const { rows } = await pool.query(
      'SELECT workspace_id, email, role, name, joined_at FROM workspace_members ORDER BY workspace_id ASC, email ASC'
    );
    return rows.map(row => ({
      workspaceId: row.workspace_id || DEFAULT_WORKSPACE_ID,
      email: row.email,
      role: row.role || 'member',
      name: row.name || null,
      joinedAt: row.joined_at,
    }));
  } catch (e) {
    console.error('[db] loadWorkspaceMembers error:', e.message);
    return null;
  }
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

async function saveSession(token, user) {
  if (!pool) return;
  try {
    await pool.query(
      `INSERT INTO sessions (token, name, email, picture)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (token) DO UPDATE SET
         name = EXCLUDED.name,
         email = EXCLUDED.email,
         picture = EXCLUDED.picture`,
      [token, user.name, user.email, user.picture || null]
    );
  } catch (e) {
    console.error('[db] saveSession error:', e.message);
  }
}

async function deleteSession(token) {
  if (!pool) return;
  try {
    await pool.query('DELETE FROM sessions WHERE token = $1', [token]);
  } catch (e) {
    console.error('[db] deleteSession error:', e.message);
  }
}

async function loadSessions() {
  if (!pool) return null;
  try {
    const { rows } = await pool.query('SELECT token, name, email, picture FROM sessions');
    return rows.map(row => ({
      token: row.token,
      user: { name: row.name, email: row.email, picture: row.picture || null },
    }));
  } catch (e) {
    console.error('[db] loadSessions error:', e.message);
    return null;
  }
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
  saveChannel,
  deleteChannel,
  loadChannels,
  saveChannelAgent,
  deleteChannelAgent,
  loadChannelAgents,
  saveWorkspace,
  loadWorkspaces,
  saveWorkspaceMember,
  loadWorkspaceMembers,
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
};
