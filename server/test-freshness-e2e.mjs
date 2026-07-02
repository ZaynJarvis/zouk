#!/usr/bin/env node
/**
 * Send-freshness (optimistic lock) e2e contract tests.
 *
 * Exercises server/routes/agent-internal.js POST /:agentId/send's
 * "held: newer_messages" behavior via the reusable sandbox in
 * server/test-support/zouk-simulation.mjs — a real server/index.js, real
 * agent configs, and a scripted daemon connection that acks deliveries by
 * hand so the test controls exactly what each agent has "seen".
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createZoukSimulation } from './test-support/zouk-simulation.mjs';

function marker(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

// Registers two agents ("a" and "b") on a shared daemon connection,
// subscribed to #all and marked active. Returns their agentIds.
async function setupAgentPair(sim, daemon, machineId, prefix) {
  const agentIds = {};
  for (const label of ['a', 'b']) {
    const name = `${prefix}${label}`;
    const agentId = `agent-${name}-${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 6)}`;
    // eslint-disable-next-line no-await-in-loop
    await sim.createAgentConfig({ id: agentId, name, displayName: name, machineId });
    // eslint-disable-next-line no-await-in-loop
    await sim.setAgentSubscription(agentId, { channelName: 'all', canRead: true, subscribed: true });
    const startFrame = daemon.waitForStart(agentId);
    // eslint-disable-next-line no-await-in-loop
    await sim.startAgent({ agentId, name, displayName: name, machineId });
    // eslint-disable-next-line no-await-in-loop
    await startFrame;
    daemon.agentStatus(agentId, { status: 'active' });
    agentIds[label] = { agentId, name };
  }
  await sim.waitUntil(async () => {
    const { agents } = await sim.get(`/internal/agent/${encodeURIComponent(agentIds.a.agentId)}/server`);
    return ['a', 'b'].every((label) => agents.some((a) => a.name === agentIds[label].name && a.status === 'active'));
  }, `${prefix} agent pair active`, 2000);
  return agentIds;
}

test('freshness: stale send held, resend passes, receive advances cursor, clientMsgId dedupes', async (t) => {
  const sim = await createZoukSimulation({ name: 'zouk-sim-freshness' });
  t.after(() => sim.stop());

  const key = await sim.createMachineKey('freshness-machine');
  const daemon = await sim.connectDaemon({ key: key.rawKey });
  t.after(() => daemon.close());
  daemon.ready({ runtimes: ['claude'], capabilities: [] });
  await sim.waitForMachineReady(key.key.id, { runtime: 'claude' });

  const { a, b } = await setupAgentPair(sim, daemon, key.key.id, 'fresh');

  const human = await sim.createGuest(`freshness-human-${Date.now()}`);
  const question = marker('freshness-question');

  const deliverA = daemon.waitForDelivery(a.agentId, (e) => e.message?.content === question);
  const deliverB = daemon.waitForDelivery(b.agentId, (e) => e.message?.content === question);
  await sim.sendHumanMessage({ token: human.token, target: '#all', content: question });
  const [evA, evB] = await Promise.all([deliverA, deliverB]);
  daemon.deliverAck(a.agentId, evA.seq, evA.cursor);
  daemon.deliverAck(b.agentId, evB.seq, evB.cursor);

  // --- (a) stale send is held --------------------------------------------
  const replyA = marker('freshness-reply-a');
  const sentA = await sim.agentSend(a.agentId, { target: '#all', content: replyA });
  assert.ok(sentA.messageId, 'A send should succeed (A has seen everything so far)');
  assert.equal(sentA.state, undefined);

  const replyB = marker('freshness-reply-b');
  const heldB = await sim.agentSend(b.agentId, { target: '#all', content: replyB });
  assert.equal(heldB.state, 'held');
  assert.equal(heldB.reason, 'newer_messages');
  assert.ok(heldB.newMessageCount >= 1);
  assert.ok(
    heldB.heldMessages.some((m) => m.content === replyA && m.sender_type === 'agent'),
    'held response should surface A\'s reply as the reason for the hold',
  );

  const historyAfterHold = await sim.getMessages({ channel: '#all', limit: 50 });
  assert.ok(!historyAfterHold.messages.some((m) => m.content === replyB), 'held message must not be posted');

  // --- (b) re-send after hold passes --------------------------------------
  const resentB = await sim.agentSend(b.agentId, { target: '#all', content: replyB });
  assert.ok(resentB.messageId, 'resend after hold should succeed');
  assert.equal(resentB.state, undefined);
  const historyAfterResend = await sim.getMessages({ channel: '#all', limit: 50 });
  assert.ok(historyAfterResend.messages.some((m) => m.content === replyB), 'resent message should now be posted');

  // Bring A up to date on B's reply the same way a real daemon would — via
  // ack of the WS delivery it already fanned out to A — so A's own next
  // send below isn't itself held (that's not what this test is measuring).
  const deliverAforB = await daemon.waitForDelivery(a.agentId, (e) => e.message?.content === replyB);
  daemon.deliverAck(a.agentId, deliverAforB.seq, deliverAforB.cursor);

  const replyA2 = marker('freshness-reply-a2');
  const sentA2 = await sim.agentSend(a.agentId, { target: '#all', content: replyA2 });
  assert.ok(sentA2.messageId, 'A send should succeed once A has acked B\'s reply');

  // --- (c) GET receive advances the cursor --------------------------------
  // B never acked or held past replyA2 — /receive should surface it AND
  // advance B's seen cursor, so B's next send passes without a hold.
  const inbox = await sim.agentReceive(b.agentId);
  assert.ok(inbox.messages.some((m) => m.content === replyA2), 'receive should surface A\'s new message');

  const replyB2 = marker('freshness-reply-b2');
  const sentB2 = await sim.agentSend(b.agentId, { target: '#all', content: replyB2 });
  assert.ok(sentB2.messageId, 'send after receive should not be held');
  assert.equal(sentB2.state, undefined);

  // --- (d) clientMsgId dedupe ----------------------------------------------
  const dedupeContent = marker('freshness-dedupe');
  const clientMsgId = marker('client-msg-id');
  const first = await sim.agentSend(b.agentId, { target: '#all', content: dedupeContent, clientMsgId });
  assert.ok(first.messageId);
  assert.notEqual(first.deduplicated, true);
  const replay = await sim.agentSend(b.agentId, { target: '#all', content: dedupeContent, clientMsgId });
  assert.equal(replay.messageId, first.messageId);
  assert.equal(replay.deduplicated, true);

  const historyFinal = await sim.getMessages({ channel: '#all', limit: 50 });
  const dedupeMatches = historyFinal.messages.filter((m) => m.content === dedupeContent);
  assert.equal(dedupeMatches.length, 1, 'dedupe must not insert a second message');
});

test('freshness: ZOUK_SEND_FRESHNESS=0 disables the hold (baseline)', async (t) => {
  const sim = await createZoukSimulation({ name: 'zouk-sim-freshness-off', env: { ZOUK_SEND_FRESHNESS: '0' } });
  t.after(() => sim.stop());

  const key = await sim.createMachineKey('freshness-off-machine');
  const daemon = await sim.connectDaemon({ key: key.rawKey });
  t.after(() => daemon.close());
  daemon.ready({ runtimes: ['claude'], capabilities: [] });
  await sim.waitForMachineReady(key.key.id, { runtime: 'claude' });

  const { a, b } = await setupAgentPair(sim, daemon, key.key.id, 'base');

  const human = await sim.createGuest(`freshness-off-human-${Date.now()}`);
  const question = marker('freshness-off-question');

  const deliverA = daemon.waitForDelivery(a.agentId, (e) => e.message?.content === question);
  const deliverB = daemon.waitForDelivery(b.agentId, (e) => e.message?.content === question);
  await sim.sendHumanMessage({ token: human.token, target: '#all', content: question });
  const [evA, evB] = await Promise.all([deliverA, deliverB]);
  daemon.deliverAck(a.agentId, evA.seq, evA.cursor);
  daemon.deliverAck(b.agentId, evB.seq, evB.cursor);

  const replyA = marker('freshness-off-reply-a');
  const sentA = await sim.agentSend(a.agentId, { target: '#all', content: replyA });
  assert.ok(sentA.messageId);

  // B never acks or reads replyA — with the freshness check disabled this
  // stale send must go through anyway (the baseline "spam" behavior).
  const replyB = marker('freshness-off-reply-b');
  const sentB = await sim.agentSend(b.agentId, { target: '#all', content: replyB });
  assert.ok(sentB.messageId, 'baseline mode should not hold B\'s stale send');
  assert.equal(sentB.state, undefined);

  const history = await sim.getMessages({ channel: '#all', limit: 50 });
  assert.ok(history.messages.some((m) => m.content === replyA), 'A\'s reply should be posted in baseline mode');
  assert.ok(history.messages.some((m) => m.content === replyB), 'B\'s reply should also be posted in baseline mode');
});
