#!/usr/bin/env node
/**
 * Regression test: delivery counts in POST /api/messages response must be
 * non-zero when a connected daemon agent is subscribed to the channel.
 *
 * Before the fix, deliverToAllAgents checked deliverToAgent's return value
 * synchronously (it's async), so sentCount and queuedCount were always 0.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createZoukSimulation } from './test-support/zouk-simulation.mjs';

function marker(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

test('delivery: POST /api/messages returns non-zero sent count when daemon agent is connected', async (t) => {
  const sim = await createZoukSimulation({ name: 'zouk-delivery-counts' });
  t.after(() => sim.stop());

  const web = await sim.connectWebClient({ token: sim.rootToken });
  t.after(() => web.close());
  await web.waitForType('init');

  const key = await sim.createMachineKey('delivery-test-machine');
  const daemon = await sim.connectDaemon({ key: key.rawKey });
  t.after(() => daemon.close());
  daemon.ready({ runtimes: ['claude'], capabilities: ['workspace_fs'] });
  await sim.waitForMachineReady(key.key.id, { runtime: 'claude' });

  const agentId = `agent-delivery-${Date.now().toString(16)}`;
  const startFramePromise = daemon.waitForStart(agentId);
  await sim.startAgent({
    agentId,
    name: 'deliverbot',
    displayName: 'Delivery Bot',
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

  const alice = await sim.createGuest(`delivery-human-${Date.now()}`);
  const content = marker('delivery-count-test');

  // Set up delivery listener BEFORE sending
  const deliveryPromise = daemon.waitForDelivery(
    agentId,
    (e) => e.message?.content === content,
    5000
  );

  const sent = await sim.sendHumanMessage({ token: alice.token, target: '#all', content });

  // Verify delivery object has non-zero counts — this is the core assertion
  assert.ok(sent.delivery, 'response should include delivery object');
  assert.equal(typeof sent.delivery.sentCount, 'number', 'sentCount should be a number');
  assert.equal(typeof sent.delivery.queuedCount, 'number', 'queuedCount should be a number');
  assert.ok(
    sent.delivery.sentCount >= 1 || sent.delivery.queuedCount >= 1,
    `delivery counts should be non-zero when agent is active and subscribed (got sent=${sent.delivery.sentCount} queued=${sent.delivery.queuedCount})`
  );
  assert.ok(sent.delivery.recipientCount >= 1, 'recipientCount should be >= 1');

  // Verify the agent actually received the delivery
  const delivery = await deliveryPromise;
  assert.ok(delivery, 'agent should receive the delivery');
  assert.equal(delivery.agentId, agentId);

  // Ack the delivery
  if (delivery.seq) {
    daemon.deliverAck(agentId, delivery.seq, delivery.cursor);
  }
});
