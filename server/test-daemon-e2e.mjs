#!/usr/bin/env node
/**
 * Full-stack daemon e2e tests using the REAL zouk-daemon with the mock runtime.
 *
 * These tests exercise the same code paths as a production daemon: WebSocket
 * connection to /daemon/connect, ready handshake, agent:start spawn, mock
 * runtime driver, MCP tool calls for check_messages/send_message, delivery
 * acks, and agent status/activity broadcasts.
 *
 * Prerequisites: a built zouk-daemon at ../zouk-daemon/dist/index.js (or set
 * ZOUK_DAEMON_BIN). Tests SKIP (not fail) when the daemon binary is missing
 * so CI (which has no daemon checkout) stays green.
 *
 * Run: node --test server/test-daemon-e2e.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createZoukSimulation } from './test-support/zouk-simulation.mjs';
import {
  isRealDaemonAvailable,
  startRealDaemon,
  writeMockBehavior,
} from './test-support/zouk-real-daemon.mjs';

function marker(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function makeTempDir(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `zouk-${label}-`));
}

// ── Test 1: default behavior (no behavior file → "ack:" reply) ──────────

test('daemon-e2e: real daemon + mock runtime replies with default "ack:" behavior', async (t) => {
  if (!isRealDaemonAvailable()) {
    t.skip('zouk-daemon binary not found (set ZOUK_DAEMON_BIN or build ../zouk-daemon)');
    return;
  }

  const sim = await createZoukSimulation({ name: 'zouk-sim-daemon-default' });
  t.after(() => sim.stop());

  const key = await sim.createMachineKey('daemon-default-machine');
  const machineId = key.key.id;

  const daemon = await startRealDaemon(sim, {
    machineKey: key.rawKey,
    hostname: 'test-daemon-default',
    env: {
      // Speed up agent spawn rate-limiting for tests
      ZOUK_DAEMON_AGENT_START_INTERVAL_MS: '0',
      ZOUK_DAEMON_MAX_CONCURRENT_AGENT_STARTS: '10',
    },
  });
  t.after(() => daemon.stop());

  // Wait for the daemon to register with the mock runtime advertised
  const machine = await sim.waitForMachineReady(machineId, { runtime: 'mock', timeoutMs: 8000 });
  assert.ok(machine, `machine should appear with mock runtime. daemon stderr:\n${daemon.stderr}`);
  assert.ok(machine.runtimes?.includes('mock'), 'machine should advertise mock runtime');

  // Prepare agent work directory
  const agentWorkDir = makeTempDir('agent-default');
  t.after(() => { try { fs.rmSync(agentWorkDir, { recursive: true, force: true }); } catch { /* ignore */ } });

  // Create and start agent
  const agentName = `daemon-default-bot-${Date.now().toString(36)}`;
  const agentId = `agent-${agentName}`;

  await sim.createAgentConfig({
    id: agentId,
    name: agentName,
    displayName: agentName,
    machineId,
    workDir: agentWorkDir,
  });

  await sim.setAgentSubscription(agentId, { channelName: 'all', canRead: true, subscribed: true });

  const started = await sim.startAgent({
    agentId,
    name: agentName,
    displayName: agentName,
    runtime: 'mock',
    machineId,
    workDir: agentWorkDir,
  });
  assert.equal(started.status, 'starting', `agent should enter starting state. daemon stderr:\n${daemon.stderr}`);

  // Wait for agent to become active (daemon reports status via agent:status)
  await sim.waitUntil(async () => {
    try {
      const { agents } = await sim.get(`/internal/agent/${encodeURIComponent(agentId)}/server`);
      return agents.some((a) => a.name === agentName && a.status === 'active');
    } catch {
      return false;
    }
  }, `agent ${agentName} active`, 15_000);

  // Send a human message and wait for the agent's default "ack:" reply
  const human = await sim.createGuest(`daemon-default-human-${Date.now()}`);
  const question = marker('daemon-default-hello');
  await sim.sendHumanMessage({ token: human.token, target: '#all', content: question });

  const expectedReply = `ack: ${question}`;
  const reply = await sim.waitUntil(async () => {
    const history = await sim.getMessages({ channel: '#all', limit: 20 });
    return history.messages.find(
      (m) => m.senderType === 'agent' && m.content === expectedReply,
    );
  }, `agent reply "ack: ${question}"`, 20_000);

  assert.ok(reply, `Expected agent reply "${expectedReply}". daemon stderr:\n${daemon.stderr}`);
  assert.equal(reply.senderName, agentName, 'reply should come from the agent');
});

// ── Test 2: custom behavior rules (ping → pong) ─────────────────────────

test('daemon-e2e: mock runtime respects custom behavior rules', async (t) => {
  if (!isRealDaemonAvailable()) {
    t.skip('zouk-daemon binary not found');
    return;
  }

  const sim = await createZoukSimulation({ name: 'zouk-sim-daemon-rules' });
  t.after(() => sim.stop());

  const key = await sim.createMachineKey('daemon-rules-machine');
  const machineId = key.key.id;

  const daemon = await startRealDaemon(sim, {
    machineKey: key.rawKey,
    hostname: 'test-daemon-rules',
    env: {
      ZOUK_DAEMON_AGENT_START_INTERVAL_MS: '0',
      ZOUK_DAEMON_MAX_CONCURRENT_AGENT_STARTS: '10',
    },
  });
  t.after(() => daemon.stop());

  await sim.waitForMachineReady(machineId, { runtime: 'mock', timeoutMs: 8000 });

  // Prepare agent work dir with custom behavior
  const agentWorkDir = makeTempDir('agent-rules');
  t.after(() => { try { fs.rmSync(agentWorkDir, { recursive: true, force: true }); } catch { /* ignore */ } });

  writeMockBehavior(agentWorkDir, {
    defaultDelayMs: 20,
    rules: [
      { match: 'ping', reply: 'pong {{sender}}', delayMs: 20 },
    ],
    fallbackReply: 'roger: {{content}}',
    contextUsagePerTurnPct: 1,
  });

  const agentName = `daemon-rules-bot-${Date.now().toString(36)}`;
  const agentId = `agent-${agentName}`;

  await sim.createAgentConfig({
    id: agentId,
    name: agentName,
    displayName: agentName,
    machineId,
    workDir: agentWorkDir,
  });

  await sim.setAgentSubscription(agentId, { channelName: 'all', canRead: true, subscribed: true });

  await sim.startAgent({
    agentId,
    name: agentName,
    displayName: agentName,
    runtime: 'mock',
    machineId,
    workDir: agentWorkDir,
  });

  await sim.waitUntil(async () => {
    try {
      const { agents } = await sim.get(`/internal/agent/${encodeURIComponent(agentId)}/server`);
      return agents.some((a) => a.name === agentName && a.status === 'active');
    } catch {
      return false;
    }
  }, `agent ${agentName} active`, 15_000);

  // Send "ping" — should trigger the rule
  const human = await sim.createGuest(`daemon-rules-human-${Date.now()}`);
  const humanName = human.user.name;
  await sim.sendHumanMessage({ token: human.token, target: '#all', content: 'ping' });

  const expectedReply = `pong ${humanName}`;
  const reply = await sim.waitUntil(async () => {
    const history = await sim.getMessages({ channel: '#all', limit: 20 });
    return history.messages.find(
      (m) => m.senderType === 'agent' && m.content === expectedReply,
    );
  }, `agent reply "${expectedReply}"`, 20_000);

  assert.ok(reply, `Expected agent reply "${expectedReply}". daemon stderr:\n${daemon.stderr}`);
  assert.equal(reply.senderName, agentName);

  // Also verify the fallback works for non-matching messages
  const fallbackQuestion = marker('daemon-rules-fallback');
  await sim.sendHumanMessage({ token: human.token, target: '#all', content: fallbackQuestion });

  const expectedFallback = `roger: ${fallbackQuestion}`;
  const fallbackReply = await sim.waitUntil(async () => {
    const history = await sim.getMessages({ channel: '#all', limit: 30 });
    return history.messages.find(
      (m) => m.senderType === 'agent' && m.content === expectedFallback,
    );
  }, `agent fallback reply "${expectedFallback}"`, 20_000);

  assert.ok(fallbackReply, `Expected fallback "${expectedFallback}". daemon stderr:\n${daemon.stderr}`);
});

// ── Test 3: web client sees agent status/activity events ────────────────

test('daemon-e2e: web client receives agent status and activity events', async (t) => {
  if (!isRealDaemonAvailable()) {
    t.skip('zouk-daemon binary not found');
    return;
  }

  const sim = await createZoukSimulation({ name: 'zouk-sim-daemon-web' });
  t.after(() => sim.stop());

  // Connect a web client early so it doesn't miss events
  const web = await sim.connectWebClient({ token: sim.rootToken });
  t.after(() => web.close());
  await web.waitForType('init');

  const key = await sim.createMachineKey('daemon-web-machine');
  const machineId = key.key.id;

  const daemon = await startRealDaemon(sim, {
    machineKey: key.rawKey,
    hostname: 'test-daemon-web',
    env: {
      ZOUK_DAEMON_AGENT_START_INTERVAL_MS: '0',
      ZOUK_DAEMON_MAX_CONCURRENT_AGENT_STARTS: '10',
    },
  });
  t.after(() => daemon.stop());

  await sim.waitForMachineReady(machineId, { runtime: 'mock', timeoutMs: 8000 });

  const agentWorkDir = makeTempDir('agent-web');
  t.after(() => { try { fs.rmSync(agentWorkDir, { recursive: true, force: true }); } catch { /* ignore */ } });

  writeMockBehavior(agentWorkDir, {
    defaultDelayMs: 10,
    rules: [],
    fallbackReply: 'got it: {{content}}',
    contextUsagePerTurnPct: 1,
  });

  const agentName = `daemon-web-bot-${Date.now().toString(36)}`;
  const agentId = `agent-${agentName}`;

  // Watch for agent_started event
  const startedEvent = web.waitFor(
    (event) => event.type === 'agent_started' && event.agent?.name === agentName,
    10_000,
  );

  await sim.createAgentConfig({
    id: agentId,
    name: agentName,
    displayName: agentName,
    machineId,
    workDir: agentWorkDir,
  });

  await sim.setAgentSubscription(agentId, { channelName: 'all', canRead: true, subscribed: true });

  await sim.startAgent({
    agentId,
    name: agentName,
    displayName: agentName,
    runtime: 'mock',
    machineId,
    workDir: agentWorkDir,
  });

  const started = await startedEvent;
  assert.ok(started, `web client should see agent_started event. daemon stderr:\n${daemon.stderr}`);
  assert.ok(['starting', 'active'].includes(started.agent.status), 'agent_started should carry starting or active status');

  // Watch for agent_status active (daemon reports this when the process is running)
  const activeStatus = web.waitFor(
    (event) => event.type === 'agent_status' && event.agentId === agentId && event.status === 'active',
    15_000,
  );

  const active = await activeStatus;
  assert.ok(active, `web client should see agent_status=active. daemon stderr:\n${daemon.stderr}`);

  // Send a message and verify the reply lands via web broadcast
  const human = await sim.createGuest(`daemon-web-human-${Date.now()}`);
  const question = 'hello web agent';

  const replyBroadcast = web.waitFor(
    (event) => event.type === 'message' && event.message?.senderType === 'agent',
    15_000,
  );

  await sim.sendHumanMessage({ token: human.token, target: '#all', content: question });

  const reply = await replyBroadcast;
  assert.ok(reply, `web client should see the agent reply broadcast. daemon stderr:\n${daemon.stderr}`);
  assert.match(reply.message.content, /^got it: hello web agent/, 'reply should match fallback template');
  assert.equal(reply.message.senderName, agentName, 'reply should come from the agent');
});

// ── Test 4: seen-cursor / send-freshness with real daemon ───────────────

test('daemon-e2e: caught-up agent does not get held on second send', async (t) => {
  if (!isRealDaemonAvailable()) {
    t.skip('zouk-daemon binary not found');
    return;
  }

  const sim = await createZoukSimulation({ name: 'zouk-sim-daemon-freshness' });
  t.after(() => sim.stop());

  const key = await sim.createMachineKey('daemon-freshness-machine');
  const machineId = key.key.id;

  const daemon = await startRealDaemon(sim, {
    machineKey: key.rawKey,
    hostname: 'test-daemon-freshness',
    env: {
      ZOUK_DAEMON_AGENT_START_INTERVAL_MS: '0',
      ZOUK_DAEMON_MAX_CONCURRENT_AGENT_STARTS: '10',
    },
  });
  t.after(() => daemon.stop());

  await sim.waitForMachineReady(machineId, { runtime: 'mock', timeoutMs: 8000 });

  const agentWorkDir = makeTempDir('agent-freshness');
  t.after(() => { try { fs.rmSync(agentWorkDir, { recursive: true, force: true }); } catch { /* ignore */ } });

  // Agent replies to everything with "echo: {{content}}"
  writeMockBehavior(agentWorkDir, {
    defaultDelayMs: 10,
    rules: [],
    fallbackReply: 'echo: {{content}}',
    contextUsagePerTurnPct: 1,
  });

  const agentName = `daemon-fresh-bot-${Date.now().toString(36)}`;
  const agentId = `agent-${agentName}`;

  await sim.createAgentConfig({
    id: agentId,
    name: agentName,
    displayName: agentName,
    machineId,
    workDir: agentWorkDir,
  });

  await sim.setAgentSubscription(agentId, { channelName: 'all', canRead: true, subscribed: true });

  await sim.startAgent({
    agentId,
    name: agentName,
    displayName: agentName,
    runtime: 'mock',
    machineId,
    workDir: agentWorkDir,
  });

  await sim.waitUntil(async () => {
    try {
      const { agents } = await sim.get(`/internal/agent/${encodeURIComponent(agentId)}/server`);
      return agents.some((a) => a.name === agentName && a.status === 'active');
    } catch {
      return false;
    }
  }, `agent ${agentName} active`, 15_000);

  // First message → agent replies (this advances its seen cursor via check_messages MCP call)
  const human = await sim.createGuest(`daemon-fresh-human-${Date.now()}`);
  const firstMsg = marker('daemon-fresh-first');
  await sim.sendHumanMessage({ token: human.token, target: '#all', content: firstMsg });

  await sim.waitUntil(async () => {
    const history = await sim.getMessages({ channel: '#all', limit: 20 });
    return history.messages.some(
      (m) => m.senderType === 'agent' && m.content === `echo: ${firstMsg}`,
    );
  }, `agent reply to first message`, 20_000);

  // Second message → agent should be able to reply without hold since it's caught up
  const secondMsg = marker('daemon-fresh-second');
  await sim.sendHumanMessage({ token: human.token, target: '#all', content: secondMsg });

  const secondReply = await sim.waitUntil(async () => {
    const history = await sim.getMessages({ channel: '#all', limit: 30 });
    return history.messages.find(
      (m) => m.senderType === 'agent' && m.content === `echo: ${secondMsg}`,
    );
  }, `agent reply to second message (no hold)`, 20_000);

  assert.ok(secondReply, `Agent should reply to second message without hold. daemon stderr:\n${daemon.stderr}`);

  // Verify the agent's server view shows it as caught up (no stale state)
  const serverView = await sim.get(`/internal/agent/${encodeURIComponent(agentId)}/server`);
  const agentEntry = serverView.agents?.find((a) => a.name === agentName);
  assert.ok(agentEntry, 'agent should appear in server view');
  assert.equal(agentEntry.status, 'active', 'agent should still be active');
});
