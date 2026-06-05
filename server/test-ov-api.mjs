import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ovApi = require('./ov-api.js');

// Stub global.fetch to capture the request without touching the network.
function captureFetch() {
  const calls = [];
  const orig = global.fetch;
  global.fetch = async (url, opts) => {
    calls.push({ url, opts });
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ status: 'ok', result: {} }),
    };
  };
  return { calls, restore: () => { global.fetch = orig; } };
}

// Identity is always derived from the Bearer key; the X-OpenViking-* headers
// are never sent regardless of peerEnabled (zouk is always non-trusted mode).
const PEER_CREDS = { url: 'http://ov.local', apiKey: 'bearer-key', account: 'acc', user: 'usr', agent: 'agent1', peerEnabled: true };
const LEGACY_CREDS = { url: 'http://ov.local', apiKey: 'bearer-key', account: 'acc', user: 'usr', agent: 'agent1' };

function assertNoIdentityHeaders(headers) {
  assert.equal(headers['Authorization'], 'Bearer bearer-key', 'Bearer auth retained');
  assert.equal(headers['X-OpenViking-Account'], undefined);
  assert.equal(headers['X-OpenViking-User'], undefined);
  assert.equal(headers['X-OpenViking-Agent'], undefined);
}

test('ovCall never sends X-OpenViking identity headers (peer on)', async () => {
  const { calls, restore } = captureFetch();
  try {
    await ovApi.appendSessionMessage(PEER_CREDS, 'sess', { role: 'user', content: 'hi' });
  } finally {
    restore();
  }
  assertNoIdentityHeaders(calls[0].opts.headers);
});

test('ovCall never sends X-OpenViking identity headers (peer off)', async () => {
  const { calls, restore } = captureFetch();
  try {
    await ovApi.appendSessionMessage(LEGACY_CREDS, 'sess', { role: 'user', content: 'hi' });
  } finally {
    restore();
  }
  assertNoIdentityHeaders(calls[0].opts.headers);
});

test('appendSessionMessage sets peer_id on the body when provided', async () => {
  const { calls, restore } = captureFetch();
  try {
    await ovApi.appendSessionMessage(PEER_CREDS, 'sess', { role: 'user', content: 'hi', peerId: 'alice' });
  } finally {
    restore();
  }
  const body = JSON.parse(calls[0].opts.body);
  assert.equal(body.peer_id, 'alice');
  assert.equal(body.role, 'user');
  assert.equal(body.content, 'hi');
});

test('appendSessionMessage omits peer_id when not provided', async () => {
  const { calls, restore } = captureFetch();
  try {
    await ovApi.appendSessionMessage(PEER_CREDS, 'sess', { role: 'assistant', content: 'ok' });
  } finally {
    restore();
  }
  const body = JSON.parse(calls[0].opts.body);
  assert.equal('peer_id' in body, false);
});

test('commitSession sends memory_policy when provided', async () => {
  const { calls, restore } = captureFetch();
  const policy = { self: { enabled: true }, peer: { enabled: true } };
  try {
    await ovApi.commitSession(PEER_CREDS, 'sess', { memoryPolicy: policy });
  } finally {
    restore();
  }
  const body = JSON.parse(calls[0].opts.body);
  assert.deepEqual(body.memory_policy, policy);
});

test('commitSession sends an empty body when no memory_policy', async () => {
  const { calls, restore } = captureFetch();
  try {
    await ovApi.commitSession(LEGACY_CREDS, 'sess', {});
  } finally {
    restore();
  }
  assert.deepEqual(JSON.parse(calls[0].opts.body), {});
});
