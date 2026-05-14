import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createStore } = require('./profilePresets.js');

async function withStore(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'zouk-profile-presets-'));
  try {
    const store = createStore({ filePath: join(dir, 'presets.json') });
    return await fn(store);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const imageA = 'data:image/png;base64,aaa';
const imageB = 'data:image/png;base64,bbb';

test('profile presets list default plus workspace-local presets for custom workspaces', async () => {
  await withStore(async (store) => {
    const defaultAdd = await store.add(imageA, 'default');
    const customAdd = await store.add(imageB, 'custom-workspace');

    assert.equal(defaultAdd.error, undefined);
    assert.equal(customAdd.error, undefined);

    assert.deepEqual(store.list('default'), [{
      id: defaultAdd.preset.id,
      workspaceId: 'default',
      image: imageA,
      shared: false,
    }]);

    assert.deepEqual(store.list('custom-workspace'), [
      {
        id: defaultAdd.preset.id,
        workspaceId: 'default',
        image: imageA,
        shared: true,
      },
      {
        id: customAdd.preset.id,
        workspaceId: 'custom-workspace',
        image: imageB,
        shared: false,
      },
    ]);
  });
});

test('profile presets cannot delete shared default presets from custom workspaces', async () => {
  await withStore(async (store) => {
    const defaultAdd = await store.add(imageA, 'default');
    const customAdd = await store.add(imageB, 'custom-workspace');

    assert.deepEqual(await store.remove(defaultAdd.preset.id, 'custom-workspace'), { error: 'Preset not found' });
    assert.equal(store.list('custom-workspace').length, 2);

    assert.deepEqual(await store.remove(customAdd.preset.id, 'custom-workspace'), { success: true });
    assert.deepEqual(store.list('custom-workspace'), [{
      id: defaultAdd.preset.id,
      workspaceId: 'default',
      image: imageA,
      shared: true,
    }]);
  });
});
