#!/usr/bin/env node
/**
 * UI Smoke Tests — zouk/web
 *
 * Playwright-based smoke tests that boot the app against a running server,
 * mock the WebSocket init event, and verify critical UI paths.
 *
 * Follows the same mock-WS pattern established in web/scripts/qa-lib.mjs
 * so no real daemon is needed — tests are fast and fully isolated.
 *
 * Run (server must be up at --url):
 *   node web/tests/ui-smoke.mjs
 *   node web/tests/ui-smoke.mjs --url http://localhost:7777 --out ./test-out
 *
 * Exit code 1 if any test fails (CI-friendly).
 *
 * Why each test exists:
 *   app-boots          — Verifies the React bundle renders at all. A broken
 *                        build (missing env var, bad import) produces a blank
 *                        screen that no other test catches.
 *   channels-in-sidebar— The WS init payload drives all initial UI state.
 *                        If the payload shape drifts from what the store
 *                        expects, the sidebar silently renders nothing.
 *   message-render     — A WS "message" event must produce a visible bubble.
 *                        This is the most-used realtime path; silent regressions
 *                        here mean users see no messages.
 */

import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import {
  loadApp,
  FAKE_CHANNELS,
  FAKE_AGENTS,
  FAKE_HUMANS,
  FAKE_CONFIGS,
  FAKE_MACHINES,
} from '../scripts/qa-lib.mjs';

// ─── CLI ──────────────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    url: 'http://localhost:7777',
    out: resolve(process.cwd(), 'test-out/ui-smoke'),
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--url' && args[i + 1]) opts.url = args[++i];
    if (args[i] === '--out' && args[i + 1]) opts.out = resolve(args[++i]);
  }
  return opts;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function pass(results, name) {
  results.push({ name, status: 'PASS' });
  console.log(`  ✓ ${name}`);
}
function fail(results, name, reason) {
  results.push({ name, status: 'FAIL', reason });
  console.error(`  ✗ ${name}: ${reason}`);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

/**
 * Test: app-boots
 * The app must mount and render at least one interactive element (the main
 * layout wrapper). A blank screen means the JS bundle failed to execute.
 */
async function testAppBoots(browser, opts, results) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  try {
    await loadApp(page, opts.url);
    // The app either shows a login screen or the main chat UI.
    // Either way, some button or interactive element must exist.
    const hasContent = await page.locator('button, input, [role="button"]').first()
      .isVisible({ timeout: 5000 }).catch(() => false);
    if (hasContent) {
      pass(results, 'app-boots: React app renders interactive elements');
    } else {
      const bodyText = await page.locator('body').innerText().catch(() => '');
      fail(results, 'app-boots', `No interactive elements found. Body text: "${bodyText.slice(0, 100)}"`);
    }
    await page.screenshot({ path: resolve(opts.out, 'smoke-01-boot.png') });
  } finally {
    await ctx.close();
  }
}

/**
 * Test: channels-in-sidebar
 * After the WS init event fires, the sidebar must show the injected channels.
 * The init payload shape is the contract between server and frontend — if it
 * drifts, the sidebar renders nothing without any error.
 */
async function testChannelsInSidebar(browser, opts, results) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  try {
    await loadApp(page, opts.url, {
      initOverride: {
        channels: [
          { id: 'ch-ci-test', name: 'ci-smoke-channel', description: 'CI test channel' },
          ...FAKE_CHANNELS,
        ],
      },
    });
    // The sidebar renders channel names as clickable items
    const channelVisible = await page.locator('text=ci-smoke-channel').first()
      .isVisible({ timeout: 5000 }).catch(() => false);
    if (channelVisible) {
      pass(results, 'channels-in-sidebar: injected channel name renders in sidebar');
    } else {
      fail(results, 'channels-in-sidebar', '"ci-smoke-channel" not found — WS init payload not applied to sidebar');
    }
    await page.screenshot({ path: resolve(opts.out, 'smoke-02-sidebar.png') });
  } finally {
    await ctx.close();
  }
}

/**
 * Test: message-render
 * A WS "message" event injected after init must produce a visible chat bubble.
 * This validates the end-to-end realtime delivery path in the UI: WS event →
 * store update → MessageList re-render.
 */
async function testMessageRender(browser, opts, results) {
  const PROBE = `ci-smoke-${Date.now()}`;
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  try {
    await loadApp(page, opts.url, {
      extraMessages: [{
        type: 'message',
        message: {
          id: `msg-ci-${Date.now()}`,
          channel_type: 'channel',
          channel_name: 'all',
          sender_type: 'human',
          sender_name: 'ci-bot',
          content: PROBE,
          timestamp: new Date().toISOString(),
        },
      }],
    });
    // Extra settle for WS message delivery (extraMessages fire at 600ms)
    await page.waitForTimeout(1000);

    const msgVisible = await page.locator(`text=${PROBE}`).first()
      .isVisible({ timeout: 4000 }).catch(() => false);
    if (msgVisible) {
      pass(results, 'message-render: WS message event produces visible chat bubble');
    } else {
      fail(results, 'message-render', `Message "${PROBE}" not visible — WS message event not reflected in UI`);
    }
    await page.screenshot({ path: resolve(opts.out, 'smoke-03-message.png') });
  } finally {
    await ctx.close();
  }
}

// ─── Runner ───────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs();
  mkdirSync(opts.out, { recursive: true });

  console.log(`\nZouk UI Smoke Tests`);
  console.log(`  Server: ${opts.url}`);
  console.log(`  Out:    ${opts.out}\n`);

  const browser = await chromium.launch({ headless: true });
  const results = [];

  try {
    // Run all smoke tests sequentially (they share a browser but separate contexts)
    await testAppBoots(browser, opts, results);
    await testChannelsInSidebar(browser, opts, results);
    await testMessageRender(browser, opts, results);
  } finally {
    await browser.close();
  }

  const passed = results.filter(r => r.status === 'PASS').length;
  const failed = results.filter(r => r.status === 'FAIL').length;

  console.log(`\n${passed}/${results.length} PASS${failed ? `  — ${failed} FAIL` : '  ✓ ALL GREEN'}`);
  writeFileSync(resolve(opts.out, 'results.json'), JSON.stringify({ passed, failed, tests: results }, null, 2));

  if (failed) process.exit(1);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
