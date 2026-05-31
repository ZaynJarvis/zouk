#!/usr/bin/env node
/**
 * Unit tests for server/ov-proxy.js. The OV proxy runs behind Cloudflare on
 * Zouk and then calls an OpenViking origin that is also behind Cloudflare; it
 * must not forward client/proxy identity headers between those two hops.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { buildUpstreamHeaders } = require('./ov-proxy.js');

test('buildUpstreamHeaders strips Cloudflare and forwarding chain headers', () => {
  const headers = buildUpstreamHeaders({
    accept: 'application/json',
    authorization: 'Bearer agent-token',
    'content-type': 'application/json',
    'user-agent': 'zouk-test',
    host: 'zouk.zaynjarvis.com',
    connection: 'keep-alive',
    'transfer-encoding': 'chunked',
    'cf-connecting-ip': '203.0.113.10',
    'cf-ray': 'a03c4afa0dabfd9a-SIN',
    'cf-visitor': '{"scheme":"https"}',
    'cf-ipcountry': 'SG',
    'cdn-loop': 'cloudflare',
    forwarded: 'for=203.0.113.10;proto=https',
    'x-forwarded-for': '203.0.113.10',
    'x-forwarded-host': 'zouk.zaynjarvis.com',
    'x-forwarded-proto': 'https',
    'x-real-ip': '203.0.113.10',
    'true-client-ip': '203.0.113.10',
  });

  assert.deepEqual(headers, {
    accept: 'application/json',
    authorization: 'Bearer agent-token',
    'content-type': 'application/json',
    'user-agent': 'zouk-test',
  });
});
