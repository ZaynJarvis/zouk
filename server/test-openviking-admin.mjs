#!/usr/bin/env node
/**
 * Unit tests for server/openviking-admin.js — the per-agent key provisioning
 * client. Mocks global fetch so we can assert request shape and error handling
 * without contacting a real OpenViking server.
 */

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { provisionAgentKey, revokeAgentKey } = require('./openviking-admin.js');

const realFetch = globalThis.fetch;
let calls = [];

beforeEach(() => {
  calls = [];
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

function mockOk(body) {
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return {
      ok: true,
      status: 200,
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
  };
}

function mockErr(status, text) {
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return {
      ok: false,
      status,
      json: async () => { throw new Error('not json'); },
      text: async () => text,
    };
  };
}

test('provisionAgentKey: posts to /admin/accounts/{acct}/users with X-Api-Key', async () => {
  mockOk({ status: 'ok', result: { user_key: 'k_xyz', user_id: 'zouk-abc', account_id: 'acct1' } });

  const out = await provisionAgentKey({
    url: 'https://ov.example.com',
    account: 'acct1',
    rootApiKey: 'root_key',
    agentId: 'zouk-abc',
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://ov.example.com/api/v1/admin/accounts/acct1/users');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers['X-Api-Key'], 'root_key');
  assert.equal(calls[0].init.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(calls[0].init.body), { user_id: 'zouk-abc', role: 'user' });

  assert.equal(out.user_key, 'k_xyz');
  assert.equal(out.user_id, 'zouk-abc');
});

test('provisionAgentKey: throws on non-2xx with body excerpt', async () => {
  mockErr(409, '{"status":"error","error":{"code":"already_exists","message":"user_id exists"}}');

  await assert.rejects(
    () => provisionAgentKey({ url: 'https://ov', account: 'a', rootApiKey: 'k', agentId: 'u' }),
    /OV admin 409/,
  );
});

test('provisionAgentKey: throws when response is missing user_key', async () => {
  mockOk({ status: 'ok', result: { user_id: 'zouk-abc' } }); // no user_key

  await assert.rejects(
    () => provisionAgentKey({ url: 'https://ov', account: 'a', rootApiKey: 'k', agentId: 'u' }),
    /missing user_key/,
  );
});

test('provisionAgentKey: throws when status is not ok', async () => {
  mockOk({ status: 'error', result: null });
  await assert.rejects(
    () => provisionAgentKey({ url: 'https://ov', account: 'a', rootApiKey: 'k', agentId: 'u' }),
    /status=error/,
  );
});

test('provisionAgentKey: account_id is URL-encoded', async () => {
  mockOk({ status: 'ok', result: { user_key: 'k', user_id: 'u', account_id: 'team/a' } });
  await provisionAgentKey({
    url: 'https://ov',
    account: 'team/a',
    rootApiKey: 'k',
    agentId: 'u',
  });
  assert.match(calls[0].url, /\/accounts\/team%2Fa\/users$/);
});

test('revokeAgentKey: DELETE with X-Api-Key on the right URL', async () => {
  mockOk({ status: 'ok' });
  await revokeAgentKey({
    url: 'https://ov',
    account: 'acct1',
    rootApiKey: 'root_key',
    agentId: 'zouk-abc',
  });
  assert.equal(calls[0].init.method, 'DELETE');
  assert.equal(calls[0].url, 'https://ov/api/v1/admin/accounts/acct1/users/zouk-abc');
  assert.equal(calls[0].init.headers['X-Api-Key'], 'root_key');
});
