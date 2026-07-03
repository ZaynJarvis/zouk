#!/usr/bin/env node
/**
 * Agent inbox/check_messages contract tests.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createZoukSimulation } from './test-support/zouk-simulation.mjs';

function marker(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

test('inbox: a newly registered agent starts unread from current seq, not channel history', async (t) => {
  const sim = await createZoukSimulation({ name: 'zouk-sim-agent-inbox' });
  t.after(() => sim.stop());

  const key = await sim.createMachineKey('inbox-machine');
  const daemon = await sim.connectDaemon({ key: key.rawKey });
  t.after(() => daemon.close());
  daemon.ready({ runtimes: ['claude'], capabilities: [] });
  await sim.waitForMachineReady(key.key.id, { runtime: 'claude' });

  const human = await sim.createGuest(`inbox-human-${Date.now()}`);
  const oldContent = marker('old-before-agent');
  await sim.sendHumanMessage({ token: human.token, target: '#all', content: oldContent });

  const agentId = `agent-inbox-${Date.now().toString(16)}`;
  await sim.createAgentConfig({
    id: agentId,
    name: `inbox-${Date.now().toString(16)}`,
    displayName: 'Inbox Test Agent',
    machineId: key.key.id,
  });
  await sim.setAgentSubscription(agentId, { channelName: 'all', canRead: true, subscribed: true });

  const initialInbox = await sim.agentReceive(agentId);
  assert.deepEqual(initialInbox.messages, [], 'old channel history must not be returned as unread');

  const newContent = marker('new-after-agent');
  await sim.sendHumanMessage({ token: human.token, target: '#all', content: newContent });

  const nextInbox = await sim.agentReceive(agentId);
  assert.ok(nextInbox.messages.some((m) => m.content === newContent), 'new message should be returned');
  assert.ok(!nextInbox.messages.some((m) => m.content === oldContent), 'old history should stay out of inbox');
});
