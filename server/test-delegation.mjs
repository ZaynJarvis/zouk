#!/usr/bin/env node
/**
 * Delegation and directory enrichment tests.
 *
 * (1) Agent cards: directory endpoint returns per-agent name, displayName,
 *     description, runtime/model, status, activity, claimedTasks, and channels.
 * (2) Delegate with result contract: agent A creates task with assignee B,
 *     B receives DM mentioning task #N, task is pre-claimed, B marks done
 *     triggers A's completion DM.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createZoukSimulation } from './test-support/zouk-simulation.mjs';

function marker(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

// ─── Directory enrichment (agent cards) ────────────────────────────

test('directory: agent cards include description, runtime, model, claimedTasks, and channels', async (t) => {
  const sim = await createZoukSimulation({ name: 'zouk-sim-directory' });
  t.after(() => sim.stop());

  const web = await sim.connectWebClient({ token: sim.rootToken });
  t.after(() => web.close());
  await web.waitForType('init');

  const key = await sim.createMachineKey('dir-machine');
  const daemon = await sim.connectDaemon({ key: key.rawKey });
  t.after(() => daemon.close());
  daemon.ready({ runtimes: ['claude'] });
  await sim.waitForMachineReady(key.key.id, { runtime: 'claude' });

  // Create two agents with descriptions
  const agentA = `agent-dir-a-${Date.now().toString(16)}`;
  const agentB = `agent-dir-b-${Date.now().toString(16)}`;

  await sim.createAgentConfig({
    id: agentA,
    name: 'diralpha',
    displayName: 'Dir Alpha',
    description: 'Frontend specialist: React, TypeScript, UI design',
    machineId: key.key.id,
    runtime: 'claude',
    model: 'sonnet',
  });
  await sim.createAgentConfig({
    id: agentB,
    name: 'dirbeta',
    displayName: 'Dir Beta',
    description: 'Backend specialist: Node.js, PostgreSQL, APIs',
    machineId: key.key.id,
    runtime: 'claude',
    model: 'opus',
  });

  // Start both agents
  const startAPromise = daemon.waitForStart(agentA);
  await sim.startAgent({ agentId: agentA, name: 'diralpha', displayName: 'Dir Alpha', runtime: 'claude', model: 'sonnet', machineId: key.key.id });
  await startAPromise;
  const activeAPromise = web.waitFor((e) => e.type === 'agent_status' && e.agentId === agentA && e.status === 'active');
  daemon.agentStatus(agentA, { status: 'active', runtime: 'claude', model: 'sonnet' });
  await activeAPromise;

  const startBPromise = daemon.waitForStart(agentB);
  await sim.startAgent({ agentId: agentB, name: 'dirbeta', displayName: 'Dir Beta', runtime: 'claude', model: 'opus', machineId: key.key.id });
  await startBPromise;
  const activeBPromise = web.waitFor((e) => e.type === 'agent_status' && e.agentId === agentB && e.status === 'active');
  daemon.agentStatus(agentB, { status: 'active', runtime: 'claude', model: 'opus' });
  await activeBPromise;

  // Subscribe agent A to #all and #engineering
  await sim.setAgentSubscription(agentA, { channelName: 'all', canRead: true, subscribed: true });

  // Have agent A claim a task
  await sim.post(`/internal/agent/${agentA}/tasks`, {
    channel: '#all',
    tasks: [{ title: 'Build the dashboard UI' }],
  });
  const tasksList = await sim.get(`/internal/agent/${agentA}/tasks?channel=%23all`);
  const createdTask = tasksList.tasks.find((t) => t.title === 'Build the dashboard UI');
  assert.ok(createdTask, 'task should be created');
  await sim.post(`/internal/agent/${agentA}/tasks/claim`, {
    channel: '#all',
    task_numbers: [createdTask.taskNumber],
    message_ids: [],
  });

  // Set activity for agent A
  daemon.agentActivity(agentA, { activity: 'working', detail: 'Implementing dashboard components' });

  // Now call the directory endpoint as agent A
  const directory = await sim.get(`/internal/agent/${agentA}/server`);

  // Verify agent A's card
  const agentACard = directory.agents.find((a) => a.name === 'diralpha');
  assert.ok(agentACard, 'agent A should appear in directory');
  assert.equal(agentACard.displayName, 'Dir Alpha', 'should include displayName');
  assert.equal(agentACard.description, 'Frontend specialist: React, TypeScript, UI design', 'should include description');
  assert.equal(agentACard.runtime, 'claude', 'should include runtime');
  assert.equal(agentACard.model, 'sonnet', 'should include model');
  assert.equal(agentACard.status, 'active', 'should include status');
  assert.equal(agentACard.activity, 'working', 'should include activity');
  assert.equal(agentACard.activityDetail, 'Implementing dashboard components', 'should include activity detail');
  assert.ok(Array.isArray(agentACard.claimedTasks), 'claimedTasks should be an array');
  assert.ok(agentACard.claimedTasks.some((t) => t.title === 'Build the dashboard UI'), 'should include claimed task');
  assert.ok(Array.isArray(agentACard.channels), 'channels should be an array');
  assert.ok(agentACard.channels.includes('all'), 'should list subscribed channel #all');

  // Verify agent B's card
  const agentBCard = directory.agents.find((a) => a.name === 'dirbeta');
  assert.ok(agentBCard, 'agent B should appear in directory');
  assert.equal(agentBCard.displayName, 'Dir Beta', 'B should include displayName');
  assert.equal(agentBCard.description, 'Backend specialist: Node.js, PostgreSQL, APIs', 'B should include description');
  assert.equal(agentBCard.runtime, 'claude', 'B should include runtime');
  assert.equal(agentBCard.model, 'opus', 'B should include model');
  assert.equal(agentBCard.status, 'active', 'B should include status');
  assert.equal(agentBCard.claimedTasks.length, 0, 'B should have no claimed tasks');
});

// ─── Delegate with result contract ─────────────────────────────────

test('delegation: agent A creates task with assignee B → B gets DM, B marks done → A gets notified', async (t) => {
  const sim = await createZoukSimulation({ name: 'zouk-sim-delegation' });
  t.after(() => sim.stop());

  const web = await sim.connectWebClient({ token: sim.rootToken });
  t.after(() => web.close());
  await web.waitForType('init');

  const key = await sim.createMachineKey('del-machine');
  const daemon = await sim.connectDaemon({ key: key.rawKey });
  t.after(() => daemon.close());
  daemon.ready({ runtimes: ['claude'] });
  await sim.waitForMachineReady(key.key.id, { runtime: 'claude' });

  // Create two agents
  const agentA = `agent-del-a-${Date.now().toString(16)}`;
  const agentB = `agent-del-b-${Date.now().toString(16)}`;

  await sim.createAgentConfig({
    id: agentA,
    name: 'delalpha',
    displayName: 'Del Alpha',
    machineId: key.key.id,
    runtime: 'claude',
    model: 'sonnet',
  });
  await sim.createAgentConfig({
    id: agentB,
    name: 'delbeta',
    displayName: 'Del Beta',
    machineId: key.key.id,
    runtime: 'claude',
    model: 'sonnet',
  });

  // Start agent A
  const startAPromise = daemon.waitForStart(agentA);
  await sim.startAgent({ agentId: agentA, name: 'delalpha', displayName: 'Del Alpha', runtime: 'claude', model: 'sonnet', machineId: key.key.id });
  await startAPromise;
  const activeAPromise = web.waitFor((e) => e.type === 'agent_status' && e.agentId === agentA && e.status === 'active');
  daemon.agentStatus(agentA, { status: 'active', runtime: 'claude', model: 'sonnet' });
  await activeAPromise;

  // Start agent B
  const startBPromise = daemon.waitForStart(agentB);
  await sim.startAgent({ agentId: agentB, name: 'delbeta', displayName: 'Del Beta', runtime: 'claude', model: 'sonnet', machineId: key.key.id });
  await startBPromise;
  const activeBPromise = web.waitFor((e) => e.type === 'agent_status' && e.agentId === agentB && e.status === 'active');
  daemon.agentStatus(agentB, { status: 'active', runtime: 'claude', model: 'sonnet' });
  await activeBPromise;

  // Subscribe both to #all
  await sim.setAgentSubscription(agentA, { channelName: 'all', canRead: true, subscribed: true });
  await sim.setAgentSubscription(agentB, { channelName: 'all', canRead: true, subscribed: true });

  // Drain initial deliveries
  await sim.agentReceive(agentA);
  await sim.agentReceive(agentB);

  // ── Step 1: Agent A creates a task assigned to agent B ──
  const taskTitle = marker('delegated-task');

  // Watch for B's delivery of the assignment DM
  const bDeliveryPromise = daemon.waitForDelivery(agentB, (event) => {
    const msg = event.message;
    return msg?.channel_type === 'dm' && msg?.content?.includes(taskTitle);
  }, 5000);

  const created = await sim.post(`/internal/agent/${agentA}/tasks`, {
    channel: '#all',
    tasks: [{ title: taskTitle }],
    assignee: 'delbeta',
  });

  assert.ok(created.tasks?.length > 0, 'should create at least one task');
  const createdTask = created.tasks[0];
  assert.equal(createdTask.assignedTo, 'delbeta', 'response should indicate assignee');
  const taskNum = createdTask.taskNumber;
  assert.ok(taskNum > 0, 'task should have a number');

  // ── Step 2: Verify B received the assignment DM ──
  const bDelivery = await bDeliveryPromise;
  assert.ok(bDelivery, 'B should receive a delivery about the assigned task');
  assert.ok(bDelivery.message.content.includes(`#${taskNum}`), `DM should mention task #${taskNum}`);
  assert.ok(bDelivery.message.content.includes(taskTitle), 'DM should mention the task title');
  assert.equal(bDelivery.message.channel_type, 'dm', 'assignment should be a DM');
  assert.equal(bDelivery.message.sender_name, 'delalpha', 'DM should come from agent A');
  // Ack the delivery so the seen cursor advances
  daemon.deliverAck(agentB, bDelivery.seq);

  // ── Step 3: Verify task is pre-claimed by B ──
  const tasksAfterCreate = await sim.get(`/internal/agent/${agentB}/tasks?channel=%23all`);
  const bTask = tasksAfterCreate.tasks.find((t) => t.taskNumber === taskNum);
  assert.ok(bTask, 'task should be visible to B');
  assert.equal(bTask.claimedByName, 'delbeta', 'task should be pre-claimed by B');
  assert.equal(bTask.status, 'in_progress', 'task status should be in_progress');

  // Also verify via the directory endpoint that B shows the claimed task
  const dirAfter = await sim.get(`/internal/agent/${agentA}/server`);
  const bCard = dirAfter.agents.find((a) => a.name === 'delbeta');
  assert.ok(bCard.claimedTasks.some((t) => t.taskNumber === taskNum && t.status === 'in_progress'), 'directory should show B has the task in_progress');

  // ── Step 4: Agent B marks task done ──
  // Watch for A's delivery of the completion notification
  const aDeliveryPromise = daemon.waitForDelivery(agentA, (event) => {
    const msg = event.message;
    return msg?.channel_type === 'dm'
      && msg?.content?.includes(`#${taskNum}`)
      && msg?.content?.includes('done');
  }, 5000);

  await sim.post(`/internal/agent/${agentB}/tasks/update-status`, {
    task_number: taskNum,
    status: 'done',
  });

  // ── Step 5: Verify A received the completion DM ──
  const aDelivery = await aDeliveryPromise;
  assert.ok(aDelivery, 'A should receive a delivery about task completion');
  assert.ok(aDelivery.message.content.includes(`#${taskNum}`), `completion DM should mention task #${taskNum}`);
  assert.ok(aDelivery.message.content.includes('done'), 'completion DM should mention "done"');
  assert.equal(aDelivery.message.channel_type, 'dm', 'completion notification should be a DM');
  assert.equal(aDelivery.message.sender_name, 'delbeta', 'completion DM should come from agent B');
  daemon.deliverAck(agentA, aDelivery.seq);

  // ── Step 6: Verify final task state ──
  const finalTasks = await sim.get(`/internal/agent/${agentA}/tasks?channel=%23all`);
  const finalTask = finalTasks.tasks.find((t) => t.taskNumber === taskNum);
  assert.equal(finalTask.status, 'done', 'task should be done');
});

test('delegation: assignee not found returns 404', async (t) => {
  const sim = await createZoukSimulation({ name: 'zouk-sim-del-404' });
  t.after(() => sim.stop());

  const key = await sim.createMachineKey('del404-machine');
  const daemon = await sim.connectDaemon({ key: key.rawKey });
  t.after(() => daemon.close());
  daemon.ready({ runtimes: ['claude'] });
  await sim.waitForMachineReady(key.key.id, { runtime: 'claude' });

  const agentA = `agent-del-404-${Date.now().toString(16)}`;
  await sim.createAgentConfig({
    id: agentA,
    name: 'del404alpha',
    displayName: 'Del 404 Alpha',
    machineId: key.key.id,
    runtime: 'claude',
    model: 'sonnet',
  });

  const startPromise = daemon.waitForStart(agentA);
  await sim.startAgent({ agentId: agentA, name: 'del404alpha', displayName: 'Del 404 Alpha', runtime: 'claude', model: 'sonnet', machineId: key.key.id });
  await startPromise;
  daemon.agentStatus(agentA, { status: 'active', runtime: 'claude', model: 'sonnet' });

  const result = await sim.json('POST', `/internal/agent/${agentA}/tasks`, {
    body: { channel: '#all', tasks: [{ title: 'test' }], assignee: 'nonexistent' },
  });
  assert.equal(result.status, 404, 'should return 404 for unknown assignee');
  assert.ok(result.body?.error?.includes('assignee_not_found'), 'error should mention assignee_not_found');
});

test('delegation: create without assignee still works (backward compat)', async (t) => {
  const sim = await createZoukSimulation({ name: 'zouk-sim-del-compat' });
  t.after(() => sim.stop());

  const key = await sim.createMachineKey('delcompat-machine');
  const daemon = await sim.connectDaemon({ key: key.rawKey });
  t.after(() => daemon.close());
  daemon.ready({ runtimes: ['claude'] });
  await sim.waitForMachineReady(key.key.id, { runtime: 'claude' });

  const agentA = `agent-del-compat-${Date.now().toString(16)}`;
  await sim.createAgentConfig({
    id: agentA,
    name: 'delcompatalpha',
    displayName: 'Del Compat Alpha',
    machineId: key.key.id,
    runtime: 'claude',
    model: 'sonnet',
  });

  const startPromise = daemon.waitForStart(agentA);
  await sim.startAgent({ agentId: agentA, name: 'delcompatalpha', displayName: 'Del Compat Alpha', runtime: 'claude', model: 'sonnet', machineId: key.key.id });
  await startPromise;
  daemon.agentStatus(agentA, { status: 'active', runtime: 'claude', model: 'sonnet' });

  const created = await sim.post(`/internal/agent/${agentA}/tasks`, {
    channel: '#all',
    tasks: [{ title: 'unassigned task' }],
  });

  assert.ok(created.tasks?.length > 0);
  assert.equal(created.tasks[0].assignedTo, null, 'no assignee should return null');
  const taskNum = created.tasks[0].taskNumber;

  const tasks = await sim.get(`/internal/agent/${agentA}/tasks?channel=%23all`);
  const task = tasks.tasks.find((t) => t.taskNumber === taskNum);
  assert.equal(task.status, 'todo', 'unassigned task should be todo');
  assert.equal(task.claimedByName, null, 'unassigned task should not be claimed');
});
