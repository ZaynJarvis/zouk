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
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_PORT = 17779;
const BASE = `http://localhost:${TEST_PORT}`;

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
    env: { ...process.env, PORT: String(TEST_PORT), NODE_ENV: 'test' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  serverProc.stdout.resume();
  serverProc.stderr.resume();
  await waitForServer();
});

after(() => {
  serverProc?.kill('SIGTERM');
});

// ─── Auth ─────────────────────────────────────────────────────────────────────

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

// ─── Auth enforcement ─────────────────────────────────────────────────────────

test('POST /api/messages without auth: returns 403', async () => {
  const res = await fetch(`${BASE}/api/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ target: '#all', content: 'unauthorized' }),
  });
  assert.equal(res.status, 403, 'unauthenticated writes must be rejected with 403');
});
