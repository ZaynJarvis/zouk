#!/usr/bin/env node
// Regression guard for the "/z/foo bounces back to /z/default" loop.
//
// Before this fix, handleWebConnection in server/lib/daemon-handler.js
// silently rewrote ws._workspaceId to "default" whenever the requesting user
// failed the access check (allowlist or membership). The web client treated
// that as "user moved" and history.replaceState'd the browser URL from
// /z/foo to /z/default — trapping any invitee whose allowlist row got
// dropped by a DB hiccup until a server restart re-hydrated the cache.
//
// Now the server still routes the socket onto "default" for safety, but it
// also reports `requestedWorkspaceId` and `requestedWorkspaceAccess` so the
// client can keep the URL where the user asked to be and surface a denial
// banner instead of rewriting the location.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import WebSocket from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function waitForInit(ws, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      ws.off('message', onMsg);
      resolve(null);
    }, timeoutMs);
    const onMsg = (raw) => {
      try {
        const ev = JSON.parse(raw.toString());
        if (ev?.type === 'init') {
          clearTimeout(timer);
          ws.off('message', onMsg);
          resolve(ev);
        }
      } catch (_) { /* ignore */ }
    };
    ws.on('message', onMsg);
  });
}

async function waitForReady(base, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${base}/api/channels`);
      if (res.ok) return true;
    } catch (_) { /* not yet up */ }
    await new Promise(r => setTimeout(r, 150));
  }
  return false;
}

test('WS init reports requestedWorkspaceAccess instead of silently bouncing to default', async () => {
  const tmpConfigDir = fs.mkdtempSync(path.join(path.sep === '/' ? '/tmp' : process.env.TEMP || '.', 'zouk-bounce-cfg-'));
  const uploadDir = fs.mkdtempSync(path.join(path.sep === '/' ? '/tmp' : process.env.TEMP || '.', 'zouk-bounce-up-'));
  const port = 17900;
  const base = `http://localhost:${port}`;
  const aliceToken = 'bounce-alice-token';
  const bobToken = 'bounce-bob-token';
  fs.writeFileSync(path.join(tmpConfigDir, 'sessions.json'), JSON.stringify([
    [aliceToken, { name: 'alice', email: 'alice@example.com', picture: null }],
    [bobToken, { name: 'bob', email: 'bob@example.com', picture: null }],
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
    const ready = await waitForReady(base);
    assert.equal(ready, true, 'bounce regression server must become ready');

    // Alice owns the freshly-created workspace; bob has no membership row, so
    // the post-invite "stable" state is reproduced by simply skipping the
    // invite altogether. The bouncing bug also triggers on an invitee whose
    // allowlist row was dropped by a DB hiccup; the surface check is the same.
    const created = await fetch(`${base}/api/workspaces`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${aliceToken}` },
      body: JSON.stringify({ name: 'Foo' }),
    });
    assert.equal(created.status, 200);
    const createdBody = await created.json();
    const workspaceId = createdBody.workspace.id;

    // Bob — explicitly NOT a member — asks the WS for /z/foo. Old server
    // would silently rewrite to default and the client would bounce the URL.
    const ws = new WebSocket(`ws://localhost:${port}/ws?token=${bobToken}&workspaceId=${encodeURIComponent(workspaceId)}`);
    await new Promise((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', reject);
    });
    const init = await waitForInit(ws);
    ws.close();

    assert.ok(init, 'bob must receive an init payload');
    // Server still routes the socket onto default for safety (it can't deliver
    // foo-scoped state to someone who isn't allowed in), but it now also
    // reports the original request and the reason for the swap so the client
    // can avoid rewriting the URL.
    assert.equal(init.workspaceId, 'default', 'server must fall through to default workspace');
    assert.equal(init.requestedWorkspaceId, workspaceId, 'server must echo the requested workspace id');
    assert.equal(init.requestedWorkspaceAccess, 'denied', 'server must mark the workspace request as denied');

    // Alice — the owner — must still see her workspace granted, and the
    // `requestedWorkspaceAccess` field must report "granted" so the client
    // doesn't accidentally show a denial banner for the happy path.
    const okWs = new WebSocket(`ws://localhost:${port}/ws?token=${aliceToken}&workspaceId=${encodeURIComponent(workspaceId)}`);
    await new Promise((resolve, reject) => {
      okWs.once('open', resolve);
      okWs.once('error', reject);
    });
    const okInit = await waitForInit(okWs);
    okWs.close();

    assert.ok(okInit, 'alice must receive an init payload');
    assert.equal(okInit.workspaceId, workspaceId);
    assert.equal(okInit.requestedWorkspaceId, workspaceId);
    assert.equal(okInit.requestedWorkspaceAccess, 'granted');
  } finally {
    proc.kill('SIGKILL');
    fs.rmSync(tmpConfigDir, { recursive: true, force: true });
    fs.rmSync(uploadDir, { recursive: true, force: true });
  }
});

test('invite endpoint puts member+allowlist behind one atomic boundary (no-DB happy path)', async () => {
  // No DATABASE_URL → db.enabled is false in this run, so the allowlist row
  // path is skipped and saveWorkspaceMemberStrict no-ops. The point of this
  // test is the happy-path contract: after POST /api/workspaces/:id/members,
  // the invitee must immediately be able to WS-connect with that workspace
  // and receive `requestedWorkspaceAccess: granted`. If a future refactor of
  // inviteWorkspaceMember accidentally rolls back the in-memory member row
  // on the no-DB path (or forgets to write it at all), this test fails.
  const tmpConfigDir = fs.mkdtempSync(path.join(path.sep === '/' ? '/tmp' : process.env.TEMP || '.', 'zouk-invite-cfg-'));
  const uploadDir = fs.mkdtempSync(path.join(path.sep === '/' ? '/tmp' : process.env.TEMP || '.', 'zouk-invite-up-'));
  const port = 17902;
  const base = `http://localhost:${port}`;
  const aliceToken = 'invite-alice-token';
  const bobToken = 'invite-bob-token';
  fs.writeFileSync(path.join(tmpConfigDir, 'sessions.json'), JSON.stringify([
    [aliceToken, { name: 'alice', email: 'alice@example.com', picture: null }],
    [bobToken, { name: 'bob', email: 'bob@example.com', picture: null }],
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
    const ready = await waitForReady(base);
    assert.equal(ready, true, 'invite atomicity server must become ready');

    const created = await fetch(`${base}/api/workspaces`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${aliceToken}` },
      body: JSON.stringify({ name: 'AtomicFoo' }),
    });
    assert.equal(created.status, 200);
    const workspaceId = (await created.json()).workspace.id;

    // Pre-invite: bob is denied.
    {
      const ws = new WebSocket(`ws://localhost:${port}/ws?token=${bobToken}&workspaceId=${encodeURIComponent(workspaceId)}`);
      await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
      const init = await waitForInit(ws);
      ws.close();
      assert.equal(init?.requestedWorkspaceAccess, 'denied', 'bob must be denied before invite');
    }

    // Alice invites bob.
    const invited = await fetch(`${base}/api/workspaces/${encodeURIComponent(workspaceId)}/members`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${aliceToken}`,
        'X-Workspace-Id': encodeURIComponent(workspaceId),
      },
      body: JSON.stringify({ email: 'bob@example.com', role: 'member', name: 'Bob' }),
    });
    assert.equal(invited.status, 200, 'invite endpoint must succeed');
    const invitedBody = await invited.json();
    assert.equal(invitedBody.member.email, 'bob@example.com');

    // Post-invite: bob is granted.
    {
      const ws = new WebSocket(`ws://localhost:${port}/ws?token=${bobToken}&workspaceId=${encodeURIComponent(workspaceId)}`);
      await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
      const init = await waitForInit(ws);
      ws.close();
      assert.equal(init?.workspaceId, workspaceId, 'invited bob must land on the requested workspace');
      assert.equal(init?.requestedWorkspaceId, workspaceId);
      assert.equal(init?.requestedWorkspaceAccess, 'granted', 'invited bob must be granted access');
    }
  } finally {
    proc.kill('SIGKILL');
    fs.rmSync(tmpConfigDir, { recursive: true, force: true });
    fs.rmSync(uploadDir, { recursive: true, force: true });
  }
});

test('WS init surfaces missing-workspace requests', async () => {
  const tmpConfigDir = fs.mkdtempSync(path.join(path.sep === '/' ? '/tmp' : process.env.TEMP || '.', 'zouk-bounce-missing-cfg-'));
  const uploadDir = fs.mkdtempSync(path.join(path.sep === '/' ? '/tmp' : process.env.TEMP || '.', 'zouk-bounce-missing-up-'));
  const port = 17901;
  const base = `http://localhost:${port}`;
  const token = 'bounce-missing-token';
  fs.writeFileSync(path.join(tmpConfigDir, 'sessions.json'), JSON.stringify([
    [token, { name: 'someone', email: 'someone@example.com', picture: null }],
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
    const ready = await waitForReady(base);
    assert.equal(ready, true, 'missing-workspace regression server must become ready');

    const ws = new WebSocket(`ws://localhost:${port}/ws?token=${token}&workspaceId=does-not-exist`);
    await new Promise((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', reject);
    });
    const init = await waitForInit(ws);
    ws.close();

    assert.ok(init, 'init must arrive');
    assert.equal(init.workspaceId, 'default');
    assert.equal(init.requestedWorkspaceId, 'does-not-exist');
    assert.equal(init.requestedWorkspaceAccess, 'missing');
  } finally {
    proc.kill('SIGKILL');
    fs.rmSync(tmpConfigDir, { recursive: true, force: true });
    fs.rmSync(uploadDir, { recursive: true, force: true });
  }
});
