#!/usr/bin/env node
/**
 * Ready-race owner-guard test.
 *
 * Reproduces the single-machine ready-race where:
 *   (a) daemon A owns an agent (status active), daemon B connects and sends
 *       ready with the same agent in runningAgents while A is still OPEN —
 *       the server must NOT re-bind to B; deliveries still reach A.
 *   (b) daemon A closes, daemon B sends ready with runningAgents — the server
 *       must re-bind to B (daemon-swap case, existing behavior).
 *
 * Run:
 *   node --test server/test-ready-race.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createZoukSimulation } from './test-support/zouk-simulation.mjs';

function marker(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

test('ready-race: live daemon A blocks adoption by daemon B via ready runningAgents', async (t) => {
  const sim = await createZoukSimulation({ name: 'zouk-ready-race' });
  t.after(() => sim.stop());

  const web = await sim.connectWebClient({ token: sim.rootToken });
  t.after(() => web.close());
  await web.waitForType('init');

  // Single machine key so both daemons resolve to the same machineId.
  const key = await sim.createMachineKey('ready-race-machine');
  const agentId = `agent-rr-${Date.now().toString(16)}`;

  // Create agent config bound to this machine.
  await sim.createAgentConfig({
    id: agentId,
    name: 'readyrace',
    displayName: 'Ready Race',
    machineId: key.key.id,
    autoStart: false,
  });

  // Subscribe agent to #all so it receives channel messages.
  await sim.setAgentSubscription(agentId, { channelName: 'all', canRead: true, subscribed: true });

  // --- Daemon A connects and readies ---
  const daemonA = await sim.connectDaemon({ key: key.rawKey });
  t.after(() => daemonA.close());
  daemonA.ready({ runtimes: ['claude'], runningAgents: [] });
  await sim.waitForMachineReady(key.key.id, { runtime: 'claude' });

  // Start the agent on daemon A explicitly.
  const startOnA = daemonA.waitForStart(agentId, 4000);
  const started = await sim.startAgent({
    agentId,
    name: 'readyrace',
    displayName: 'Ready Race',
    runtime: 'claude',
    model: 'sonnet',
    machineId: key.key.id,
  });
  assert.equal(started.agentId, agentId);
  const startFrameA = await startOnA;
  assert.ok(startFrameA, 'daemon A should receive agent:start');

  // Mark agent active via daemon A so the server considers A the owner.
  const activePromise = web.waitFor(
    (ev) => ev.type === 'agent_status' && ev.agentId === agentId && ev.status === 'active',
    3000,
  );
  daemonA.agentStatus(agentId, { status: 'active', runtime: 'claude', model: 'sonnet' });
  await activePromise;

  // Drain any startup/system delivery backlog.
  await sim.agentReceive(agentId);

  // --- Daemon B connects and sends ready with the same agent in runningAgents ---
  const daemonB = await sim.connectDaemon({ key: key.rawKey });
  t.after(() => daemonB.close());

  // B should NOT receive an agent:start for this agent because A is live owner.
  const bStart = daemonB.waitForOrNull(
    (ev) => ev.type === 'agent:start' && ev.agentId === agentId,
    2000,
  );
  daemonB.ready({ runtimes: ['claude'], runningAgents: [agentId] });
  const prematureStart = await bStart;
  assert.equal(prematureStart, null, 'daemon B must NOT receive agent:start while A is live owner');

  // --- Deliver a message; it must reach A, not B ---
  const alice = await sim.createGuest(`ready-race-human-${Date.now()}`);
  const content = marker('ready-race-msg');
  const deliveryOnA = daemonA.waitForDelivery(agentId, (ev) => ev.message?.content === content, 4000);
  const deliveryOnB = daemonB.waitForOrNull(
    (ev) => ev.type === 'agent:deliver' && ev.agentId === agentId && ev.message?.content === content,
    2000,
  );
  await sim.sendHumanMessage({ token: alice.token, target: '#all', content });

  const deliveredA = await deliveryOnA;
  assert.ok(deliveredA, 'daemon A should receive the delivery (it is the live owner)');
  const deliveredB = await deliveryOnB;
  assert.equal(deliveredB, null, 'daemon B must NOT receive the delivery while A is live');

  // Cleanup
  daemonB.close();
  daemonA.close();
});

test('ready-race: daemon-swap rebind works when A closes and B sends ready', async (t) => {
  const sim = await createZoukSimulation({ name: 'zouk-ready-swap' });
  t.after(() => sim.stop());

  const web = await sim.connectWebClient({ token: sim.rootToken });
  t.after(() => web.close());
  await web.waitForType('init');

  const key = await sim.createMachineKey('swap-machine');
  const agentId = `agent-rs-${Date.now().toString(16)}`;

  await sim.createAgentConfig({
    id: agentId,
    name: 'readyswap',
    displayName: 'Ready Swap',
    machineId: key.key.id,
    autoStart: false,
  });

  // Subscribe agent to #all.
  await sim.setAgentSubscription(agentId, { channelName: 'all', canRead: true, subscribed: true });

  // --- Daemon A starts the agent ---
  const daemonA = await sim.connectDaemon({ key: key.rawKey });
  daemonA.ready({ runtimes: ['claude'], runningAgents: [] });
  await sim.waitForMachineReady(key.key.id, { runtime: 'claude' });

  const startOnA = daemonA.waitForStart(agentId, 4000);
  await sim.startAgent({
    agentId,
    name: 'readyswap',
    displayName: 'Ready Swap',
    runtime: 'claude',
    model: 'sonnet',
    machineId: key.key.id,
  });
  await startOnA;

  const activeOnA = web.waitFor(
    (ev) => ev.type === 'agent_status' && ev.agentId === agentId && ev.status === 'active',
    3000,
  );
  daemonA.agentStatus(agentId, { status: 'active', runtime: 'claude', model: 'sonnet' });
  await activeOnA;

  // Drain startup backlog.
  await sim.agentReceive(agentId);

  // --- Daemon B connects (same machine) without claiming the agent ---
  const daemonB = await sim.connectDaemon({ key: key.rawKey });
  t.after(() => daemonB.close());
  daemonB.ready({ runtimes: ['claude'], runningAgents: [] });

  // B should not get agent:start yet (agent is active on A, autoStart skips it).
  const bPremature = daemonB.waitForOrNull(
    (ev) => ev.type === 'agent:start' && ev.agentId === agentId,
    1500,
  );
  const noStart = await bPremature;
  assert.equal(noStart, null, 'daemon B must not get agent:start while agent is active on A');

  // --- Daemon A closes: server clears the binding and marks agent inactive ---
  const agentInactive = web.waitFor(
    (ev) => ev.type === 'agent_status' && ev.agentId === agentId && ev.status === 'inactive',
    3000,
  );
  await daemonA.close();
  await agentInactive;

  // --- Now daemon B sends ready WITH the agent in runningAgents.
  //     The server must adopt it (no live owner to block). ---
  const agentStarted = web.waitFor(
    (ev) => ev.type === 'agent_started' && ev.agent?.id === agentId,
    4000,
  );
  daemonB.ready({ runtimes: ['claude'], runningAgents: [agentId] });
  await agentStarted;

  // Mark agent active via B so delivery routing works.
  daemonB.agentStatus(agentId, { status: 'active', runtime: 'claude', model: 'sonnet' });
  await web.waitFor(
    (ev) => ev.type === 'agent_status' && ev.agentId === agentId && ev.status === 'active',
    3000,
  );

  // --- Deliver a message; it must reach B now ---
  const alice = await sim.createGuest(`ready-swap-human-${Date.now()}`);
  const content = marker('ready-swap-msg');
  const deliveryOnB = daemonB.waitForDelivery(agentId, (ev) => ev.message?.content === content, 4000);
  await sim.sendHumanMessage({ token: alice.token, target: '#all', content });
  const delivered = await deliveryOnB;
  assert.ok(delivered, 'daemon B should receive the delivery after swap rebind');

  daemonB.close();
});
