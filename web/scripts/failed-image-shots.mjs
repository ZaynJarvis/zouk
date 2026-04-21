#!/usr/bin/env node
/**
 * Visual QA for the failed-image fix: every image render swaps to a
 * border-only empty box when the src fails to load (no icon / filename /
 * broken-image glyph).
 *
 * Output under web/qa-screenshots/failed-image/:
 *   message-thumb-failed.png   — inline thumbnail with a broken src
 *   lightbox-failed.png        — full-screen lightbox with a broken src
 *   composer-preview-failed.png — pending-image preview with a broken src
 */

import { chromium } from 'playwright';
import { mkdirSync } from 'fs';
import { resolve } from 'path';
import { loadApp } from './qa-lib.mjs';

const URL = process.env.ZOUK_URL || 'http://127.0.0.1:5199';
const OUT = resolve(process.cwd(), 'qa-screenshots/failed-image');
mkdirSync(OUT, { recursive: true });

const now = Date.now();

// A broken attachment id — the /api/attachments/<id> endpoint 404s, so the
// <img> onError fires and FailableImage renders the empty box fallback.
const BROKEN_ID = 'attachment-does-not-exist-999';

const seedMessages = [
  {
    id: 'msg-plain',
    channel_name: 'all',
    channel_type: 'channel',
    sender_name: 'zaynjarvis',
    sender_type: 'human',
    content: 'here is an attachment that 404s — should render as an empty framed box.',
    timestamp: new Date(now - 60000).toISOString(),
    attachments: [
      { id: BROKEN_ID, filename: 'missing.png', contentType: 'image/png', size: 0 },
    ],
  },
];

async function boot(page) {
  await page.route('**/api/messages*', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ messages: seedMessages }),
  }));
  await page.route('**/api/channels/*/messages*', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ messages: seedMessages }),
  }));
  // Force the attachment URL to fail fast so onError fires reliably.
  await page.route('**/api/attachments/**', (route) => route.fulfill({ status: 404, body: '' }));
  await loadApp(page, URL, { extraMessages: seedMessages.map((m) => ({ type: 'new_message', message: m })) });
  await page.waitForTimeout(800);
}

async function full(page, file) {
  await page.screenshot({ path: resolve(OUT, file), fullPage: false });
  console.log('Saved:', file);
}

// ── Message list thumbnail + lightbox ──────────────────────────────────────
{
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await boot(page);

  // Scoped crop around the parent message so the empty framed box is obvious.
  const row = page.locator('.group').filter({ hasText: 'here is an attachment' }).first();
  await row.scrollIntoViewIfNeeded();
  const box = await row.boundingBox();
  if (box) {
    await page.screenshot({
      path: resolve(OUT, 'message-thumb-failed.png'),
      clip: {
        x: Math.max(0, box.x - 20),
        y: Math.max(0, box.y - 10),
        width: Math.min(600, 1440 - Math.max(0, box.x - 20)),
        height: Math.min(280, 900 - Math.max(0, box.y - 10)),
      },
    });
    console.log('Saved: message-thumb-failed.png');
  }

  // Click the empty box to open the lightbox (role=img fallback still sits
  // inside the clickable <button>, so a simple button click works).
  const openBtn = page.locator('button[aria-label^="Open missing.png"]').first();
  await openBtn.click();
  await page.waitForTimeout(400);
  await full(page, 'lightbox-failed.png');

  await ctx.close();
  await browser.close();
}

// ── Composer pending-image preview ─────────────────────────────────────────
{
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await boot(page);

  // Inject a pending image with a deliberately invalid previewUrl via the
  // composer's file-picker pipeline. Easiest: dispatch a File on the hidden
  // input so MessageComposer's own logic runs, then nuke the preview URL.
  // Simpler alternative: just drop a known-bad image into the page via
  // an in-page helper and render nothing special — but the composer
  // pipeline isn't exposed, so we fall back to setting the <img> src
  // directly after the first pending render.
  const fileInput = page.locator('input[type="file"]').first();
  // Create a 1x1 transparent PNG File in-page and set it via the DataTransfer.
  await page.evaluate(() => {
    const pngBytes = Uint8Array.from(atob(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNgAAIAAAUAAeImBZsAAAAASUVORK5CYII='
    ), (c) => c.charCodeAt(0));
    const file = new File([pngBytes], 'preview.png', { type: 'image/png' });
    const dt = new DataTransfer();
    dt.items.add(file);
    const input = document.querySelector('input[type="file"]');
    if (input) {
      Object.defineProperty(input, 'files', { value: dt.files, configurable: true });
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });
  await page.waitForTimeout(400);
  // Force the preview image to fail by swapping src to a 404 endpoint.
  await page.evaluate(() => {
    const imgs = Array.from(document.querySelectorAll('img[alt="preview.png"]'));
    for (const img of imgs) img.setAttribute('src', '/api/attachments/nope-999');
  });
  await page.waitForTimeout(400);

  // Focus the composer area for a tighter crop.
  const composer = page.locator('textarea').first();
  await composer.scrollIntoViewIfNeeded();
  const box = await composer.boundingBox();
  if (box) {
    await page.screenshot({
      path: resolve(OUT, 'composer-preview-failed.png'),
      clip: {
        x: Math.max(0, box.x - 40),
        y: Math.max(0, box.y - 100),
        width: Math.min(800, 1440 - Math.max(0, box.x - 40)),
        height: Math.min(220, 900 - Math.max(0, box.y - 100)),
      },
    });
    console.log('Saved: composer-preview-failed.png');
  } else {
    await full(page, 'composer-preview-failed.png');
  }

  await ctx.close();
  await browser.close();
}

console.log('Done. See', OUT);
