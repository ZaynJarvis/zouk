// Tests for attachment prune: verify that pruneOlderThan respects protectedIds
// so blobs referenced by messages are never silently deleted.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const require = createRequire(import.meta.url);
const { createStorage } = require('./storage.js');

function makeTempDir(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `zouk-attach-prune-${label}-`));
}

function backdateMeta(dir, id, daysAgo) {
  const metaPath = path.join(dir, `${id}.meta.json`);
  const raw = fs.readFileSync(metaPath, 'utf8');
  const meta = JSON.parse(raw);
  const past = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
  meta.createdAt = past.toISOString();
  fs.writeFileSync(metaPath, JSON.stringify(meta));
  return meta;
}

const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;

test('pruneOlderThan: removes old blobs, keeps recent ones', async () => {
  const dir = makeTempDir('basic');
  const storage = createStorage(dir);

  // Put two blobs
  const idOld = 'old-blob';
  const idNew = 'new-blob';
  await storage.put(idOld, Buffer.from('old content'), { filename: 'old.txt', contentType: 'text/plain' });
  await storage.put(idNew, Buffer.from('new content'), { filename: 'new.txt', contentType: 'text/plain' });

  // Backdate the old one to 20 days ago
  backdateMeta(dir, idOld, 20);

  assert.equal(storage.existsSync(idOld), true, 'old blob exists before prune');
  assert.equal(storage.existsSync(idNew), true, 'new blob exists before prune');

  const removed = await storage.pruneOlderThan(FOURTEEN_DAYS_MS);
  assert.equal(removed, 1, 'one blob removed');

  assert.equal(storage.existsSync(idOld), false, 'old blob removed');
  assert.equal(storage.existsSync(idNew), true, 'new blob kept');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('pruneOlderThan: skips protected ids even if old', async () => {
  const dir = makeTempDir('protected');
  const storage = createStorage(dir);

  // Put three blobs: two old, one new
  const idOld1 = 'old-protected';
  const idOld2 = 'old-unprotected';
  const idNew = 'new-blob';
  await storage.put(idOld1, Buffer.from('old protected'), { filename: 'p.txt', contentType: 'text/plain' });
  await storage.put(idOld2, Buffer.from('old unprotected'), { filename: 'u.txt', contentType: 'text/plain' });
  await storage.put(idNew, Buffer.from('new'), { filename: 'n.txt', contentType: 'text/plain' });

  // Backdate both old ones to 20 days
  backdateMeta(dir, idOld1, 20);
  backdateMeta(dir, idOld2, 20);

  // Prune, protecting idOld1
  const protectedIds = new Set([idOld1]);
  const removed = await storage.pruneOlderThan(FOURTEEN_DAYS_MS, { protectedIds });

  assert.equal(removed, 1, 'only unprotected old blob removed');
  assert.equal(storage.existsSync(idOld1), true, 'protected old blob kept');
  assert.equal(storage.existsSync(idOld2), false, 'unprotected old blob removed');
  assert.equal(storage.existsSync(idNew), true, 'new blob kept');

  // Verify sidecar of protected blob is still present
  const meta = storage.statSync(idOld1);
  assert.ok(meta, 'protected blob meta still readable');
  assert.equal(meta.filename, 'p.txt');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('pruneOlderThan: empty protectedIds set behaves the same as no option', async () => {
  const dir = makeTempDir('empty-protected');
  const storage = createStorage(dir);

  const idOld = 'old';
  await storage.put(idOld, Buffer.from('data'), { filename: 'f.txt', contentType: 'text/plain' });
  backdateMeta(dir, idOld, 20);

  const removed = await storage.pruneOlderThan(FOURTEEN_DAYS_MS, { protectedIds: new Set() });
  assert.equal(removed, 1, 'old blob removed with empty protected set');
  assert.equal(storage.existsSync(idOld), false);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('pruneOlderThan: missing meta falls back to file mtime', async () => {
  const dir = makeTempDir('no-meta');
  const storage = createStorage(dir);

  const idOrphan = 'orphan-blob';
  // Write a blob directly without a sidecar
  const blobPath = path.join(dir, idOrphan);
  fs.writeFileSync(blobPath, 'orphan content');
  // Set mtime to 20 days ago
  const oldTime = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000);
  fs.utimesSync(blobPath, oldTime, oldTime);

  assert.equal(storage.existsSync(idOrphan), true, 'orphan blob exists');

  const removed = await storage.pruneOlderThan(FOURTEEN_DAYS_MS);
  assert.equal(removed, 1, 'orphan blob removed via mtime fallback');
  assert.equal(storage.existsSync(idOrphan), false, 'orphan blob gone');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('collectInMemoryAttachmentRefs: extracts ids from message attachments', async () => {
  // We can't easily import the index.js helpers (they live in a CJS module
  // with heavy side effects), so replicate the extraction logic inline to
  // verify the shape assumption: msg.attachments is an array of {id,...}
  // objects, or raw strings.
  function attachmentIdsFromMessage(msg) {
    if (!msg || !Array.isArray(msg.attachments)) return [];
    return msg.attachments
      .map((a) => (typeof a === "string" ? a : a?.id))
      .filter(Boolean);
  }

  const msg1 = { attachments: [{ id: 'a1', filename: 'x.txt' }, { id: 'a2', filename: 'y.png' }] };
  const msg2 = { attachments: ['raw-id-1', 'raw-id-2'] };
  const msg3 = { attachments: [] };
  const msg4 = {};

  assert.deepEqual(attachmentIdsFromMessage(msg1), ['a1', 'a2']);
  assert.deepEqual(attachmentIdsFromMessage(msg2), ['raw-id-1', 'raw-id-2']);
  assert.deepEqual(attachmentIdsFromMessage(msg3), []);
  assert.deepEqual(attachmentIdsFromMessage(msg4), []);
});
