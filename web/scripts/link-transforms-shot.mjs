#!/usr/bin/env node
/**
 * Link-transforms feature verification shots.
 * Renders a message containing a GitHub PR URL and captures:
 *   (1) message render with default rule → should display "#142"
 *   (2) Settings → Links panel (with preview row populated)
 *
 * Usage:
 *   node scripts/link-transforms-shot.mjs --round 1
 */

import { chromium } from 'playwright';
import { mkdirSync } from 'fs';
import { resolve } from 'path';
import { mockWS, setupAuth, TEST_USER } from './qa-lib.mjs';

const PC = { width: 1280, height: 900 };
const MOBILE = { width: 390, height: 844 };

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { url: 'http://localhost:5173', round: '1', out: null };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--url' && args[i + 1]) opts.url = args[++i];
    if (args[i] === '--round' && args[i + 1]) opts.round = args[++i];
    if (args[i] === '--out' && args[i + 1]) opts.out = resolve(args[++i]);
  }
  if (!opts.out) {
    opts.out = resolve(process.cwd(), 'qa-screenshots', `link-transforms-round-${opts.round}`);
  }
  return opts;
}

const MESSAGES = [
  {
    id: 'm-1',
    channel_type: 'channel',
    channel_name: 'all',
    sender_name: 'zaynjarvis',
    sender_type: 'human',
    timestamp: new Date().toISOString(),
    content: `Shipping PR: https://github.com/ZaynJarvis/zouk/pull/142 for review. Also see https://example.com/article for context.`,
  },
  {
    id: 'm-2',
    channel_type: 'channel',
    channel_name: 'all',
    sender_name: 'Hela',
    sender_type: 'agent',
    timestamp: new Date().toISOString(),
    content: `Confirmed. The merge target is https://github.com/ZaynJarvis/zouk/pull/143 (link-transforms feature). Looks good.`,
  },
];

async function run() {
  const { url, out } = parseArgs();
  mkdirSync(out, { recursive: true });

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: PC });
  const page = await ctx.newPage();

  await mockWS(page, {
    extraMessages: MESSAGES.map(m => ({ type: 'message', message: m })),
  });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await setupAuth(page, TEST_USER);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  // Blur any focused element (composer auto-focus)
  await page.evaluate(() => (document.activeElement instanceof HTMLElement) && document.activeElement.blur());
  await page.waitForTimeout(200);

  await page.screenshot({ path: resolve(out, '01-message-with-transform.png'), fullPage: false });
  console.log('[shot] message render saved');

  // Open settings → Links
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find(b => /settings/i.test(b.getAttribute('title') || '') || /settings/i.test(b.textContent || ''));
    btn?.click();
  });
  await page.waitForTimeout(400);
  // Click LINKS nav
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find(b => /^links$/i.test(b.textContent?.trim() || ''));
    btn?.click();
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: resolve(out, '02-settings-links.png'), fullPage: false });
  console.log('[shot] settings → links saved');

  // Mobile view
  await page.setViewportSize(MOBILE);
  await page.waitForTimeout(300);
  await page.screenshot({ path: resolve(out, '03-settings-links-mobile.png'), fullPage: false });
  console.log('[shot] settings → links (mobile) saved');

  await browser.close();
  console.log(`[done] → ${out}`);
}

run().catch(e => { console.error(e); process.exit(1); });
