#!/usr/bin/env node
/**
 * Visual check for the mobile keyboard / visual-viewport pin regression.
 *
 *   1. baseline — 393x852 iPhone viewport, browser mode
 *   2. focused  — same viewport, composer focused (cursor in input)
 *   3. kbd-open — viewport shrunk to 393x452 to emulate the visual viewport
 *                 after iOS/Android raises a ~400px on-screen keyboard.
 *                 With `interactive-widget=resizes-content` in the viewport
 *                 meta, the browser resizes the layout instead of scrolling
 *                 the doc up, so TopBar AND composer should both remain
 *                 visible and anchored in the shrunken shell.
 *
 * Playwright's setViewportSize approximates the "viewport shrinks" branch of
 * interactive-widget=resizes-content. It does NOT simulate the doc-translate
 * behavior of older iOS — on-device verification still required, but this
 * confirms the layout does the right thing when the browser honors the meta.
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
  { type: 'new_message', message: { id: 'm1', channel_name: 'all', channel_type: 'channel', sender_name: 'zaynjarvis', sender_type: 'human', content: 'Keyboard pin test — top bar and composer should both stay visible.', timestamp: new Date(now - 60000).toISOString() } },
  { type: 'new_message', message: { id: 'm2', channel_name: 'all', channel_type: 'channel', sender_name: 'hela-bot', sender_type: 'agent', content: 'Validating interactive-widget=resizes-content on mobile.', timestamp: new Date(now - 30000).toISOString() } },
];

const HOME_INDICATOR_CSS = `
  body::after {
    content: "";
    position: fixed;
    bottom: 8px; left: 50%;
    transform: translateX(-50%);
    width: 140px; height: 5px;
    border-radius: 3px;
    background: rgba(255,255,255,0.7);
    z-index: 100;
    pointer-events: none;
  }
`;

async function capture(label, { width, height, focus = false, standalone = false }) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    bypassCSP: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
  });
  const page = await ctx.newPage();
  await loadApp(page, URL, { extraMessages });
  if (standalone) {
    await page.evaluate(() => {
      document.documentElement.setAttribute('data-display-mode', 'standalone');
    });
  }
  await page.addStyleTag({ content: HOME_INDICATOR_CSS });
  await page.waitForTimeout(500);
  if (focus) {
    await page.locator('textarea[placeholder*="Message"]').first().focus();
    await page.waitForTimeout(250);
  }
  const out = resolve(OUT, `keyboard-${label}.png`);
  await page.screenshot({ path: out, fullPage: false });
  console.log('Saved:', out);
  await browser.close();
}

await capture('baseline-browser', { width: 393, height: 852 });
await capture('focused-browser', { width: 393, height: 852, focus: true });
await capture('kbd-open-browser', { width: 393, height: 452, focus: true });
await capture('baseline-pwa', { width: 393, height: 852, standalone: true });
await capture('kbd-open-pwa', { width: 393, height: 452, focus: true, standalone: true });
