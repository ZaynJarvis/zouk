#!/usr/bin/env node
/**
 * QA for the agent sidebar (channel sidebar phone-modal) on non-chat pages:
 *   1. Sidebar modal must not extend into the iOS top safe area (47px).
 *   2. Modal background / border tokens should match the rest of the chrome.
 *
 * Captures one screenshot per (view × mode):
 *   - sidebar-on-{channel|agents|tasks|memory}-{light|dark}.png
 */

import { chromium } from 'playwright';
import { mkdirSync } from 'fs';
import { resolve } from 'path';
import { loadApp } from './qa-lib.mjs';

const URL = process.env.ZOUK_URL || 'http://localhost:5174';
const OUT = resolve(process.cwd(), 'qa-screenshots');
mkdirSync(OUT, { recursive: true });

// Walk every element and rewrite paddingTop / paddingBottom inline styles
// that use env(safe-area-inset-*) — Chromium's env() reads 0 by default in
// non-PWA mode, so this lets us preview the iPhone PWA layout offline.
const SAFE_AREA_FAKE_JS = `
(function() {
  const TOP = 47, BOT = 34;
  // Patch utility classes
  const style = document.createElement('style');
  style.textContent = \`
    .safe-top { padding-top: \${TOP}px !important; }
    .safe-bottom { padding-bottom: \${BOT}px !important; }
    .safe-bottom-fill { padding-bottom: \${BOT}px !important; }
    body::before {
      content: "9:41";
      position: fixed; top: 0; left: 0; right: 0;
      height: \${TOP}px; z-index: 9999;
      color: rgba(255,255,255,0.95);
      font: 600 16px -apple-system, sans-serif;
      display: flex; align-items: center; justify-content: center;
      pointer-events: none;
      mix-blend-mode: difference;
    }
    body::after {
      content: ""; position: fixed; left: 0; right: 0; top: 0;
      height: \${TOP}px; background: rgba(255, 0, 0, 0.18);
      pointer-events: none; z-index: 9998;
    }
  \`;
  document.head.appendChild(style);
  // Patch any inline paddingTop calc(env(safe-area-inset-top)...) to apply TOP value
  const patch = () => {
    document.querySelectorAll('*').forEach((el) => {
      const s = el.style;
      if (!s) return;
      const pt = s.paddingTop;
      if (pt && /env\\(safe-area-inset-top/i.test(pt)) {
        const m = pt.match(/(\\d+)px/);
        const extra = m ? parseInt(m[1], 10) : 0;
        s.setProperty('padding-top', (TOP + extra) + 'px', 'important');
      }
      const pb = s.paddingBottom;
      if (pb && /env\\(safe-area-inset-bottom/i.test(pb)) {
        const m = pb.match(/(\\d+)px/);
        const extra = m ? parseInt(m[1], 10) : 0;
        s.setProperty('padding-bottom', (BOT + extra) + 'px', 'important');
      }
    });
  };
  patch();
  new MutationObserver(patch).observe(document.body, { subtree: true, attributes: true, childList: true, attributeFilter: ['style'] });
})();
`;

async function shotFor(label, view, mode) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 393, height: 852 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    bypassCSP: true,
    colorScheme: mode,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
  });
  const page = await ctx.newPage();
  await loadApp(page, URL);
  await page.evaluate(SAFE_AREA_FAKE_JS);
  await page.waitForTimeout(400);

  if (view !== 'channel') {
    const navTitle = view === 'agents' ? 'Agents' : view === 'tasks' ? 'Tasks' : 'Memory';
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(
        (b) => b.getAttribute('aria-label') === 'Open menu' || b.title === 'Open menu',
      );
      if (btn) btn.click();
    });
    await page.waitForTimeout(300);
    await page.evaluate((label) => {
      const btn = Array.from(document.querySelectorAll('button')).find(
        (b) => b.getAttribute('aria-label') === label || b.title === label,
      );
      if (btn) btn.click();
    }, navTitle);
    await page.waitForTimeout(800);
  }

  // Reopen sidebar on the target view (only for the modal screenshots — we
  // also want a "page only" screenshot to see the page header alignment).
  const ssPage = resolve(OUT, `${label}-${mode}-page.png`);
  await page.screenshot({ path: ssPage, fullPage: false });
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find(
      (b) => b.getAttribute('aria-label') === 'Open menu' || b.title === 'Open menu',
    );
    if (btn) btn.click();
  });
  await page.waitForTimeout(500);

  const ss = resolve(OUT, `${label}-${mode}-modal.png`);
  await page.screenshot({ path: ss, fullPage: false });
  console.log('Saved screenshot:', ss);
  await browser.close();
}

const VIEWS = ['channel', 'agents', 'tasks', 'memory'];
const MODES = (process.env.MODES || 'dark,light').split(',');
for (const m of MODES) {
  for (const v of VIEWS) {
    await shotFor(`sidebar-${v}`, v, m);
  }
}
