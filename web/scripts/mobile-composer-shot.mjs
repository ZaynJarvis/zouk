#!/usr/bin/env node
/**
 * Task #61 visual check. Produces three screenshots of the MessageComposer:
 *   1. desktop  — 1280×800 (sm breakpoint satisfied → existing cyber-bevel look)
 *   2. mobile   — 393×852 iPhone viewport, data-display-mode="browser"
 *   3. pwa      — same viewport, data-display-mode="standalone" + injected
 *                 env(safe-area-inset-bottom)=34px to simulate iPhone PWA
 *
 * The third capture is what gates direction 1 ("safe-area as margin"): the
 * composer must sit at the visual bottom of its container with a 34px gap
 * below it, not absorbed INTO the safe area (that was the rejected PR #98
 * direction).
 *
 * Playwright 1.59 / Chromium 130 silently no-ops matchMedia display-mode
 * emulation, so we force data-display-mode via addInitScript and inject the
 * safe-area CSS via addStyleTag (same trick the pwa-safe-area-shot.mjs uses).
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
  { type: 'new_message', message: { id: 'm1', channel_name: 'all', channel_type: 'channel', sender_name: 'zaynjarvis', sender_type: 'human', content: 'Hey team, shipping the mobile composer polish today.', timestamp: new Date(now - 120000).toISOString() } },
  { type: 'new_message', message: { id: 'm2', channel_name: 'all', channel_type: 'channel', sender_name: 'hela-bot', sender_type: 'agent', content: 'Pill-shape composer with enterkeyhint=send + long-press-for-newline going in.', timestamp: new Date(now - 90000).toISOString() } },
  { type: 'new_message', message: { id: 'm3', channel_name: 'all', channel_type: 'channel', sender_name: 'qa-bot', sender_type: 'agent', content: 'Standing by for eval on desktop, mobile browser, and PWA.', timestamp: new Date(now - 60000).toISOString() } },
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

// Simulates iOS PWA safe-area by forcing 34px padding on .composer-outer
// only (the rule from index.css that does this depends on
// html[data-display-mode="standalone"], which we set post-load below).
const PWA_SAFE_AREA_CSS = `
  html[data-display-mode="standalone"] .composer-outer.safe-bottom {
    padding-bottom: 34px !important;
  }
`;

async function shot(label, { viewport, mobile = false, standalone = false, theme = null }) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport,
    deviceScaleFactor: mobile ? 3 : 1,
    isMobile: mobile,
    hasTouch: mobile,
    bypassCSP: true,
    userAgent: mobile
      ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15'
      : undefined,
  });
  if (theme) {
    await ctx.addInitScript((t) => { localStorage.setItem('zouk_theme', t); }, theme);
  }
  const page = await ctx.newPage();
  await loadApp(page, URL, { extraMessages });
  if (standalone) {
    await page.evaluate(() => {
      document.documentElement.setAttribute('data-display-mode', 'standalone');
    });
    await page.addStyleTag({ content: PWA_SAFE_AREA_CSS + HOME_INDICATOR_CSS });
  } else if (mobile) {
    await page.addStyleTag({ content: HOME_INDICATOR_CSS });
  }
  await page.waitForTimeout(700);
  const out = resolve(OUT, `composer-${label}.png`);
  await page.screenshot({ path: out, fullPage: false });
  console.log('Saved:', out);
  await browser.close();
}

await shot('desktop', { viewport: { width: 1280, height: 800 } });
await shot('mobile-browser', { viewport: { width: 393, height: 852 }, mobile: true, standalone: false });
await shot('mobile-pwa', { viewport: { width: 393, height: 852 }, mobile: true, standalone: true });
await shot('mobile-pwa-nc', { viewport: { width: 393, height: 852 }, mobile: true, standalone: true, theme: 'night-city' });
