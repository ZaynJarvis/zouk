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
  /* Emulation for iOS safe-area insets. Chromium's env() returns 0 by
     default, so we emulate the iPhone 15 Pro values directly. */
  .safe-top { padding-top: 47px; }
  .safe-bottom { padding-bottom: 34px; }

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
    background: rgba(255,255,255,0.95);
    box-shadow: 0 0 0 1px rgba(0,0,0,0.15);
    z-index: 100;
    pointer-events: none;
  }
`;

/* IMPORTANT limitation: Playwright's emulateMedia({features:[{name:'display-mode',
   value:'standalone'}]}) and CDP Emulation.setEmulatedMedia both report the
   feature as supported but Chromium (at least v1.59.1 Playwright / Chromium
   130+) does NOT actually propagate display-mode changes to matchMedia or
   @media CSS rules — they stay at "browser". Verified via matchMedia()
   probe in this script.

   This means our production @media (display-mode: standalone) block cannot
   be exercised through emulation alone. For the PWA "after-fix" shot, we
   force-apply the fix's rule bodies via a style tag; for the "before-fix"
   (pre-fix) shot, we only apply base iOS emulation (safe-area insets) and
   let the production rule sit dormant, reproducing the bug that shipped to
   real iOS devices after PR #94.

   Real iOS PWA behavior must be verified on hardware by zaynjarvis, which
   the bug report confirmed. Playwright shots verify visual correctness of
   the fix's CSS contract; hardware verifies the @media gate. */
const PWA_STANDALONE_FORCE_CSS = `
  /* Simulate what the @media (display-mode: standalone) rule in
     web/src/index.css would do if matched. Keep in sync with that rule. */
  .composer-outer.safe-bottom { padding-bottom: 0 !important; }
  .composer-inner-pad { padding-bottom: 0 !important; }
  .composer-surface { padding-bottom: 34px !important; }
  html[data-theme="night-city"] .composer-surface.cyber-bevel-sm {
    clip-path: polygon(0 0, calc(100% - 6px) 0, 100% 6px, 100% 100%, 0 100%) !important;
  }
`;

async function shootMobile(browser, { name, displayMode, emulateIOS, forceStandaloneFix, reportComputed }) {
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
  if (forceStandaloneFix) {
    await page.addStyleTag({ content: PWA_STANDALONE_FORCE_CSS });
  }
  await page.waitForTimeout(600);
  if (reportComputed) {
    const computed = await page.evaluate(() => {
      const surface = document.querySelector('.composer-surface');
      const innerPad = document.querySelector('.composer-inner-pad');
      const outer = document.querySelector('.composer-outer');
      const textarea = document.querySelector('.composer-textarea');
      if (!surface) return { error: 'composer-surface not found' };
      const get = (el) => el ? getComputedStyle(el) : null;
      const s = get(surface), i = get(innerPad), o = get(outer), t = get(textarea);
      return {
        matchMediaStandalone: window.matchMedia('(display-mode: standalone)').matches,
        matchMediaBrowser: window.matchMedia('(display-mode: browser)').matches,
        outer: { pb: o?.paddingBottom, classes: outer?.className },
        innerPad: { pb: i?.paddingBottom },
        surface: { pb: s?.paddingBottom, clipPath: s?.clipPath, bg: s?.backgroundColor },
        textarea: { pb: t?.paddingBottom, pt: t?.paddingTop },
      };
    });
    console.log(`[${name}] computed styles:`, JSON.stringify(computed, null, 2));
  }
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

// Pre-fix (bug) state: iOS safe-area emulation applied, but the production
// @media (display-mode: standalone) rule is dormant (Chromium won't match
// it). This reproduces what shipped before the fix.
await shootMobile(browser, { name: 'iphone-pwa-prefix',       displayMode: 'standalone', emulateIOS: true  });
// After-fix state: additionally force-apply the fix's rule bodies so the
// shot shows what real iOS PWA users see once the @media rule matches.
await shootMobile(browser, { name: 'iphone-pwa-standalone',   displayMode: 'standalone', emulateIOS: true, forceStandaloneFix: true, reportComputed: true });
await shootMobile(browser, { name: 'iphone-safari-tab',       displayMode: 'browser',    emulateIOS: false });
await shootDesktop(browser);

await browser.close();
