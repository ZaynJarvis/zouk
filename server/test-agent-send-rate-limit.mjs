#!/usr/bin/env node
/**
 * Per-agent send rate limit tests for POST /internal/agent/:id/send.
 *
 * Exercises the sliding-window limiter in server/routes/agent-internal.js
 * via the reusable sandbox in server/test-support/zouk-simulation.mjs.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createZoukSimulation } from './test-support/zouk-simulation.mjs';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function uniqueId(prefix) {
  return `${prefix}-${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 6)}`;
}

// Sets up a single active agent: creates config, starts it via daemon,
// waits for it to be running. Returns { agentId, name }.
async function setupAgent(sim, daemon, machineId, name) {
  const agentId = uniqueId(`agent-${name}`);
  await sim.createAgentConfig({ id: agentId, name, displayName: name, machineId });
  await sim.setAgentSubscription(agentId, { channelName: 'all', canRead: true, subscribed: true });
  const startFrame = daemon.waitForStart(agentId);
  await sim.startAgent({ agentId, name, displayName: name, machineId });
  await startFrame;
  daemon.agentStatus(agentId, { status: 'active' });
  // Give the server a tick to register the active status
  await sim.waitUntil(async () => {
    try {
      const { agents } = await sim.get(`/internal/agent/${encodeURIComponent(agentId)}/server`);
      return agents.some((a) => a.name === name && a.status === 'active');
    } catch {
      return false;
    }
  }, `agent ${name} active`, 2000);
  return { agentId, name };
}

// Helper: send a message via the agent send endpoint using the low-level
// json() method so we can inspect 429 responses (agentSend throws on non-200).
async function sendRaw(sim, agentId, content) {
  return sim.json('POST', `/internal/agent/${encodeURIComponent(agentId)}/send`, {
    body: { target: '#all', content, clientMsgId: uniqueId('cmi') },
  });
}

// ── Test (a): 25 rapid sends → first 20 succeed, rest 429 ──────────────

test('rate limit: 25 rapid sends → first 20 succeed, rest get 429 with retryAfter', async (t) => {
  const sim = await createZoukSimulation({ name: 'zouk-sim-rate-limit-a' });
  t.after(() => sim.stop());

  const key = await sim.createMachineKey('rate-limit-machine-a');
  const daemon = await sim.connectDaemon({ key: key.rawKey });
  t.after(() => daemon.close());
  daemon.ready({ runtimes: ['claude'], capabilities: [] });
  await sim.waitForMachineReady(key.key.id, { runtime: 'claude' });

  const { agentId } = await setupAgent(sim, daemon, key.key.id, 'flood-bot');

  const results = [];
  for (let i = 0; i < 25; i++) {
    // eslint-disable-next-line no-await-in-loop
    results.push(await sendRaw(sim, agentId, `flood message ${i}`));
  }

  const succeeded = results.filter((r) => r.ok);
  const rateLimited = results.filter((r) => r.status === 429);

  assert.equal(succeeded.length, 20, `expected 20 successful sends, got ${succeeded.length}`);
  assert.equal(rateLimited.length, 5, `expected 5 rate-limited sends, got ${rateLimited.length}`);

  // Every 429 response should have retryAfter and Retry-After header
  for (const r of rateLimited) {
    assert.ok(r.body, '429 response should have a body');
    assert.equal(typeof r.body.retryAfter, 'number', 'retryAfter should be a number');
    assert.ok(r.body.retryAfter > 0, 'retryAfter should be positive');
    assert.ok(r.body.error, '429 body should have error field');
    const retryAfterHeader = r.res.headers.get('retry-after');
    assert.ok(retryAfterHeader, 'Retry-After header should be present');
    assert.equal(Number(retryAfterHeader), r.body.retryAfter, 'header should match body retryAfter');
  }

  // Succeeded responses should have a messageId or state 'held'
  for (const r of succeeded) {
    const hasMessageId = r.body && r.body.messageId;
    const isHeld = r.body && r.body.state === 'held';
    assert.ok(hasMessageId || isHeld, `successful send should have messageId or state=held, got ${JSON.stringify(r.body)}`);
  }
});

// ── Test (b): per-agent isolation ──────────────────────────────────────

test('rate limit: per-agent isolation — agent B unaffected while A is limited', async (t) => {
  const sim = await createZoukSimulation({ name: 'zouk-sim-rate-limit-b' });
  t.after(() => sim.stop());

  const key = await sim.createMachineKey('rate-limit-machine-b');
  const daemon = await sim.connectDaemon({ key: key.rawKey });
  t.after(() => daemon.close());
  daemon.ready({ runtimes: ['claude'], capabilities: [] });
  await sim.waitForMachineReady(key.key.id, { runtime: 'claude' });

  const agentA = await setupAgent(sim, daemon, key.key.id, 'agent-a');
  const agentB = await setupAgent(sim, daemon, key.key.id, 'agent-b');

  // Flood agent A to its limit (20 sends)
  for (let i = 0; i < 20; i++) {
    // eslint-disable-next-line no-await-in-loop
    await sendRaw(sim, agentA.agentId, `A flood ${i}`);
  }

  // Agent A's 21st send should be 429
  const a21 = await sendRaw(sim, agentA.agentId, 'A flood 21');
  assert.equal(a21.status, 429, `agent A's 21st send should be 429, got ${a21.status}`);

  // Agent B's first send should succeed
  const b1 = await sendRaw(sim, agentB.agentId, 'B first message');
  assert.equal(b1.status, 200, `agent B's 1st send should succeed, got ${b1.status}`);
  assert.ok(b1.body && (b1.body.messageId || b1.body.state === 'held'), 'agent B response should have messageId or state=held');

  // Agent B can send up to its own limit
  const bSends = [];
  for (let i = 0; i < 19; i++) {
    // eslint-disable-next-line no-await-in-loop
    bSends.push(await sendRaw(sim, agentB.agentId, `B flood ${i}`));
  }
  const bOk = bSends.filter((r) => r.ok);
  assert.equal(bOk.length, 19, `agent B should get 19 more successful sends (total 20), got ${bOk.length}`);

  // Now agent B's 21st should also be 429
  const b21 = await sendRaw(sim, agentB.agentId, 'B flood 21');
  assert.equal(b21.status, 429, `agent B's 21st send should be 429, got ${b21.status}`);

  // Agent A should still be 429
  const a22 = await sendRaw(sim, agentA.agentId, 'A flood 22');
  assert.equal(a22.status, 429, `agent A should still be 429, got ${a22.status}`);
});

// ── Test (c): window expiry allows sending again ───────────────────────

test('rate limit: window expiry allows sending again after a short wait', async (t) => {
  // Shrink the window to 300ms and max to 5 for fast testing
  const sim = await createZoukSimulation({
    name: 'zouk-sim-rate-limit-c',
    env: { ZOUK_AGENT_SEND_RATE: '5', ZOUK_AGENT_SEND_WINDOW_MS: '300' },
  });
  t.after(() => sim.stop());

  const key = await sim.createMachineKey('rate-limit-machine-c');
  const daemon = await sim.connectDaemon({ key: key.rawKey });
  t.after(() => daemon.close());
  daemon.ready({ runtimes: ['claude'], capabilities: [] });
  await sim.waitForMachineReady(key.key.id, { runtime: 'claude' });

  const { agentId } = await setupAgent(sim, daemon, key.key.id, 'window-bot');

  // Send 5 messages — all should succeed (at the limit, not over)
  for (let i = 0; i < 5; i++) {
    // eslint-disable-next-line no-await-in-loop
    const r = await sendRaw(sim, agentId, `window test ${i}`);
    assert.equal(r.status, 200, `send ${i} should succeed, got ${r.status}`);
  }

  // 6th send should be 429
  const sixth = await sendRaw(sim, agentId, 'window test 6');
  assert.equal(sixth.status, 429, `6th send should be 429, got ${sixth.status}`);

  // Wait for the window to expire (300ms + some margin)
  await sleep(400);

  // Now sending should succeed again
  const afterWait = await sendRaw(sim, agentId, 'after window expiry');
  assert.equal(afterWait.status, 200, `send after window expiry should succeed, got ${afterWait.status}`);
  assert.ok(afterWait.body && (afterWait.body.messageId || afterWait.body.state === 'held'),
    'post-wait response should have messageId or state=held');
});
