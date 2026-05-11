#!/usr/bin/env node
/**
 * Daemon swap auto-rebind test.
 *
 * Reproduces the scenario where a daemon is replaced by another daemon
 * authenticated with the same machine api key (e.g. PM2 migration). The
 * server should re-bind orphaned agents onto the still-connected daemon
 * via the existing autoStart path, rather than leaving them inactive
 * until a human manually starts them.
 *
 * Run:
 *   node --test server/test-daemon-swap.mjs
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
const TEST_PORT = 17780;
const BASE = `http://localhost:${TEST_PORT}`;
const WS_BASE = `ws://localhost:${TEST_PORT}`;

const TEST_CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'zouk-test-config-'));
const TEST_UPLOADS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'zouk-test-uploads-'));

// Stable machine key so two daemon WS sessions resolve to the same machineId.
// Without a persisted record, resolveDaemonMachineId() falls back to a fresh
// uuid per connect, defeating the swap scenario.
const MACHINE_ID = crypto.randomUUID();
const MACHINE_KEY = `sk_test_${crypto.randomBytes(8).toString('hex')}`;
const AGENT_ID = `agent-swap-${crypto.randomBytes(4).toString('hex')}`;

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

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

before(async () => {
  // Pre-populate the temp config dir so the server boots with the test
  // machine key + agent config already persisted.
  writeJson(path.join(TEST_CONFIG_DIR, 'machine-keys.json'), [{
    id: MACHINE_ID,
    name: 'test-swap',
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
    autoStart: true,
    lifecycle: 'persistent',
  }]);

  serverProc = spawn(process.execPath, [path.join(__dirname, 'index.js')], {
    env: {
      ...process.env,
      PORT: String(TEST_PORT),
      NODE_ENV: 'test',
      ZOUK_CONFIG_DIR: TEST_CONFIG_DIR,
      ZOUK_UPLOADS_DIR: TEST_UPLOADS_DIR,
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

function connectDaemon(key) {
  const ws = new WebSocket(`${WS_BASE}/daemon/connect?key=${encodeURIComponent(key)}`);
  return new Promise((resolve, reject) => {
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

function sendReady(ws, runningAgents = []) {
  ws.send(JSON.stringify({
    type: 'ready',
    hostname: 'test-host',
    os: 'test-os',
    runtimes: ['claude'],
    capabilities: [],
    runningAgents,
  }));
}

function waitForAgentStart(ws, agentId, timeoutMs = 2500) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      ws.off('message', onMsg);
      resolve(null);
    }, timeoutMs);
    const onMsg = (raw) => {
      let ev;
      try { ev = JSON.parse(raw.toString()); } catch (_) { return; }
      if (ev.type === 'agent:start' && ev.agentId === agentId) {
        clearTimeout(timer);
        ws.off('message', onMsg);
        resolve(ev);
      }
    };
    ws.on('message', onMsg);
  });
}

test('daemon swap: orphaned agent auto-rebinds onto same-machine replacement', async () => {
  // Daemon A connects first. autoStartAgents() fires ~1s after ready and
  // sends agent:start for AGENT_ID (because the seed config has
  // autoStart=true and matches MACHINE_ID).
  const daemonA = await connectDaemon(MACHINE_KEY);
  const aGotInitialStart = waitForAgentStart(daemonA, AGENT_ID, 3000);
  sendReady(daemonA);
  const initialStart = await aGotInitialStart;
  assert.ok(initialStart, 'daemon A should receive agent:start from initial autoStartAgents');

  // Mark the agent as active so future autoStart sweeps treat it as healthy
  // on daemon A and skip it. Without this the test would see daemon B
  // receive an agent:start just from B's own ready handler, not from the
  // swap-rebind path we're trying to exercise.
  daemonA.send(JSON.stringify({
    type: 'agent:status',
    agentId: AGENT_ID,
    status: 'active',
    runtime: 'claude',
    model: 'sonnet',
  }));
  await new Promise(r => setTimeout(r, 200));

  // Daemon B connects with the same key, so it resolves to the same
  // machineId. Its ready triggers autoStartAgents() but the agent is now
  // active, so B should NOT receive agent:start yet.
  const daemonB = await connectDaemon(MACHINE_KEY);
  const bShouldNotGetStart = waitForAgentStart(daemonB, AGENT_ID, 1500);
  sendReady(daemonB);
  const prematureStart = await bShouldNotGetStart;
  assert.equal(prematureStart, null, 'daemon B must not receive agent:start while agent is active on daemon A');

  // Daemon A drops. Server should detect the same-machine replacement
  // (daemon B) and re-trigger autoStartAgents, which re-targets B because
  // its _machineId matches the agent's config.machineId.
  const bGotRebindStart = waitForAgentStart(daemonB, AGENT_ID, 3000);
  daemonA.close();
  const rebindStart = await bGotRebindStart;
  assert.ok(rebindStart, 'daemon B should receive agent:start after daemon A disconnects (auto-rebind)');

  daemonB.close();
});
