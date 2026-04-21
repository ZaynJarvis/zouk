#!/usr/bin/env node
/**
 * Capture one screenshot per theme showing a stack of success / info /
 * warning / error toasts. Used to verify that the semantic toast palette
 * stays green-for-ok and red-for-error across every theme.
 *
 * Relies on Tailwind already having emitted `bg-nc-success/90`,
 * `bg-nc-error/90`, etc. — i.e. `ToastContainer.tsx` is using the
 * semantic classes so JIT keeps them in the dev CSS.
 *
 * Usage:
 *   # start dev server first (port 5288 is the default here)
 *   npm run dev -- --port 5288 --host 127.0.0.1 &
 *   node scripts/toast-theme-shots.mjs
 */
import { chromium } from 'playwright';
import { resolve } from 'path';
import { mkdirSync } from 'fs';
import { loadApp } from './qa-lib.mjs';

const THEMES = ['night-city', 'brutalist', 'washington-post', 'carbon'];

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { port: 5288, out: resolve(process.cwd(), 'qa-screenshots') };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port' && args[i + 1]) opts.port = Number(args[++i]);
    if (args[i] === '--out' && args[i + 1]) opts.out = resolve(args[++i]);
  }
  return opts;
}

async function shootTheme(browser, baseUrl, outDir, theme) {
  const ctx = await browser.newContext({ viewport: { width: 560, height: 360 } });
  const page = await ctx.newPage();
  await loadApp(page, baseUrl);
  await page.evaluate((t) => {
    localStorage.setItem('zouk_theme', t);
    document.documentElement.setAttribute('data-theme', t);
  }, theme);
  await page.waitForTimeout(400);
  // Inject a toast-container + four toast rows. Classes match the ones
  // emitted by ToastContainer.tsx so Tailwind keeps them in the CSS.
  await page.evaluate(() => {
    const old = document.querySelector('.toast-theme-shot');
    if (old) old.remove();
    const wrap = document.createElement('div');
    wrap.className =
      'toast-theme-shot toast-container fixed left-1/2 -translate-x-1/2 z-[100] ' +
      'flex flex-col items-center gap-2 w-[min(22rem,calc(100%-2rem))] top-6';
    const classMap = {
      success: 'border-nc-success bg-nc-success/90 text-nc-black',
      info:    'border-nc-info bg-nc-info/90 text-nc-black',
      warning: 'border-nc-warning bg-nc-warning/90 text-nc-black',
      error:   'border-nc-error bg-nc-error/90 text-white',
    };
    const rows = [
      { type: 'success', icon: '✓', label: 'Changes saved' },
      { type: 'info',    icon: 'i', label: 'Heads up — preview only' },
      { type: 'warning', icon: '!', label: 'Queue is filling up' },
      { type: 'error',   icon: '×', label: 'Failed to sync' },
    ];
    for (const r of rows) {
      const el = document.createElement('div');
      el.className =
        'pointer-events-auto w-full flex items-center gap-2 px-3 py-2.5 border text-sm font-bold shadow-lg backdrop-blur-md ' +
        classMap[r.type];
      el.innerHTML =
        `<span class="inline-flex items-center justify-center w-4 h-4 border border-current font-mono text-[10px]">${r.icon}</span>` +
        `<span class="flex-1 font-mono text-xs">${r.label}</span>`;
      wrap.appendChild(el);
    }
    document.body.appendChild(wrap);
  });
  await page.waitForTimeout(400);
  const file = resolve(outDir, `toast-${theme}.png`);
  await page.screenshot({ path: file });
  console.log(`  ✓ ${file}`);
  await ctx.close();
}

async function main() {
  const opts = parseArgs();
  mkdirSync(opts.out, { recursive: true });
  const baseUrl = `http://127.0.0.1:${opts.port}`;
  console.log(`\nToast theme screenshots → ${baseUrl}`);
  const browser = await chromium.launch();
  try {
    for (const theme of THEMES) {
      console.log(`\n📸 ${theme}`);
      try { await shootTheme(browser, baseUrl, opts.out, theme); }
      catch (err) { console.error(`  ✗ ${theme}: ${err.message}`); }
    }
  } finally {
    await browser.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
