#!/usr/bin/env node
/**
 * Visual check for the PWA safe-area edge-to-edge layout.
 *
 * Emulates an iPhone 15 Pro viewport (393×852) and injects a large top
 * safe-area inset (47px) + bottom inset (34px) via a stylesheet override,
 * so we can see whether the TopBar background extends into the status bar
 * band and the MessageComposer extends into the home-indicator band.
 */

import { chromium } from 'playwright';
import { mkdirSync } from 'fs';
import { resolve } from 'path';
import { loadApp } from './qa-lib.mjs';

const URL = process.env.ZOUK_URL || 'http://localhost:7777';
const OUT = resolve(process.cwd(), 'qa-screenshots');
mkdirSync(OUT, { recursive: true });

const SAFE_AREA_CSS = `
  :root {
    /* Force iOS-like safe-area insets so Chromium shows what the PWA looks like on iPhone. */
  }
  html {
    --fake-safe-top: 47px;
    --fake-safe-bottom: 34px;
  }
  /* Override env() so CSS that uses env(safe-area-inset-*) sees fake iOS values. */
  .safe-top { padding-top: var(--fake-safe-top) !important; }
  .safe-bottom { padding-bottom: var(--fake-safe-bottom) !important; }
  /* Status-bar & home-indicator mocks to sanity-check bleed */
  body::before {
    content: "2:00 PWA • 5G 100%";
    position: fixed;
    top: 0; left: 0; right: 0;
    height: 47px;
    z-index: 100;
    color: white;
    font: bold 14px -apple-system, sans-serif;
    display: flex; align-items: center; justify-content: center;
    background: transparent;
    pointer-events: none;
  }
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

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 393, height: 852 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  bypassCSP: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
});
const page = await ctx.newPage();
await page.addStyleTag({ content: SAFE_AREA_CSS }).catch(() => {});
await loadApp(page, URL);
await page.addStyleTag({ content: SAFE_AREA_CSS });
await page.waitForTimeout(500);
const shot = resolve(OUT, 'pwa-safe-area.png');
await page.screenshot({ path: shot, fullPage: false });
console.log('Saved screenshot:', shot);
await browser.close();
