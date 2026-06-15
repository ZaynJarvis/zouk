import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// Stub ov-api before loading ov-lifecycle: capture the payloads passed to
// appendSessionMessage so we can assert parts-mode structured tool capture.
const ovApi = require('./ov-api.js');
const { createOvLifecycleManager } = require('./ov-lifecycle.js');

function makeManager(captured, { creds, commits } = {}) {
  const origAppend = ovApi.appendSessionMessage;
  const origCommit = ovApi.commitSession;
  const origGet = ovApi.getSession;
  ovApi.appendSessionMessage = async (_creds, sessionId, payload) => {
    captured.push({ sessionId, payload });
  };
  ovApi.commitSession = async (_creds, sessionId, opts = {}) => {
    if (commits) commits.push({ sessionId, opts });
  };
  // autoCapture fires a best-effort autoCommit; stub getSession so it returns
  // early (null) instead of hitting the network during these unit tests.
  ovApi.getSession = async () => null;
  const manager = createOvLifecycleManager({
    getAgentOvCreds: () => creds || { apiKey: 'k', url: 'http://ov.local', userId: 'u', account: 'a' },
    resolveOvUrl: () => 'http://ov.local',
  });
  return {
    manager,
    restore: () => {
      ovApi.appendSessionMessage = origAppend;
      ovApi.commitSession = origCommit;
      ovApi.getSession = origGet;
    },
  };
}

const PEER_CREDS = { apiKey: 'k', url: 'http://ov.local', userId: 'u', account: 'a', peerEnabled: true };
const NON_PEER_CREDS = { apiKey: 'k', url: 'http://ov.local', userId: 'u', account: 'a' };

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

// ─── Peer contract (workspace peerEnabled) ──────────────────────────

test('autoCapture tags the incoming message with peer_id when peer is enabled', async () => {
  const captured = [];
  const { manager, restore } = makeManager(captured, { creds: PEER_CREDS });
  try {
    await manager.autoCapture('agent1', 'hello there', null, { senderName: 'alice', senderType: 'human' });
  } finally {
    restore();
  }
  // ov-api (stubbed here) is what renames peerId → peer_id on the wire; at the
  // lifecycle boundary we assert the camelCase field the manager hands off.
  assert.equal(captured.length, 1);
  assert.equal(captured[0].payload.role, 'user');
  assert.equal(captured[0].payload.peerId, 'alice');
});

test('autoCapture omits peer_id when peer is disabled', async () => {
  const captured = [];
  const { manager, restore } = makeManager(captured, { creds: NON_PEER_CREDS });
  try {
    await manager.autoCapture('agent1', 'hello', null, { senderName: 'alice', senderType: 'human' });
  } finally {
    restore();
  }
  assert.equal(captured[0].payload.peerId, undefined);
});

test('autoCapture converges out-of-charset peer_id to [a-zA-Z0-9_.@-]', async () => {
  const charset = /^[a-zA-Z0-9_.@-]+$/;
  // [input displayName, expected peer_id] — path separators, spaces, '+', and
  // non-ASCII all fold to '-'; allowed chars (_ . @ -) survive untouched.
  const cases = [
    ['a/b\\c', 'a-b-c'],            // path separators no longer cross namespaces
    ['Renamed Reviewer', 'Renamed-Reviewer'], // self-chosen name with a space
    ['user+tag', 'user-tag'],       // '+' is a valid email local-part char, not in charset
    ['guest-Bob', 'guest-Bob'],     // common guest name passes through unchanged
    ['name_.@-ok', 'name_.@-ok'],   // every allowed punctuation survives
    ['  spaced  ', 'spaced'],       // edge whitespace folds then trims away
  ];
  for (const [input, expected] of cases) {
    const captured = [];
    const { manager, restore } = makeManager(captured, { creds: PEER_CREDS });
    try {
      await manager.autoCapture('agent1', 'hi', null, { senderName: input, senderType: 'human' });
    } finally {
      restore();
    }
    assert.equal(captured[0].payload.peerId, expected, `peerId for ${JSON.stringify(input)}`);
    assert.match(captured[0].payload.peerId, charset, `charset for ${JSON.stringify(input)}`);
  }
});

test('autoCapture omits peer_id for a name with no representable character', async () => {
  // An all-non-ASCII name collapses to empty → undefined, so the message is left
  // untagged instead of mapped to a colliding '-' placeholder.
  const captured = [];
  const { manager, restore } = makeManager(captured, { creds: PEER_CREDS });
  try {
    await manager.autoCapture('agent1', 'hi', null, { senderName: '张三', senderType: 'human' });
  } finally {
    restore();
  }
  assert.equal(captured[0].payload.peerId, undefined);
});

test('the agent reply (self) carries no peer_id even when peer is enabled', async () => {
  const captured = [];
  const { manager, restore } = makeManager(captured, { creds: PEER_CREDS });
  try {
    await manager.autoCapture('agent1', null, 'sure, done', { agentName: 'bot', senderType: 'agent' });
  } finally {
    restore();
  }
  assert.equal(captured.length, 1);
  assert.equal(captured[0].payload.role, 'assistant');
  assert.equal(captured[0].payload.peerId, undefined);
});

test('force commitSession sends peer memory_policy when enabled', async () => {
  const commits = [];
  const { manager, restore } = makeManager([], { creds: PEER_CREDS, commits });
  try {
    await manager.commitSession('agent1');
  } finally {
    restore();
  }
  assert.equal(commits.length, 1);
  assert.deepEqual(commits[0].opts.memoryPolicy, { self: { enabled: true }, peer: { enabled: true } });
});

test('force commitSession sends no memory_policy when disabled', async () => {
  const commits = [];
  const { manager, restore } = makeManager([], { creds: NON_PEER_CREDS, commits });
  try {
    await manager.commitSession('agent1');
  } finally {
    restore();
  }
  assert.equal(commits.length, 1);
  assert.equal(commits[0].opts.memoryPolicy, undefined);
});
