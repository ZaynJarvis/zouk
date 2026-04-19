#!/usr/bin/env node
/**
 * Visual check for iOS PWA (display-mode: standalone) composer bottom absorption.
 *
 * Emulates iPhone 15 Pro (393×852) with Playwright and:
 *   - page.emulateMedia({ features: [{ name: 'display-mode', value: 'standalone' }] })
 *     so @media (display-mode: standalone) matches in CSS.
 *   - Injected override rules that fake env(safe-area-inset-bottom) ≈ 34px,
 *     because Chromium on macOS returns 0 for env() by default.
 *
 * We inject two kinds of emulation rules:
 *   1. Outside @media: override .safe-top and .safe-bottom to known pixel values
 *      so components that use those utilities render as they would on iOS.
 *   2. Inside @media (display-mode: standalone): override .composer-surface to
 *      34px !important — layered ON TOP OF our production rule
 *      `.composer-surface { padding-bottom: env(safe-area-inset-bottom, 0px) }`
 *      which would otherwise resolve to 0 in Chromium.
 *
 * Captures three scenarios:
 *   - iphone-pwa-standalone: display-mode: standalone + 34px inset. Expected:
 *     composer surface (bordered input) extends to viewport bottom; home-indicator
 *     pill visible OVER the composer bg, not over chat bg below it.
 *   - iphone-safari-tab: display-mode: browser + 0 inset. Expected: composer
 *     unchanged from desktop shape — small gap above viewport bottom, no pill.
 *   - pc-desktop: 1280×800, no mobile emulation. Expected: regular desktop layout.
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
  { type: 'new_message', message: { id: 'm1', channel_name: 'all', channel_type: 'channel', sender_name: 'zaynjarvis', sender_type: 'human', content: 'Testing the PWA composer absorbs the home-indicator zone.', timestamp: new Date(now - 180000).toISOString() } },
  { type: 'new_message', message: { id: 'm2', channel_name: 'all', channel_type: 'channel', sender_name: 'hela', sender_type: 'agent', content: 'Composer bg should now extend all the way to viewport bottom in iOS PWA.', timestamp: new Date(now - 120000).toISOString() } },
  { type: 'new_message', message: { id: 'm3', channel_name: 'all', channel_type: 'channel', sender_name: 'alice', sender_type: 'agent', content: 'Will eval before/after shots side by side.', timestamp: new Date(now - 60000).toISOString() } },
];

const IOS_EMULATION_CSS = `
  /* Fake env(safe-area-inset-*) on Chromium by layering same-specificity rules
     LATER in the cascade than production CSS. No !important — because the
     fix's .composer-outer.safe-bottom override (specificity 0,2,0) must still
     beat the emulation's .safe-bottom (0,1,0) to show absorbed-into-surface
     behavior in the standalone screenshot. */
  .safe-top { padding-top: 47px; }
  .safe-bottom { padding-bottom: 34px; }

  /* Emulate env(safe-area-inset-bottom) for the composer-surface rule, which
     only applies inside display-mode: standalone (our production rule) and
     resolves to 0 in Chromium. */
  @media (display-mode: standalone) {
    .composer-surface {
      padding-bottom: 34px;
    }
  }

  /* Fake status bar + home-indicator pill for visual sanity. */
  body::before {
    content: "5:33 PWA · 5G";
    position: fixed;
    top: 14px; left: 0; right: 0;
    z-index: 100;
    color: white;
    font: 600 14px -apple-system, sans-serif;
    text-align: center;
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

async function shootMobile(browser, { name, displayMode, emulateIOS }) {
  const ctx = await browser.newContext({
    viewport: { width: 393, height: 852 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    bypassCSP: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
  });
  const page = await ctx.newPage();
  await page.emulateMedia({
    media: 'screen',
    features: [{ name: 'display-mode', value: displayMode }],
  });
  if (emulateIOS) {
    await page.addStyleTag({ content: IOS_EMULATION_CSS }).catch(() => {});
  }
  await loadApp(page, URL, { extraMessages });
  if (emulateIOS) {
    await page.addStyleTag({ content: IOS_EMULATION_CSS });
  }
  await page.waitForTimeout(600);
  const shot = resolve(OUT, `${name}.png`);
  await page.screenshot({ path: shot, fullPage: false });
  console.log('Saved:', shot);
  await ctx.close();
}

async function shootDesktop(browser) {
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });
  const page = await ctx.newPage();
  await loadApp(page, URL, { extraMessages });
  await page.waitForTimeout(600);
  const shot = resolve(OUT, 'pc-desktop.png');
  await page.screenshot({ path: shot, fullPage: false });
  console.log('Saved:', shot);
  await ctx.close();
}

const browser = await chromium.launch();

await shootMobile(browser, { name: 'iphone-pwa-standalone',   displayMode: 'standalone', emulateIOS: true  });
await shootMobile(browser, { name: 'iphone-safari-tab',       displayMode: 'browser',    emulateIOS: false });
await shootDesktop(browser);

await browser.close();
