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
    // Inline the lucide SVG paths used by ToastContainer.tsx so the screenshot
    // faithfully reflects the real glyphs. Bare Check/X avoid the visible
    // white ring that CheckCircle/AlertCircle would draw on colored toasts.
    const svg = (paths) =>
      `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
    const glyphs = {
      success: svg('<path d="M20 6 9 17l-5-5"/>'),
      info:    svg('<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>'),
      warning: svg('<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>'),
      error:   svg('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>'),
    };
    const rows = [
      { type: 'success', label: 'Changes saved' },
      { type: 'info',    label: 'Heads up — preview only' },
      { type: 'warning', label: 'Queue is filling up' },
      { type: 'error',   label: 'Failed to sync' },
    ];
    for (const r of rows) {
      const el = document.createElement('div');
      el.className =
        'pointer-events-auto w-full flex items-center gap-2 px-3 py-2.5 border text-sm font-bold shadow-lg backdrop-blur-md ' +
        classMap[r.type];
      el.innerHTML =
        glyphs[r.type] +
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
