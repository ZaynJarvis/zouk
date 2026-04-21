#!/usr/bin/env node
/**
 * Visual QA for the composer icon padding + hide-on-content fix.
 *
 * Captures four cropped screenshots under qa-screenshots/composer-icon-padding/:
 *   desktop-empty.png     — empty composer (icon visible, symmetric padding)
 *   desktop-typing.png    — composer with text (icon collapsed, both sides 12px)
 *   mobile-empty.png      — empty composer on mobile viewport
 *   mobile-typing.png     — composer with text on mobile (icon collapsed)
 *
 * Each screenshot is cropped to the composer region so reviewers can eyeball
 * the icon-to-text vs text-to-right-edge spacing directly.
 */

import { chromium } from 'playwright';
import { mkdirSync } from 'fs';
import { resolve } from 'path';
import { loadApp } from './qa-lib.mjs';

const URL = process.env.ZOUK_URL || 'http://localhost:5188';
const OUT = resolve(process.cwd(), 'qa-screenshots/composer-icon-padding');
mkdirSync(OUT, { recursive: true });

const now = Date.now();
const seedMessages = [
  { id: 'm1', channel_name: 'all', channel_type: 'channel', sender_name: 'zaynjarvis', sender_type: 'human', content: 'Composer polish — icon padding + hide on content.', timestamp: new Date(now - 60000).toISOString() },
];
const extraMessages = seedMessages.map((message) => ({ type: 'new_message', message }));

async function shotComposer(page, file) {
  const composer = page.locator('.composer-surface').first();
  await composer.waitFor({ state: 'visible' });
  // crop to the composer surface plus a little surrounding chrome
  const box = await composer.boundingBox();
  if (!box) throw new Error('composer not found');
  const pad = 24;
  await page.screenshot({
    path: file,
    clip: {
      x: Math.max(0, box.x - pad),
      y: Math.max(0, box.y - pad),
      width: box.width + pad * 2,
      height: box.height + pad * 2,
    },
  });
  console.log('Saved:', file);
}

async function captureFor(viewport, opts, prefix) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport,
    deviceScaleFactor: 2,
    ...opts,
  });
  const page = await ctx.newPage();
  // REST stub for messages endpoints (qa-lib's mockWS init alone isn't enough)
  await page.route('**/api/messages*', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ messages: seedMessages }),
  }));
  await page.route('**/api/channels/*/messages*', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ messages: seedMessages }),
  }));
  await loadApp(page, URL, { extraMessages });
  await page.waitForTimeout(400);

  // Empty state
  await shotComposer(page, resolve(OUT, `${prefix}-empty.png`));

  // Type state
  const ta = page.locator('textarea').first();
  await ta.fill('hello, this composer has content now');
  await page.waitForTimeout(250); // allow transition
  await shotComposer(page, resolve(OUT, `${prefix}-typing.png`));

  await ctx.close();
  await browser.close();
}

await captureFor(
  { width: 1280, height: 800 },
  {},
  'desktop',
);

await captureFor(
  { width: 393, height: 852 },
  {
    isMobile: true,
    hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
  },
  'mobile',
);
