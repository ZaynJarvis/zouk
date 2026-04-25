#!/usr/bin/env node
/**
 * URL-in-markdown verification shots.
 *
 * Repros the bug where `**https://example.com/x**` was emitted with the
 * trailing `**` consumed into the URL, producing href=`https://example.com/x**`.
 *
 * Renders messages with several markdown-wrapped URL shapes and asserts each
 * <a href> equals the bare URL (no trailing delimiters).
 *
 * Usage:
 *   cd web && pnpm dev
 *   node scripts/url-bold-shots.mjs
 */

import { chromium } from 'playwright';
import { mkdirSync } from 'fs';
import { resolve } from 'path';
import { mockWS, setupAuth, TEST_USER } from './qa-lib.mjs';

const PC = { width: 1280, height: 900 };

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { url: 'http://localhost:5173', round: '1', out: null };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--url' && args[i + 1]) opts.url = args[++i];
    if (args[i] === '--round' && args[i + 1]) opts.round = args[++i];
    if (args[i] === '--out' && args[i + 1]) opts.out = resolve(args[++i]);
  }
  if (!opts.out) {
    opts.out = resolve(process.cwd(), 'qa-screenshots', `url-bold-round-${opts.round}`);
  }
  return opts;
}

// Cases scoped to the trailing-delimiter strip. Underscore-wrapping (`_URL_`)
// is intentionally excluded — the URL regex uses `\b` which doesn't fire
// between `_` and `h` (underscore is a word char), so no link is generated
// in the first place. That's pre-existing behavior, orthogonal to this fix.
const CASES = [
  { id: 'bold-double-asterisk', expectHref: 'https://github.com/chekusu/wanman/pull/2',
    content: 'PR 提了：**https://github.com/chekusu/wanman/pull/2** (feat/idle-cached-resume)' },
  { id: 'italic-asterisk', expectHref: 'https://example.com/path',
    content: 'See *https://example.com/path* now.' },
  { id: 'strikethrough', expectHref: 'https://example.com/z',
    content: 'See ~~https://example.com/z~~ here.' },
  { id: 'trailing-paren', expectHref: 'https://example.com/p',
    content: 'See (https://example.com/p) here.' },
  { id: 'trailing-period', expectHref: 'https://example.com/d',
    content: 'See https://example.com/d. Done.' },
  { id: 'bold-then-period', expectHref: 'https://example.com/bp',
    content: '**https://example.com/bp**.' },
  { id: 'plain', expectHref: 'https://example.com/plain',
    content: 'See https://example.com/plain done.' },
];

const MESSAGES = CASES.map((c, i) => ({
  id: `m-${i}`,
  channel_type: 'channel',
  channel_name: 'all',
  sender_name: 'zaynjarvis',
  sender_type: 'human',
  timestamp: new Date(Date.now() + i * 1000).toISOString(),
  content: c.content,
}));

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
  await page.waitForTimeout(1500);

  await page.evaluate(() => (document.activeElement instanceof HTMLElement) && document.activeElement.blur());
  await page.waitForTimeout(200);

  await page.screenshot({ path: resolve(out, '01-bold-url-cases.png'), fullPage: true });
  console.log(`[shot] saved screenshot → ${out}/01-bold-url-cases.png`);

  // Assert hrefs match expected URLs
  const renderedHrefs = await page.evaluate(() => {
    const anchors = Array.from(document.querySelectorAll('a[href^="http"]'));
    return anchors.map(a => a.getAttribute('href'));
  });
  console.log('[debug] rendered hrefs:', renderedHrefs);

  let failures = 0;
  for (const c of CASES) {
    if (c.expectHref === null) continue;
    if (!renderedHrefs.includes(c.expectHref)) {
      console.error(`[fail] ${c.id}: expected href "${c.expectHref}" not found.`);
      failures++;
    } else {
      console.log(`[ok]   ${c.id}: href="${c.expectHref}"`);
    }
  }
  // Also assert no broken hrefs (hrefs that contain markdown delimiters)
  for (const href of renderedHrefs) {
    if (/[*_~`]+$/.test(href)) {
      console.error(`[fail] href "${href}" has trailing markdown delimiters.`);
      failures++;
    }
  }

  await browser.close();
  if (failures > 0) {
    console.error(`[done] ${failures} failure(s) → ${out}`);
    process.exit(1);
  }
  console.log(`[done] all hrefs clean → ${out}`);
}

run().catch(err => { console.error(err); process.exit(1); });
