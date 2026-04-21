#!/usr/bin/env node
/**
 * Visual QA for the image composer + lightbox feature.
 *
 * Produces four screenshots under `qa-screenshots/`:
 *   image-composer-desktop-pending.png  — composer with two pending image previews
 *   image-chat-desktop-thumbnails.png   — chat view with image attachments inline
 *   image-lightbox-desktop.png          — lightbox open on desktop
 *   image-lightbox-mobile.png           — lightbox open on iPhone-class viewport
 *
 * Attachment bytes are served via page.route() — no real server needed beyond
 * the Vite dev server.
 */

import { chromium } from 'playwright';
import { mkdirSync } from 'fs';
import { resolve } from 'path';
import zlib from 'node:zlib';
import { loadApp } from './qa-lib.mjs';

const URL = process.env.ZOUK_URL || 'http://localhost:5188';
const OUT = resolve(process.cwd(), 'qa-screenshots');
mkdirSync(OUT, { recursive: true });

// Build a PNG entirely in JS using a minimal DEFLATE + CRC32 writer so the
// script ships no binary fixtures.
function buildSolidPng(width, height, r, g, b) {
  const crcTable = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(buf) {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }
  function chunk(type, data) {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, 'ascii');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
    return Buffer.concat([len, typeBuf, data, crc]);
  }
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (width * 3 + 1);
    raw[rowStart] = 0;
    for (let x = 0; x < width; x++) {
      raw[rowStart + 1 + x * 3] = r;
      raw[rowStart + 2 + x * 3] = g;
      raw[rowStart + 3 + x * 3] = b;
    }
  }
  const idat = zlib.deflateSync(raw);
  const buf = Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
  return `data:image/png;base64,${buf.toString('base64')}`;
}

const IMG_A_DATA_URL = buildSolidPng(520, 320, 220, 60, 80);   // red-ish
const IMG_B_DATA_URL = buildSolidPng(520, 320, 60, 160, 180);  // teal-ish

const ATT_IMG_A = 'att-img-a';
const ATT_IMG_B = 'att-img-b';

function pngBufferFromDataUrl(u) {
  const base64 = u.split(',', 2)[1];
  return Buffer.from(base64, 'base64');
}

async function routeAttachments(page) {
  const bufA = pngBufferFromDataUrl(IMG_A_DATA_URL);
  const bufB = pngBufferFromDataUrl(IMG_B_DATA_URL);
  await page.route('**/api/attachments/*', (route) => {
    const url = route.request().url();
    if (url.endsWith(ATT_IMG_A)) {
      return route.fulfill({ status: 200, contentType: 'image/png', body: bufA });
    }
    if (url.endsWith(ATT_IMG_B)) {
      return route.fulfill({ status: 200, contentType: 'image/png', body: bufB });
    }
    return route.fulfill({ status: 404, body: 'not found' });
  });
}

async function seedChatWithImages(page, { withImages = true } = {}) {
  const now = Date.now();
  const baseMessages = [
    { id: 'm1', channel_name: 'all', channel_type: 'channel', sender_name: 'zaynjarvis', sender_type: 'human', content: 'Test the new image flow — drop one in.', timestamp: new Date(now - 120000).toISOString() },
    { id: 'm2', channel_name: 'all', channel_type: 'channel', sender_name: 'hela-bot', sender_type: 'agent', content: 'Ready for upload. Paste works too, per Zayn.', timestamp: new Date(now - 90000).toISOString() },
  ];
  if (withImages) {
    baseMessages.push({
      id: 'm3',
      channel_name: 'all',
      channel_type: 'channel',
      sender_name: 'QA Tester',
      sender_type: 'human',
      content: 'Here are the two shots from today:',
      timestamp: new Date(now - 30000).toISOString(),
      attachments: [
        { id: ATT_IMG_A, filename: 'hero.png', contentType: 'image/png' },
        { id: ATT_IMG_B, filename: 'detail.png', contentType: 'image/png' },
      ],
    });
  }
  return baseMessages.map((message) => ({ type: 'new_message', message }));
}

const browser = await chromium.launch();

// ── 1. Desktop composer with two pending image previews + draft text ────────
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  await routeAttachments(page);
  const extraMessages = await seedChatWithImages(page, { withImages: false });
  await loadApp(page, URL, { extraMessages });
  await page.waitForTimeout(400);

  // Drop two files into the hidden image <input>.
  const bufA = pngBufferFromDataUrl(IMG_A_DATA_URL);
  const bufB = pngBufferFromDataUrl(IMG_B_DATA_URL);
  const input = page.locator('input[type="file"][accept="image/*"]').first();
  await input.setInputFiles([
    { name: 'hero.png', mimeType: 'image/png', buffer: bufA },
    { name: 'detail.png', mimeType: 'image/png', buffer: bufB },
  ]);
  await page.locator('textarea').first().fill('two screenshots from the composer test');
  await page.waitForTimeout(300);

  const shot = resolve(OUT, 'image-composer-desktop-pending.png');
  await page.screenshot({ path: shot, fullPage: false });
  console.log('Saved:', shot);
  await ctx.close();
}

// ── 2. Desktop chat thumbnails ──────────────────────────────────────────────
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  await routeAttachments(page);
  const extraMessages = await seedChatWithImages(page, { withImages: true });
  await loadApp(page, URL, { extraMessages });
  await page.waitForTimeout(800);

  const shot = resolve(OUT, 'image-chat-desktop-thumbnails.png');
  await page.screenshot({ path: shot, fullPage: false });
  console.log('Saved:', shot);
  await ctx.close();
}

// ── 3. Desktop lightbox open ────────────────────────────────────────────────
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  await routeAttachments(page);
  const extraMessages = await seedChatWithImages(page, { withImages: true });
  await loadApp(page, URL, { extraMessages });
  await page.waitForTimeout(800);

  // Click the first image thumbnail
  const firstThumb = page.getByRole('button', { name: /Open hero\.png/ });
  await firstThumb.click();
  await page.waitForTimeout(500);

  const shot = resolve(OUT, 'image-lightbox-desktop.png');
  await page.screenshot({ path: shot, fullPage: false });
  console.log('Saved:', shot);
  await ctx.close();
}

// ── 4. Mobile lightbox (iPhone-class viewport) ──────────────────────────────
{
  const ctx = await browser.newContext({
    viewport: { width: 393, height: 852 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
  });
  const page = await ctx.newPage();
  await routeAttachments(page);
  const extraMessages = await seedChatWithImages(page, { withImages: true });
  await loadApp(page, URL, { extraMessages });
  await page.waitForTimeout(800);

  const firstThumb = page.getByRole('button', { name: /Open hero\.png/ });
  await firstThumb.click();
  await page.waitForTimeout(500);

  const shot = resolve(OUT, 'image-lightbox-mobile.png');
  await page.screenshot({ path: shot, fullPage: false });
  console.log('Saved:', shot);
  await ctx.close();
}

await browser.close();
