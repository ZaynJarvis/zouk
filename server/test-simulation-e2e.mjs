#!/usr/bin/env node
/**
 * Zouk simulation e2e contract tests.
 *
 * These tests exercise the reusable sandbox API in
 * server/test-support/zouk-simulation.mjs. They intentionally avoid preview
 * mock data: each test creates the users, machine keys, agents, daemon sockets,
 * and messages it needs.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createZoukSimulation } from './test-support/zouk-simulation.mjs';

function marker(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

test('simulation: human message writes channel history and broadcasts to web clients', async (t) => {
  const sim = await createZoukSimulation({ name: 'zouk-sim-human' });
  t.after(() => sim.stop());

  const alice = await sim.createGuest(`sim-alice-${Date.now()}`);
  assert.ok(alice.token, 'guest session should return an auth token');
  assert.equal(alice.user.name.startsWith('guest-sim-alice-'), true);

  const web = await sim.connectWebClient({ token: alice.token });
  t.after(() => web.close());
  const init = await web.waitForType('init');
  assert.equal(init.workspaceId, 'default');
  assert.ok(init.channels.some((channel) => channel.name === 'all'), 'init should expose #all');

  const content = marker('sim-human-message');
  const broadcastPromise = web.waitFor((event) => (
    event.type === 'message' && event.message?.content === content
  ));
  const sent = await sim.sendHumanMessage({ token: alice.token, target: '#all', content });

  assert.equal(sent.messageId, sent.message.id);
  assert.equal(sent.message.content, content);
  assert.equal(sent.message.channelName, 'all');
  assert.equal(sent.message.senderName, alice.user.name);

  const broadcast = await broadcastPromise;
  assert.equal(broadcast.message.messageId, sent.messageId);
  assert.equal(broadcast.message.senderName, alice.user.name);

  const history = await sim.getMessages({ channel: '#all', limit: 10 });
  assert.ok(
    history.messages.some((message) => message.messageId === sent.messageId && message.content === content),
    'sent message should be readable from channel history',
  );
});

test('simulation: agent internal APIs cover receive, send, history, and search', async (t) => {
  const sim = await createZoukSimulation({ name: 'zouk-sim-agent-api' });
  t.after(() => sim.stop());

  const key = await sim.createMachineKey('agent-api-machine');
  const agentId = `agent-sim-api-${Date.now().toString(16)}`;
  const created = await sim.createAgentConfig({
    id: agentId,
    name: 'simapi',
    displayName: 'Sim API',
    machineId: key.key.id,
  });
  assert.equal(created.config.id, agentId);

  await sim.setAgentSubscription(agentId, { channelName: 'all', canRead: true, subscribed: true });
  await sim.agentReceive(agentId); // drain any startup/system backlog

  const alice = await sim.createGuest(`agent-api-human-${Date.now()}`);
  const inbound = marker('sim-agent-inbound');
  await sim.sendHumanMessage({ token: alice.token, target: '#all', content: inbound });

  const inbox = await sim.agentReceive(agentId);
  assert.ok(
    inbox.messages.some((message) => (
      message.content === inbound
      && message.channel_name === 'all'
      && message.sender_name === alice.user.name
    )),
    'agent receive API should expose readable channel messages',
  );

  const reply = marker('sim-agent-reply');
  const sent = await sim.agentSend(agentId, { target: '#all', content: reply });
  assert.ok(sent.messageId, 'agent send API should return a message id');

  const history = await sim.agentHistory(agentId, { channel: '#all', limit: 20 });
  assert.ok(
    history.messages.some((message) => (
      message.message_id === sent.messageId
      && message.content === reply
      && message.sender_name === 'simapi'
    )),
    'agent history API should include the agent-authored reply',
  );

  const search = await sim.agentSearch(agentId, { q: reply, limit: 5 });
  assert.ok(
    search.results.some((message) => message.messageId === sent.messageId && message.content === reply),
    'agent search API should find visible messages by content',
  );
});

test('simulation: daemon lifecycle drives agent start, activity, push delivery, and stop', async (t) => {
  const sim = await createZoukSimulation({ name: 'zouk-sim-daemon' });
  t.after(() => sim.stop());

  const web = await sim.connectWebClient({ token: sim.rootToken });
  t.after(() => web.close());
  await web.waitForType('init');

  const key = await sim.createMachineKey('daemon-machine');
  const daemon = await sim.connectDaemon({ key: key.rawKey });
  t.after(() => daemon.close());
  daemon.ready({ runtimes: ['claude'], capabilities: ['workspace_fs'] });
  const machine = await sim.waitForMachineReady(key.key.id, { runtime: 'claude' });
  assert.equal(machine.id, key.key.id);
  assert.deepEqual(machine.runtimes, ['claude']);

  const agentId = `agent-sim-runner-${Date.now().toString(16)}`;
  const startFramePromise = daemon.waitForStart(agentId);
  const started = await sim.startAgent({
    agentId,
    name: 'simrunner',
    displayName: 'Sim Runner',
    runtime: 'claude',
    model: 'sonnet',
    machineId: key.key.id,
  });
  assert.deepEqual(started, { agentId, status: 'starting' });

  const startFrame = await startFramePromise;
  assert.equal(startFrame.config.name, 'simrunner');
  assert.equal(startFrame.config.serverUrl, sim.baseUrl);
  assert.match(startFrame.config.authToken, /^sat_/);
  assert.ok(startFrame.toolDefinitions.length > 0, 'agent:start should include tool definitions');

  const activePromise = web.waitFor((event) => (
    event.type === 'agent_status'
    && event.agentId === agentId
    && event.status === 'active'
  ));
  daemon.agentStatus(agentId, { status: 'active', runtime: 'claude', model: 'sonnet' });
  await activePromise;

  const activityPromise = web.waitFor((event) => (
    event.type === 'agent_activity'
    && event.agentId === agentId
    && event.activity === 'working'
  ));
  daemon.agentActivity(agentId, { activity: 'working', detail: 'simulation turn' });
  const activity = await activityPromise;
  assert.equal(activity.detail, 'simulation turn');

  const alice = await sim.createGuest(`daemon-human-${Date.now()}`);
  const inbound = marker('sim-daemon-delivery');
  const deliveryPromise = daemon.waitForDelivery(agentId, (event) => event.message?.content === inbound);
  const sent = await sim.sendHumanMessage({ token: alice.token, target: '#all', content: inbound });
  const delivery = await deliveryPromise;
  assert.equal(delivery.message.message_id, sent.messageId);
  assert.equal(delivery.message.sender_name, alice.user.name);
  daemon.deliverAck(agentId, delivery.seq);

  const stopFramePromise = daemon.waitForStop(agentId);
  await sim.stopAgent(agentId);
  const stopFrame = await stopFramePromise;
  assert.equal(stopFrame.agentId, agentId);

  const inactivePromise = web.waitFor((event) => (
    event.type === 'agent_status'
    && event.agentId === agentId
    && event.status === 'inactive'
  ));
  daemon.agentStatus(agentId, { status: 'inactive' });
  await inactivePromise;
});
