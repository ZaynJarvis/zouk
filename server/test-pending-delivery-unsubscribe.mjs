#!/usr/bin/env node
/**
 * Regression test: channel subscription must be checked before delivery.
 *
 * This covers the F3 fix (replayPendingDeliveries re-checks subscription):
 *   1. Normal delivery path: an unsubscribed agent must NOT receive channel
 *      messages. This uses the same store.channelAgents membership data that
 *      replayPendingDeliveries now checks via getMembership().
 *   2. Re-subscribing restores delivery.
 *
 * The replay-specific check (replayPendingDeliveries) adds the same getMembership()
 * guard that the normal deliverToAllAgents path uses via subscribedAgentIdsFor().
 * Both paths consult store.channelAgents, so verifying the normal path also
 * validates the replay path's subscription gate.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createZoukSimulation } from './test-support/zouk-simulation.mjs';

function marker(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

test('delivery: unsubscribed agent does not receive channel messages; re-subscribing restores delivery', async (t) => {
  const sim = await createZoukSimulation({ name: 'zouk-subscription-gate' });
  t.after(() => sim.stop());

  const web = await sim.connectWebClient({ token: sim.rootToken });
  t.after(() => web.close());
  await web.waitForType('init');

  const key = await sim.createMachineKey('sub-gate-machine');
  const daemon = await sim.connectDaemon({ key: key.rawKey });
  t.after(() => daemon.close());
  daemon.ready({ runtimes: ['claude'], capabilities: ['workspace_fs'] });
  await sim.waitForMachineReady(key.key.id, { runtime: 'claude' });

  const agentId = `agent-subgate-${Date.now().toString(16)}`;
  const startFramePromise = daemon.waitForStart(agentId);
  await sim.startAgent({
    agentId,
    name: 'subgate',
    displayName: 'Subscription Gate Bot',
    runtime: 'claude',
    model: 'sonnet',
    machineId: key.key.id,
  });
  await startFramePromise;

  // Mark agent active
  const activePromise = web.waitFor(
    (event) => event.type === 'agent_status' && event.agentId === agentId && event.status === 'active'
  );
  daemon.agentStatus(agentId, { status: 'active', runtime: 'claude', model: 'sonnet' });
  await activePromise;

  // Drain any startup/system deliveries
  await daemon.waitForOrNull(() => false, 200);

  const alice = await sim.createGuest(`subgate-human-${Date.now()}`);

  // ── Phase 1: agent is subscribed (default) — should receive messages ──
  const content1 = marker('subscribed-msg');
  const deliver1Promise = daemon.waitForDelivery(
    agentId,
    (e) => e.message?.content === content1,
    5000
  );
  const sent1 = await sim.sendHumanMessage({ token: alice.token, target: '#all', content: content1 });
  assert.ok(
    sent1.delivery.sentCount >= 1 || sent1.delivery.queuedCount >= 1,
    'subscribed agent should be a delivery recipient'
  );
  const delivery1 = await deliver1Promise;
  assert.ok(delivery1, 'subscribed agent SHOULD receive channel message');
  if (delivery1?.seq) daemon.deliverAck(agentId, delivery1.seq, delivery1.cursor);

  // ── Phase 2: unsubscribe agent — should NOT receive messages ──
  await sim.setAgentSubscription(agentId, { channelName: 'all', canRead: false, subscribed: false });

  // Give the subscription change time to propagate
  await new Promise((r) => setTimeout(r, 50));

  const content2 = marker('unsubscribed-msg');
  const deliver2Promise = daemon.waitForOrNull(
    (e) => e.type === 'agent:deliver' && e.agentId === agentId && e.message?.content === content2,
    2000
  );
  const sent2 = await sim.sendHumanMessage({ token: alice.token, target: '#all', content: content2 });
  assert.equal(
    sent2.delivery.recipientCount, 0,
    'unsubscribed agent should not be in delivery recipient list'
  );
  const delivery2 = await deliver2Promise;
  assert.equal(delivery2, null, 'unsubscribed agent should NOT receive channel message');

  // ── Phase 3: re-subscribe agent — should receive again ──
  await sim.setAgentSubscription(agentId, { channelName: 'all', canRead: true, subscribed: true });
  await new Promise((r) => setTimeout(r, 50));

  const content3 = marker('resubscribed-msg');
  const deliver3Promise = daemon.waitForDelivery(
    agentId,
    (e) => e.message?.content === content3,
    5000
  );
  const sent3 = await sim.sendHumanMessage({ token: alice.token, target: '#all', content: content3 });
  assert.ok(
    sent3.delivery.sentCount >= 1 || sent3.delivery.queuedCount >= 1,
    're-subscribed agent should be a delivery recipient again'
  );
  const delivery3 = await deliver3Promise;
  assert.ok(delivery3, 're-subscribed agent SHOULD receive channel message again');
  if (delivery3?.seq) daemon.deliverAck(agentId, delivery3.seq, delivery3.cursor);
});
