#!/usr/bin/env node
/**
 * Agent status/activity lifecycle tests.
 *
 * Run:
 *   node --test server/test-agent-status.mjs
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import crypto from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_PORT = 17783;
const BASE = `http://localhost:${TEST_PORT}`;
const WS_BASE = `ws://localhost:${TEST_PORT}`;

const TEST_CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'zouk-test-config-'));
const TEST_UPLOADS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'zouk-test-uploads-'));
const MACHINE_ID = crypto.randomUUID();
const MACHINE_KEY = `sk_test_${crypto.randomBytes(8).toString('hex')}`;
const AGENT_ID = `agent-status-${crypto.randomBytes(4).toString('hex')}`;
const ROOT_TOKEN = `root-${crypto.randomBytes(8).toString('hex')}`;
const ROOT_EMAIL = 'agent-status-root@example.com';

let serverProc = null;

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

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
  writeJson(path.join(TEST_CONFIG_DIR, 'machine-keys.json'), [{
    id: MACHINE_ID,
    name: 'test-status',
    rawKey: MACHINE_KEY,
    createdAt: Date.now(),
    lastUsedAt: null,
    revokedAt: null,
    boundFingerprint: null,
  }]);
  writeJson(path.join(TEST_CONFIG_DIR, 'agent-configs.json'), [{
    id: AGENT_ID,
    name: AGENT_ID,
    displayName: AGENT_ID,
    description: '',
    systemPrompt: '',
    runtime: 'claude',
    model: 'sonnet',
    machineId: MACHINE_ID,
    autoStart: false,
    lifecycle: 'persistent',
  }]);
  writeJson(path.join(TEST_CONFIG_DIR, 'sessions.json'), [
    [ROOT_TOKEN, { name: 'agent-status-root', email: ROOT_EMAIL, picture: null }],
  ]);

  serverProc = spawn(process.execPath, [path.join(__dirname, 'index.js')], {
    env: {
      ...process.env,
      PORT: String(TEST_PORT),
      NODE_ENV: 'test',
      ZOUK_CONFIG_DIR: TEST_CONFIG_DIR,
      ZOUK_UPLOADS_DIR: TEST_UPLOADS_DIR,
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
  fs.rmSync(TEST_CONFIG_DIR, { recursive: true, force: true });
  fs.rmSync(TEST_UPLOADS_DIR, { recursive: true, force: true });
});

function connectWeb() {
  const ws = new WebSocket(`${WS_BASE}/ws`);
  return new Promise((resolve, reject) => {
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

function connectDaemon() {
  const ws = new WebSocket(`${WS_BASE}/daemon/connect?key=${encodeURIComponent(MACHINE_KEY)}`);
  return new Promise((resolve, reject) => {
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

function sendReady(ws) {
  ws.send(JSON.stringify({
    type: 'ready',
    hostname: 'test-host',
    os: 'test-os',
    runtimes: ['claude'],
    capabilities: [],
    runningAgents: [],
  }));
}

function waitForMessageOrTimeout(ws, predicate, timeoutMs = 800) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      ws.off('message', onMsg);
      resolve(null);
    }, timeoutMs);
    const onMsg = (raw) => {
      let ev;
      try { ev = JSON.parse(raw.toString()); } catch (_) { return; }
      if (predicate(ev)) {
        clearTimeout(timer);
        ws.off('message', onMsg);
        resolve(ev);
      }
    };
    ws.on('message', onMsg);
  });
}

async function closeWs(ws) {
  if (!ws || ws.readyState === WebSocket.CLOSED) return;
  await new Promise((resolve) => {
    ws.once('close', resolve);
    ws.close();
  });
}

async function postJson(pathname, body) {
  return json(await fetch(`${BASE}${pathname}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${ROOT_TOKEN}`,
    },
    body: JSON.stringify(body || {}),
  }));
}

async function readAgent() {
  const res = await json(await fetch(`${BASE}/api/agents`));
  assert.equal(res.status, 200);
  const agent = res.body.agents.find((a) => a.id === AGENT_ID);
  assert.ok(agent, 'test agent should be visible in /api/agents');
  return agent;
}

test('inactive agent status clears stale busy activity and rejects late busy heartbeats', async () => {
  const web = await connectWeb();
  await waitForMessageOrTimeout(web, (ev) => ev.type === 'init', 3000);

  const daemon = await connectDaemon();
  sendReady(daemon);

  const activePromise = waitForMessageOrTimeout(
    web,
    (ev) => (
      (ev.type === 'agent_started' && ev.agent?.id === AGENT_ID)
      || (ev.type === 'agent_status' && ev.agentId === AGENT_ID && ev.status === 'active')
    ),
    3000,
  );
  daemon.send(JSON.stringify({ type: 'agent:status', agentId: AGENT_ID, status: 'active' }));
  const active = await activePromise;
  assert.ok(active, 'web client should observe the agent becoming active');

  const busyPromise = waitForMessageOrTimeout(
    web,
    (ev) => ev.type === 'agent_activity' && ev.agentId === AGENT_ID && ev.activity === 'working',
    3000,
  );
  daemon.send(JSON.stringify({
    type: 'agent:activity',
    agentId: AGENT_ID,
    activity: 'working',
    detail: 'CI busy',
  }));
  const busy = await busyPromise;
  assert.ok(busy, 'web client should observe the busy activity before inactive');

  let agent = await readAgent();
  assert.equal(agent.status, 'active');
  assert.equal(agent.activity, 'working');

  const inactivePromise = waitForMessageOrTimeout(
    web,
    (ev) => ev.type === 'agent_status' && ev.agentId === AGENT_ID && ev.status === 'inactive',
    3000,
  );
  const offlinePromise = waitForMessageOrTimeout(
    web,
    (ev) => ev.type === 'agent_activity' && ev.agentId === AGENT_ID && ev.activity === 'offline',
    3000,
  );
  daemon.send(JSON.stringify({ type: 'agent:status', agentId: AGENT_ID, status: 'inactive' }));
  const inactive = await inactivePromise;
  assert.ok(inactive, 'web client should receive inactive status');
  const offline = await offlinePromise;
  assert.ok(offline, 'inactive status should be followed by an offline activity update');

  agent = await readAgent();
  assert.equal(agent.status, 'inactive');
  assert.equal(agent.activity, 'offline');
  assert.equal(agent.activityDetail, undefined);

  const lateBusy = waitForMessageOrTimeout(
    web,
    (ev) => ev.type === 'agent_activity' && ev.agentId === AGENT_ID && ev.activity === 'working',
    500,
  );
  daemon.send(JSON.stringify({
    type: 'agent:activity',
    agentId: AGENT_ID,
    activity: 'working',
    detail: 'late heartbeat',
  }));
  assert.equal(await lateBusy, null, 'late busy activity must not be broadcast after inactive');

  agent = await readAgent();
  assert.equal(agent.status, 'inactive');
  assert.equal(agent.activity, 'offline');
  assert.equal(agent.activityDetail, undefined);

  await closeWs(daemon);
  await closeWs(web);
});

test('agent idle health check reconciles stale busy activity to online', async () => {
  const web = await connectWeb();
  await waitForMessageOrTimeout(web, (ev) => ev.type === 'init', 3000);

  const daemon = await connectDaemon();
  sendReady(daemon);

  const activePromise = waitForMessageOrTimeout(
    web,
    (ev) => (
      (ev.type === 'agent_started' && ev.agent?.id === AGENT_ID)
      || (ev.type === 'agent_status' && ev.agentId === AGENT_ID && ev.status === 'active')
    ),
    3000,
  );
  daemon.send(JSON.stringify({ type: 'agent:status', agentId: AGENT_ID, status: 'active' }));
  const active = await activePromise;
  assert.ok(active, 'web client should observe the agent becoming active');

  const busyPromise = waitForMessageOrTimeout(
    web,
    (ev) => ev.type === 'agent_activity' && ev.agentId === AGENT_ID && ev.activity === 'working',
    3000,
  );
  daemon.send(JSON.stringify({
    type: 'agent:activity',
    agentId: AGENT_ID,
    activity: 'working',
    detail: 'Checking messages...',
  }));
  const busy = await busyPromise;
  assert.ok(busy, 'web client should observe the stale busy activity first');

  let agent = await readAgent();
  assert.equal(agent.status, 'active');
  assert.equal(agent.activity, 'working');

  const onlinePromise = waitForMessageOrTimeout(
    web,
    (ev) => ev.type === 'agent_activity' && ev.agentId === AGENT_ID && ev.activity === 'online',
    3000,
  );
  const ackPromise = waitForMessageOrTimeout(
    daemon,
    (ev) => ev.type === 'daemon:health:ack' && ev.seq === 1001,
    3000,
  );
  daemon.send(JSON.stringify({
    type: 'daemon:health',
    seq: 1001,
    reason: 'agent_idle',
    agentId: AGENT_ID,
    sentAt: new Date().toISOString(),
  }));

  const ack = await ackPromise;
  assert.ok(ack, 'daemon should receive the health ack');
  const online = await onlinePromise;
  assert.ok(online, 'web client should receive an online reconciliation activity');
  assert.equal(online.detail, 'Idle');

  agent = await readAgent();
  assert.equal(agent.status, 'active');
  assert.equal(agent.activity, 'online');
  assert.equal(agent.activityDetail, 'Idle');

  await closeWs(daemon);
  await closeWs(web);
});

test('reset-context cold-starts instead of resuming cached runtime session', async () => {
  const daemon = await connectDaemon();
  sendReady(daemon);

  const initialStartPromise = waitForMessageOrTimeout(
    daemon,
    (ev) => ev.type === 'agent:start' && ev.agentId === AGENT_ID,
    3000,
  );
  const initial = await postJson('/api/agents/start', { id: AGENT_ID });
  assert.equal(initial.status, 200);
  const initialStart = await initialStartPromise;
  assert.ok(initialStart, 'initial start should be sent to daemon');
  assert.equal(initialStart.config.sessionId, undefined, 'first start has no cached session');

  daemon.send(JSON.stringify({ type: 'agent:session', agentId: AGENT_ID, sessionId: 'session-before-reset' }));
  daemon.send(JSON.stringify({ type: 'agent:status', agentId: AGENT_ID, status: 'inactive' }));
  await new Promise(r => setTimeout(r, 100));

  const resumeStartPromise = waitForMessageOrTimeout(
    daemon,
    (ev) => ev.type === 'agent:start' && ev.agentId === AGENT_ID,
    3000,
  );
  const resume = await postJson('/api/agents/start', { id: AGENT_ID });
  assert.equal(resume.status, 200);
  const resumeStart = await resumeStartPromise;
  assert.ok(resumeStart, 'regular start should be sent to daemon');
  assert.equal(resumeStart.config.sessionId, 'session-before-reset', 'regular start should resume cached session');

  daemon.send(JSON.stringify({ type: 'agent:status', agentId: AGENT_ID, status: 'active' }));
  await new Promise(r => setTimeout(r, 100));

  const stopPromise = waitForMessageOrTimeout(
    daemon,
    (ev) => ev.type === 'agent:stop' && ev.agentId === AGENT_ID,
    3000,
  );
  const resetStartPromise = waitForMessageOrTimeout(
    daemon,
    (ev) => ev.type === 'agent:start' && ev.agentId === AGENT_ID,
    3000,
  );
  const resetRequest = postJson(`/api/agents/${AGENT_ID}/reset-context`);
  const stop = await stopPromise;
  assert.ok(stop, 'reset should ask daemon to stop the running process first');
  daemon.send(JSON.stringify({ type: 'agent:status', agentId: AGENT_ID, status: 'inactive' }));

  const resetStart = await resetStartPromise;
  const reset = await resetRequest;
  assert.equal(reset.status, 200);
  assert.ok(resetStart, 'reset should start the agent again after stop ack');
  assert.equal(resetStart.config.sessionId, null, 'reset must cold-start with an explicit null session');

  await closeWs(daemon);
});
