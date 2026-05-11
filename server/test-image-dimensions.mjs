// Tests for server/imageDimensions.js. Uses synthetic byte buffers so we
// don't depend on real image fixtures sitting in the repo.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { extractImageDimensions } = require('./imageDimensions.js');

function pngOf(width, height) {
  // Minimal PNG: 8-byte signature + IHDR chunk header + width/height + IHDR
  // tail (depth/color/...). Only the first 24 bytes are inspected.
  const buf = Buffer.alloc(40);
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < 8; i++) buf[i] = sig[i];
  // IHDR length = 13
  buf.writeUInt32BE(13, 8);
  buf.write('IHDR', 12, 'ascii');
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return buf;
}

function jpegOf(width, height) {
  // SOI(FFD8) + SOF0 marker (FFC0) with len(2)=11, precision(1)=8, height(2),
  // width(2), components(1)=3, then EOI.
  const buf = Buffer.alloc(24);
  buf[0] = 0xff; buf[1] = 0xd8;     // SOI
  buf[2] = 0xff; buf[3] = 0xc0;     // SOF0
  buf.writeUInt16BE(11, 4);          // segment length
  buf[6] = 0x08;                     // precision
  buf.writeUInt16BE(height, 7);
  buf.writeUInt16BE(width, 9);
  buf[11] = 0x03;                    // components
  return buf;
}

function gifOf(width, height) {
  const buf = Buffer.alloc(16);
  buf.write('GIF89a', 0, 'ascii');
  buf.writeUInt16LE(width, 6);
  buf.writeUInt16LE(height, 8);
  return buf;
}

test('PNG: extracts width/height from IHDR', () => {
  const buf = pngOf(800, 600);
  assert.deepEqual(extractImageDimensions(buf, 'image/png'), { width: 800, height: 600 });
});

test('JPEG: extracts width/height from SOF0', () => {
  const buf = jpegOf(1920, 1080);
  assert.deepEqual(extractImageDimensions(buf, 'image/jpeg'), { width: 1920, height: 1080 });
});

test('GIF: extracts width/height from logical screen header', () => {
  const buf = gifOf(320, 240);
  assert.deepEqual(extractImageDimensions(buf, 'image/gif'), { width: 320, height: 240 });
});

test('mismatched content-type falls back to magic-byte probe', () => {
  const buf = pngOf(100, 200);
  // Caller lied about contentType — we should still detect PNG.
  assert.deepEqual(extractImageDimensions(buf, 'image/jpeg'), { width: 100, height: 200 });
});

test('unsupported buffer returns null', () => {
  assert.equal(extractImageDimensions(Buffer.alloc(8), 'image/heic'), null);
  assert.equal(extractImageDimensions(null, 'image/png'), null);
  assert.equal(extractImageDimensions(undefined, 'image/png'), null);
});
