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
//
// Ported to ZoukSimulation harness: free ports, temp config dirs, no mock
// seeding (ZOUK_NO_MOCK=1), and SimulatedSocket event buffering so init
// payloads are never lost even when they arrive before waitForType().

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createZoukSimulation, ZoukSimulation } from './test-support/zouk-simulation.mjs';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = __dirname;
const REPO_DIR = path.resolve(SERVER_DIR, '..');

// ─── Helpers for tests that need sessions pre-populated before server start ──

function appendLog(current, chunk) {
  const next = current + chunk.toString();
  return next.length > 24_000 ? next.slice(-24_000) : next;
}

async function getFreePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  await new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
  return port;
}

/**
 * Create a ZoukSimulation with extra sessions pre-populated in
 * sessions.json BEFORE the server boots.  Needed when ALLOW is active
 * (which disables guest-session creation) or when deterministic user
 * emails are required for env-based allowlist matching.
 */
async function createSimWithSessions(extraSessions, options = {}) {
  const sim = new ZoukSimulation(options);
  sim.port = options.port || await getFreePort();
  sim.configDir = fs.mkdtempSync(path.join(os.tmpdir(), `${sim.name}-config-`));
  sim.uploadsDir = fs.mkdtempSync(path.join(os.tmpdir(), `${sim.name}-uploads-`));

  const allSessions = [[sim.rootToken, sim.rootUser], ...extraSessions];
  fs.writeFileSync(
    path.join(sim.configDir, 'sessions.json'),
    JSON.stringify(allSessions, null, 2),
    'utf8',
  );

  const env = {
    ...process.env,
    DATABASE_URL: '',
    NODE_ENV: 'test',
    PORT: String(sim.port),
    PUBLIC_URL: sim.baseUrl,
    ZOUK_CONFIG_DIR: sim.configDir,
    ZOUK_UPLOADS_DIR: sim.uploadsDir,
    ZOUK_SUPERUSERS: sim.rootUser.email || '',
    ZOUK_PERF_LOG: '0',
    ...(!sim.mock ? { ZOUK_NO_MOCK: '1' } : {}),
    ...sim.env,
  };

  sim.proc = spawn(process.execPath, [path.join(SERVER_DIR, 'index.js')], {
    cwd: REPO_DIR,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  sim.proc.stdout.on('data', (chunk) => { sim.stdout = appendLog(sim.stdout, chunk); });
  sim.proc.stderr.on('data', (chunk) => { sim.stderr = appendLog(sim.stderr, chunk); });

  await sim.waitForReady();
  return sim;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

test('WS init reports requestedWorkspaceAccess instead of silently bouncing to default', async (t) => {
  const sim = await createZoukSimulation({
    name: 'bounce',
    rootName: 'alice',
    rootEmail: 'alice@example.com',
  });
  t.after(() => sim.stop());

  const aliceToken = sim.rootToken;
  const bob = await sim.createGuest('bob');
  const bobToken = bob.token;

  // Alice owns the freshly-created workspace; bob has no membership row, so
  // the post-invite "stable" state is reproduced by simply skipping the
  // invite altogether. The bouncing bug also triggers on an invitee whose
  // allowlist row was dropped by a DB hiccup; the surface check is the same.
  const created = await sim.post('/api/workspaces', { name: 'Foo' }, { token: aliceToken });
  const workspaceId = created.workspace.id;

  // Bob — explicitly NOT a member — asks the WS for /z/foo. Old server
  // would silently rewrite to default and the client would bounce the URL.
  const bobWs = await sim.connectWebClient({ token: bobToken, workspaceId });
  t.after(() => bobWs.close());
  const bobInit = await bobWs.waitForType('init');

  assert.ok(bobInit, 'bob must receive an init payload');
  // Server still routes the socket onto default for safety (it can't deliver
  // foo-scoped state to someone who isn't allowed in), but it now also
  // reports the original request and the reason for the swap so the client
  // can avoid rewriting the URL.
  assert.equal(bobInit.workspaceId, 'default', 'server must fall through to default workspace');
  assert.equal(bobInit.requestedWorkspaceId, workspaceId, 'server must echo the requested workspace id');
  assert.equal(bobInit.requestedWorkspaceAccess, 'denied', 'server must mark the workspace request as denied');

  // Alice — the owner — must still see her workspace granted, and the
  // `requestedWorkspaceAccess` field must report "granted" so the client
  // doesn't accidentally show a denial banner for the happy path.
  const aliceWs = await sim.connectWebClient({ token: aliceToken, workspaceId });
  t.after(() => aliceWs.close());
  const aliceInit = await aliceWs.waitForType('init');

  assert.ok(aliceInit, 'alice must receive an init payload');
  assert.equal(aliceInit.workspaceId, workspaceId);
  assert.equal(aliceInit.requestedWorkspaceId, workspaceId);
  assert.equal(aliceInit.requestedWorkspaceAccess, 'granted');
});

test('invite endpoint puts member+allowlist behind one atomic boundary (no-DB happy path)', async (t) => {
  // No DATABASE_URL → db.enabled is false in this run, so the allowlist row
  // path is skipped and saveWorkspaceMemberStrict no-ops. The point of this
  // test is the happy-path contract: after POST /api/workspaces/:id/members,
  // the invitee must immediately be able to WS-connect with that workspace
  // and receive `requestedWorkspaceAccess: granted`. If a future refactor of
  // inviteWorkspaceMember accidentally rolls back the in-memory member row
  // on the no-DB path (or forgets to write it at all), this test fails.
  const bobEmail = 'bob@example.com';
  const bobToken = 'invite-bob-token';
  const sim = await createSimWithSessions(
    [[bobToken, { name: 'bob', email: bobEmail, picture: null }]],
    {
      name: 'invite-atomic',
      rootName: 'alice',
      rootEmail: 'alice@example.com',
    },
  );
  t.after(() => sim.stop());

  const aliceToken = sim.rootToken;

  const created = await sim.post('/api/workspaces', { name: 'AtomicFoo' }, { token: aliceToken });
  const workspaceId = created.workspace.id;

  // Pre-invite: bob is denied.
  {
    const ws = await sim.connectWebClient({ token: bobToken, workspaceId });
    t.after(() => ws.close());
    const init = await ws.waitForType('init');
    assert.equal(init.requestedWorkspaceAccess, 'denied', 'bob must be denied before invite');
  }

  // Alice invites bob.
  const invited = await sim.post(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/members`,
    { email: bobEmail, role: 'member', name: 'Bob' },
    { token: aliceToken, workspaceId },
  );
  assert.equal(invited.member.email, bobEmail, 'invited member email must match');

  // Post-invite: bob is granted.
  {
    const ws = await sim.connectWebClient({ token: bobToken, workspaceId });
    t.after(() => ws.close());
    const init = await ws.waitForType('init');
    assert.equal(init.workspaceId, workspaceId, 'invited bob must land on the requested workspace');
    assert.equal(init.requestedWorkspaceId, workspaceId);
    assert.equal(init.requestedWorkspaceAccess, 'granted', 'invited bob must be granted access');
  }
});

test('invite path rolls back on strict member-persist failure (louise post-#394 review)', async (t) => {
  // Reproduces louise's concern about PR #394's invite-atomicity gap:
  // setWorkspaceMember(persist:true) used to queue a fire-and-forget DB
  // write that could race past the strict await + rollback and re-create
  // the bad half-state. The follow-up PR switched the invite path to
  // setWorkspaceMember(persist:false) so the strict path is the ONLY DB
  // write for the member row.
  //
  // We exercise the strict-fail branch via a test-only env hook
  // (ZOUK_TEST_FORCE_MEMBER_PERSIST_FAIL=1, gated on NODE_ENV=test) so we
  // don't need a live DB. The fault hits both the workspace-create owner
  // invite and the explicit POST /api/workspaces/:id/members invite — same
  // helper, same single strict write — so verifying the workspace-create
  // path covers both. We additionally assert workspace state is fully
  // rolled back (no lingering visible workspace, no in-memory member).
  const sim = await createZoukSimulation({
    name: 'invite-rollback',
    rootName: 'alice',
    rootEmail: 'alice@example.com',
    env: { ZOUK_TEST_FORCE_MEMBER_PERSIST_FAIL: '1' },
  });
  t.after(() => sim.stop());

  const aliceToken = sim.rootToken;

  const result = await sim.json('POST', '/api/workspaces', {
    body: { name: 'RollbackFoo' },
    token: aliceToken,
  });
  assert.equal(result.status, 500, 'workspace creation must fail loudly when strict member persist fails');

  // The workspace must be fully rolled back: alice's accessible-workspace
  // list returned by the WS init should not contain RollbackFoo. We
  // connect to the default workspace and inspect the `workspaces` array.
  const ws = await sim.connectWebClient({ token: aliceToken, workspaceId: 'default' });
  t.after(() => ws.close());
  const init = await ws.waitForType('init');
  assert.ok(init, 'default-workspace init must arrive after the failed create');
  const visibleIds = new Set((init.workspaces || []).map((w) => w.id));
  assert.ok(!visibleIds.has('rollbackfoo'), 'failed-create workspace must not be visible to alice (in-memory rollback)');

  // Also confirm: hitting /z/rollbackfoo as alice now reports 'missing',
  // not 'denied' — the workspace was fully removed, not just hidden.
  const missingWs = await sim.connectWebClient({ token: aliceToken, workspaceId: 'rollbackfoo' });
  t.after(() => missingWs.close());
  const missingInit = await missingWs.waitForType('init');
  assert.equal(missingInit.requestedWorkspaceAccess, 'missing', 'rolled-back workspace must not exist server-side');
});

test('WS init surfaces missing-workspace requests', async (t) => {
  const sim = await createZoukSimulation({
    name: 'bounce-missing',
    rootName: 'someone',
    rootEmail: 'someone@example.com',
  });
  t.after(() => sim.stop());

  const token = sim.rootToken;
  const ws = await sim.connectWebClient({ token, workspaceId: 'does-not-exist' });
  t.after(() => ws.close());
  const init = await ws.waitForType('init');

  assert.ok(init, 'init must arrive');
  assert.equal(init.workspaceId, 'default');
  assert.equal(init.requestedWorkspaceId, 'does-not-exist');
  assert.equal(init.requestedWorkspaceAccess, 'missing');
});

test('failed re-invite of removed user keeps tombstone intact (louise post-#395 review)', async (t) => {
  // Reproduces louise's concern about the clearWorkspaceMemberRemoval
  // ordering inside inviteWorkspaceMember.
  //
  // Before this fix, clearWorkspaceMemberRemoval(id, normalized) ran
  // BEFORE the strict member persist. A failed re-invite of a previously
  // removed user would roll back the in-memory member row + allowlist row
  // in the catch block, but the tombstone had already been cleared and was
  // NOT restored. For a restricted default workspace where the removed
  // user was on the ALLOW env allowlist, this re-admitted them silently
  // via userWorkspaceRole's allowlist fall-through path (line 1081 of
  // server/index.js: `return isEmailAllowed(...) ? 'member' : null`).
  //
  // After this fix, clearWorkspaceMemberRemoval runs ONLY after the strict
  // persist resolves. The failed re-invite leaves the tombstone in place,
  // and userWorkspaceRole short-circuits at the isWorkspaceMemberRemoved
  // check (line 1076) before ever reaching the allowlist fall-through.
  //
  // We exercise that by:
  //   1. seed ALLOW=alice@…,bob@… → restricted default with bob
  //      allowlist-eligible (the dangerous shape)
  //   2. server startup auto-enrolls both alice and bob in default via
  //      visibleWorkspacesForUser's fallback (index.js:3168). This uses
  //      setWorkspaceMember(persist:true) which goes through the
  //      fire-and-forget db.saveWorkspaceMember — NOT through
  //      saveWorkspaceMemberStrict — so the strict-call counter is still 0
  //      when the test body starts.
  //   3. alice (superuser, deterministic admin) removes bob → tombstone set,
  //      bob is denied on the next WS connect (sanity check)
  //   4. ZOUK_TEST_FORCE_MEMBER_PERSIST_FAIL_AT=1 → the next (i.e. first)
  //      saveWorkspaceMemberStrict call throws
  //   5. alice re-invites bob → saveWorkspaceMemberStrict throws on call #1,
  //      catch rolls back the member row + allowlist row; tombstone MUST
  //      stay intact (this is the bug being fixed)
  //   6. bob WS-connects to default → requestedWorkspaceAccess === 'denied'
  const aliceEmail = 'alice@example.com';
  const bobEmail = 'bob@example.com';
  const bobToken = 'tombstone-bob-token';

  const sim = await createSimWithSessions(
    [[bobToken, { name: 'bob', email: bobEmail, picture: null }]],
    {
      name: 'tombstone',
      rootName: 'alice',
      rootEmail: aliceEmail,
      rootToken: 'tombstone-alice-token',
      env: {
        ALLOW: `${aliceEmail},${bobEmail}`,
        // Server startup auto-enrolls both sessions in default (via the
        // visibleWorkspacesForUser fallback at index.js:3168). That means bob
        // is already a member by the time the test runs; no "first invite" is
        // needed. The only strict-persist call that happens in this test is
        // the re-invite below — so fail on call #1.
        ZOUK_TEST_FORCE_MEMBER_PERSIST_FAIL_AT: '1',
      },
    },
  );
  t.after(() => sim.stop());

  const aliceToken = sim.rootToken;

  // Step 1: Confirm bob is auto-enrolled (visibleWorkspacesForUser
  // fallback at boot). This is our starting "bob is a member" state — no
  // explicit invite needed.

  // Step 2: Remove bob → tombstone set.
  const removeResult = await sim.json('DELETE',
    `/api/workspaces/default/members/${encodeURIComponent(bobEmail)}`,
    { token: aliceToken, workspaceId: 'default' },
  );
  assert.equal(removeResult.status, 200, 'bob removal must succeed');

  // Sanity: bob is denied immediately after removal — tombstone short-circuit
  // at line 1076 of server/index.js wins over the allowlist eligibility on
  // line 1077. If this passes, our pre-condition is correct.
  {
    const ws = await sim.connectWebClient({ token: bobToken, workspaceId: 'default' });
    t.after(() => ws.close());
    const init = await ws.waitForType('init');
    assert.equal(init.requestedWorkspaceAccess, 'denied', 'tombstoned bob must be denied pre re-invite');
  }

  // Step 3: Re-invite bob — strict call #1 (counter starts at 0 because
  // boot auto-enroll uses setWorkspaceMember(persist:true) which goes
  // through the fire-and-forget db.saveWorkspaceMember, NOT through
  // saveWorkspaceMemberStrict). The fault injection throws on this call,
  // the inviteWorkspaceMember catch block rolls back the in-memory member
  // row + (no-op) allowlist row. The fix under test is that the tombstone
  // is NOT touched in this catch path.
  const reinviteResult = await sim.json('POST',
    '/api/workspaces/default/members',
    {
      body: { email: bobEmail, role: 'member', name: 'Bob' },
      token: aliceToken,
      workspaceId: 'default',
    },
  );
  assert.equal(reinviteResult.status, 500, 're-invite must surface strict-persist failure as 5xx');

  // Step 5: The invariant under test — bob MUST still be denied. If the
  // tombstone-clear ran pre-strict (the old buggy ordering), bob would now
  // get requestedWorkspaceAccess: 'granted' here via the allowlist
  // fall-through. That is precisely the silent re-admission louise flagged.
  const ws = await sim.connectWebClient({ token: bobToken, workspaceId: 'default' });
  t.after(() => ws.close());
  const init = await ws.waitForType('init');
  assert.equal(
    init.requestedWorkspaceAccess,
    'denied',
    'failed re-invite must NOT silently re-admit a removed allowlisted user — tombstone must be intact',
  );
});