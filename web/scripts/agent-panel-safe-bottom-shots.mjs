#!/usr/bin/env node
/**
 * Phone-PWA QA for the AgentPanel agent-list safe-area bottom behavior.
 *
 * Simulates iPhone 15 Pro (393×852) and fakes a 34px bottom safe-area inset.
 * With the fix the scrollable agent list extends visually under the home
 * indicator (content bleeds), and when scrolled to the end the last item is
 * pushed above the indicator because the scroll container has padding-bottom
 * equal to the inset.
 *
 * Usage: node web/scripts/agent-panel-safe-bottom-shots.mjs --label after
 */

import { chromium } from 'playwright';
import { mkdirSync } from 'fs';
import { resolve } from 'path';
import {
  TEST_TOKEN, TEST_USER, FAKE_CHANNELS, FAKE_HUMANS, FAKE_MACHINES,
} from './qa-lib.mjs';

const URL = process.env.ZOUK_URL || 'http://localhost:7777';
const VP = { width: 393, height: 852 };

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { label: 'after', out: null };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--label' && args[i + 1]) opts.label = args[++i];
    if (args[i] === '--out' && args[i + 1]) opts.out = resolve(args[++i]);
  }
  if (!opts.out) opts.out = resolve(process.cwd(), 'qa-screenshots', 'agent-panel-safe-bottom');
  return opts;
}

const opts = parseArgs();
mkdirSync(opts.out, { recursive: true });

const machineId = 'machine-001';
const FAKE_AGENTS = Array.from({ length: 20 }, (_, i) => ({
  id: `agent-test-${String(i).padStart(3, '0')}`,
  name: `agent-${i}`,
  displayName: `Agent ${i}`,
  runtime: 'claude',
  model: 'claude-sonnet-4-6',
  status: i % 3 === 0 ? 'active' : 'idle',
  machineId,
}));
const FAKE_CONFIGS = FAKE_AGENTS.map((a) => ({
  id: a.id, name: a.name, displayName: a.displayName,
  runtime: a.runtime, model: a.model,
  description: `Test agent ${a.name}`,
  picture: null,
}));

const SAFE_AREA_FAKE_JS = `
(function() {
  const TOP = 47, BOT = 34;
  const style = document.createElement('style');
  style.textContent = \`
    .safe-top { padding-top: \${TOP}px !important; }
    .safe-bottom { padding-bottom: \${BOT}px !important; }
    .safe-bottom-fill { padding-bottom: \${BOT}px !important; }
    body::before { content: "9:41"; position: fixed; top: 0; left: 0; right: 0; height: \${TOP}px; z-index: 9999; color: #fff; font: 600 16px -apple-system, sans-serif; display: flex; align-items: center; justify-content: center; pointer-events: none; background: rgba(0,0,0,0.55); }
    body::after { content: ""; position: fixed; bottom: 0; left: 0; right: 0; height: \${BOT}px; background: rgba(0,0,0,0.55); pointer-events: none; z-index: 9998; }
    html::after { content: ""; position: fixed; bottom: 9px; left: 50%; transform: translateX(-50%); width: 134px; height: 5px; border-radius: 3px; background: rgba(255,255,255,0.9); z-index: 10000; pointer-events: none; }
  \`;
  document.head.appendChild(style);
  const patch = () => {
    document.querySelectorAll('*').forEach((el) => {
      const s = el.style; if (!s) return;
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

async function run() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: VP, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    bypassCSP: true, colorScheme: 'dark',
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
  });
  const page = await ctx.newPage();
  page.on('console', (msg) => { if (msg.type() === 'error') console.log('[console.error]', msg.text()); });
  page.on('pageerror', (err) => console.log('[pageerror]', err.message));

  await page.routeWebSocket(/\/ws/, (ws) => {
    ws.send(JSON.stringify({
      type: 'init',
      channels: FAKE_CHANNELS,
      agents: FAKE_AGENTS,
      humans: FAKE_HUMANS,
      configs: FAKE_CONFIGS,
      machines: FAKE_MACHINES,
    }));
    ws.onMessage(() => {});
    ws.onClose(() => {});
  });
  await page.route('**/api/messages*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ messages: [] }) }));
  await page.route('**/api/channels/*/messages*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ messages: [] }) }));
  await page.route('**/api/agents/*/activities*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ entries: [] }) }));

  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.evaluate(({ token, user }) => {
    localStorage.setItem('zouk_auth_token', token);
    localStorage.setItem('zouk_auth_user', JSON.stringify(user));
    localStorage.setItem('zouk_current_user', user.name);
  }, { token: TEST_TOKEN, user: TEST_USER });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await page.evaluate(SAFE_AREA_FAKE_JS);
  await page.waitForTimeout(300);

  // Open mobile sidebar, click Agents.
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find(
      (b) => b.getAttribute('aria-label') === 'Open menu' || b.title === 'Open menu',
    );
    if (btn) btn.click();
  });
  await page.waitForTimeout(400);
  const navResult = await page.evaluate(() => {
    const btn = document.querySelector('button[aria-label="Agents"]');
    if (btn) { btn.click(); return 'clicked'; }
    return 'not-found';
  });
  console.log('[nav]', navResult);
  await page.waitForTimeout(600);
  // Close the mobile sidebar overlay so the agent list is unobstructed.
  await page.evaluate(() => {
    const overlay = document.querySelector('.lg\\:hidden.fixed.inset-0');
    if (overlay) overlay.click();
  });
  await page.waitForTimeout(400);
  await page.evaluate(SAFE_AREA_FAKE_JS);
  await page.waitForTimeout(200);

  const listSelector = '.zk-scroll.safe-bottom-fill';
  const listInfo = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return { found: false };
    return { found: true, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight, paddingBottom: getComputedStyle(el).paddingBottom };
  }, listSelector);
  console.log('[list]', JSON.stringify(listInfo));

  // 1. Scroll to TOP.
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (el) el.scrollTop = 0;
  }, listSelector);
  await page.waitForTimeout(200);
  await page.screenshot({ path: resolve(opts.out, `${opts.label}-top.png`) });
  console.log('Saved:', resolve(opts.out, `${opts.label}-top.png`));

  // 2. Scroll to BOTTOM.
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (el) el.scrollTop = el.scrollHeight;
  }, listSelector);
  await page.waitForTimeout(200);
  await page.screenshot({ path: resolve(opts.out, `${opts.label}-bottom.png`) });
  console.log('Saved:', resolve(opts.out, `${opts.label}-bottom.png`));

  await browser.close();
}

run().catch((e) => { console.error(e); process.exit(1); });
