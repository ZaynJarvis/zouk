import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// Stub ov-api before loading ov-lifecycle: capture the payloads passed to
// appendSessionMessage so we can assert parts-mode structured tool capture.
const ovApi = require('./ov-api.js');
const { createOvLifecycleManager } = require('./ov-lifecycle.js');

function makeManager(captured) {
  const orig = ovApi.appendSessionMessage;
  ovApi.appendSessionMessage = async (_creds, sessionId, payload) => {
    captured.push({ sessionId, payload });
  };
  const manager = createOvLifecycleManager({
    getAgentOvCreds: () => ({ apiKey: 'k', url: 'http://ov.local', userId: 'u', account: 'a' }),
    resolveOvUrl: () => 'http://ov.local',
  });
  return { manager, restore: () => { ovApi.appendSessionMessage = orig; } };
}

test('captureToolCalls emits a structured running tool part for a call', async () => {
  const captured = [];
  const { manager, restore } = makeManager(captured);
  try {
    await manager.captureToolCalls('agent1', [
      { kind: 'tool', toolName: 'Read', toolId: 'toolu_1', toolInput: { file_path: '/a/b' } },
    ]);
  } finally {
    restore();
  }
  assert.equal(captured.length, 1);
  const { payload } = captured[0];
  assert.equal(payload.role, 'assistant');
  assert.ok(Array.isArray(payload.parts), 'uses parts, not content');
  assert.equal(payload.content, undefined);
  assert.deepEqual(payload.parts[0], {
    type: 'tool',
    tool_id: 'toolu_1',
    tool_name: 'Read',
    tool_input: { file_path: '/a/b' },
    tool_status: 'running',
  });
});

test('captureToolCalls emits a completed result part with tool_output', async () => {
  const captured = [];
  const { manager, restore } = makeManager(captured);
  try {
    await manager.captureToolCalls('agent1', [
      { kind: 'tool', toolName: 'shell', toolId: 'c1', toolInput: { command: 'ls' } },
      { kind: 'tool_result', toolName: 'shell', toolId: 'c1', toolOutput: 'total 0', toolStatus: 'completed' },
    ]);
  } finally {
    restore();
  }
  assert.equal(captured.length, 1);
  const parts = captured[0].payload.parts;
  assert.equal(parts.length, 2);
  assert.equal(parts[0].tool_status, 'running');
  assert.deepEqual(parts[1], {
    type: 'tool',
    tool_id: 'c1',
    tool_name: 'shell',
    tool_output: 'total 0',
    tool_status: 'completed',
  });
});

test('captureToolCalls maps error result status', async () => {
  const captured = [];
  const { manager, restore } = makeManager(captured);
  try {
    await manager.captureToolCalls('agent1', [
      { kind: 'tool_result', toolName: 'shell', toolId: 'e1', toolOutput: 'boom', toolStatus: 'error' },
    ]);
  } finally {
    restore();
  }
  assert.equal(captured[0].payload.parts[0].tool_status, 'error');
});

test('captureToolCalls skips the chat send tool call but keeps its result', async () => {
  const captured = [];
  const { manager, restore } = makeManager(captured);
  try {
    await manager.captureToolCalls('agent1', [
      { kind: 'tool', toolName: 'mcp__chat__send_message', toolId: 's1', toolInput: { text: 'hi' } },
      { kind: 'tool', toolName: 'Read', toolId: 'r1', toolInput: { file_path: '/x' } },
    ]);
  } finally {
    restore();
  }
  const parts = captured[0].payload.parts;
  assert.equal(parts.length, 1, 'send call filtered out');
  assert.equal(parts[0].tool_name, 'Read');
});

test('captureToolCalls falls back to toolInputSummary when toolInput is absent', async () => {
  const captured = [];
  const { manager, restore } = makeManager(captured);
  try {
    await manager.captureToolCalls('agent1', [
      { kind: 'tool', toolName: 'legacy', toolInputSummary: '{"k":1}' },
    ]);
  } finally {
    restore();
  }
  assert.equal(captured[0].payload.parts[0].tool_input, '{"k":1}');
});
