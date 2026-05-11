/**
 * Manual visual verification for the status-dot scoping fix.
 *
 * Setup: 3 channels (#all, #zouk, #ov), 2 working agents (hela, tim).
 * Stream:
 *   - hela posts to #all
 *   - tim  posts to #zouk
 *
 * Expected:
 *   - #all  row → 1 dot (hela)
 *   - #zouk row → 1 dot (tim)
 *   - #ov   row → 0 dots
 *   - LIVE rail on the active channel (#all) → 1 avatar (hela), not tim
 *
 * Run:
 *   PORT=7777 node server/index.js &
 *   node web/scripts/verify-status-dot-scope.mjs
 */
import { chromium } from 'playwright';
import { loadApp } from './qa-lib.mjs';

const URL = 'http://localhost:7777';

const AGENTS = [
  { id: 'agent-hela', name: 'hela', displayName: 'Hela', runtime: 'claude', model: 'claude-sonnet-4-6', status: 'active', activity: 'working',  machineId: 'm1', channels: ['all', 'zouk', 'ov'] },
  { id: 'agent-tim',  name: 'tim',  displayName: 'Tim',  runtime: 'claude', model: 'claude-sonnet-4-6', status: 'active', activity: 'thinking', machineId: 'm1', channels: ['all', 'zouk', 'ov'] },
];
const CHANNELS = [
  { id: 'ch-all',  name: 'all',  description: 'General' },
  { id: 'ch-zouk', name: 'zouk', description: 'Dev' },
  { id: 'ch-ov',   name: 'ov',   description: 'OV' },
];

const now = new Date().toISOString();
const extraMessages = [
  {
    type: 'message',
    message: {
      id: 'msg-hela-1', channel_type: 'channel', channel_name: 'all',
      sender_type: 'agent', sender_name: 'hela',
      content: 'hela working in #all', timestamp: now,
    },
  },
  {
    type: 'message',
    message: {
      id: 'msg-tim-1', channel_type: 'channel', channel_name: 'zouk',
      sender_type: 'agent', sender_name: 'tim',
      content: 'tim working in #zouk', timestamp: now,
    },
  },
];

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();

await loadApp(page, URL, {
  extraMessages,
  initOverride: { channels: CHANNELS, agents: AGENTS },
});
await page.waitForTimeout(800);

const out1 = 'qa-screenshots/status-dot-scope-active-all.png';
await page.screenshot({ path: out1, fullPage: false });
console.log(`Active=#all screenshot → ${out1}`);

// Count dots per non-active channel row from the DOM
function countDots(page) {
  return page.evaluate(() => {
    const out = { all: 0, zouk: 0, ov: 0 };
    const names = Object.keys(out);
    for (const div of document.querySelectorAll('div[role="button"]')) {
      const txt = (div.textContent || '').replace(/\s+/g, '');
      // Match the channel-row truncate span ("ov" etc.) to avoid hitting the
      // sender of a chat message ("alice", etc.). Channel rows have the
      // hash glyph as the first child.
      const hash = div.querySelector('span[aria-hidden="true"]')?.textContent?.trim();
      if (hash !== '#') continue;
      const label = txt.replace(/^#/, '').replace(/\d+$/, '');
      if (!names.includes(label)) continue;
      out[label] = div.querySelectorAll('.zk-dot--working, .zk-dot--thinking').length;
    }
    return out;
  });
}

const dotsAllActive = await countDots(page);
console.log('with #all active → dots per row:', dotsAllActive);

// Switch to #ov and re-check — now #all and #zouk should both show their dots
await page.locator('div[role="button"]:has-text("ov")').first().click();
await page.waitForTimeout(500);
const dotsOvActive = await countDots(page);
console.log('with #ov  active → dots per row:', dotsOvActive);
const out2 = 'qa-screenshots/status-dot-scope-active-ov.png';
await page.screenshot({ path: out2, fullPage: false });
console.log(`Active=#ov  screenshot → ${out2}`);

// Sanity assertions
const expectAllActive = { all: 0, zouk: 1, ov: 0 };
const expectOvActive  = { all: 1, zouk: 1, ov: 0 };
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}: got=${JSON.stringify(got)} want=${JSON.stringify(want)}`);
  return ok;
}
const ok1 = check('active=all', dotsAllActive, expectAllActive);
const ok2 = check('active=ov',  dotsOvActive,  expectOvActive);

await browser.close();
process.exit(ok1 && ok2 ? 0 : 1);
