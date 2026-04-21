#!/usr/bin/env node
/**
 * QA: verify the composer's square-to-round transition matches the
 * menu FAB's lg-breakpoint (`lg:hidden` = <1024px) visibility.
 *
 * Captures the composer bottom strip at three viewports:
 *   - 560×800  mobile     → menu btn visible + rounded composer
 *   - 900×800  tablet     → menu btn visible + rounded composer (fix target)
 *   - 1280×800 desktop    → menu btn hidden  + square composer
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'fs';
import { resolve } from 'path';
import { loadApp } from './qa-lib.mjs';

const URL = process.env.ZOUK_URL || 'http://localhost:5188';
const OUT = resolve(process.cwd(), 'qa-screenshots');
mkdirSync(OUT, { recursive: true });

const now = Date.now();
const extraMessages = [
  { type: 'new_message', message: { id: 'm1', channel_name: 'all', channel_type: 'channel', sender_name: 'zaynjarvis', sender_type: 'human', content: 'Align composer radius with menu FAB breakpoint.', timestamp: new Date(now - 60000).toISOString() } },
];

const browser = await chromium.launch();

async function capture(name, { width, height }) {
  const ctx = await browser.newContext({ viewport: { width, height } });
  const page = await ctx.newPage();
  await loadApp(page, URL, { extraMessages });
  // close sidebar so the round menu FAB becomes visible next to the composer
  await page.evaluate(() => {
    try { localStorage.setItem('zouk_sidebar_open', 'false'); } catch (_) {}
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  const shot = resolve(OUT, `menu-width-${name}.png`);
  await page.screenshot({ path: shot, fullPage: false, clip: { x: 0, y: height - 140, width, height: 140 } });
  console.log('Saved:', shot);
  await ctx.close();
}

await capture('560', { width: 560, height: 800 });
await capture('900', { width: 900, height: 800 });
await capture('1280', { width: 1280, height: 800 });

await browser.close();
