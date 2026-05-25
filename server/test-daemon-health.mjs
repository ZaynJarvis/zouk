#!/usr/bin/env node
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_PORT = 17850;
const BASE = `http://localhost:${TEST_PORT}`;
const WS_BASE = `ws://localhost:${TEST_PORT}`;
const TEST_CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'zouk-test-health-config-'));
const TEST_UPLOADS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'zouk-test-health-uploads-'));

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

before(async () => {
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

function connectDaemon() {
  const ws = new WebSocket(`${WS_BASE}/daemon/connect?key=test`);
  return new Promise((resolve, reject) => {
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

function waitForMessage(ws, predicate, timeoutMs = 2500) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off('message', onMsg);
      reject(new Error(`Timed out waiting for WebSocket message after ${timeoutMs}ms`));
    }, timeoutMs);
    const onMsg = (raw) => {
      let ev;
      try { ev = JSON.parse(raw.toString()); } catch (_) { return; }
      if (!predicate(ev)) return;
      clearTimeout(timer);
      ws.off('message', onMsg);
      resolve(ev);
    };
    ws.on('message', onMsg);
  });
}

test('daemon health check receives an ack without agent status coupling', async () => {
  const daemon = await connectDaemon();
  daemon.send(JSON.stringify({
    type: 'daemon:health',
    seq: 7,
    reason: 'agent_start',
    agentId: 'agent-health',
    launchId: 'launch-health',
    sentAt: '2026-05-13T05:42:00.000Z',
  }));

  const ack = await waitForMessage(daemon, (ev) => ev.type === 'daemon:health:ack' && ev.seq === 7);
  assert.equal(ack.reason, 'agent_start');
  assert.equal(ack.agentId, 'agent-health');
  assert.equal(ack.launchId, 'launch-health');
  assert.equal(ack.sentAt, '2026-05-13T05:42:00.000Z');
  assert.equal(typeof ack.serverAt, 'string');
  assert.equal(typeof ack.machineId, 'string');
  daemon.close();
});
