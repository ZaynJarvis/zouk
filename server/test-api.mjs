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
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import WebSocket from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { splitSqlStatements } = require('./db.js');
const TEST_PORT = 17779;
const BASE = `http://localhost:${TEST_PORT}`;

// Tests write real bytes through the attachment storage layer; keep them out of
// the dev workspace's uploads/ dir so re-runs stay clean.
const TEST_UPLOADS_DIR = fs.mkdtempSync(path.join(path.sep === '/' ? '/tmp' : process.env.TEMP || '.', 'zouk-test-uploads-'));

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
    env: { ...process.env, PORT: String(TEST_PORT), NODE_ENV: 'test', ZOUK_UPLOADS_DIR: TEST_UPLOADS_DIR },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  serverProc.stdout.resume();
  serverProc.stderr.resume();
  await waitForServer();
});

after(() => {
  serverProc?.kill('SIGTERM');
  fs.rmSync(TEST_UPLOADS_DIR, { recursive: true, force: true });
});

// ─── Auth ─────────────────────────────────────────────────────────────────────

test('schema migration parser keeps channel_agents create-table statement after comment blocks', () => {
  const schemaSql = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
  const statements = splitSqlStatements(schemaSql);
  assert.ok(
    statements.some((statement) => statement.startsWith('CREATE TABLE IF NOT EXISTS channel_agents')),
    'channel_agents create-table statement must survive schema parsing'
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
  assert.equal(body.user.name, 'ci-tester');
  assert.equal(body.user.guest, true);
  assert.ok(typeof body.token === 'string' && body.token.length > 8, 'token must be a non-trivial string');
});

test('guest session: rejects missing name', async () => {
  const res = await fetch(`${BASE}/api/auth/guest-session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  assert.equal(res.status, 400);
});

// ─── Channels ─────────────────────────────────────────────────────────────────

test('GET /api/channels: returns default "all" channel', async () => {
  const { status, body } = await json(await fetch(`${BASE}/api/channels`));
  assert.equal(status, 200);
  assert.ok(Array.isArray(body.channels), 'channels must be an array');
  const all = body.channels.find(c => c.name === 'all');
  assert.ok(all, '"all" channel must exist in the default store');
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
  assert.equal(body.message.senderName, 'ci-msg-sender');
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

// ─── Auth enforcement ─────────────────────────────────────────────────────────

test('POST /api/messages without auth: returns 403', async () => {
  const res = await fetch(`${BASE}/api/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ target: '#all', content: 'unauthorized' }),
  });
  assert.equal(res.status, 403, 'unauthenticated writes must be rejected with 403');
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
    body: JSON.stringify({ channel: '#all', message_ids: [messageId] }),
  }));
  assert.equal(claimed.status, 200);
  assert.deepEqual(claimed.body.results, [
    { taskNumber, messageId, success: true, reason: null },
  ]);
});

test('claim_tasks: normal message ids are rejected with explicit create_tasks guidance', async () => {
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
    body: JSON.stringify({ channel: '#all', message_ids: [sent.body.messageId] }),
  }));
  assert.equal(claimed.status, 200);
  assert.deepEqual(claimed.body.results, [
    {
      taskNumber: null,
      messageId: sent.body.messageId,
      success: false,
      reason: 'message exists but is not a task; create a new task explicitly',
    },
  ]);
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
    `${BASE}/internal/agent/agent-mock-bugbot/history?channel=${encodeURIComponent('dm:@dm-history-tester')}&limit=50`,
  ));
  assert.equal(recipient.status, 200);
  assert.ok(
    recipient.body.messages.some((m) => m.content === marker),
    'DM recipient (bugbot) must see marker in its own DM history',
  );

  // Unrelated agent (reviewer) querying the same DM target returns nothing:
  // matchesTarget + the DM-party gate combine so history is never fished.
  const unrelated = await json(await fetch(
    `${BASE}/internal/agent/agent-mock-reviewer/history?channel=${encodeURIComponent('dm:@dm-history-tester')}&limit=50`,
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
    ws.once('open', resolve);
    ws.once('error', reject);
  });
  // Drain the init frame so .once('message') below catches real traffic.
  await new Promise((resolve) => ws.once('message', resolve));
  return ws;
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
    body: JSON.stringify({ target: 'dm:@dmtest-bob', content: marker }),
  });

  const [aliceGot, bobGot, carolGot] = await Promise.all([alicePromise, bobPromise, carolPromise]);

  aliceWs.close();
  bobWs.close();
  carolWs.close();

  assert.ok(aliceGot, 'sender (alice) must receive her own DM echo');
  assert.ok(bobGot, 'recipient (bob) must receive the DM');
  assert.equal(carolGot, null, 'uninvolved party (carol) must NOT receive the DM');
});

// ─── Channel ↔ Agent membership ───────────────────────────────────────────────
// These tests cover the PM-broadcast-v2 fix: only agents that are members of a
// channel should see messages in that channel via the pull path
// (check_messages / history / search) and the push path (WS deliver). Mock
// data seeds three agents (reviewer, bugbot, deployer) into four channels
// (all, engineering, design, ops).

const MOCK_AGENT = 'agent-mock-reviewer';
const OTHER_AGENT = 'agent-mock-bugbot';

test('subscriptions: mock agents are seeded into every regular channel', async () => {
  const { status, body } = await json(await fetch(
    `${BASE}/internal/agent/${MOCK_AGENT}/subscriptions`,
  ));
  assert.equal(status, 200);
  const names = new Set(body.subscriptions.map(s => s.channelName));
  for (const expected of ['all', 'engineering', 'design', 'ops']) {
    assert.ok(names.has(expected), `seeded membership on #${expected} expected`);
  }
  // All default seeds should be both readable and subscribed.
  for (const s of body.subscriptions) {
    assert.equal(s.canRead, true);
    assert.equal(s.subscribed, true);
  }
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
  // (messages count, cap, index sizes) so curl-based investigations work.
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
  assert.ok(typeof body.store.messages === 'number');
  assert.ok(typeof body.store.messagesCap === 'number' && body.store.messagesCap > 0);
  assert.ok(typeof body.indexes.messagesById === 'number');
  assert.ok(typeof body.indexes.messagesByShortId === 'number');
  assert.equal(
    body.indexes.messagesById, body.store.messages,
    'messagesById index must size-match store.messages — out-of-sync = silent perf regression'
  );
});

test('store.messages sliding window evicts oldest beyond MAX_IN_MEMORY_MESSAGES', async () => {
  // Reason: without an upper bound, store.messages grew with total traffic
  // and every history fetch slowed proportionally. This test boots a server
  // with a deliberately tiny cap, sends more messages than the cap, and
  // confirms the cap actually holds.
  const capPort = TEST_PORT + 2;
  const capBase = `http://localhost:${capPort}`;

  const proc = spawn(process.execPath, [path.join(__dirname, 'index.js')], {
    env: {
      ...process.env,
      PORT: String(capPort),
      NODE_ENV: 'test',
      ZOUK_UPLOADS_DIR: TEST_UPLOADS_DIR,
      MAX_IN_MEMORY_MESSAGES: '5',
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

    // Push 12 messages — 7 over the cap.
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
    assert.equal(stats.body.store.messagesCap, 5, 'cap env must be respected');
    assert.ok(stats.body.store.messages <= 5, `messages must be capped at 5, saw ${stats.body.store.messages}`);
    assert.equal(
      stats.body.indexes.messagesById, stats.body.store.messages,
      'index must shrink when messages are evicted',
    );

    // Newest 5 must still be reachable.
    const histRes = await json(await fetch(`${capBase}/api/messages`, {
      headers: { 'X-Channel': '#all', 'X-Limit': '20' },
    }));
    assert.equal(histRes.status, 200);
    const contents = histRes.body.messages.map((m) => m.content);
    assert.ok(contents.includes('cap-probe-11'), 'newest message must remain');
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

test('reserved username: guest-session rejects "system"', async () => {
  const res = await fetch(`${BASE}/api/auth/guest-session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'system' }),
  });
  assert.equal(res.status, 400);
});

test('reserved username: guest-session rejects "System" (case-insensitive)', async () => {
  const res = await fetch(`${BASE}/api/auth/guest-session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'System' }),
  });
  assert.equal(res.status, 400);
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
