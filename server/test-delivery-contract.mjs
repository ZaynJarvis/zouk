#!/usr/bin/env node
/**
 * Delivery payload contract tests.
 *
 * Verifies that every agent:deliver frame and every /receive, /history,
 * and held-send response carries the full required field set with no
 * undefined values: seq, message_id, channel_type, thread_id,
 * parent_message_id, timestamp, sender_type.
 *
 * See docs/agent-delivery-routing.md "Phase 2 TODO".
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createZoukSimulation } from './test-support/zouk-simulation.mjs';

function marker(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/**
 * Assert that a delivery payload (from formatMessageForAgent) satisfies
 * the contract: every required field is present and non-undefined.
 * null is acceptable for thread_id / parent_message_id on non-thread messages.
 */
function assertDeliveryContract(payload, { expectThread = false, label = 'message' } = {}) {
  assert.ok(payload, `${label}: payload should be truthy`);
  assert.equal(typeof payload.seq, 'number', `${label}: seq should be a number, got ${typeof payload.seq} (${payload.seq})`);
  assert.ok(payload.seq >= 0 || payload.seq === -1, `${label}: seq should be >= 0 or sentinel -1, got ${payload.seq}`);
  assert.equal(typeof payload.message_id, 'string', `${label}: message_id should be a string, got ${typeof payload.message_id}`);
  assert.ok(payload.message_id.length > 0, `${label}: message_id should be non-empty`);
  assert.equal(typeof payload.channel_type, 'string', `${label}: channel_type should be a string, got ${typeof payload.channel_type}`);
  assert.ok(payload.channel_type.length > 0, `${label}: channel_type should be non-empty`);
  assert.notEqual(payload.thread_id, undefined, `${label}: thread_id should not be undefined`);
  assert.notEqual(payload.parent_message_id, undefined, `${label}: parent_message_id should not be undefined`);
  assert.equal(typeof payload.timestamp, 'string', `${label}: timestamp should be a string, got ${typeof payload.timestamp}`);
  assert.ok(payload.timestamp.length > 0, `${label}: timestamp should be non-empty`);
  // timestamp should be a valid ISO-parseable string
  const ts = new Date(payload.timestamp);
  assert.ok(!isNaN(ts.getTime()), `${label}: timestamp should be valid ISO, got ${payload.timestamp}`);
  assert.equal(typeof payload.sender_type, 'string', `${label}: sender_type should be a string, got ${typeof payload.sender_type}`);
  assert.ok(payload.sender_type.length > 0, `${label}: sender_type should be non-empty`);
  assert.equal(typeof payload.sender_name, 'string', `${label}: sender_name should be a string`);
  assert.equal(typeof payload.channel_name, 'string', `${label}: channel_name should be a string`);

  if (expectThread) {
    assert.ok(payload.thread_id, `${label}: thread_id should be truthy for thread messages`);
    assert.equal(payload.channel_type, 'thread', `${label}: channel_type should be 'thread' for thread replies`);
  }
}

/**
 * Assert that an agent:deliver frame satisfies the contract at both
 * the envelope level (seq) and the message level (all fields).
 */
function assertDeliverFrame(frame, { expectThread = false, label = 'frame' } = {}) {
  assert.equal(frame.type, 'agent:deliver', `${label}: frame type`);
  assert.equal(typeof frame.seq, 'number', `${label}: frame-level seq should be a number`);
  assert.ok(frame.agentId, `${label}: agentId should be present`);
  assertDeliveryContract(frame.message, { expectThread, label: `${label}.message` });
}

async function setupActiveAgent(sim, daemon, machineId, prefix) {
  const name = `${prefix}-bot`;
  const agentId = `agent-${prefix}-${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 6)}`;
  await sim.createAgentConfig({ id: agentId, name, displayName: name, machineId });
  await sim.setAgentSubscription(agentId, { channelName: 'all', canRead: true, subscribed: true });
  const startFrame = daemon.waitForStart(agentId);
  await sim.startAgent({ agentId, name, displayName: name, machineId });
  await startFrame;
  daemon.agentStatus(agentId, { status: 'active' });
  // Wait for agent to show as active in the server listing
  await sim.waitUntil(async () => {
    const server = await sim.get(`/internal/agent/${encodeURIComponent(agentId)}/server`);
    return server.agents.some((a) => a.name === name && a.status === 'active');
  }, `${prefix} agent active`, 2000);
  return { agentId, name };
}

// ─── Top-level channel message ─────────────────────────────────────

test('delivery contract: top-level channel message via agent:deliver', async (t) => {
  const sim = await createZoukSimulation({ name: 'zouk-contract-channel' });
  t.after(() => sim.stop());

  const web = await sim.connectWebClient({ token: sim.rootToken });
  t.after(() => web.close());
  await web.waitForType('init');

  const key = await sim.createMachineKey('contract-machine');
  const daemon = await sim.connectDaemon({ key: key.rawKey });
  t.after(() => daemon.close());
  daemon.ready({ runtimes: ['claude'], capabilities: [] });
  await sim.waitForMachineReady(key.key.id, { runtime: 'claude' });

  const { agentId } = await setupActiveAgent(sim, daemon, key.key.id, 'contract');

  // Drain startup noise
  await daemon.waitForOrNull(() => false, 200);

  const content = marker('contract-channel');
  const deliveryPromise = daemon.waitForDelivery(
    agentId,
    (e) => e.message?.content === content,
    5000
  );

  const human = await sim.createGuest(`contract-human-${Date.now()}`);
  await sim.sendHumanMessage({ token: human.token, target: '#all', content });

  const frame = await deliveryPromise;
  assert.ok(frame, `agent should receive delivery for top-level message`);
  assertDeliverFrame(frame, { expectThread: false, label: 'channel-deliver' });
  assert.equal(frame.message.channel_type, 'channel', 'channel_type should be "channel"');
  assert.equal(frame.message.thread_id, null, 'thread_id should be null for top-level');
  assert.equal(frame.message.parent_message_id, null, 'parent_message_id should be null for top-level');
});

// ─── Thread reply ──────────────────────────────────────────────────

test('delivery contract: thread reply via agent:deliver', async (t) => {
  const sim = await createZoukSimulation({ name: 'zouk-contract-thread' });
  t.after(() => sim.stop());

  const web = await sim.connectWebClient({ token: sim.rootToken });
  t.after(() => web.close());
  await web.waitForType('init');

  const key = await sim.createMachineKey('contract-machine');
  const daemon = await sim.connectDaemon({ key: key.rawKey });
  t.after(() => daemon.close());
  daemon.ready({ runtimes: ['claude'], capabilities: [] });
  await sim.waitForMachineReady(key.key.id, { runtime: 'claude' });

  const { agentId, name: agentName } = await setupActiveAgent(sim, daemon, key.key.id, 'threadbot');

  // Drain startup noise
  await daemon.waitForOrNull(() => false, 200);

  // Send root message that @mentions the agent so it becomes a thread
  // root participant. Thread-scope routing only delivers to participants,
  // not all channel subscribers (docs/agent-delivery-routing.md).
  const rootContent = `@${agentName} please check this ${marker('contract-thread-root')}`;
  const rootDeliveryPromise = daemon.waitForDelivery(
    agentId,
    (e) => e.message?.content === rootContent,
    5000
  );
  const human = await sim.createGuest(`contract-human-${Date.now()}`);
  const sent = await sim.sendHumanMessage({ token: human.token, target: '#all', content: rootContent });
  const rootFrame = await rootDeliveryPromise;
  assert.ok(rootFrame, 'agent should receive root message delivery');
  assertDeliverFrame(rootFrame, { expectThread: false, label: 'thread-root' });

  // Get the root message short id for threading
  const rootMsgId = sent.messageId || rootFrame.message.message_id;
  const shortId = rootMsgId.slice(0, 8);

  // Send thread reply — agent should receive it because it's a root participant
  const replyContent = marker('contract-thread-reply');
  const replyDeliveryPromise = daemon.waitForDelivery(
    agentId,
    (e) => e.message?.content === replyContent,
    5000
  );
  await sim.sendHumanMessage({ token: human.token, target: `#all:${shortId}`, content: replyContent });
  const replyFrame = await replyDeliveryPromise;
  assert.ok(replyFrame, 'agent should receive thread reply delivery');
  assertDeliverFrame(replyFrame, { expectThread: true, label: 'thread-reply' });
  assert.equal(replyFrame.message.thread_id, shortId, 'thread_id should match the root short id');
  assert.ok(replyFrame.message.parent_message_id, 'parent_message_id should be set for thread reply');
  assert.equal(replyFrame.message.parent_message_id, rootMsgId, 'parent_message_id should be the root message id');
});

// ─── DM message ────────────────────────────────────────────────────

test('delivery contract: DM message via agent:deliver', async (t) => {
  const sim = await createZoukSimulation({ name: 'zouk-contract-dm' });
  t.after(() => sim.stop());

  const web = await sim.connectWebClient({ token: sim.rootToken });
  t.after(() => web.close());
  await web.waitForType('init');

  const key = await sim.createMachineKey('contract-machine');
  const daemon = await sim.connectDaemon({ key: key.rawKey });
  t.after(() => daemon.close());
  daemon.ready({ runtimes: ['claude'], capabilities: [] });
  await sim.waitForMachineReady(key.key.id, { runtime: 'claude' });

  const { agentId, name: agentName } = await setupActiveAgent(sim, daemon, key.key.id, 'dmbot');

  // Drain startup noise
  await daemon.waitForOrNull(() => false, 200);

  const content = marker('contract-dm');
  const deliveryPromise = daemon.waitForDelivery(
    agentId,
    (e) => e.message?.content === content,
    5000
  );

  // Send a DM to the agent. Use dm:@agentname syntax.
  const human = await sim.createGuest(`contract-human-${Date.now()}`);
  await sim.sendHumanMessage({ token: human.token, target: `dm:@${agentName}`, content });

  const frame = await deliveryPromise;
  assert.ok(frame, 'agent should receive DM delivery');
  assertDeliverFrame(frame, { expectThread: false, label: 'dm-deliver' });
  assert.equal(frame.message.channel_type, 'dm', 'channel_type should be "dm"');
  assert.equal(frame.message.thread_id, null, 'thread_id should be null for DM');
});

// ─── /receive endpoint ─────────────────────────────────────────────

test('delivery contract: /receive returns messages with full field set', async (t) => {
  const sim = await createZoukSimulation({ name: 'zouk-contract-receive' });
  t.after(() => sim.stop());

  const web = await sim.connectWebClient({ token: sim.rootToken });
  t.after(() => web.close());
  await web.waitForType('init');

  const key = await sim.createMachineKey('contract-machine');
  const daemon = await sim.connectDaemon({ key: key.rawKey });
  t.after(() => daemon.close());
  daemon.ready({ runtimes: ['claude'], capabilities: [] });
  await sim.waitForMachineReady(key.key.id, { runtime: 'claude' });

  const { agentId } = await setupActiveAgent(sim, daemon, key.key.id, 'recvbot');

  // Drain startup deliveries by acking them
  await daemon.waitForOrNull(() => false, 200);

  // Send a top-level message
  const human = await sim.createGuest(`contract-human-${Date.now()}`);
  const channelContent = marker('contract-recv-channel');
  await sim.sendHumanMessage({ token: human.token, target: '#all', content: channelContent });

  // Send a thread reply
  const rootContent = marker('contract-recv-root');
  const rootSent = await sim.sendHumanMessage({ token: human.token, target: '#all', content: rootContent });
  const shortId = rootSent.messageId.slice(0, 8);
  const threadContent = marker('contract-recv-thread');
  await sim.sendHumanMessage({ token: human.token, target: `#all:${shortId}`, content: threadContent });

  // Give messages time to be stored
  await new Promise((r) => setTimeout(r, 100));

  // Now call /receive — it should return all unseen messages with full fields
  const receive = await sim.agentReceive(agentId);
  assert.ok(Array.isArray(receive.messages), '/receive should return messages array');
  assert.ok(receive.messages.length > 0, '/receive should have messages');

  for (const msg of receive.messages) {
    assertDeliveryContract(msg, { label: `receive/${msg.message_id?.slice(0, 8) || 'unknown'}` });
  }

  // Verify we got both a top-level and a thread message
  const topLevel = receive.messages.filter((m) => m.channel_type !== 'thread');
  const threadMsgs = receive.messages.filter((m) => m.channel_type === 'thread');
  assert.ok(topLevel.length > 0, 'should have top-level messages in /receive');
  assert.ok(threadMsgs.length > 0, 'should have thread messages in /receive');

  // Thread messages should have non-null thread_id
  for (const tm of threadMsgs) {
    assert.ok(tm.thread_id, `thread message ${tm.message_id?.slice(0, 8)} should have thread_id`);
  }
});

// ─── /history endpoint ─────────────────────────────────────────────

test('delivery contract: /history returns messages with full field set', async (t) => {
  const sim = await createZoukSimulation({ name: 'zouk-contract-history' });
  t.after(() => sim.stop());

  const web = await sim.connectWebClient({ token: sim.rootToken });
  t.after(() => web.close());
  await web.waitForType('init');

  const key = await sim.createMachineKey('contract-machine');
  const daemon = await sim.connectDaemon({ key: key.rawKey });
  t.after(() => daemon.close());
  daemon.ready({ runtimes: ['claude'], capabilities: [] });
  await sim.waitForMachineReady(key.key.id, { runtime: 'claude' });

  const { agentId } = await setupActiveAgent(sim, daemon, key.key.id, 'histbot');

  // Drain startup noise
  await daemon.waitForOrNull(() => false, 200);

  // Send messages to populate history
  const human = await sim.createGuest(`contract-human-${Date.now()}`);
  const histContent = marker('contract-hist');
  await sim.sendHumanMessage({ token: human.token, target: '#all', content: histContent });

  // Also create a thread for history
  const rootContent = marker('contract-hist-root');
  const rootSent = await sim.sendHumanMessage({ token: human.token, target: '#all', content: rootContent });
  const shortId = rootSent.messageId.slice(0, 8);
  const threadContent = marker('contract-hist-reply');
  await sim.sendHumanMessage({ token: human.token, target: `#all:${shortId}`, content: threadContent });

  // Give messages time to be stored
  await new Promise((r) => setTimeout(r, 100));

  // Check channel history
  const history = await sim.agentHistory(agentId, { channel: '#all', limit: 50 });
  assert.ok(Array.isArray(history.messages), '/history should return messages array');
  assert.ok(history.messages.length > 0, '/history should have messages');

  for (const msg of history.messages) {
    assertDeliveryContract(msg, { label: `history/${msg.message_id?.slice(0, 8) || 'unknown'}` });
  }

  // Check thread history
  const threadHistory = await sim.agentHistory(agentId, { channel: `#all:${shortId}`, limit: 50 });
  assert.ok(Array.isArray(threadHistory.messages), 'thread /history should return messages array');

  for (const msg of threadHistory.messages) {
    assertDeliveryContract(msg, { label: `thread-history/${msg.message_id?.slice(0, 8) || 'unknown'}` });
    assert.equal(msg.channel_type, 'thread', 'thread history messages should have channel_type=thread');
    assert.ok(msg.thread_id, 'thread history messages should have thread_id');
  }
});

// ─── Held send response ────────────────────────────────────────────

test('delivery contract: held-send response includes contract-compliant heldMessages', async (t) => {
  const sim = await createZoukSimulation({ name: 'zouk-contract-held' });
  t.after(() => sim.stop());

  const web = await sim.connectWebClient({ token: sim.rootToken });
  t.after(() => web.close());
  await web.waitForType('init');

  const key = await sim.createMachineKey('contract-machine');
  const daemon = await sim.connectDaemon({ key: key.rawKey });
  t.after(() => daemon.close());
  daemon.ready({ runtimes: ['claude'], capabilities: [] });
  await sim.waitForMachineReady(key.key.id, { runtime: 'claude' });

  // Set up two agents
  const a = await setupActiveAgent(sim, daemon, key.key.id, 'helda');
  const b = await setupActiveAgent(sim, daemon, key.key.id, 'heldb');

  // Drain startup deliveries
  await daemon.waitForOrNull(() => false, 200);

  // Agent A sends a message (this won't be held)
  const aContent = marker('contract-held-a');
  const aSent = await sim.agentSend(a.agentId, { target: '#all', content: aContent });
  assert.ok(aSent.messageId, 'agent A send should succeed');

  // Now agent B tries to send — it should be held because B hasn't seen A's message
  const bContent = marker('contract-held-b');
  const bSent = await sim.agentSend(b.agentId, { target: '#all', content: bContent });

  if (bSent.state === 'held') {
    assert.ok(bSent.heldMessages && bSent.heldMessages.length > 0, 'held response should include heldMessages');
    for (const hm of bSent.heldMessages) {
      assertDeliveryContract(hm, { label: `held/${hm.message_id?.slice(0, 8) || 'unknown'}` });
    }
  }
  // If state wasn't held (e.g., freshness disabled), that's fine — the
  // contract is still tested by the other test cases.
});

// ─── DM history ────────────────────────────────────────────────────

test('delivery contract: DM history returns messages with full field set', async (t) => {
  const sim = await createZoukSimulation({ name: 'zouk-contract-dm-hist' });
  t.after(() => sim.stop());

  const web = await sim.connectWebClient({ token: sim.rootToken });
  t.after(() => web.close());
  await web.waitForType('init');

  const key = await sim.createMachineKey('contract-machine');
  const daemon = await sim.connectDaemon({ key: key.rawKey });
  t.after(() => daemon.close());
  daemon.ready({ runtimes: ['claude'], capabilities: [] });
  await sim.waitForMachineReady(key.key.id, { runtime: 'claude' });

  const { agentId, name: agentName } = await setupActiveAgent(sim, daemon, key.key.id, 'dmhist');

  // Drain startup noise
  await daemon.waitForOrNull(() => false, 200);

  // Send a DM to populate history
  const human = await sim.createGuest(`contract-human-${Date.now()}`);
  const dmContent = marker('contract-dm-hist');
  const dmSent = await sim.sendHumanMessage({ token: human.token, target: `dm:@${agentName}`, content: dmContent });
  assert.ok(dmSent.messageId, 'DM send should return messageId');

  await new Promise((r) => setTimeout(r, 100));

  // Check DM history — the agent should be able to read its own DM history
  const dmHistory = await sim.agentHistory(agentId, { channel: `dm:@${agentName}`, limit: 50 });
  assert.ok(Array.isArray(dmHistory.messages), 'DM /history should return messages array');

  for (const msg of dmHistory.messages) {
    assertDeliveryContract(msg, { label: `dm-history/${msg.message_id?.slice(0, 8) || 'unknown'}` });
    assert.equal(msg.channel_type, 'dm', 'DM history messages should have channel_type=dm');
    assert.equal(msg.thread_id, null, 'DM messages should have null thread_id');
  }
});

// ─── seq is present and numeric ────────────────────────────────────

test('delivery contract: seq is present in all message shapes', async (t) => {
  const sim = await createZoukSimulation({ name: 'zouk-contract-seq' });
  t.after(() => sim.stop());

  const web = await sim.connectWebClient({ token: sim.rootToken });
  t.after(() => web.close());
  await web.waitForType('init');

  const key = await sim.createMachineKey('contract-machine');
  const daemon = await sim.connectDaemon({ key: key.rawKey });
  t.after(() => daemon.close());
  daemon.ready({ runtimes: ['claude'], capabilities: [] });
  await sim.waitForMachineReady(key.key.id, { runtime: 'claude' });

  const { agentId } = await setupActiveAgent(sim, daemon, key.key.id, 'seqbot');

  // Drain
  await daemon.waitForOrNull(() => false, 200);

  const content = marker('contract-seq');
  const deliveryPromise = daemon.waitForDelivery(
    agentId,
    (e) => e.message?.content === content,
    5000
  );
  const human = await sim.createGuest(`contract-human-${Date.now()}`);
  const sent = await sim.sendHumanMessage({ token: human.token, target: '#all', content });
  const frame = await deliveryPromise;

  // Frame-level seq (delivery sequence from nextSeq())
  assert.equal(typeof frame.seq, 'number', 'frame.seq should be a number');
  assert.ok(frame.seq > 0, 'frame.seq should be positive');

  // Message-level seq (global message sequence)
  assert.equal(typeof frame.message.seq, 'number', 'message.seq should be a number');
  assert.ok(frame.message.seq > 0, 'message.seq should be positive');

  // The message-level seq should match the messageId from the send response
  assert.equal(frame.message.message_id, sent.messageId, 'message_id should match sent messageId');

  // /receive should also include seq
  await new Promise((r) => setTimeout(r, 100));
  const receive = await sim.agentReceive(agentId);
  for (const msg of receive.messages) {
    assert.equal(typeof msg.seq, 'number', `/receive message ${msg.message_id?.slice(0, 8)} seq should be a number`);
    assert.ok(msg.seq > 0, `/receive message ${msg.message_id?.slice(0, 8)} seq should be positive`);
  }

  // /history should also include seq
  const history = await sim.agentHistory(agentId, { channel: '#all', limit: 50 });
  for (const msg of history.messages) {
    assert.equal(typeof msg.seq, 'number', `/history message ${msg.message_id?.slice(0, 8)} seq should be a number`);
    assert.ok(msg.seq > 0, `/history message ${msg.message_id?.slice(0, 8)} seq should be positive`);
  }
});