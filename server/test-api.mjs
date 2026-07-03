#!/usr/bin/env node
/**
 * Server API Tests — zouk/server
 *
 * Uses Node.js built-in test runner (node:test). Spawns the server on an
 * isolated port so tests never collide with a running dev instance.
 *
 * Run:
 *   node --test server/test-api.mjs
 *
 * Why each test exists:
 *   guest-session  — Auth is the gate to all write operations. If this
 *                    endpoint breaks, no web client can authenticate.
 *   channel-list   — GET /api/channels must always return the default "all"
 *                    channel. Downstream: WS init, sidebar render, message routing.
 *   message-send   — POST /api/messages is the primary write path for human
 *                    users. Regression here silently drops messages.
 *   message-read   — GET /api/messages must surface stored messages. Regression
 *                    here means chat history disappears on reload.
 *   auth-rejected  — requireAuth must block unauthenticated writes. If this
 *                    breaks, the access model collapses.
 *   dm-broadcast-  — WS DM broadcasts must reach only the two parties. If this
 *     scoping        regresses, unrelated users see "notification" badges for
 *                    conversations they aren't in.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import WebSocket from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { splitSqlStatements } = require('./db.js');
const { syncWorkspaceMemberNamesFromSessions } = require('./lib/workspace-member-profile-sync.js');
const TEST_PORT = 17779;
const BASE = `http://localhost:${TEST_PORT}`;

// Tests write real bytes through the attachment storage layer; keep them out of
// the dev workspace's uploads/ dir so re-runs stay clean.
const TEST_UPLOADS_DIR = fs.mkdtempSync(path.join(path.sep === '/' ? '/tmp' : process.env.TEMP || '.', 'zouk-test-uploads-'));
const TEST_CONFIG_DIR = fs.mkdtempSync(path.join(path.sep === '/' ? '/tmp' : process.env.TEMP || '.', 'zouk-test-config-'));
const ROOT_TOKEN = 'ci-root-token';
const ROOT_EMAIL = 'ci-root@example.com';
fs.writeFileSync(
  path.join(TEST_CONFIG_DIR, 'sessions.json'),
  JSON.stringify([[ROOT_TOKEN, { name: 'ci-root', email: ROOT_EMAIL, picture: null }]]),
  'utf8'
);

let serverProc = null;

async function waitForServer(timeout = 10_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/api/channels`);
      if (res.ok) return;
    } catch (_) {}
    await new Promise(r => setTimeout(r, 150));
  }
  throw new Error(`Server did not become ready within ${timeout}ms`);
}

async function json(res) {
  const body = await res.json();
  return { status: res.status, body };
}

before(async () => {
  serverProc = spawn(process.execPath, [path.join(__dirname, 'index.js')], {
    env: {
      ...process.env,
      PORT: String(TEST_PORT),
      NODE_ENV: 'test',
      ZOUK_UPLOADS_DIR: TEST_UPLOADS_DIR,
      ZOUK_CONFIG_DIR: TEST_CONFIG_DIR,
      ZOUK_SUPERUSERS: ROOT_EMAIL,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  serverProc.stdout.resume();
  serverProc.stderr.resume();
  await waitForServer();
});

after(() => {
  serverProc?.kill('SIGTERM');
  fs.rmSync(TEST_UPLOADS_DIR, { recursive: true, force: true });
  fs.rmSync(TEST_CONFIG_DIR, { recursive: true, force: true });
});

// ─── Auth ─────────────────────────────────────────────────────────────────────

test('schema migration parser keeps channel_agents create-table statement after comment blocks', () => {
  const schemaSql = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
  const statements = splitSqlStatements(schemaSql);
  assert.ok(
    statements.some((statement) => statement.startsWith('CREATE TABLE IF NOT EXISTS channel_agents')),
    'channel_agents create-table statement must survive schema parsing'
  );
  assert.ok(
    statements.some((statement) => statement.startsWith('CREATE TABLE IF NOT EXISTS agent_read_cursors')),
    'agent_read_cursors create-table statement must survive schema parsing'
  );
});

test('guest session: returns token and user for valid name', async () => {
  const res = await fetch(`${BASE}/api/auth/guest-session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'ci-tester' }),
  });
  const { status, body } = await json(res);
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.user.name, 'guest-ci-tester');
  assert.equal(body.user.guest, true);
  assert.ok(typeof body.token === 'string' && body.token.length > 8, 'token must be a non-trivial string');
});

test('guest session: rejects non-default workspaces', async () => {
  const res = await fetch(`${BASE}/api/auth/guest-session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Workspace-Id': 'private-ci' },
    body: JSON.stringify({ name: 'ci-private-guest' }),
  });
  assert.equal(res.status, 403);
});

test('guest session: rejects missing name', async () => {
  const res = await fetch(`${BASE}/api/auth/guest-session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  assert.equal(res.status, 400);
});

test('PATCH /api/workspaces/default: member can update server avatar icon', async () => {
  const authRes = await fetch(`${BASE}/api/auth/guest-session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'ci-workspace-avatar' }),
  });
  const { token } = await authRes.json();
  const icon = 'data:image/png;base64,iVBORw0KGgo=';
  const { status, body } = await json(await fetch(`${BASE}/api/workspaces/default`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ icon }),
  }));
  assert.equal(status, 200);
  assert.equal(body.workspace.icon, icon);

  const workspacesRes = await fetch(`${BASE}/api/workspaces`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const workspacesBody = await workspacesRes.json();
  assert.equal(workspacesBody.workspaces.find(w => w.id === 'default')?.icon, icon);
});

// ─── Channels ─────────────────────────────────────────────────────────────────

test('GET /api/channels: returns default "all" channel', async () => {
  const { status, body } = await json(await fetch(`${BASE}/api/channels`));
  assert.equal(status, 200);
  assert.ok(Array.isArray(body.channels), 'channels must be an array');
  const all = body.channels.find(c => c.name === 'all');
  assert.ok(all, '"all" channel must exist in the default store');
});

test('embed guest session: channel-scoped token can only use allowed chat APIs', async () => {
  const channelsRes = await json(await fetch(`${BASE}/api/channels`, {
    headers: { Authorization: `Bearer ${ROOT_TOKEN}` },
  }));
  const all = channelsRes.body.channels.find(c => c.name === 'all');
  assert.ok(all?.id, 'all channel id is required for embed scope');

  const settingsRes = await json(await fetch(`${BASE}/api/settings/embed`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ROOT_TOKEN}` },
    body: JSON.stringify({
      enabled: true,
      allowedOrigins: ['https://studio.zaynjarvis.com'],
      allowedChannelIds: [all.id],
      tokenTtlSeconds: 900,
    }),
  }));
  assert.equal(settingsRes.status, 200);
  assert.equal(settingsRes.body.settings.enabled, true);

  const rejectedOrigin = await fetch(`${BASE}/api/auth/embed-guest-session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' },
    body: JSON.stringify({ workspaceId: 'default', channel: 'all', name: 'bad-origin' }),
  });
  assert.equal(rejectedOrigin.status, 403);

  const embedAvatar = 'https://studio.zaynjarvis.com/avatar.png';
  const embedRes = await json(await fetch(`${BASE}/api/auth/embed-guest-session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://studio.zaynjarvis.com' },
    body: JSON.stringify({ workspaceId: 'default', channel: 'all', name: 'blog reader', picture: embedAvatar }),
  }));
  assert.equal(embedRes.status, 200);
  assert.equal(embedRes.body.user.embed, true);
  assert.equal(embedRes.body.user.picture, embedAvatar);
  assert.ok(embedRes.body.token, 'embed session must return a token');

  const stableBrowserBody = { workspaceId: 'default', channel: 'all', name: 'stable reader', browserId: 'browser-ci-stable' };
  const stableA = await json(await fetch(`${BASE}/api/auth/embed-guest-session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://studio.zaynjarvis.com' },
    body: JSON.stringify(stableBrowserBody),
  }));
  const stableB = await json(await fetch(`${BASE}/api/auth/embed-guest-session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://studio.zaynjarvis.com' },
    body: JSON.stringify(stableBrowserBody),
  }));
  const stableOther = await json(await fetch(`${BASE}/api/auth/embed-guest-session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://studio.zaynjarvis.com' },
    body: JSON.stringify({ ...stableBrowserBody, browserId: 'browser-ci-other' }),
  }));
  assert.equal(stableA.status, 200);
  assert.equal(stableB.status, 200);
  assert.equal(stableOther.status, 200);
  assert.equal(stableA.body.user.name, stableB.body.user.name, 'same browser id should reuse the same embed name');
  assert.notEqual(stableA.body.user.name, stableOther.body.user.name, 'different browser ids should get different embed names');

  const embedHeaders = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${embedRes.body.token}`,
  };
  const channelList = await json(await fetch(`${BASE}/api/channels`, { headers: embedHeaders }));
  assert.equal(channelList.status, 200);
  assert.deepEqual(channelList.body.channels.map(c => c.name), ['all']);

  const marker = `ci-embed-chat-${Date.now()}`;
  const sent = await json(await fetch(`${BASE}/api/messages`, {
    method: 'POST',
    headers: embedHeaders,
    body: JSON.stringify({ target: '#all', content: marker }),
  }));
  assert.equal(sent.status, 200);
  assert.equal(sent.body.message.content, marker);
  assert.match(sent.body.message.senderName, /^embed-blog-reader-/);

  const history = await json(await fetch(`${BASE}/api/messages`, {
    headers: { ...embedHeaders, 'X-Channel': '#all', 'X-Limit': '20' },
  }));
  assert.equal(history.status, 200);
  const storedEmbedMessage = history.body.messages.find(m => m.content === marker);
  assert.ok(storedEmbedMessage, 'embed token must read allowed channel history');
  assert.equal(storedEmbedMessage.senderPicture, embedAvatar, 'embed sender avatar should be exposed on message payloads');

  const dmWrite = await fetch(`${BASE}/api/messages`, {
    method: 'POST',
    headers: embedHeaders,
    body: JSON.stringify({ target: 'dm:@agent-mock-reviewer', content: 'nope' }),
  });
  assert.equal(dmWrite.status, 403, 'embed token must not write DMs');

  const privilegedRead = await fetch(`${BASE}/api/agents`, { headers: embedHeaders });
  assert.equal(privilegedRead.status, 403, 'embed token must not read non-chat APIs');

  const embedWs = new WebSocket(`ws://localhost:${TEST_PORT}/ws?token=${embedRes.body.token}`);
  const embedInitPromise = waitForMessageOrTimeout(embedWs, ev => ev.type === 'init', 3000);
  await new Promise((resolve, reject) => {
    embedWs.once('open', resolve);
    embedWs.once('error', reject);
  });
  const embedInit = await embedInitPromise;
  assert.ok(
    embedInit?.agents?.some(agent => agent.id === MOCK_AGENT),
    'embed websocket init must include agents visible to allowed channels',
  );

  const activityPromise = waitForMessageOrTimeout(
    embedWs,
    ev => ev.type === 'agent_activity' && ev.agentId === MOCK_AGENT,
    3000,
  );
  const daemonWs = new WebSocket(`ws://localhost:${TEST_PORT}/daemon/connect?key=test`);
  await new Promise((resolve, reject) => {
    daemonWs.once('open', resolve);
    daemonWs.once('error', reject);
  });
  daemonWs.send(JSON.stringify({
    type: 'agent:activity',
    agentId: MOCK_AGENT,
    activity: 'working',
    detail: 'CI visible progress',
  }));
  const visibleActivity = await activityPromise;
  assert.equal(visibleActivity?.activity, 'working');
  assert.equal(visibleActivity?.detail, 'CI visible progress');
  daemonWs.close();
  await closeWs(embedWs);
});

// ─── Messages ─────────────────────────────────────────────────────────────────

test('POST /api/messages: stores and returns the message', async () => {
  // Get an auth token first
  const authRes = await fetch(`${BASE}/api/auth/guest-session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'ci-msg-sender' }),
  });
  const { token } = await authRes.json();

  const { status, body } = await json(await fetch(`${BASE}/api/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ target: '#all', content: 'ci-test-message' }),
  }));

  assert.equal(status, 200);
  assert.ok(body.messageId, 'response must include messageId');
  assert.equal(body.message.content, 'ci-test-message');
  assert.equal(body.message.channelName, 'all');
  assert.equal(body.message.senderName, 'guest-ci-msg-sender');
});

test('GET /api/messages: returns previously stored message', async () => {
  // Send a uniquely-identifiable message
  const authRes = await fetch(`${BASE}/api/auth/guest-session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'ci-reader' }),
  });
  const { token } = await authRes.json();

  const marker = `ci-read-probe-${Date.now()}`;
  await fetch(`${BASE}/api/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ target: '#all', content: marker }),
  });

  const { status, body } = await json(await fetch(`${BASE}/api/messages`, {
    headers: { 'X-Channel': '#all', 'X-Limit': '20' },
  }));

  assert.equal(status, 200);
  assert.ok(Array.isArray(body.messages), 'messages must be an array');
  const found = body.messages.find(m => m.content === marker);
  assert.ok(found, 'sent message must appear in message history');
});

// ─── Attachments ──────────────────────────────────────────────────────────────

test('POST /api/attachments + POST /api/messages: image rides along as attachment', async () => {
  const authRes = await fetch(`${BASE}/api/auth/guest-session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'ci-att-sender' }),
  });
  const { token } = await authRes.json();

  // Upload a 1x1 PNG.
  const png = Buffer.from(
    '89504E470D0A1A0A0000000D49484452000000010000000108060000001F15C4890000000D4944415478DA636400000000050001AAAAAAAA0000000049454E44AE426082',
    'hex',
  );
  const form = new FormData();
  form.append('file', new Blob([png], { type: 'image/png' }), 'pixel.png');
  const uploadRes = await fetch(`${BASE}/api/attachments`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const upload = await uploadRes.json();
  assert.equal(uploadRes.status, 200);
  assert.ok(upload.id, 'upload must return an id');
  assert.equal(upload.contentType, 'image/png');

  // Send a message with the attachment id.
  const marker = `ci-att-probe-${Date.now()}`;
  const sendRes = await fetch(`${BASE}/api/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ target: '#all', content: marker, attachmentIds: [upload.id] }),
  });
  const sent = await sendRes.json();
  assert.equal(sendRes.status, 200);
  assert.equal(sent.message.attachments?.length, 1);
  assert.equal(sent.message.attachments[0].id, upload.id);
  assert.equal(sent.message.attachments[0].filename, 'pixel.png');
  assert.equal(sent.message.attachments[0].contentType, 'image/png');

  // The attachment must be retrievable by id.
  const getRes = await fetch(`${BASE}/api/attachments/${upload.id}`);
  assert.equal(getRes.status, 200);
  assert.equal(getRes.headers.get('content-type'), 'image/png');
  const disposition = getRes.headers.get('content-disposition') || '';
  assert.match(disposition, /^inline;/);
  assert.match(disposition, /filename="pixel\.png"/);
  assert.match(disposition, /filename\*=UTF-8''pixel\.png/);

  const getByFilenameRes = await fetch(`${BASE}/api/attachments/${upload.id}/pixel.png`);
  assert.equal(getByFilenameRes.status, 200);
  assert.equal(getByFilenameRes.headers.get('content-type'), 'image/png');
  assert.match(getByFilenameRes.headers.get('content-disposition') || '', /filename="pixel\.png"/);
});

test('POST /api/attachments without auth: returns 403', async () => {
  const form = new FormData();
  form.append('file', new Blob([Buffer.from('a')], { type: 'image/png' }), 'a.png');
  const res = await fetch(`${BASE}/api/attachments`, { method: 'POST', body: form });
  assert.equal(res.status, 403, 'unauthenticated uploads must be rejected');
});

test('attachments persist across server restart', async () => {
  // Reason: pre-change uploads lived only in-memory. This test spawns a fresh
  // server in an isolated uploads dir, uploads a blob, kills the process, and
  // confirms a new server on the same dir can still serve the same id.
  const tmpDir = fs.mkdtempSync(path.join(path.sep === '/' ? '/tmp' : process.env.TEMP || '.', 'zouk-att-'));
  const restartPort = TEST_PORT + 1;
  const restartBase = `http://localhost:${restartPort}`;

  async function bootServer() {
    const proc = spawn(process.execPath, [path.join(__dirname, 'index.js')], {
      env: { ...process.env, PORT: String(restartPort), NODE_ENV: 'test', ZOUK_UPLOADS_DIR: tmpDir },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    proc.stdout.resume();
    proc.stderr.resume();
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      try {
        const r = await fetch(`${restartBase}/api/channels`);
        if (r.ok) return proc;
      } catch (_) {}
      await new Promise(r => setTimeout(r, 150));
    }
    proc.kill('SIGKILL');
    throw new Error('restart-persistence server did not become ready');
  }

  async function waitForExit(proc) {
    if (proc.exitCode != null) return;
    await new Promise((resolve) => proc.once('exit', resolve));
  }

  let proc1, proc2;
  try {
    proc1 = await bootServer();

    const authRes = await fetch(`${restartBase}/api/auth/guest-session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'ci-restart' }),
    });
    const { token } = await authRes.json();

    const payload = Buffer.from('restart-persists');
    const form = new FormData();
    form.append('file', new Blob([payload], { type: 'text/plain' }), 'note.txt');
    const uploadRes = await fetch(`${restartBase}/api/attachments`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    const upload = await uploadRes.json();
    assert.equal(uploadRes.status, 200);
    assert.ok(upload.id);

    proc1.kill('SIGTERM');
    await waitForExit(proc1);
    proc1 = null;

    proc2 = await bootServer();
    const getRes = await fetch(`${restartBase}/api/attachments/${upload.id}`);
    assert.equal(getRes.status, 200, 'attachment must survive server restart');
    // Whatever content-type multer inferred at upload time (FormData blob may
    // tack on "; charset=utf-8"); we only care that the prefix round-trips.
    assert.ok(
      (getRes.headers.get('content-type') || '').startsWith('text/plain'),
      'content-type must round-trip after restart',
    );
    const got = Buffer.from(await getRes.arrayBuffer());
    assert.equal(got.toString('utf8'), 'restart-persists');
  } finally {
    proc1?.kill('SIGKILL');
    proc2?.kill('SIGKILL');
    if (proc1) await waitForExit(proc1).catch(() => {});
    if (proc2) await waitForExit(proc2).catch(() => {});
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ─── Auth: allowlist union semantics ──────────────────────────────────────────

test('GET /api/auth/config: allowlistActive=false when no allowlist source is configured', async () => {
  // Baseline. Default server boot in this test file has no ALLOW env and no
  // DB-backed allowlist rows, so guest button must remain enabled.
  const defaultCfg = await json(await fetch(`${BASE}/api/auth/config`));
  assert.equal(defaultCfg.status, 200);
  assert.equal(defaultCfg.body.allowlistActive, false);
  // Same answer when the request lands on a non-default workspace — the gate
  // is now system-wide, not per-workspace.
  const nonDefaultCfg = await json(await fetch(`${BASE}/api/auth/config`, {
    headers: { 'X-Workspace-Id': 'somewhere-else' },
  }));
  assert.equal(nonDefaultCfg.status, 200);
  assert.equal(nonDefaultCfg.body.allowlistActive, false);
});

test('GET /api/auth/config: allowlistActive=true when ANY workspace gates on an allowlist', async () => {
  // Spec (zhiheng.liu 2026-05-15): the login safeguard must be the UNION across
  // every workspace allowlist + env defaults. The frontend reads
  // /api/auth/config.allowlistActive to decide whether to hide the guest
  // button. Before the fix this was scoped to a single workspace, so adding an
  // allowlist on workspace X failed to gate default-workspace visitors.
  const port = TEST_PORT + 2;
  const altBase = `http://localhost:${port}`;
  const proc = spawn(process.execPath, [path.join(__dirname, 'index.js')], {
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: 'test',
      ALLOW: 'ci-allow@example.com',
      ZOUK_UPLOADS_DIR: TEST_UPLOADS_DIR,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.resume();
  proc.stderr.resume();
  try {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      try {
        const r = await fetch(`${altBase}/api/channels`);
        if (r.ok) break;
      } catch (_) {}
      await new Promise(r => setTimeout(r, 150));
    }
    const defaultCfg = await json(await fetch(`${altBase}/api/auth/config`));
    assert.equal(defaultCfg.status, 200);
    assert.equal(defaultCfg.body.allowlistActive, true);
    // The bug: previously this came back false because the request was scoped
    // to a workspace whose own allowlist was empty. The fix returns true
    // because some workspace (default, via ENV) gates on an allowlist.
    const nonDefaultCfg = await json(await fetch(`${altBase}/api/auth/config`, {
      headers: { 'X-Workspace-Id': 'private-workspace' },
    }));
    assert.equal(nonDefaultCfg.status, 200);
    assert.equal(nonDefaultCfg.body.allowlistActive, true);
  } finally {
    proc.kill('SIGTERM');
    if (proc.exitCode == null) {
      await new Promise((resolve) => proc.once('exit', resolve));
    }
  }
});

test('magic link challenge: Safari callback can complete PWA poll', async () => {
  const supabaseServer = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/auth/v1/user') {
      assert.equal(req.headers.authorization, 'Bearer supabase-access-token');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ email: 'pwa-ci@example.com' }));
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  });
  await new Promise((resolve) => supabaseServer.listen(0, '127.0.0.1', resolve));
  const supabasePort = supabaseServer.address().port;
  const port = TEST_PORT + 8;
  const altBase = `http://localhost:${port}`;
  const proc = spawn(process.execPath, [path.join(__dirname, 'index.js')], {
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: 'test',
      SUPABASE_URL: `http://127.0.0.1:${supabasePort}`,
      SUPABASE_ANON_KEY: 'anon-key',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
      ZOUK_UPLOADS_DIR: TEST_UPLOADS_DIR,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.resume();
  proc.stderr.resume();
  try {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      try {
        const r = await fetch(`${altBase}/api/channels`);
        if (r.ok) break;
      } catch (_) {}
      await new Promise(r => setTimeout(r, 150));
    }

    const challenge = await json(await fetch(`${altBase}/api/auth/magic-link-challenge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'pwa-ci@example.com' }),
    }));
    assert.equal(challenge.status, 200);
    assert.match(challenge.body.challengeId, /^[0-9a-f]{48}$/);
    assert.match(challenge.body.pollToken, /^[0-9a-f]{48}$/);

    const pending = await json(await fetch(`${altBase}/api/auth/magic-link-challenge/${challenge.body.challengeId}?pollToken=${challenge.body.pollToken}`));
    assert.equal(pending.status, 200);
    assert.equal(pending.body.status, 'pending');

    const wrongPoll = await fetch(`${altBase}/api/auth/magic-link-challenge/${challenge.body.challengeId}?pollToken=wrong`);
    assert.equal(wrongPoll.status, 404);

    const completedLogin = await json(await fetch(`${altBase}/api/auth/supabase`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accessToken: 'supabase-access-token',
        magicLoginChallengeId: challenge.body.challengeId,
      }),
    }));
    assert.equal(completedLogin.status, 200);
    assert.equal(completedLogin.body.user.email, 'pwa-ci@example.com');
    assert.ok(completedLogin.body.token);

    const completedPoll = await json(await fetch(`${altBase}/api/auth/magic-link-challenge/${challenge.body.challengeId}?pollToken=${challenge.body.pollToken}`));
    assert.equal(completedPoll.status, 200);
    assert.equal(completedPoll.body.status, 'completed');
    assert.equal(completedPoll.body.token, completedLogin.body.token);
    assert.equal(completedPoll.body.user.email, 'pwa-ci@example.com');
  } finally {
    proc.kill('SIGTERM');
    supabaseServer.close();
    if (proc.exitCode == null) {
      await new Promise((resolve) => proc.once('exit', resolve));
    }
  }
});

// ─── Auth enforcement ─────────────────────────────────────────────────────────

test('POST /api/messages without auth: returns 403', async () => {
  const res = await fetch(`${BASE}/api/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ target: '#all', content: 'unauthorized' }),
  });
  assert.equal(res.status, 403, 'unauthenticated writes must be rejected with 403');
});

test('workspace members: public default workspace does not support removing people', async () => {
  const tmpConfigDir = fs.mkdtempSync(path.join(path.sep === '/' ? '/tmp' : process.env.TEMP || '.', 'zouk-member-remove-'));
  const uploadDir = fs.mkdtempSync(path.join(path.sep === '/' ? '/tmp' : process.env.TEMP || '.', 'zouk-member-remove-uploads-'));
  const port = TEST_PORT + 30;
  const base = `http://localhost:${port}`;
  const rootToken = 'member-remove-root-token';
  const targetToken = 'member-remove-target-token';
  const targetEmail = 'remove-target@example.com';
  fs.mkdirSync(tmpConfigDir, { recursive: true });
  fs.writeFileSync(path.join(tmpConfigDir, 'sessions.json'), JSON.stringify([
    [rootToken, { name: 'member-remove-root', email: 'member-remove-root@example.com', picture: null }],
    [targetToken, { name: 'remove-target', email: targetEmail, picture: null }],
  ]), 'utf8');

  const proc = spawn(process.execPath, [path.join(__dirname, 'index.js')], {
    env: {
      ...process.env,
      DATABASE_URL: '',
      PORT: String(port),
      NODE_ENV: 'test',
      ALLOW: '',
      ZOUK_CONFIG_DIR: tmpConfigDir,
      ZOUK_UPLOADS_DIR: uploadDir,
      ZOUK_SUPERUSERS: 'member-remove-root@example.com',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.resume();
  proc.stderr.resume();

  try {
    const deadline = Date.now() + 10_000;
    let ready = false;
    while (Date.now() < deadline) {
      try {
        const res = await fetch(`${base}/api/auth/config`);
        if (res.ok) {
          ready = true;
          break;
        }
      } catch (_) {}
      await new Promise(r => setTimeout(r, 150));
    }
    assert.equal(ready, true, 'member removal test server must become ready');

    const rootHeaders = { Authorization: `Bearer ${rootToken}`, 'X-Workspace-Id': 'default' };
    const before = await json(await fetch(`${base}/api/workspaces/default/members`, {
      headers: rootHeaders,
    }));
    assert.equal(before.status, 200);
    assert.ok(before.body.members.some(m => m.email === targetEmail), 'target session should be backfilled as a member before removal');

    const removed = await json(await fetch(`${base}/api/workspaces/default/members/${encodeURIComponent(targetEmail)}`, {
      method: 'DELETE',
      headers: rootHeaders,
    }));
    assert.equal(removed.status, 400, 'open default workspace is public, so member removal is unsupported');

    const after = await json(await fetch(`${base}/api/workspaces/default/members`, {
      headers: rootHeaders,
    }));
    assert.equal(after.status, 200);
    assert.ok(after.body.members.some(m => m.email === targetEmail), 'public default member must remain listed after rejected removal');

    const targetRead = await json(await fetch(`${base}/api/channels`, {
      headers: { Authorization: `Bearer ${targetToken}`, 'X-Workspace-Id': 'default' },
    }));
    assert.equal(targetRead.status, 200, 'public default member must keep access when removal is unsupported');
  } finally {
    proc.kill('SIGTERM');
    if (proc.exitCode == null) {
      await new Promise((resolve) => proc.once('exit', resolve));
    }
    fs.rmSync(tmpConfigDir, { recursive: true, force: true });
    fs.rmSync(uploadDir, { recursive: true, force: true });
  }
});

test('workspace members: restricted default removal blocks until re-invited', async () => {
  const tmpConfigDir = fs.mkdtempSync(path.join(path.sep === '/' ? '/tmp' : process.env.TEMP || '.', 'zouk-member-restrict-remove-'));
  const uploadDir = fs.mkdtempSync(path.join(path.sep === '/' ? '/tmp' : process.env.TEMP || '.', 'zouk-member-restrict-remove-uploads-'));
  const port = TEST_PORT + 31;
  const base = `http://localhost:${port}`;
  const rootToken = 'member-restrict-remove-root-token';
  const targetToken = 'member-restrict-remove-target-token';
  const rootEmail = 'member-restrict-remove-root@example.com';
  const targetEmail = 'restrict-remove-target@example.com';
  fs.mkdirSync(tmpConfigDir, { recursive: true });
  fs.writeFileSync(path.join(tmpConfigDir, 'sessions.json'), JSON.stringify([
    [rootToken, { name: 'member-restrict-remove-root', email: rootEmail, picture: null }],
    [targetToken, { name: 'restrict-remove-target', email: targetEmail, picture: null }],
  ]), 'utf8');

  const proc = spawn(process.execPath, [path.join(__dirname, 'index.js')], {
    env: {
      ...process.env,
      DATABASE_URL: '',
      PORT: String(port),
      NODE_ENV: 'test',
      ALLOW: `${rootEmail},${targetEmail}`,
      ZOUK_CONFIG_DIR: tmpConfigDir,
      ZOUK_UPLOADS_DIR: uploadDir,
      ZOUK_SUPERUSERS: rootEmail,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.resume();
  proc.stderr.resume();

  try {
    const deadline = Date.now() + 10_000;
    let ready = false;
    while (Date.now() < deadline) {
      try {
        const res = await fetch(`${base}/api/auth/config`);
        if (res.ok) {
          ready = true;
          break;
        }
      } catch (_) {}
      await new Promise(r => setTimeout(r, 150));
    }
    assert.equal(ready, true, 'restricted member removal test server must become ready');

    const rootHeaders = { Authorization: `Bearer ${rootToken}`, 'X-Workspace-Id': 'default', 'Content-Type': 'application/json' };
    const before = await json(await fetch(`${base}/api/workspaces/default/members`, {
      headers: rootHeaders,
    }));
    assert.equal(before.status, 200);
    assert.ok(before.body.members.some(m => m.email === targetEmail), 'allowed target session should be backfilled before removal');

    const removed = await json(await fetch(`${base}/api/workspaces/default/members/${encodeURIComponent(targetEmail)}`, {
      method: 'DELETE',
      headers: rootHeaders,
    }));
    assert.equal(removed.status, 200);

    const afterRemove = await json(await fetch(`${base}/api/workspaces/default/members`, {
      headers: rootHeaders,
    }));
    assert.equal(afterRemove.status, 200);
    assert.ok(!afterRemove.body.members.some(m => m.email === targetEmail), 'removed target must stay out of PEOPLE');

    const blockedRead = await json(await fetch(`${base}/api/channels`, {
      headers: { Authorization: `Bearer ${targetToken}`, 'X-Workspace-Id': 'default' },
    }));
    assert.equal(blockedRead.status, 403, 'restricted default removal must block access and not re-materialize');

    const reinvited = await json(await fetch(`${base}/api/workspaces/default/members`, {
      method: 'POST',
      headers: rootHeaders,
      body: JSON.stringify({ email: targetEmail, role: 'member' }),
    }));
    assert.equal(reinvited.status, 200);

    const restoredRead = await json(await fetch(`${base}/api/channels`, {
      headers: { Authorization: `Bearer ${targetToken}`, 'X-Workspace-Id': 'default' },
    }));
    assert.equal(restoredRead.status, 200, 're-inviting clears the removal tombstone');
  } finally {
    proc.kill('SIGTERM');
    if (proc.exitCode == null) {
      await new Promise((resolve) => proc.once('exit', resolve));
    }
    fs.rmSync(tmpConfigDir, { recursive: true, force: true });
    fs.rmSync(uploadDir, { recursive: true, force: true });
  }
});

test('profile rename updates workspace member roster for other clients', async () => {
  const tmpConfigDir = fs.mkdtempSync(path.join(path.sep === '/' ? '/tmp' : process.env.TEMP || '.', 'zouk-member-rename-'));
  const uploadDir = fs.mkdtempSync(path.join(path.sep === '/' ? '/tmp' : process.env.TEMP || '.', 'zouk-member-rename-uploads-'));
  const port = TEST_PORT + 32;
  const base = `http://localhost:${port}`;
  const viewerToken = 'member-rename-viewer-token';
  const targetToken = 'member-rename-target-token';
  const viewerEmail = 'member-rename-viewer@example.com';
  const targetEmail = 'member-rename-target@example.com';
  fs.mkdirSync(tmpConfigDir, { recursive: true });
  fs.writeFileSync(path.join(tmpConfigDir, 'sessions.json'), JSON.stringify([
    [viewerToken, { name: 'member-rename-viewer', email: viewerEmail, picture: null }],
    [targetToken, { name: 'member-rename-target', email: targetEmail, picture: null }],
  ]), 'utf8');

  const proc = spawn(process.execPath, [path.join(__dirname, 'index.js')], {
    env: {
      ...process.env,
      DATABASE_URL: '',
      PORT: String(port),
      NODE_ENV: 'test',
      ALLOW: '',
      ZOUK_CONFIG_DIR: tmpConfigDir,
      ZOUK_UPLOADS_DIR: uploadDir,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.resume();
  proc.stderr.resume();

  let ws = null;
  try {
    const deadline = Date.now() + 10_000;
    let ready = false;
    while (Date.now() < deadline) {
      try {
        const res = await fetch(`${base}/api/auth/config`);
        if (res.ok) {
          ready = true;
          break;
        }
      } catch (_) {}
      await new Promise(r => setTimeout(r, 150));
    }
    assert.equal(ready, true, 'member rename test server must become ready');

    const viewerHeaders = { Authorization: `Bearer ${viewerToken}`, 'X-Workspace-Id': 'default' };
    const before = await json(await fetch(`${base}/api/workspaces/default/members`, {
      headers: viewerHeaders,
    }));
    assert.equal(before.status, 200);
    assert.ok(
      before.body.members.some(m => m.email === targetEmail && m.name === 'member-rename-target'),
      'target session should be listed under its original profile name before rename'
    );

    ws = new WebSocket(`ws://localhost:${port}/ws?token=${viewerToken}`);
    const initPromise = waitForMessageOrTimeout(ws, ev => ev.type === 'init', 3000);
    await new Promise((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', reject);
    });
    const init = await initPromise;
    assert.ok(init, 'viewer websocket should receive init before rename');

    const membersPromise = waitForMessageOrTimeout(ws, ev => (
      ev.type === 'workspace:members'
      && ev.workspaceId === 'default'
      && ev.members?.some(m => m.email === targetEmail && m.name === 'member-rename-renamed')
    ), 3000);

    const renamed = await json(await fetch(`${base}/api/auth/profile`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${targetToken}`, 'X-Workspace-Id': 'default' },
      body: JSON.stringify({ name: 'member-rename-renamed' }),
    }));
    assert.equal(renamed.status, 200);
    assert.equal(renamed.body.user.name, 'member-rename-renamed');

    const broadcast = await membersPromise;
    assert.ok(broadcast, 'other connected clients must receive a workspace member rename broadcast');

    const after = await json(await fetch(`${base}/api/workspaces/default/members`, {
      headers: viewerHeaders,
    }));
    assert.equal(after.status, 200);
    assert.ok(
      after.body.members.some(m => m.email === targetEmail && m.name === 'member-rename-renamed'),
      'workspace member row should persist the renamed profile name'
    );
    assert.ok(
      !after.body.members.some(m => m.email === targetEmail && m.name === 'member-rename-target'),
      'old profile name must not remain in the workspace member roster'
    );
  } finally {
    if (ws) await closeWs(ws);
    proc.kill('SIGTERM');
    if (proc.exitCode == null) {
      await new Promise((resolve) => proc.once('exit', resolve));
    }
    fs.rmSync(tmpConfigDir, { recursive: true, force: true });
    fs.rmSync(uploadDir, { recursive: true, force: true });
  }
});

test('workspace member profile sync refreshes stale PEOPLE names from auth sessions', async () => {
  const authSessions = new Map([
    ['profile-token', { name: 'profile-sync-renamed', email: 'Profile.Sync@Example.com', picture: null }],
    ['guest-token', { name: 'guest-profile-sync', email: 'guest-profile-sync@example.com', guest: true }],
    ['embed-token', { name: 'embed-profile-sync', email: 'embed-profile-sync@example.com', embed: { workspaceId: 'default' } }],
  ]);
  const workspaceMembers = new Map([
    ['default', new Map([
      ['profile.sync@example.com', {
        workspaceId: 'default',
        email: 'profile.sync@example.com',
        role: 'member',
        name: 'profile-sync-old',
        joinedAt: '2026-07-04T00:00:00.000Z',
      }],
      ['guest-profile-sync@example.com', {
        workspaceId: 'default',
        email: 'guest-profile-sync@example.com',
        role: 'member',
        name: 'guest-old',
      }],
    ])],
    ['team', new Map([
      ['profile.sync@example.com', {
        workspaceId: 'team',
        email: 'profile.sync@example.com',
        role: 'root',
        name: 'profile-sync-old',
      }],
      ['embed-profile-sync@example.com', {
        workspaceId: 'team',
        email: 'embed-profile-sync@example.com',
        role: 'member',
        name: 'embed-old',
      }],
    ])],
  ]);
  const updates = [];
  const count = await syncWorkspaceMemberNamesFromSessions({
    authSessions,
    workspaceMembers,
    setWorkspaceMember: async (member) => {
      updates.push(member);
      workspaceMembers.get(member.workspaceId).set(member.email, member);
      return member;
    },
    normalizeEmail: (email) => String(email || '').trim().toLowerCase(),
    normalizeWorkspaceId: (id) => id || 'default',
    isProfileSession: (user) => !!user && !user.guest && !user.embed && !!user.email && !!user.name,
  });

  assert.equal(count, 2);
  assert.deepEqual(
    updates.map((member) => [member.workspaceId, member.email, member.name, member.role]).sort(),
    [
      ['default', 'profile.sync@example.com', 'profile-sync-renamed', 'member'],
      ['team', 'profile.sync@example.com', 'profile-sync-renamed', 'root'],
    ]
  );
  assert.equal(workspaceMembers.get('default').get('guest-profile-sync@example.com').name, 'guest-old');
  assert.equal(workspaceMembers.get('team').get('embed-profile-sync@example.com').name, 'embed-old');
});

// ─── Tasks ────────────────────────────────────────────────────────────────────

test('claim_tasks: existing task can be claimed by its task message id', async () => {
  const title = `claim-by-message-id-${Date.now()}`;
  const created = await json(await fetch(`${BASE}/internal/agent/${MOCK_AGENT}/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ channel: '#all', tasks: [{ title }] }),
  }));
  assert.equal(created.status, 200);
  assert.equal(created.body.tasks.length, 1);

  const [{ taskNumber, messageId }] = created.body.tasks;
  const claimed = await json(await fetch(`${BASE}/internal/agent/${OTHER_AGENT}/tasks/claim`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ channel: '#all', message_ids: [messageId.slice(0, 8)] }),
  }));
  assert.equal(claimed.status, 200);
  assert.deepEqual(claimed.body.results, [
    { taskNumber, messageId, success: true, reason: null },
  ]);
});

test('claim_tasks: normal top-level message ids are converted to claimed tasks', async () => {
  const authRes = await fetch(`${BASE}/api/auth/guest-session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'ci-task-contract' }),
  });
  const { token } = await authRes.json();

  const marker = `claim-contract-probe-${Date.now()}`;
  const sent = await json(await fetch(`${BASE}/api/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ target: '#all', content: marker }),
  }));
  assert.equal(sent.status, 200);

  const claimed = await json(await fetch(`${BASE}/internal/agent/${MOCK_AGENT}/tasks/claim`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ channel: '#all', message_ids: [sent.body.messageId.slice(0, 8)] }),
  }));
  assert.equal(claimed.status, 200);
  const [result] = claimed.body.results;
  assert.equal(result.messageId, sent.body.messageId);
  assert.equal(result.success, true);
  assert.equal(result.reason, null);
  assert.ok(Number.isInteger(result.taskNumber));

  const tasks = await json(await fetch(`${BASE}/internal/agent/${MOCK_AGENT}/tasks?channel=%23all`));
  const task = tasks.body.tasks.find((t) => t.taskNumber === result.taskNumber);
  assert.equal(task.title, marker);
  assert.equal(task.status, 'in_progress');
  assert.equal(task.claimedByName, 'reviewer');

  const history = await json(await fetch(`${BASE}/internal/agent/${MOCK_AGENT}/history?channel=%23all&limit=50`));
  const original = history.body.messages.find((m) => m.message_id === sent.body.messageId);
  assert.equal(original.task_number, result.taskNumber);
  assert.equal(original.task_status, 'in_progress');
});

test('claim_tasks: concurrent normal-message claims create only one task', async () => {
  const authRes = await fetch(`${BASE}/api/auth/guest-session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'ci-task-race' }),
  });
  const { token } = await authRes.json();

  const marker = `claim-race-probe-${Date.now()}`;
  const sent = await json(await fetch(`${BASE}/api/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ target: '#all', content: marker }),
  }));
  assert.equal(sent.status, 200);

  const claimBody = JSON.stringify({ channel: '#all', message_ids: [sent.body.messageId] });
  const [a, b] = await Promise.all([
    json(await fetch(`${BASE}/internal/agent/${MOCK_AGENT}/tasks/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: claimBody,
    })),
    json(await fetch(`${BASE}/internal/agent/${OTHER_AGENT}/tasks/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: claimBody,
    })),
  ]);

  const results = [a.body.results[0], b.body.results[0]];
  assert.equal(results.filter((r) => r.success).length, 1);
  assert.equal(results.filter((r) => r.reason?.startsWith('already claimed by @')).length, 1);

  const tasks = await json(await fetch(`${BASE}/internal/agent/${MOCK_AGENT}/tasks?channel=%23all`));
  const matching = tasks.body.tasks.filter((t) => t.messageId === sent.body.messageId);
  assert.equal(matching.length, 1);
});

test('claim_tasks: DM short message ids resolve in the canonical DM channel', async () => {
  const authRes = await fetch(`${BASE}/api/auth/guest-session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'ci-dm-task-human' }),
  });
  const { token } = await authRes.json();

  const marker = `dm-claim-probe-${Date.now()}`;
  const sent = await json(await fetch(`${BASE}/api/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ target: 'dm:@reviewer', content: marker }),
  }));
  assert.equal(sent.status, 200);

  const claimed = await json(await fetch(`${BASE}/internal/agent/${MOCK_AGENT}/tasks/claim`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ channel: 'dm:@guest-ci-dm-task-human', message_ids: [sent.body.messageId.slice(0, 8)] }),
  }));
  assert.equal(claimed.status, 200);
  const [result] = claimed.body.results;
  assert.equal(result.messageId, sent.body.messageId);
  assert.equal(result.success, true);

  const tasks = await json(await fetch(`${BASE}/internal/agent/${MOCK_AGENT}/tasks?channel=dm%3A%40guest-ci-dm-task-human`));
  const task = tasks.body.tasks.find((t) => t.taskNumber === result.taskNumber);
  assert.equal(task.title, marker);
  assert.equal(task.status, 'in_progress');

  const history = await json(await fetch(`${BASE}/internal/agent/${MOCK_AGENT}/history?channel=dm%3A%40guest-ci-dm-task-human&limit=20`));
  const systemClaim = history.body.messages.find((m) => m.content.includes(`claimed #${result.taskNumber}`));
  assert.equal(systemClaim.parent_channel_type || systemClaim.channel_type, 'dm');
});

test('claim_tasks: missing message ids report message not found', async () => {
  const missingMessageId = `missing-message-${Date.now()}`;
  const claimed = await json(await fetch(`${BASE}/internal/agent/${MOCK_AGENT}/tasks/claim`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ channel: '#all', message_ids: [missingMessageId] }),
  }));
  assert.equal(claimed.status, 200);
  assert.deepEqual(claimed.body.results, [
    {
      taskNumber: null,
      messageId: missingMessageId,
      success: false,
      reason: 'message not found',
    },
  ]);
});

// ─── DM target gating ──────────────────────────────────────────────────────────
// Regression: check_messages used to return every message in the store
// regardless of target, so any agent calling it saw DMs between other pairs.
// Membership-based gating (DM seeds only the two parties) enforces this on
// the /receive, /history, and /search paths.

test('check_messages: DM between human and one agent is not visible to other agents', async () => {
  // Drain all mock agents' /receive so backlog doesn't mask the result.
  for (const id of ['agent-mock-reviewer', 'agent-mock-bugbot', 'agent-mock-deployer']) {
    await fetch(`${BASE}/internal/agent/${id}/receive`);
  }

  const authRes = await fetch(`${BASE}/api/auth/guest-session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'dm-tester' }),
  });
  const { token } = await authRes.json();

  const marker = `dm-gate-probe-${Date.now()}`;
  const sent = await fetch(`${BASE}/api/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ target: 'dm:@reviewer', content: marker }),
  });
  assert.equal(sent.status, 200);

  const { body: recipientBody } = await json(
    await fetch(`${BASE}/internal/agent/agent-mock-reviewer/receive`),
  );
  assert.ok(
    recipientBody.messages.some((m) => m.content === marker),
    'DM recipient (reviewer) must see the message via check_messages',
  );

  for (const nonParty of ['agent-mock-bugbot', 'agent-mock-deployer']) {
    const { body } = await json(await fetch(`${BASE}/internal/agent/${nonParty}/receive`));
    assert.ok(
      !body.messages.some((m) => m.content === marker),
      `non-party agent ${nonParty} must NOT see DM between dm-tester and reviewer`,
    );
  }
});

test('read_history: non-party agent cannot read another pair\'s DM history', async () => {
  const authRes = await fetch(`${BASE}/api/auth/guest-session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'dm-history-tester' }),
  });
  const { token } = await authRes.json();

  const marker = `dm-history-probe-${Date.now()}`;
  await fetch(`${BASE}/api/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ target: 'dm:@bugbot', content: marker }),
  });

  // Recipient agent sees its own DM history.
  const recipient = await json(await fetch(
    `${BASE}/internal/agent/agent-mock-bugbot/history?channel=${encodeURIComponent('dm:@guest-dm-history-tester')}&limit=50`,
  ));
  assert.equal(recipient.status, 200);
  assert.ok(
    recipient.body.messages.some((m) => m.content === marker),
    'DM recipient (bugbot) must see marker in its own DM history',
  );

  // Unrelated agent (reviewer) querying the same DM target returns nothing:
  // matchesTarget + the DM-party gate combine so history is never fished.
  const unrelated = await json(await fetch(
    `${BASE}/internal/agent/agent-mock-reviewer/history?channel=${encodeURIComponent('dm:@guest-dm-history-tester')}&limit=50`,
  ));
  assert.equal(unrelated.status, 200);
  assert.ok(
    !unrelated.body.messages.some((m) => m.content === marker),
    'non-party agent (reviewer) must not see another pair\'s DM via history',
  );
});

test('search_messages: DM content does not leak via search to non-parties', async () => {
  const authRes = await fetch(`${BASE}/api/auth/guest-session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'dm-search-tester' }),
  });
  const { token } = await authRes.json();

  const marker = `dm-search-probe-${Date.now()}`;
  await fetch(`${BASE}/api/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ target: 'dm:@deployer', content: marker }),
  });

  // Deployer (party) finds it.
  const partyHit = await json(await fetch(
    `${BASE}/internal/agent/agent-mock-deployer/search?q=${encodeURIComponent(marker)}&limit=10`,
  ));
  assert.equal(partyHit.status, 200);
  assert.ok(
    partyHit.body.messages?.some?.((m) => m.content === marker)
      ?? partyHit.body.results?.some?.((m) => m.content === marker),
    'DM party (deployer) must find its own DM via search',
  );

  // Reviewer (non-party) cannot find it even by searching its text.
  const nonPartyHit = await json(await fetch(
    `${BASE}/internal/agent/agent-mock-reviewer/search?q=${encodeURIComponent(marker)}&limit=10`,
  ));
  assert.equal(nonPartyHit.status, 200);
  const items = nonPartyHit.body.messages || nonPartyHit.body.results || [];
  assert.ok(
    !items.some((m) => m.content === marker),
    'non-party agent (reviewer) must not find DM content via search',
  );
});

// ─── WS DM broadcast scoping ──────────────────────────────────────────────────

async function openAuthedWs(token) {
  const ws = new WebSocket(`ws://localhost:${TEST_PORT}/ws?token=${token}`);
  await new Promise((resolve, reject) => {
    const onOpen = () => {
      ws.off('error', onError);
      ws.off('unexpected-response', onUnexpectedResponse);
      resolve();
    };
    const onError = (err) => {
      ws.off('open', onOpen);
      ws.off('unexpected-response', onUnexpectedResponse);
      reject(err);
    };
    const onUnexpectedResponse = (_req, res) => {
      ws.off('open', onOpen);
      ws.off('error', onError);
      reject(new Error(`unexpected websocket response ${res.statusCode}`));
    };
    ws.once('open', onOpen);
    ws.once('error', onError);
    ws.once('unexpected-response', onUnexpectedResponse);
  });
  // Drain the init frame so .once('message') below catches real traffic.
  await new Promise((resolve) => ws.once('message', resolve));
  return ws;
}

async function closeWs(ws) {
  if (!ws || ws.readyState === WebSocket.CLOSED) return;
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 50);
    ws.once('close', () => {
      clearTimeout(timer);
      resolve();
    });
    ws.close();
  });
}

function waitForMessageOrTimeout(ws, predicate, timeoutMs = 600) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      ws.off('message', onMsg);
      resolve(null);
    }, timeoutMs);
    const onMsg = (raw) => {
      try {
        const ev = JSON.parse(raw.toString());
        if (predicate(ev)) {
          clearTimeout(timer);
          ws.off('message', onMsg);
          resolve(ev);
        }
      } catch (_) {}
    };
    ws.on('message', onMsg);
  });
}

test('workspaces: unicode ids flow through route websocket and root delete', async () => {
  const tmpConfigDir = fs.mkdtempSync(path.join(path.sep === '/' ? '/tmp' : process.env.TEMP || '.', 'zouk-workspace-'));
  const uploadDir = fs.mkdtempSync(path.join(path.sep === '/' ? '/tmp' : process.env.TEMP || '.', 'zouk-workspace-uploads-'));
  const port = TEST_PORT + 20;
  const base = `http://localhost:${port}`;
  const token = 'workspace-root-token';
  fs.mkdirSync(tmpConfigDir, { recursive: true });
  fs.writeFileSync(path.join(tmpConfigDir, 'sessions.json'), JSON.stringify([
    [token, { name: 'workspace-root', email: 'workspace-root@example.com', picture: null }],
  ]), 'utf8');

  const proc = spawn(process.execPath, [path.join(__dirname, 'index.js')], {
    env: {
      ...process.env,
      DATABASE_URL: '',
      PORT: String(port),
      NODE_ENV: 'test',
      ZOUK_CONFIG_DIR: tmpConfigDir,
      ZOUK_UPLOADS_DIR: uploadDir,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.resume();
  proc.stderr.resume();

  try {
    const deadline = Date.now() + 10_000;
    let ready = false;
    while (Date.now() < deadline) {
      try {
        const res = await fetch(`${base}/api/channels`);
        if (res.ok) {
          ready = true;
          break;
        }
      } catch (_) {}
      await new Promise(r => setTimeout(r, 150));
    }
    assert.equal(ready, true, 'workspace test server must become ready');

    const authHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
    const first = await json(await fetch(`${base}/api/workspaces`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ name: '中文 服务' }),
    }));
    assert.equal(first.status, 200);
    assert.equal(first.body.workspace.id, '中文-服务');

    const duplicate = await json(await fetch(`${base}/api/workspaces`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ name: '中文 服务' }),
    }));
    assert.equal(duplicate.status, 200);
    assert.equal(duplicate.body.workspace.id, '中文-服务-2');

    const workspaceId = first.body.workspace.id;
    const ws = new WebSocket(`ws://localhost:${port}/ws?token=${token}&workspaceId=${encodeURIComponent(workspaceId)}`);
    const initPromise = waitForMessageOrTimeout(ws, ev => ev.type === 'init', 3000);
    await new Promise((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', reject);
    });
    const init = await initPromise;
    assert.equal(init?.workspaceId, workspaceId);

    const deletedPromise = waitForMessageOrTimeout(ws, ev => ev.type === 'workspace_deleted' && ev.workspaceId === workspaceId, 3000);
    const deleted = await json(await fetch(`${base}/api/workspaces/${encodeURIComponent(workspaceId)}`, {
      method: 'DELETE',
      headers: { ...authHeaders, 'X-Workspace-Id': encodeURIComponent(workspaceId) },
    }));
    assert.equal(deleted.status, 200);
    assert.equal(deleted.body.workspace.id, workspaceId);
    assert.ok(!deleted.body.workspaces.some(w => w.id === workspaceId));
    assert.ok(await deletedPromise, 'deleted workspace tab must receive workspace_deleted over WS');
    ws.close();

    const defaultDelete = await json(await fetch(`${base}/api/workspaces/default`, {
      method: 'DELETE',
      headers: { ...authHeaders, 'X-Workspace-Id': 'default' },
    }));
    assert.equal(defaultDelete.status, 400);
  } finally {
    proc.kill('SIGKILL');
    fs.rmSync(tmpConfigDir, { recursive: true, force: true });
    fs.rmSync(uploadDir, { recursive: true, force: true });
  }
});

// name-scope — agent handle uniqueness must be per-workspace, not global. A
// global check let an agent in one workspace (e.g. the default "zeus") block
// creating the same handle in another, and deleting the local one couldn't free
// it. Regression guard for both 409 paths: POST /api/agents/start and POST
// /api/agent-configs. The start name-check fires before any daemon work, so the
// cross-workspace case reaches "no daemon" (400/non-409) rather than conflict.
test('agent name uniqueness is scoped per-workspace (start + config create)', async () => {
  const tmpConfigDir = fs.mkdtempSync(path.join(path.sep === '/' ? '/tmp' : process.env.TEMP || '.', 'zouk-name-scope-'));
  const uploadDir = fs.mkdtempSync(path.join(path.sep === '/' ? '/tmp' : process.env.TEMP || '.', 'zouk-name-scope-uploads-'));
  const port = TEST_PORT + 21;
  const base = `http://localhost:${port}`;
  const token = 'name-scope-root-token';
  const email = 'name-scope-root@example.com';
  fs.writeFileSync(path.join(tmpConfigDir, 'sessions.json'), JSON.stringify([
    [token, { name: 'name-scope-root', email, picture: null }],
  ]), 'utf8');

  const proc = spawn(process.execPath, [path.join(__dirname, 'index.js')], {
    env: {
      ...process.env,
      DATABASE_URL: '',
      PORT: String(port),
      NODE_ENV: 'test',
      ZOUK_CONFIG_DIR: tmpConfigDir,
      ZOUK_UPLOADS_DIR: uploadDir,
      ZOUK_SUPERUSERS: email,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.resume();
  proc.stderr.resume();

  const auth = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  const wsHeaders = (wsId) => ({ ...auth, 'X-Workspace-Id': wsId });

  try {
    const deadline = Date.now() + 10_000;
    let ready = false;
    while (Date.now() < deadline) {
      try { if ((await fetch(`${base}/api/channels`)).ok) { ready = true; break; } } catch (_) {}
      await new Promise(r => setTimeout(r, 150));
    }
    assert.equal(ready, true, 'name-scope test server must become ready');

    // Two workspaces, each with its own machine key (config create requires a
    // machine key bound to the same workspace).
    const wsA = (await json(await fetch(`${base}/api/workspaces`, { method: 'POST', headers: auth, body: JSON.stringify({ name: 'Scope A' }) }))).body.workspace.id;
    const wsB = (await json(await fetch(`${base}/api/workspaces`, { method: 'POST', headers: auth, body: JSON.stringify({ name: 'Scope B' }) }))).body.workspace.id;
    assert.ok(wsA && wsB && wsA !== wsB, 'two distinct workspaces');
    const keyA = (await json(await fetch(`${base}/api/machine-keys`, { method: 'POST', headers: wsHeaders(wsA), body: JSON.stringify({ name: 'mk-a' }) }))).body.key.id;
    const keyB = (await json(await fetch(`${base}/api/machine-keys`, { method: 'POST', headers: wsHeaders(wsB), body: JSON.stringify({ name: 'mk-b' }) }))).body.key.id;

    // Seed handle "dupe" in workspace A.
    const created = await json(await fetch(`${base}/api/agent-configs`, { method: 'POST', headers: wsHeaders(wsA), body: JSON.stringify({ name: 'dupe', runtime: 'claude', model: 'sonnet', machineId: keyA }) }));
    assert.equal(created.status, 200, 'creating "dupe" in workspace A should succeed');

    // start: same handle, same workspace → 409 (fires before daemon lookup).
    const startSame = await json(await fetch(`${base}/api/agents/start`, { method: 'POST', headers: wsHeaders(wsA), body: JSON.stringify({ name: 'dupe', runtime: 'claude', machineId: keyA }) }));
    assert.equal(startSame.status, 409, 'starting "dupe" again in workspace A must conflict');

    // start: same handle, different workspace → not a name conflict (proceeds to
    // the daemon step and fails only because no daemon is connected).
    const startCross = await json(await fetch(`${base}/api/agents/start`, { method: 'POST', headers: wsHeaders(wsB), body: JSON.stringify({ name: 'dupe', runtime: 'claude', machineId: keyB }) }));
    assert.notEqual(startCross.status, 409, 'starting "dupe" in workspace B must not be a name conflict');

    // config create: same-workspace duplicate blocked, cross-workspace allowed.
    const cfgSame = await json(await fetch(`${base}/api/agent-configs`, { method: 'POST', headers: wsHeaders(wsA), body: JSON.stringify({ name: 'dupe', runtime: 'claude', model: 'sonnet', machineId: keyA }) }));
    assert.equal(cfgSame.status, 409, 'creating a second "dupe" in workspace A must conflict');
    const cfgCross = await json(await fetch(`${base}/api/agent-configs`, { method: 'POST', headers: wsHeaders(wsB), body: JSON.stringify({ name: 'dupe', runtime: 'claude', model: 'sonnet', machineId: keyB }) }));
    assert.equal(cfgCross.status, 200, 'creating "dupe" in workspace B must be allowed (handles scoped per workspace)');
  } finally {
    proc.kill('SIGKILL');
    fs.rmSync(tmpConfigDir, { recursive: true, force: true });
    fs.rmSync(uploadDir, { recursive: true, force: true });
  }
});

test('WS rate limit allows many concurrent browser windows for one token', async () => {
  const authRes = await fetch(`${BASE}/api/auth/guest-session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: `ws-tabs-${Date.now()}` }),
  });
  const { token } = await authRes.json();
  const sockets = [];
  try {
    const opened = await Promise.all(Array.from({ length: 13 }, () => openAuthedWs(token)));
    sockets.push(...opened);
    assert.equal(sockets.length, 13);
  } finally {
    await Promise.all(sockets.map(closeWs));
  }
});

test('WS rate limit does not block moderate reconnect churn while browser tabs are open', async () => {
  const authRes = await fetch(`${BASE}/api/auth/guest-session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: `ws-pc-tabs-${Date.now()}` }),
  });
  const { token } = await authRes.json();
  const persistent = [];
  try {
    const opened = await Promise.all(Array.from({ length: 3 }, () => openAuthedWs(token)));
    persistent.push(...opened);
    for (let i = 0; i < 25; i += 1) {
      const ws = await openAuthedWs(token);
      await closeWs(ws);
    }
  } finally {
    await Promise.all(persistent.map(closeWs));
  }
});

test('WS broadcast: DM messages reach only the two parties', async () => {
  const sessionFor = async (name) => {
    const res = await fetch(`${BASE}/api/auth/guest-session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    return (await res.json()).token;
  };
  const aliceToken = await sessionFor('dmtest-alice');
  const bobToken = await sessionFor('dmtest-bob');
  const carolToken = await sessionFor('dmtest-carol');

  const aliceWs = await openAuthedWs(aliceToken);
  const bobWs = await openAuthedWs(bobToken);
  const carolWs = await openAuthedWs(carolToken);

  const marker = `dm-scope-probe-${Date.now()}`;
  const isProbeMsg = (ev) => ev.type === 'message' && ev.message?.content === marker;

  // alice → bob DM. alice must receive her own echo (client relies on it to
  // render). bob must receive it (he's the recipient). carol must NOT.
  const alicePromise = waitForMessageOrTimeout(aliceWs, isProbeMsg);
  const bobPromise = waitForMessageOrTimeout(bobWs, isProbeMsg);
  const carolPromise = waitForMessageOrTimeout(carolWs, isProbeMsg);

  await fetch(`${BASE}/api/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${aliceToken}` },
    body: JSON.stringify({ target: 'dm:@guest-dmtest-bob', content: marker }),
  });

  const [aliceGot, bobGot, carolGot] = await Promise.all([alicePromise, bobPromise, carolPromise]);

  await Promise.all([aliceWs, bobWs, carolWs].map(closeWs));

  assert.ok(aliceGot, 'sender (alice) must receive her own DM echo');
  assert.ok(bobGot, 'recipient (bob) must receive the DM');
  assert.equal(carolGot, null, 'uninvolved party (carol) must NOT receive the DM');
});

// ─── Channel ↔ Agent membership ───────────────────────────────────────────────
// These tests cover the PM-broadcast-v2 fix: only agents that are members of a
// channel should see messages in that channel via the pull path
// (check_messages / history / search) and the push path (WS deliver). Mock
// data explicitly seeds agents into all preview channels (all, engineering,
// design, ops) — new channels/agents no longer auto-subscribe.

const MOCK_AGENT = 'agent-mock-reviewer';
const OTHER_AGENT = 'agent-mock-bugbot';

test('subscriptions: mock agents are explicitly seeded into all mock channels', async () => {
  const { status, body } = await json(await fetch(
    `${BASE}/internal/agent/${MOCK_AGENT}/subscriptions`,
  ));
  assert.equal(status, 200);
  const names = new Set(body.subscriptions.map(s => s.channelName));
  for (const expected of ['all', 'engineering', 'design', 'ops']) {
    assert.ok(names.has(expected), `explicit mock membership on #${expected} expected`);
  }
  // All explicitly-seeded rows should be both readable and subscribed.
  for (const s of body.subscriptions) {
    assert.equal(s.canRead, true);
    assert.equal(s.subscribed, true);
  }
});

test('GET /api/agents/:id/channels: returns visible channel names for known agent', async () => {
  const authRes = await fetch(`${BASE}/api/auth/guest-session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'channels-tester' }),
  });
  const { token } = await authRes.json();
  const { status, body } = await json(await fetch(
    `${BASE}/api/agents/${MOCK_AGENT}/channels`,
    { headers: { Authorization: `Bearer ${token}` } },
  ));
  assert.equal(status, 200);
  assert.ok(Array.isArray(body.channels), 'channels must be an array');
  const channelSet = new Set(body.channels);
  for (const expected of ['all', 'engineering', 'design', 'ops']) {
    assert.ok(channelSet.has(expected), `#${expected} must appear in agent channels`);
  }
});

test('GET /api/agents/:id/channels: returns 404 for unknown agent', async () => {
  const authRes = await fetch(`${BASE}/api/auth/guest-session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'channels-404-tester' }),
  });
  const { token } = await authRes.json();
  const { status } = await json(await fetch(
    `${BASE}/api/agents/no-such-agent/channels`,
    { headers: { Authorization: `Bearer ${token}` } },
  ));
  assert.equal(status, 404);
});

test('PATCH /internal/.../subscriptions flips canRead + visibility in history', async () => {
  // Seed a unique marker so we know which message to look for.
  const authRes = await fetch(`${BASE}/api/auth/guest-session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'membership-tester' }),
  });
  const { token } = await authRes.json();
  const marker = `membership-probe-${Date.now()}`;
  await fetch(`${BASE}/api/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ target: '#engineering', content: marker }),
  });

  // Subscribed agent sees it in history.
  const before = await json(await fetch(
    `${BASE}/internal/agent/${MOCK_AGENT}/history?channel=%23engineering&limit=50`,
  ));
  assert.equal(before.status, 200);
  assert.ok(
    before.body.messages.some(m => m.content === marker),
    'subscribed agent should see the marker in #engineering history'
  );

  // Flip canRead=false and subscribed=false for this agent.
  const patched = await json(await fetch(
    `${BASE}/internal/agent/${MOCK_AGENT}/subscriptions`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channelName: 'engineering', canRead: false, subscribed: false }),
    }
  ));
  assert.equal(patched.status, 200);
  assert.equal(patched.body.membership, null, 'both flags false must remove the row');

  // Unsubscribed agent no longer sees #engineering history.
  const after = await json(await fetch(
    `${BASE}/internal/agent/${MOCK_AGENT}/history?channel=%23engineering&limit=50`,
  ));
  assert.equal(after.status, 200);
  assert.ok(
    !after.body.messages.some(m => m.content === marker),
    'unsubscribed agent must not see #engineering history'
  );

  // Other agent still sees it.
  const other = await json(await fetch(
    `${BASE}/internal/agent/${OTHER_AGENT}/history?channel=%23engineering&limit=50`,
  ));
  assert.equal(other.status, 200);
  assert.ok(
    other.body.messages.some(m => m.content === marker),
    'other subscribed agent should still see #engineering history'
  );

  // Re-subscribe for cleanliness / later tests.
  await fetch(
    `${BASE}/internal/agent/${MOCK_AGENT}/subscriptions`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channelName: 'engineering', canRead: true, subscribed: true }),
    }
  );
});

test('check_messages: only members of the channel see its messages', async () => {
  // Drain any pending backlog for both agents so we're measuring incremental delivery.
  await fetch(`${BASE}/internal/agent/${MOCK_AGENT}/receive`);
  await fetch(`${BASE}/internal/agent/${OTHER_AGENT}/receive`);

  // Unsubscribe OTHER_AGENT from #ops while MOCK_AGENT stays subscribed.
  await fetch(
    `${BASE}/internal/agent/${OTHER_AGENT}/subscriptions`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channelName: 'ops', canRead: false, subscribed: false }),
    }
  );

  // Send a message to #ops.
  const authRes = await fetch(`${BASE}/api/auth/guest-session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'ops-poster' }),
  });
  const { token } = await authRes.json();
  const marker = `ops-probe-${Date.now()}`;
  await fetch(`${BASE}/api/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ target: '#ops', content: marker }),
  });

  // Subscribed agent's check_messages should include it.
  const member = await json(await fetch(`${BASE}/internal/agent/${MOCK_AGENT}/receive`));
  assert.equal(member.status, 200);
  assert.ok(
    member.body.messages.some(m => m.content === marker),
    'member agent must receive the #ops message via check_messages'
  );

  // Unsubscribed agent's check_messages MUST NOT include it.
  const nonMember = await json(await fetch(`${BASE}/internal/agent/${OTHER_AGENT}/receive`));
  assert.equal(nonMember.status, 200);
  assert.ok(
    !nonMember.body.messages.some(m => m.content === marker),
    'non-member agent must NOT see #ops message via check_messages (the PM-broadcast bug)'
  );

  // Restore.
  await fetch(
    `${BASE}/internal/agent/${OTHER_AGENT}/subscriptions`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channelName: 'ops', canRead: true, subscribed: true }),
    }
  );
});

test('DM between two agents: only the two parties are seeded as members', async () => {
  // Sending any DM message to create the channel. We use the /api/messages
  // path but need an auth token first.
  const authRes = await fetch(`${BASE}/api/auth/guest-session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'reviewer' }),
  });
  const { token } = await authRes.json();
  const marker = `dm-probe-${Date.now()}`;
  const dmSend = await json(await fetch(`${BASE}/api/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ target: 'dm:@bugbot', content: marker }),
  }));
  assert.equal(dmSend.status, 200);

  // The recipient agent (bugbot) must see it via check_messages.
  const recipient = await json(await fetch(`${BASE}/internal/agent/${OTHER_AGENT}/receive`));
  assert.equal(recipient.status, 200);
  assert.ok(
    recipient.body.messages.some(m => m.content === marker),
    'DM recipient must see the message via check_messages'
  );

  // A third, uninvolved agent must NOT see it.
  const third = await json(await fetch(`${BASE}/internal/agent/agent-mock-deployer/receive`));
  assert.equal(third.status, 200);
  assert.ok(
    !third.body.messages.some(m => m.content === marker),
    'uninvolved agent must NOT see a DM between two other agents'
  );
});

// ─── DM bypasses channel_agents ───────────────────────────────────────────────
// Regression: even when no channel_agents row exists for the agent party of a
// DM channel (e.g., because the channel was created before PR #168 shipped and
// the backfill missed this pair), the DM must still be delivered to the agent
// party. Visibility/delivery resolve DM parties from the canonical channel
// name (`dm:a,b`), not the membership table.

test('DM delivery survives missing channel_agents row (no seed needed)', async () => {
  // Send a DM from a fresh human to `reviewer` to force channel creation.
  const authRes = await fetch(`${BASE}/api/auth/guest-session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'dm-bypass-tester' }),
  });
  const { token } = await authRes.json();
  const marker = `dm-bypass-probe-${Date.now()}`;

  await fetch(`${BASE}/api/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ target: 'dm:@reviewer', content: marker }),
  });

  // The DM channel must NOT have written a channel_agents row for the
  // agent party — DM routing is table-free by design now.
  const subs = await json(
    await fetch(`${BASE}/internal/agent/agent-mock-reviewer/subscriptions`),
  );
  assert.equal(subs.status, 200);
  const dmSub = subs.body.subscriptions.find(
    (s) => s.channelType === 'dm' && s.channelName.includes('dm-bypass-tester'),
  );
  assert.equal(
    dmSub,
    undefined,
    'DM channels must not write channel_agents rows anymore',
  );

  // Drain so the next receive is incremental.
  await fetch(`${BASE}/internal/agent/agent-mock-reviewer/receive`);

  // Send a second DM to exercise delivery path with the table empty.
  const marker2 = `dm-bypass-probe2-${Date.now()}`;
  await fetch(`${BASE}/api/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ target: 'dm:@reviewer', content: marker2 }),
  });

  const recipient = await json(
    await fetch(`${BASE}/internal/agent/agent-mock-reviewer/receive`),
  );
  assert.equal(recipient.status, 200);
  assert.ok(
    recipient.body.messages.some((m) => m.content === marker2),
    'DM recipient must see the message even without a channel_agents row',
  );

  // Non-party agent must still not see it (party-list gate holds).
  const nonParty = await json(
    await fetch(`${BASE}/internal/agent/agent-mock-deployer/receive`),
  );
  assert.equal(nonParty.status, 200);
  assert.ok(
    !nonParty.body.messages.some((m) => m.content === marker2),
    'non-party agent must NOT see DM even when table-free',
  );
});

// ─── Thread index + sliding window + stats ────────────────────────────────────

test('thread index: parent + replies surface via includeReplies in O(1)', async () => {
  // Reason: pre-fix this lookup was a full store.messages scan per message.
  // The index swap is the real fix; this test catches a regression where
  // messagesByShortId / repliesByThreadId stop being maintained on push.
  const authRes = await fetch(`${BASE}/api/auth/guest-session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'ci-thread' }),
  });
  const { token } = await authRes.json();

  const parentMarker = `ci-thread-parent-${Date.now()}`;
  const parentRes = await json(await fetch(`${BASE}/api/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ target: '#all', content: parentMarker }),
  }));
  assert.equal(parentRes.status, 200);
  const parentId = parentRes.body.message.id;
  const shortId = parentId.slice(0, 8);

  // Three replies in the parent's thread.
  const replyMarkers = [];
  for (let i = 0; i < 3; i++) {
    const m = `ci-thread-reply-${i}-${Date.now()}`;
    replyMarkers.push(m);
    const r = await fetch(`${BASE}/api/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ target: `#all:${shortId}`, content: m }),
    });
    assert.equal(r.status, 200);
  }

  // GET /api/messages includes replies inline (the O(L*N) hot path pre-fix).
  // The repliesByThreadId index drives parent.replies + replyCount.
  const histRes = await json(await fetch(`${BASE}/api/messages`, {
    headers: { 'X-Channel': '#all', 'X-Limit': '50' },
  }));
  assert.equal(histRes.status, 200);
  const parent = histRes.body.messages.find((m) => m.id === parentId);
  assert.ok(parent, 'parent message must be in history');
  assert.equal(parent.replyCount, 3, 'replyCount must reflect all replies');
  assert.equal(parent.replies.length, 3, 'inline replies must include all three');
  for (const m of replyMarkers) {
    assert.ok(parent.replies.some((r) => r.content === m), `reply "${m}" must surface inline`);
  }

  // The flat /api/messages?#all view filters out thread replies (matchesTarget
  // requires no threadId for a non-thread target). Pull the thread itself to
  // verify findThreadParentId routes via messagesByShortId — each reply must
  // round-trip with parentMessageId pointing at the parent.
  const threadRes = await json(await fetch(`${BASE}/api/messages`, {
    headers: { 'X-Channel': `#all:${shortId}`, 'X-Limit': '20' },
  }));
  assert.equal(threadRes.status, 200);
  assert.equal(threadRes.body.messages.length, 3, 'thread must show 3 replies');
  for (const r of threadRes.body.messages) {
    assert.equal(r.parentMessageId, parentId, 'parentMessageId must round-trip via index');
  }
});

test('GET /api/_internal/stats: auth-gated diagnostic counters', async () => {
  // Reason: this endpoint is the operator escape hatch when "feels slow"
  // reports come in. It must stay auth-gated AND keep its core fields
  // (per-channel cache sizes, index sizes) so curl-based investigations work.
  const noAuth = await fetch(`${BASE}/api/_internal/stats`);
  assert.equal(noAuth.status, 403, 'stats must reject unauthenticated callers');

  const authRes = await fetch(`${BASE}/api/auth/guest-session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'ci-stats' }),
  });
  const { token } = await authRes.json();

  const { status, body } = await json(await fetch(`${BASE}/api/_internal/stats`, {
    headers: { Authorization: `Bearer ${token}` },
  }));
  assert.equal(status, 200);
  assert.ok(typeof body.store.cachedMessages === 'number');
  assert.ok(typeof body.store.cachedChannels === 'number');
  assert.ok(typeof body.store.channelCacheTail === 'number' && body.store.channelCacheTail > 0);
  assert.ok(typeof body.indexes.messagesById === 'number');
  assert.ok(typeof body.indexes.messagesByShortId === 'number');
});

test('per-channel cache tail caps growth without dropping the latest page', async () => {
  // Reason: history reads moved off a single global sliding window onto
  // per-channel tail caches + DB fallback. This test boots a server with a
  // tiny per-channel cap, sends more messages than the cap, and confirms (a)
  // the cap holds in memory and (b) the newest page is still served from
  // cache without falling back to DB.
  const capPort = TEST_PORT + 2;
  const capBase = `http://localhost:${capPort}`;

  const proc = spawn(process.execPath, [path.join(__dirname, 'index.js')], {
    env: {
      ...process.env,
      PORT: String(capPort),
      NODE_ENV: 'test',
      ZOUK_UPLOADS_DIR: TEST_UPLOADS_DIR,
      CHANNEL_CACHE_TAIL: '5',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.resume();
  proc.stderr.resume();

  try {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      try {
        const r = await fetch(`${capBase}/api/channels`);
        if (r.ok) break;
      } catch (_) {}
      await new Promise((r) => setTimeout(r, 150));
    }

    const authRes = await fetch(`${capBase}/api/auth/guest-session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'ci-cap' }),
    });
    const { token } = await authRes.json();

    // Push 12 messages — 7 over the per-channel cap.
    for (let i = 0; i < 12; i++) {
      await fetch(`${capBase}/api/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ target: '#all', content: `cap-probe-${i}` }),
      });
    }

    const stats = await json(await fetch(`${capBase}/api/_internal/stats`, {
      headers: { Authorization: `Bearer ${token}` },
    }));
    assert.equal(stats.status, 200);
    assert.equal(stats.body.store.channelCacheTail, 5, 'cap env must be respected');
    // Per-channel cap means total cached count is at most (channels × cap).
    // With seeded mock channels + #all this is well below 5×N — exact total
    // isn't load-bearing; the behavioral check below proves the cap works.
    assert.ok(
      stats.body.store.cachedMessages <= stats.body.store.cachedChannels * stats.body.store.channelCacheTail,
      `cached total ${stats.body.store.cachedMessages} exceeds per-channel cap × channels`
    );

    // Without DB (no DATABASE_URL in this test env), older messages are gone
    // — only the per-channel cache holds them. Latest 5 must be served, and
    // anything older than cap-probe-(11 - cap + 1) = cap-probe-7 must be gone.
    const histRes = await json(await fetch(`${capBase}/api/messages`, {
      headers: { 'X-Channel': '#all', 'X-Limit': '20' },
    }));
    assert.equal(histRes.status, 200);
    const contents = histRes.body.messages.map((m) => m.content);
    assert.ok(contents.includes('cap-probe-11'), 'newest message must remain in cache');
    assert.ok(!contents.includes('cap-probe-0'), 'oldest message must be evicted');
  } finally {
    proc.kill('SIGTERM');
    if (proc.exitCode == null) {
      await new Promise((resolve) => proc.once('exit', resolve));
    }
  }
});

// ─── Trigger API ──────────────────────────────────────────────────────────────
//
// External systems POST /api/trigger to inject a message into a public channel.
// Behaviour must match POST /api/messages so downstream side-effects (mention
// fanout, agent wakeup, WS broadcast, persistence) fire identically. Sender
// is hardcoded to "system" + senderType="human", and "system" is reserved
// (see RESERVED_USER_NAMES) so it can't collide with a real user.

test('POST /api/trigger: rejects request with no API key', async () => {
  const res = await fetch(`${BASE}/api/trigger`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ target: '#all', content: 'should fail' }),
  });
  assert.equal(res.status, 401);
});

test('POST /api/trigger: rejects invalid API key', async () => {
  const res = await fetch(`${BASE}/api/trigger`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': 'nope-not-a-real-key' },
    body: JSON.stringify({ target: '#all', content: 'should fail' }),
  });
  assert.equal(res.status, 401);
});

test('POST /api/trigger: rejects DM target', async () => {
  const { status, body } = await json(await fetch(`${BASE}/api/trigger`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': 'test' },
    body: JSON.stringify({ target: 'dm:@ci-tester', content: 'should fail' }),
  }));
  assert.equal(status, 400);
  assert.match(body.error, /DMs not supported|public channels/i);
});

test('POST /api/trigger: rejects empty content', async () => {
  const { status } = await json(await fetch(`${BASE}/api/trigger`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': 'test' },
    body: JSON.stringify({ target: '#all', content: '   ' }),
  }));
  assert.equal(status, 400);
});

test('POST /api/trigger: rejects unknown channel', async () => {
  const { status, body } = await json(await fetch(`${BASE}/api/trigger`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': 'test' },
    body: JSON.stringify({ target: '#nonexistent-channel-xyz', content: 'hi' }),
  }));
  assert.equal(status, 404);
  assert.match(body.error, /not found/i);
});

test('POST /api/trigger: stores message + visible in /api/messages with senderName=system, senderType=human', async () => {
  const marker = `ci-trigger-probe-${Date.now()}`;
  const sendRes = await fetch(`${BASE}/api/trigger`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': 'test' },
    body: JSON.stringify({ target: '#all', content: marker }),
  });
  const { status, body } = await json(sendRes);
  assert.equal(status, 200);
  assert.ok(body.messageId, 'response must include messageId');
  assert.equal(body.message.content, marker);
  assert.equal(body.message.channelName, 'all');
  assert.equal(body.message.senderName, 'system');
  // senderType="human" so the frontend renders it as a normal chat row;
  // the empty-frame avatar fallback keys on senderName==="system".
  assert.equal(body.message.senderType, 'human');

  const { body: histBody } = await json(await fetch(`${BASE}/api/messages`, {
    headers: { 'X-Channel': '#all', 'X-Limit': '20' },
  }));
  const found = histBody.messages.find((m) => m.content === marker);
  assert.ok(found, 'triggered message must appear in channel history');
  // formatMessageForClient returns camelCase; the web client normalizes to
  // snake_case in lib/api.ts.
  assert.equal(found.senderName, 'system');
  assert.equal(found.senderType, 'human');
});

test('POST /api/trigger: WS clients receive the broadcast frame', async () => {
  // A trigger message must hit broadcastToWeb, just like POST /api/messages.
  const ws = new WebSocket(`ws://localhost:${TEST_PORT}/ws`);
  await new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
  const marker = `ci-trigger-ws-${Date.now()}`;
  const received = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('ws frame timeout')), 3000);
    ws.on('message', (data) => {
      const evt = JSON.parse(data.toString());
      if (evt.type === 'message' && evt.message?.content === marker) {
        clearTimeout(timer);
        resolve(evt.message);
      }
    });
  });

  await fetch(`${BASE}/api/trigger`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': 'test' },
    body: JSON.stringify({ target: '#all', content: marker }),
  });
  const broadcast = await received;
  assert.equal(broadcast.senderName, 'system');
  assert.equal(broadcast.senderType, 'human');
  ws.close();
});

// ─── Reserved usernames ───────────────────────────────────────────────────────

test('guest-session forces a guest- prefix (reserved "system" becomes "guest-system")', async () => {
  // The forced prefix structurally prevents a guest from claiming a reserved
  // identity: "system" is namespaced to "guest-system" instead of rejected.
  const res = await fetch(`${BASE}/api/auth/guest-session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'system' }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.name, 'guest-system');
});

test('guest-session strips a client-supplied guest- prefix (no doubling)', async () => {
  const res = await fetch(`${BASE}/api/auth/guest-session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'guest-alice' }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.name, 'guest-alice');
});

test('guest-session prefixes a plain name', async () => {
  const res = await fetch(`${BASE}/api/auth/guest-session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Bob' }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.name, 'guest-Bob');
});

test('reserved username: profile rename to "system" is rejected', async () => {
  // Mint a guest session with a non-reserved name first, then attempt rename.
  const authRes = await fetch(`${BASE}/api/auth/guest-session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'ci-rename-probe' }),
  });
  const { token } = await authRes.json();
  const res = await fetch(`${BASE}/api/auth/profile`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ name: 'system' }),
  });
  assert.equal(res.status, 400);
});

// ─── username charset (OV peer_id contract) ───────────────────────────────────
// A human's display name is used verbatim as its OV peer_id, so every naming
// entry point must reject names outside [a-zA-Z0-9_.@-] — otherwise two distinct
// names could fold to one peer_id and merge two people's peer memory.
const CHARSET = /^[a-zA-Z0-9_.@-]+$/;

for (const bad of ['bob smith', 'José', 'user+tag', 'emoji😀', 'a/b']) {
  test(`guest-session rejects out-of-charset name ${JSON.stringify(bad)}`, async () => {
    const res = await fetch(`${BASE}/api/auth/guest-session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: bad }),
    });
    assert.equal(res.status, 400);
  });
}

test('guest-session accepts every allowed punctuation char', async () => {
  const res = await fetch(`${BASE}/api/auth/guest-session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'a_b.c@d-e' }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.name, 'guest-a_b.c@d-e');
  assert.match(body.name, CHARSET);
});

test('profile rename rejects an out-of-charset name and keeps it on accept', async () => {
  const authRes = await fetch(`${BASE}/api/auth/guest-session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'ci-charset-probe' }),
  });
  const { token } = await authRes.json();
  const reject = await fetch(`${BASE}/api/auth/profile`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ name: 'has space' }),
  });
  assert.equal(reject.status, 400);
  const ok = await fetch(`${BASE}/api/auth/profile`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ name: 'renamed_user.1' }),
  });
  assert.equal(ok.status, 200);
  const body = await ok.json();
  assert.match(body.user.name, CHARSET);
});

// ─── username uniqueness (查重) ────────────────────────────────────────────────
// A name claimed by one participant can't be reused by another — otherwise two
// people share one OV peer_id and their peer memory merges. Renames reject with
// 409; a successful rename seeds allTimeHumans, which is what later claims hit.
async function guestToken(name) {
  const res = await fetch(`${BASE}/api/auth/guest-session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  return (await res.json()).token;
}
async function renameTo(token, name) {
  return fetch(`${BASE}/api/auth/profile`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ name }),
  });
}

test('rename: a name owned by another user is rejected (409); a free one is accepted', async () => {
  const a = await guestToken('dedup-a');
  const b = await guestToken('dedup-b');
  assert.equal((await renameTo(a, 'dedup-owner')).status, 200);   // A registers the name
  assert.equal((await renameTo(b, 'dedup-owner')).status, 409);   // B cannot shadow it
  assert.equal((await renameTo(b, 'dedup-other')).status, 200);   // B takes a free name
});

test('rename: re-claiming your own name (incl. case-only change) is allowed', async () => {
  const a = await guestToken('dedup-self');
  assert.equal((await renameTo(a, 'dedup-self-name')).status, 200);
  assert.equal((await renameTo(a, 'dedup-self-name')).status, 200); // no-op
  assert.equal((await renameTo(a, 'DEDUP-SELF-NAME')).status, 200); // case-only
});

test('guest-session: a name already registered by a human is rejected (409)', async () => {
  const a = await guestToken('dedup-seed');
  assert.equal((await renameTo(a, 'guest-dedupclaim')).status, 200); // lands in allTimeHumans
  const res = await fetch(`${BASE}/api/auth/guest-session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'dedupclaim' }),                    // → guest-dedupclaim
  });
  assert.equal(res.status, 409);
});

// ─── update_profile (agent self-edit) ─────────────────────────────────────────
// These tests exercise POST /internal/agent/:agentId/profile, the endpoint the
// chat-bridge `update_profile` MCP tool calls. The endpoint must:
//   1. Reject empty/oversize/reserved input
//   2. Server-side resize uploaded pictures so a misbehaving agent can't blow up the DB

const PROFILE_AGENT = 'agent-mock-reviewer';
const sharp = require('sharp');

async function makeTestPng(dim = 32) {
  // Solid red 32x32 png — small and decodable.
  return sharp({
    create: { width: dim, height: dim, channels: 3, background: { r: 200, g: 30, b: 30 } },
  }).png().toBuffer();
}

test('update_profile: rejects when no fields provided', async () => {
  const form = new FormData();
  const res = await fetch(`${BASE}/internal/agent/${PROFILE_AGENT}/profile`, {
    method: 'POST',
    body: form,
  });
  assert.equal(res.status, 400);
});

test('update_profile: updates display_name and broadcasts via /api/agents', async () => {
  const form = new FormData();
  form.append('display_name', 'Renamed Reviewer');
  const { status, body } = await json(await fetch(`${BASE}/internal/agent/${PROFILE_AGENT}/profile`, {
    method: 'POST',
    body: form,
  }));
  assert.equal(status, 200);
  assert.ok(body.updated.includes('displayName'));
  assert.equal(body.agent.displayName, 'Renamed Reviewer');

  // Verify the change is visible via the public listing the frontend reads.
  const agentsRes = await fetch(`${BASE}/api/agents`, {
    headers: { Authorization: `Bearer ${ROOT_TOKEN}` },
  });
  const agentsBody = await agentsRes.json();
  const reviewer = agentsBody.agents.find((a) => a.id === PROFILE_AGENT);
  assert.equal(reviewer.displayName, 'Renamed Reviewer');
});

test('update_profile: rejects display_name longer than 64 chars', async () => {
  const form = new FormData();
  form.append('display_name', 'x'.repeat(65));
  const res = await fetch(`${BASE}/internal/agent/${PROFILE_AGENT}/profile`, {
    method: 'POST',
    body: form,
  });
  assert.equal(res.status, 400);
});

test('update_profile: rejects reserved display_name "system"', async () => {
  const form = new FormData();
  form.append('display_name', 'system');
  const res = await fetch(`${BASE}/internal/agent/${PROFILE_AGENT}/profile`, {
    method: 'POST',
    body: form,
  });
  assert.equal(res.status, 400);
});

test('update_profile: small png upload yields ≤12KB data:image/webp;base64 picture', async () => {
  const pngBuf = await makeTestPng(32);
  const form = new FormData();
  form.append('picture', new Blob([pngBuf], { type: 'image/png' }), 'avatar.png');
  const { status, body } = await json(await fetch(`${BASE}/internal/agent/${PROFILE_AGENT}/profile`, {
    method: 'POST',
    body: form,
  }));
  assert.equal(status, 200);
  assert.ok(body.updated.includes('picture'));
  assert.ok(body.agent.picture.startsWith('data:image/webp;base64,'), `picture should be webp data URI, got: ${body.agent.picture?.slice(0, 30)}`);
  // 12KB raw → ~16KB base64 + ~25 char prefix. Cap the data URI at 17KB.
  assert.ok(body.agent.picture.length < 17 * 1024, `data URI should be < 17KB, got ${body.agent.picture.length}`);
});

test('update_profile: oversized random-noise png is resized successfully (DB-blowup defense)', async () => {
  // Real-world photos compress poorly. Simulate that with random-noise pixels so
  // the input stays multi-megabyte and we actually exercise the server-side resize.
  const W = 1000, H = 1000;
  const noise = Buffer.allocUnsafe(W * H * 3);
  for (let i = 0; i < noise.length; i++) noise[i] = (Math.random() * 256) | 0;
  const bigBuf = await sharp(noise, { raw: { width: W, height: H, channels: 3 } })
    .png({ compressionLevel: 0 })
    .toBuffer();
  assert.ok(bigBuf.length > 500 * 1024, `expected large input png, got ${bigBuf.length}`);

  const form = new FormData();
  form.append('picture', new Blob([bigBuf], { type: 'image/png' }), 'huge.png');
  const { status, body } = await json(await fetch(`${BASE}/internal/agent/${PROFILE_AGENT}/profile`, {
    method: 'POST',
    body: form,
  }));
  assert.equal(status, 200, `expected 200 after server-side resize, got ${status}`);
  assert.ok(body.agent.picture.startsWith('data:image/webp;base64,'));
  assert.ok(body.agent.picture.length < 17 * 1024, `resized data URI should be small (<17KB), got ${body.agent.picture.length}`);
});

test('update_profile: clear_picture removes the avatar', async () => {
  const form = new FormData();
  form.append('clear_picture', '1');
  const { status, body } = await json(await fetch(`${BASE}/internal/agent/${PROFILE_AGENT}/profile`, {
    method: 'POST',
    body: form,
  }));
  assert.equal(status, 200);
  // agentPayload omits picture when it's null/undefined
  assert.equal(body.agent.picture, undefined);
});

test('update_profile: rejects when picture_path and clear_picture both set (server-side)', async () => {
  // Daemon-side guard is also present but server must defend too.
  const form = new FormData();
  form.append('picture', new Blob([await makeTestPng(16)], { type: 'image/png' }), 'a.png');
  form.append('clear_picture', '1');
  const res = await fetch(`${BASE}/internal/agent/${PROFILE_AGENT}/profile`, {
    method: 'POST',
    body: form,
  });
  assert.equal(res.status, 400);
});

// ─── customLauncher (per-agent driver binary override) ────────────────────────
// PUT /api/agents/:id/config accepts a customLauncher field. The string is
// whitespace-split into argv on the daemon side. These tests verify the
// server-side validation: length cap, control chars, vikingbot gate, clearing.

const LAUNCHER_AGENT = 'agent-mock-reviewer';

async function setLauncher(value) {
  return fetch(`${BASE}/api/agents/${LAUNCHER_AGENT}/config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ROOT_TOKEN}` },
    body: JSON.stringify({ customLauncher: value }),
  });
}

test('customLauncher: PUT accepts a valid string and round-trips via GET', async () => {
  const setRes = await setLauncher('/usr/local/bin/codex');
  assert.equal(setRes.status, 200);
  const getRes = await fetch(`${BASE}/api/agent-configs`, { headers: { Authorization: `Bearer ${ROOT_TOKEN}` } });
  const { configs } = await getRes.json();
  const cfg = configs.find((c) => c.id === LAUNCHER_AGENT);
  assert.equal(cfg.customLauncher, '/usr/local/bin/codex');
});

test('customLauncher: PUT rejects string > 256 chars (400)', async () => {
  const res = await setLauncher('x'.repeat(257));
  assert.equal(res.status, 400);
});

test('customLauncher: PUT rejects control chars (400)', async () => {
  const res = await setLauncher('claude\nrm -rf /');
  assert.equal(res.status, 400);
});

test('customLauncher: PUT rejects when target runtime is vikingbot (400)', async () => {
  // Swap reviewer's runtime to vikingbot temporarily, attempt to set the
  // launcher, expect rejection, then restore runtime to claude.
  const setVb = await fetch(`${BASE}/api/agents/${LAUNCHER_AGENT}/config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ROOT_TOKEN}` },
    body: JSON.stringify({ runtime: 'vikingbot' }),
  });
  assert.equal(setVb.status, 200);
  try {
    const res = await setLauncher('wrap vikingbot');
    assert.equal(res.status, 400);
  } finally {
    await fetch(`${BASE}/api/agents/${LAUNCHER_AGENT}/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ROOT_TOKEN}` },
      body: JSON.stringify({ runtime: 'claude' }),
    });
  }
});

test('customLauncher: PUT with null clears the field', async () => {
  await setLauncher('env LANG=C claude');
  const res = await setLauncher(null);
  assert.equal(res.status, 200);
  const getRes = await fetch(`${BASE}/api/agent-configs`, { headers: { Authorization: `Bearer ${ROOT_TOKEN}` } });
  const { configs } = await getRes.json();
  const cfg = configs.find((c) => c.id === LAUNCHER_AGENT);
  assert.equal(cfg.customLauncher ?? null, null);
});

test('customLauncher: PUT with empty string clears the field', async () => {
  await setLauncher('env LANG=C claude');
  const res = await setLauncher('');
  assert.equal(res.status, 200);
  const getRes = await fetch(`${BASE}/api/agent-configs`, { headers: { Authorization: `Bearer ${ROOT_TOKEN}` } });
  const { configs } = await getRes.json();
  const cfg = configs.find((c) => c.id === LAUNCHER_AGENT);
  assert.equal(cfg.customLauncher ?? null, null);
});

// ─── clientMsgId idempotency + delivery observability ────────────────────────

test('POST /api/messages with clientMsgId returns message.clientMsgId + delivery', async () => {
  const authRes = await fetch(`${BASE}/api/auth/guest-session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'ci-cmid-echo' }),
  });
  const { token } = await authRes.json();
  const clientMsgId = 'cm-test-' + Date.now();

  const { status, body } = await json(await fetch(`${BASE}/api/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ target: '#all', content: 'ci-cmid-echo-msg', clientMsgId }),
  }));

  assert.equal(status, 200);
  assert.ok(body.messageId, 'response must include messageId');
  assert.equal(body.clientMsgId, clientMsgId, 'response must echo clientMsgId');
  assert.ok(body.delivery, 'response must include delivery object');
  assert.equal(typeof body.delivery.recipientCount, 'number', 'delivery.recipientCount must be a number');
  assert.ok(Array.isArray(body.delivery.recipientIds), 'delivery.recipientIds must be an array');
});

test('Repeating same clientMsgId returns same messageId and does not create a duplicate', async () => {
  const authRes = await fetch(`${BASE}/api/auth/guest-session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'ci-cmid-dedup' }),
  });
  const { token } = await authRes.json();
  const clientMsgId = 'cm-dedup-' + Date.now();
  const content = 'ci-dedup-probe-' + Date.now();

  // First send
  const first = await json(await fetch(`${BASE}/api/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ target: '#all', content, clientMsgId }),
  }));
  assert.equal(first.status, 200);
  const firstMessageId = first.body.messageId;

  // Second send with same clientMsgId
  const second = await json(await fetch(`${BASE}/api/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ target: '#all', content, clientMsgId }),
  }));
  assert.equal(second.status, 200);
  assert.equal(second.body.messageId, firstMessageId, 'duplicate clientMsgId must return same messageId');
  assert.equal(second.body.deduplicated, true, 'duplicate response must be marked deduplicated');

  // Verify only one message exists in the channel history
  const history = await json(await fetch(`${BASE}/api/messages`, {
    headers: { 'X-Channel': '#all', 'X-Limit': '100' },
  }));
  const matches = history.body.messages.filter(m => m.content === content);
  assert.equal(matches.length, 1, 'must not create a duplicate message in history');
});

test('fanout/delivery is not repeated for duplicate clientMsgId', async () => {
  const authRes = await fetch(`${BASE}/api/auth/guest-session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'ci-cmid-fanout' }),
  });
  const { token } = await authRes.json();
  const clientMsgId = 'cm-fanout-' + Date.now();
  const content = 'ci-fanout-probe-' + Date.now();

  // First send — should have delivery info
  const first = await json(await fetch(`${BASE}/api/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ target: '#all', content, clientMsgId }),
  }));
  assert.equal(first.status, 200);
  assert.ok(first.body.delivery, 'first send must have delivery');

  // Second send — deduplicated, delivery should be the cached version
  const second = await json(await fetch(`${BASE}/api/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ target: '#all', content, clientMsgId }),
  }));
  assert.equal(second.status, 200);
  assert.equal(second.body.deduplicated, true);
  // The delivery object should be present (cached from first send)
  assert.ok(second.body.delivery, 'deduplicated response must include cached delivery');
  assert.deepEqual(
    second.body.delivery.recipientIds,
    first.body.delivery.recipientIds,
    'deduplicated delivery must match original recipientIds',
  );
});

test('POST /api/messages without clientMsgId still works (backward compat)', async () => {
  const authRes = await fetch(`${BASE}/api/auth/guest-session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'ci-no-cmid' }),
  });
  const { token } = await authRes.json();

  const { status, body } = await json(await fetch(`${BASE}/api/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ target: '#all', content: 'ci-no-cmid-msg' }),
  }));

  assert.equal(status, 200);
  assert.equal(body.clientMsgId, null, 'clientMsgId must be null when not provided');
  assert.ok(body.delivery, 'delivery must still be present');
});
