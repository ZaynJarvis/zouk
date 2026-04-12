#!/usr/bin/env node
/**
 * Theme Debug Screenshot Tool
 *
 * Captures screenshots of every registered theme across key views
 * (login, sidebar, settings) for visual regression debugging.
 *
 * Usage:
 *   # Against local dev server (default http://localhost:5173)
 *   npx playwright install chromium  # first time only
 *   node scripts/theme-screenshots.mjs
 *
 *   # Against production or staging
 *   node scripts/theme-screenshots.mjs --url https://zouk.zaynjarvis.com
 *
 *   # Specific theme only
 *   node scripts/theme-screenshots.mjs --theme brutalist
 *
 *   # Custom output directory
 *   node scripts/theme-screenshots.mjs --out ./my-screenshots
 *
 * Output:
 *   screenshots/
 *     night-city/
 *       login.png
 *       sidebar.png
 *       sidebar-bottom.png
 *       full.png
 *     brutalist/
 *       ...
 *     washington-post/
 *       ...
 */

import { chromium } from 'playwright';
import { mkdirSync } from 'fs';
import { resolve } from 'path';

const THEMES = ['night-city', 'brutalist', 'washington-post'];

const VIEWPORTS = {
  desktop: { width: 1280, height: 800 },
  mobile: { width: 390, height: 844 },
};

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    url: 'http://localhost:5173',
    theme: null,
    out: resolve(process.cwd(), 'screenshots'),
    mobile: false,
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--url' && args[i + 1]) opts.url = args[++i];
    if (args[i] === '--theme' && args[i + 1]) opts.theme = args[++i];
    if (args[i] === '--out' && args[i + 1]) opts.out = resolve(args[++i]);
    if (args[i] === '--mobile') opts.mobile = true;
  }
  return opts;
}

async function captureTheme(page, themeName, baseUrl, outDir) {
  const themeDir = resolve(outDir, themeName);
  mkdirSync(themeDir, { recursive: true });

  // 1. Navigate to app and select theme on login screen
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  // Try to click the theme button on login screen
  const themeBtn = page.locator(`button`).filter({ hasText: new RegExp(themeName.replace(/-/g, '.'), 'i') });
  if (await themeBtn.first().isVisible({ timeout: 2000 }).catch(() => false)) {
    await themeBtn.first().click();
    await page.waitForTimeout(500);
  } else {
    // Fallback: set theme via localStorage and reload
    await page.evaluate((t) => {
      localStorage.setItem('zouk_theme', t);
      document.documentElement.setAttribute('data-theme', t);
    }, themeName);
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
  }

  // Screenshot: login screen
  await page.screenshot({ path: resolve(themeDir, 'login.png') });
  console.log(`  ✓ ${themeName}/login.png`);

  // 2. Log in as guest
  const guestBtn = page.locator('button').filter({ hasText: /continue as guest|initialize guest|guest/i });
  if (await guestBtn.first().isVisible({ timeout: 2000 }).catch(() => false)) {
    await guestBtn.first().click();
    await page.waitForTimeout(3000);
  } else {
    console.warn(`  ⚠ Guest login button not found for ${themeName} — screenshots may show login screen only`);
  }

  // Screenshot: full app view
  await page.screenshot({ path: resolve(themeDir, 'full.png') });
  console.log(`  ✓ ${themeName}/full.png`);

  // Screenshot: sidebar area (left 400px)
  const viewport = page.viewportSize();
  await page.screenshot({
    path: resolve(themeDir, 'sidebar.png'),
    clip: { x: 0, y: 0, width: Math.min(400, viewport.width), height: viewport.height },
  });
  console.log(`  ✓ ${themeName}/sidebar.png`);

  // Screenshot: bottom of sidebar
  await page.screenshot({
    path: resolve(themeDir, 'sidebar-bottom.png'),
    clip: { x: 0, y: Math.max(0, viewport.height - 200), width: Math.min(400, viewport.width), height: 200 },
  });
  console.log(`  ✓ ${themeName}/sidebar-bottom.png`);

  // 3. Clear session for next theme
  await page.evaluate(() => {
    localStorage.removeItem('zouk_current_user');
    localStorage.removeItem('zouk_auth_token');
    localStorage.removeItem('zouk_theme');
  });
}

async function main() {
  const opts = parseArgs();
  const themes = opts.theme ? [opts.theme] : THEMES;
  const viewport = opts.mobile ? VIEWPORTS.mobile : VIEWPORTS.desktop;

  console.log(`\nTheme Debug Screenshots`);
  console.log(`  URL:      ${opts.url}`);
  console.log(`  Themes:   ${themes.join(', ')}`);
  console.log(`  Viewport: ${viewport.width}x${viewport.height}`);
  console.log(`  Output:   ${opts.out}\n`);

  mkdirSync(opts.out, { recursive: true });

  const browser = await chromium.launch();

  for (const themeName of themes) {
    console.log(`\n📸 Capturing: ${themeName}`);
    const ctx = await browser.newContext({ viewport });
    const page = await ctx.newPage();
    try {
      await captureTheme(page, themeName, opts.url, opts.out);
    } catch (err) {
      console.error(`  ✗ Error capturing ${themeName}: ${err.message}`);
    }
    await ctx.close();
  }

  await browser.close();
  console.log(`\n✅ Done. Screenshots saved to ${opts.out}\n`);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
