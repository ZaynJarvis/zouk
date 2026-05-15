#!/usr/bin/env node

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { allocateWorkspaceId, normalizeWorkspaceId } = require('./workspaceIds.js');

test('normalizeWorkspaceId preserves route-safe Unicode names', () => {
  assert.equal(normalizeWorkspaceId('中文 服务'), '中文-服务');
  assert.equal(normalizeWorkspaceId(encodeURIComponent('中文 服务')), '中文-服务');
  assert.equal(normalizeWorkspaceId(' 研发/测试 '), '研发-测试');
  assert.equal(normalizeWorkspaceId('Server Name'), 'server-name');
  assert.equal(normalizeWorkspaceId('🐱'), 'default');
});

test('allocateWorkspaceId keeps Unicode bases and suffixes duplicates', () => {
  const existing = new Set(['中文-服务', '中文-服务-2']);
  const id = allocateWorkspaceId('中文 服务', value => existing.has(value));
  assert.equal(id, '中文-服务-3');
});
