#!/usr/bin/env node
/**
 * Visual QA for the fixed-TopBar PWA fix.
 *
 * Simulates three states:
 *   1. normal    — full iPhone viewport, header at top
 *   2. kbd-open  — viewport shrunken to 452px (approx visible area above 400px keyboard)
 *                  with position:fixed TopBar the header stays at top
 *   3. ios-shift — simulates old iOS scroll-up: translateY(-220px) on app-shell
 *                  proves fixed TopBar survives visual-viewport shift too
 */

import { chromium } from 'playwright';
import { mkdirSync } from 'fs';
import { resolve } from 'path';
import { loadApp } from './qa-lib.mjs';

const URL = process.env.ZOUK_URL || 'http://localhost:5301';
const OUT = resolve(process.cwd(), 'qa-screenshots/topbar-fixed');
mkdirSync(OUT, { recursive: true });

const now = Date.now();
const msgs = [
  { type: 'new_message', message: { id: 'm1', channel_name: 'all', channel_type: 'channel', sender_name: 'zaynjarvis', sender_type: 'human', content: '手机端键盘弹出 header 不见了的问题。', timestamp: new Date(now - 90000).toISOString() } },
  { type: 'new_message', message: { id: 'm2', channel_name: 'all', channel_type: 'channel', sender_name: 'alice', sender_type: 'agent', content: 'Fix: TopBar uses position:fixed on mobile so iOS keyboard-shift cannot push it off-screen.', timestamp: new Date(now - 60000).toISOString() } },
  { type: 'new_message', message: { id: 'm3', channel_name: 'all', channel_type: 'channel', sender_name: 'zaynjarvis', sender_type: 'human', content: 'PR ready?', timestamp: new Date(now - 30000).toISOString() } },
];

const STATUS_CSS = `
  body::before {
    content: "9:41  PWA  5G  100%";
    position: fixed; top: 0; left: 0; right: 0;
    height: 44px; z-index: 200;
    color: rgba(0,0,0,0.6);
    font: 600 13px -apple-system, sans-serif;
    display: flex; align-items: center; justify-content: center;
    pointer-events: none;
  }
  body::after {
    content: "";
    position: fixed; bottom: 8px; left: 50%;
    transform: translateX(-50%);
    width: 140px; height: 5px; border-radius: 3px;
    background: rgba(0,0,0,0.25); z-index: 200; pointer-events: none;
  }
`;

async function capture(label, { height = 852, shift = false, pwa = false } = {}) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 393, height },
    deviceScaleFactor: 3,
    isMobile: true, hasTouch: true, bypassCSP: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
  });
  const page = await ctx.newPage();
  await loadApp(page, URL, { extraMessages: msgs });
  if (pwa) {
    await page.evaluate(() => document.documentElement.setAttribute('data-display-mode', 'standalone'));
  }
  if (!pwa) await page.addStyleTag({ content: STATUS_CSS });
  await page.waitForTimeout(500);

  await page.locator('textarea[placeholder*="Message"]').first().focus();
  await page.waitForTimeout(200);

  if (shift) {
    // Simulate iOS translating the visual viewport up (old keyboard-push behaviour)
    await page.evaluate(() => {
      document.querySelector('.app-shell').style.transform = 'translateY(-220px)';
    });
    await page.waitForTimeout(150);
  }

  const out = resolve(OUT, `${label}.png`);
  await page.screenshot({ path: out, fullPage: false });
  console.log('Saved:', out);
  await browser.close();
}

// 1. Normal full viewport — header at top
await capture('1-normal-full', { height: 852 });

// 2. Keyboard open (viewport shrunk) — header still at top
await capture('2-kbd-open-browser', { height: 452 });

// 3. iOS visual-viewport shift — fixed header survives
await capture('3-ios-shift-survival', { height: 852, shift: true });

// 4. PWA mode, keyboard open
await capture('4-kbd-open-pwa', { height: 452, pwa: true });
