#!/usr/bin/env node
/**
 * Behavior check + screenshots for ImageLightbox backdrop dismiss.
 *
 *   1. Open lightbox → click backdrop corner          → expect closed
 *   2. Open lightbox → click image                    → expect still open
 *   3. Open lightbox → click X button                 → expect closed
 *   4. Open lightbox (2 imgs) → click next then prev  → expect still open, index cycles
 *   5. Open lightbox → press Escape                   → expect closed
 *   6. Mobile phone-sized image → X and backdrop still close
 *
 * Saves before / after screenshots for case 1 (the regression target).
 */

import { chromium } from 'playwright';
import { mkdirSync } from 'fs';
import { resolve } from 'path';
import zlib from 'node:zlib';
import { loadApp } from './qa-lib.mjs';

const URL = process.env.ZOUK_URL || 'http://localhost:5188';
const OUT = resolve(process.cwd(), 'qa-screenshots');
mkdirSync(OUT, { recursive: true });

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
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// Use a portrait-ish aspect so even on a desktop viewport the rendered image
// leaves obvious dark space on the left + right of the centered image — that's
// where the backdrop click needs to land.
const PNG_A = buildSolidPng(400, 800, 220, 60, 80);
const PNG_B = buildSolidPng(400, 800, 60, 160, 180);
const PNG_PHONE = buildSolidPng(393, 852, 180, 95, 60);
const ATT_A = 'att-a';
const ATT_B = 'att-b';
const ATT_PHONE = 'att-phone';

async function routeAttachments(page) {
  await page.route('**/api/attachments/*', (route) => {
    const url = route.request().url();
    if (url.endsWith(ATT_A)) return route.fulfill({ status: 200, contentType: 'image/png', body: PNG_A });
    if (url.endsWith(ATT_B)) return route.fulfill({ status: 200, contentType: 'image/png', body: PNG_B });
    if (url.endsWith(ATT_PHONE)) return route.fulfill({ status: 200, contentType: 'image/png', body: PNG_PHONE });
    return route.fulfill({ status: 404 });
  });
}

function seedTwoImageMessage() {
  const now = Date.now();
  return [
    { type: 'new_message', message: {
      id: 'm1', channel_name: 'all', channel_type: 'channel',
      sender_name: 'QA Tester', sender_type: 'human',
      content: 'two shots',
      timestamp: new Date(now - 30000).toISOString(),
      attachments: [
        { id: ATT_A, filename: 'hero.png', contentType: 'image/png', width: 400, height: 800 },
        { id: ATT_B, filename: 'detail.png', contentType: 'image/png', width: 400, height: 800 },
      ],
    } },
  ];
}

function seedPhoneSizedImageMessage() {
  const now = Date.now();
  return [
    { type: 'new_message', message: {
      id: 'm-phone', channel_name: 'all', channel_type: 'channel',
      sender_name: 'QA Tester', sender_type: 'human',
      content: 'phone-sized image',
      timestamp: new Date(now - 30000).toISOString(),
      attachments: [
        { id: ATT_PHONE, filename: 'phone-fit.png', contentType: 'image/png', width: 393, height: 852 },
      ],
    } },
  ];
}

async function openLightbox(page) {
  const thumb = page.getByRole('button', { name: /Open hero\.png/ });
  await thumb.click();
  await page.locator('[role="dialog"]').waitFor({ state: 'visible' });
  await page.waitForTimeout(200);
}

async function lightboxOpen(page) {
  return (await page.locator('[role="dialog"]').count()) > 0;
}

function assertEq(actual, expected, label) {
  if (actual !== expected) {
    console.error(`FAIL: ${label} — expected ${expected}, got ${actual}`);
    process.exitCode = 1;
  } else {
    console.log(`PASS: ${label}`);
  }
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();
await routeAttachments(page);
await loadApp(page, URL, { extraMessages: seedTwoImageMessage() });
await page.waitForTimeout(600);

// ── Case 1: click backdrop → close ──────────────────────────────────────────
await openLightbox(page);
{
  const before = resolve(OUT, 'lightbox-backdrop-before.png');
  await page.screenshot({ path: before });
  console.log('Saved:', before);
}
// Click the upper-left corner where there's clearly no image and no button.
await page.mouse.click(20, 20);
await page.waitForTimeout(250);
assertEq(await lightboxOpen(page), false, 'backdrop click closes lightbox');
{
  const after = resolve(OUT, 'lightbox-backdrop-after.png');
  await page.screenshot({ path: after });
  console.log('Saved:', after);
}

// ── Case 2: click image → stays open ────────────────────────────────────────
await openLightbox(page);
{
  const img = page.locator('[role="dialog"] img').first();
  const box = await img.boundingBox();
  // Center of the image
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(200);
  assertEq(await lightboxOpen(page), true, 'click on image does NOT close lightbox');
}

// ── Case 3: nav buttons cycle, do NOT close ─────────────────────────────────
{
  await page.getByRole('button', { name: 'Next image' }).click();
  await page.waitForTimeout(200);
  assertEq(await lightboxOpen(page), true, 'next button does NOT close');
  await page.getByRole('button', { name: 'Previous image' }).click();
  await page.waitForTimeout(200);
  assertEq(await lightboxOpen(page), true, 'prev button does NOT close');
}

// ── Case 4: X button closes ─────────────────────────────────────────────────
await page.getByRole('button', { name: 'Close image viewer' }).click();
await page.waitForTimeout(250);
assertEq(await lightboxOpen(page), false, 'X button closes lightbox');

// ── Case 5: Escape key closes ───────────────────────────────────────────────
await openLightbox(page);
await page.keyboard.press('Escape');
await page.waitForTimeout(250);
assertEq(await lightboxOpen(page), false, 'Escape closes lightbox');

await ctx.close();

// ── Case 6: mobile same-as-phone image still has reliable close paths ───────
{
  const mobileCtx = await browser.newContext({
    viewport: { width: 393, height: 852 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
  });
  const mobilePage = await mobileCtx.newPage();
  await routeAttachments(mobilePage);
  await loadApp(mobilePage, URL, { extraMessages: seedPhoneSizedImageMessage() });
  await mobilePage.waitForTimeout(600);

  const thumb = mobilePage.getByRole('button', { name: /Open phone-fit\.png/ });
  await thumb.click();
  await mobilePage.locator('[role="dialog"]').waitFor({ state: 'visible' });
  await mobilePage.waitForTimeout(250);

  const phoneShot = resolve(OUT, 'lightbox-phone-sized.png');
  await mobilePage.screenshot({ path: phoneShot });
  console.log('Saved:', phoneShot);

  await mobilePage.getByRole('button', { name: 'Close image viewer' }).click();
  await mobilePage.waitForTimeout(250);
  assertEq(await lightboxOpen(mobilePage), false, 'mobile X closes phone-sized lightbox');

  await thumb.click();
  await mobilePage.locator('[role="dialog"]').waitFor({ state: 'visible' });
  await mobilePage.waitForTimeout(250);
  await mobilePage.mouse.click(6, 846);
  await mobilePage.waitForTimeout(250);
  assertEq(await lightboxOpen(mobilePage), false, 'mobile backdrop remains tappable for phone-sized image');

  await mobileCtx.close();
}

await browser.close();

if (process.exitCode === 1) {
  console.error('\nOne or more lightbox dismiss cases FAILED.');
  process.exit(1);
}
console.log('\nAll lightbox dismiss cases PASSED.');
