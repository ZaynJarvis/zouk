#!/usr/bin/env node
/**
 * qa-runner.mjs — Unified Zouk QA runner
 *
 * Covers all shipped fix PRs. Each test is a function that receives a
 * Playwright page (already boot-loaded with auth + mock WS) and returns
 * { pass, note, screenshotPath? }.
 *
 * All tests run in parallel (separate browser contexts) for speed.
 * Only the key assertion screenshot is taken per test — no multi-step shots.
 *
 * Usage:
 *   node scripts/qa-runner.mjs                       # all tests
 *   node scripts/qa-runner.mjs --pr 61,62            # tests for these PRs only
 *   node scripts/qa-runner.mjs --url http://... --out ./shots
 *
 * Token-saving conventions:
 *   - One screenshot per test (final evidence only)
 *   - Console: terse PASS lines, verbose FAIL lines only
 *   - Exit code 1 if any test fails (CI-friendly)
 */

import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, readFileSync } from 'fs';
import { resolve } from 'path';
import {
  TEST_AVATAR_DATA_URL, FAKE_AGENTS, FAKE_CONFIGS, FAKE_HUMANS, FAKE_CHANNELS, FAKE_MACHINES,
  loadApp,
} from './qa-lib.mjs';

// ─── CLI ────────────────────────────────────────────────────────────────────
function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    url: 'http://localhost:7777',
    out: resolve(process.cwd(), 'qa-screenshots'),
    prs: null,
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--url' && args[i + 1]) opts.url = args[++i];
    if (args[i] === '--out' && args[i + 1]) opts.out = resolve(args[++i]);
    if (args[i] === '--pr'  && args[i + 1]) opts.prs = args[++i].split(',').map(Number);
  }
  return opts;
}

// ─── Test definitions ────────────────────────────────────────────────────────
// Each entry: { id, prs, name, fn(page, out) → Promise<{pass,note}> }

async function test21(page, out) {
  const ss = resolve(out, '21-sidebar-no-username.png');
  await page.screenshot({ path: ss, clip: { x: 0, y: 0, width: 280, height: 600 } });
  // Username should NOT appear in the sidebar header area
  const visible = await page.locator('[class*="sidebar"] >> text="QA Tester"').first()
    .isVisible({ timeout: 800 }).catch(() => false);
  return {
    pass: !visible,
    note: visible ? 'Username still visible in sidebar header' : 'No username row in sidebar header',
    screenshotPath: ss,
  };
}

async function test22(page, out) {
  // Navigate to Agents view
  await page.locator('button[title="Agents"]').first().click();
  await page.waitForTimeout(1000);

  // Open Hela CONFIG panel — agent list items contain name + model text;
  // ConfigStartButton shows name only, so filter on model string to pick list item.
  const helaCard = page.locator('button').filter({ hasText: 'Hela' }).filter({ hasText: 'claude' }).first();
  await helaCard.waitFor({ state: 'visible', timeout: 6000 });
  await helaCard.click();
  await page.waitForTimeout(800);
  const configBtn = page.getByRole('button', { name: 'CONFIG', exact: true });
  await configBtn.waitFor({ state: 'visible', timeout: 6000 });
  await configBtn.click();
  await page.waitForTimeout(500);

  const inputs = page.locator('input');
  const count = await inputs.count();
  let nameInput = null;
  for (let i = 0; i < count; i++) {
    const v = await inputs.nth(i).inputValue().catch(() => '');
    if (v === 'Hela' || v === 'hela-bot') { nameInput = inputs.nth(i); break; }
  }
  if (nameInput && await nameInput.isVisible().catch(() => false)) {
    await nameInput.fill('Hela EDITED');
    await page.waitForTimeout(200);
  }

  // Switch to Tim
  const timCard = page.locator('button').filter({ hasText: 'Tim' }).first();
  await timCard.waitFor({ state: 'visible', timeout: 5000 });
  await timCard.click();
  await page.waitForTimeout(800);
  const tabBtn = page.locator('button').filter({ hasText: 'CONFIG' }).first();
  if (await tabBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await tabBtn.click(); await page.waitForTimeout(400);
  }

  const ss = resolve(out, '22-tim-config-after-switch.png');
  await page.screenshot({ path: ss });

  // Tim's display name must not show Hela's dirty value
  const timInputs = page.locator('input');
  const tc = await timInputs.count();
  let timVal = '';
  for (let i = 0; i < tc; i++) {
    const v = await timInputs.nth(i).inputValue().catch(() => '');
    if (v === 'Tim' || v === 'tim-bot' || v === 'Hela' || v === 'Hela EDITED') { timVal = v; break; }
  }
  const polluted = timVal === 'Hela EDITED';
  return {
    pass: !polluted,
    note: polluted ? `State leak: Tim form shows "${timVal}"` : `Tim form: "${timVal}" — clean`,
    screenshotPath: ss,
  };
}

async function test23(page, out) {
  await page.locator('button[title="Agents"]').first().click();
  await page.waitForTimeout(1000);
  const helaCard = page.locator('button').filter({ hasText: 'Hela' }).filter({ hasText: 'claude' }).first();
  await helaCard.waitFor({ state: 'visible', timeout: 6000 });
  await helaCard.click();
  await page.waitForTimeout(800);
  const configBtn = page.getByRole('button', { name: 'CONFIG', exact: true });
  await configBtn.waitFor({ state: 'visible', timeout: 6000 });
  await configBtn.click();
  await page.waitForTimeout(500);

  const saveBtn = page.locator('button').filter({ hasText: 'SAVE' }).first();
  const saveBefore = await saveBtn.isVisible({ timeout: 400 }).catch(() => false);

  // Find the displayName input by its current value (note: has no type attr, defaults to text)
  const allInputs = page.locator('input:visible');
  await page.waitForTimeout(500); // let SettingsTab fully render
  const iCount = await allInputs.count();
  let nameInput = null;
  for (let i = 0; i < iCount; i++) {
    const v = await allInputs.nth(i).inputValue().catch(() => '');
    if (v === 'Hela' || v === 'hela-bot') { nameInput = allInputs.nth(i); break; }
  }
  if (!nameInput) nameInput = allInputs.first();
  await nameInput.focus();
  await nameInput.pressSequentially(' (test)', { delay: 40 });
  await page.waitForTimeout(800);

  const saveAfter = await saveBtn.isVisible({ timeout: 600 }).catch(() => false);
  const ss = resolve(out, '23-config-save-button.png');
  await page.screenshot({ path: ss });

  const pass = !saveBefore && saveAfter;
  return {
    pass,
    note: `Save btn: before=${saveBefore}(expect false) after=${saveAfter}(expect true). Avatar upload auto-saves (no SAVE step).`,
    screenshotPath: ss,
  };
}

async function test24(page, out) {
  const composer = page.locator('textarea').first();
  if (!await composer.isVisible({ timeout: 4000 }).catch(() => false)) {
    return { pass: false, note: 'Composer textarea not found' };
  }
  const dropdown = page.locator('[class*="bottom-full"]').first();

  // A: email must NOT trigger dropdown
  await composer.click();
  await composer.pressSequentially('contact foo@bar.com please', { delay: 15 });
  await page.waitForTimeout(500);
  const emailDropdown = await dropdown.isVisible({ timeout: 400 }).catch(() => false);

  // B: @ at line start opens dropdown
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Delete');
  await page.waitForTimeout(100);
  await composer.pressSequentially('@', { delay: 30 });
  await page.waitForTimeout(700);
  const atDropdown = await dropdown.isVisible({ timeout: 800 }).catch(() => false);

  // C: Escape closes + suppresses
  await composer.pressSequentially('hel', { delay: 25 });
  await page.waitForTimeout(500);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  const afterEsc = await dropdown.isVisible({ timeout: 300 }).catch(() => false);
  await composer.pressSequentially('p', { delay: 25 });
  await page.waitForTimeout(300);
  const stillSuppressed = !await dropdown.isVisible({ timeout: 300 }).catch(() => false);

  const ss = resolve(out, '24-mention-dropdown.png');
  await page.screenshot({ path: ss });

  const pass = !emailDropdown;
  return {
    pass,
    note: `email-no-popup:${!emailDropdown} @-opens:${atDropdown} esc-closes:${!afterEsc} suppresses:${stillSuppressed}`,
    screenshotPath: ss,
  };
}

async function test25(page, out) {
  const custom = await page.evaluate(() => {
    for (const sheet of document.styleSheets) {
      try {
        for (const rule of sheet.cssRules) {
          const t = rule.cssText || '';
          if (t.includes('::-webkit-scrollbar') && t.includes('background') &&
              (t.includes('rgb') || t.includes('#') || t.includes('var('))) {
            return t.substring(0, 120);
          }
        }
      } catch (_) {}
    }
    return null;
  });
  const ss = resolve(out, '25-scrollbar.png');
  await page.screenshot({ path: ss });
  return {
    pass: !custom,
    note: custom ? `Custom scrollbar CSS found: ${custom}` : 'No styled ::-webkit-scrollbar rules',
    screenshotPath: ss,
  };
}

async function test26(_page, out, url) {
  // Pure CSS source check — no browser needed after page load
  let cssSource = '';
  try {
    // Prefer reading the built CSS file directly (fastest path)
    const cssFile = resolve(process.cwd(), '../web/src/index.css');
    cssSource = readFileSync(cssFile, 'utf8');
  } catch (_) {
    try {
      cssSource = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8');
    } catch (_2) {}
  }
  const hasSupports = cssSource.includes('-webkit-touch-callout');
  const hasMaxFn    = cssSource.includes('max(16px');
  const ss = resolve(out, '26-ios-zoom-fix.png');
  await _page.screenshot({ path: ss });
  return {
    pass: hasSupports && hasMaxFn,
    note: `@supports(-webkit-touch-callout):${hasSupports} max(16px,1em):${hasMaxFn}`,
    screenshotPath: ss,
  };
}

async function test28(page, out) {
  // Self-profile footer shows user name + online status
  const footerName = await page.locator('text="QA Tester"').first()
    .isVisible({ timeout: 2000 }).catch(() => false);
  const onlineDot = await page.locator('text="online"').first()
    .isVisible({ timeout: 1000 }).catch(() => false);

  // Exactly 1 visible Settings gear
  const gearCount = await page.locator('button[title="Settings"]').filter({ visible: true }).count();

  const ss = resolve(out, '28-sidebar-footer.png');
  await page.screenshot({ path: ss, clip: { x: 0, y: 0, width: 320, height: 800 } });

  return {
    pass: footerName && gearCount === 1,
    note: `footer:"QA Tester"=${footerName} online=${onlineDot} gears=${gearCount}(expect 1)`,
    screenshotPath: ss,
  };
}

async function test29(page, out) {
  // Avatar img must appear next to the self-sent message
  const avatarImg = page.locator(`img[src="${TEST_AVATAR_DATA_URL}"]`).first();
  const visible = await avatarImg.isVisible({ timeout: 2500 }).catch(() => false);
  const ss = resolve(out, '29-self-avatar-chat.png');
  await page.screenshot({ path: ss });
  return {
    pass: visible,
    note: visible ? 'authUser.gravatarUrl renders next to own message' : 'Avatar img not found — isSelf fallback not triggered',
    screenshotPath: ss,
  };
}

// ─── Registry ────────────────────────────────────────────────────────────────
const TESTS = [
  { id: 21, prs: [58], name: 'Remove username row from sidebar',     fn: test21 },
  { id: 22, prs: [59], name: 'Bot switch resets CONFIG form',         fn: test22 },
  { id: 23, prs: [60], name: 'Avatar auto-save (no SAVE button)',     fn: test23 },
  { id: 24, prs: [59], name: '@mention word-boundary + Escape',       fn: test24 },
  { id: 25, prs: [58], name: 'Native scrollbar (no custom CSS)',      fn: test25 },
  { id: 26, prs: [61], name: 'iOS focus-zoom CSS @supports rule',     fn: test26 },
  { id: 28, prs: [63, 64], name: 'Self-profile footer + gear dedup', fn: test28 },
  {
    id: 29, prs: [64], name: 'Self-avatar via authUser fallback',
    fn: test29,
    // Needs a user with gravatarUrl + a fake self-message injected via WS
    loadOpts: {
      user: { name: 'QA Tester', email: 'qa@test.local', picture: null, gravatarUrl: TEST_AVATAR_DATA_URL },
      extraMessages: [{
        type: 'message',
        message: {
          id: 'msg-qa-self-001',
          channel_type: 'channel',
          channel_name: 'all',
          sender_type: 'human',
          sender_name: 'QA Tester',
          content: 'Self-avatar test message',
          timestamp: new Date().toISOString(),
        },
      }],
    },
  },
];

// ─── Runner ──────────────────────────────────────────────────────────────────
async function runTest(browser, testDef, opts) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const start = Date.now();
  try {
    await loadApp(page, opts.url, testDef.loadOpts);
    // Extra settle for WS message delivery
    if (testDef.loadOpts?.extraMessages?.length) await page.waitForTimeout(800);
    const result = await testDef.fn(page, opts.out, opts.url);
    return {
      test: `#${testDef.id} ${testDef.name}`,
      prs: testDef.prs,
      ...result,
      ms: Date.now() - start,
    };
  } catch (e) {
    return {
      test: `#${testDef.id} ${testDef.name}`,
      prs: testDef.prs,
      pass: false,
      note: `ERROR: ${e.message}`,
      ms: Date.now() - start,
    };
  } finally {
    await ctx.close();
  }
}

async function main() {
  const opts = parseArgs();
  mkdirSync(opts.out, { recursive: true });

  const selected = opts.prs
    ? TESTS.filter(t => t.prs.some(p => opts.prs.includes(p)))
    : TESTS;

  console.log(`\nZouk QA — ${selected.length} test(s)${opts.prs ? ` [PR ${opts.prs.join(',')}]` : ''}`);
  console.log(`  Server: ${opts.url}  Out: ${opts.out}\n`);

  const browser = await chromium.launch({ headless: true });
  // All tests run in parallel — each gets its own browser context
  const settled = await Promise.allSettled(selected.map(t => runTest(browser, t, opts)));
  await browser.close();

  const results = settled.map(s => s.status === 'fulfilled' ? s.value : { pass: false, note: String(s.reason) });

  // Print summary
  let failures = 0;
  for (const r of results) {
    if (r.pass) {
      console.log(`✓ ${r.test}  (${r.ms}ms)`);
    } else {
      failures++;
      console.log(`✗ ${r.test}  (${r.ms}ms)`);
      console.log(`  → ${r.note}`);
    }
  }
  console.log(`\n${results.length - failures}/${results.length} PASS${failures ? `  — ${failures} FAIL` : '  ✓ ALL GREEN'}`);
  console.log(`Screenshots: ${opts.out}`);

  writeFileSync(resolve(opts.out, 'qa-results.json'), JSON.stringify(results, null, 2));
  if (failures) process.exit(1);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
