#!/usr/bin/env node
/**
 * Phone-PWA QA: AgentProfilePanel's ACTIVITY scroll should bleed into the
 * bottom safe area, and the last entry should sit above the home indicator
 * when scrolled all the way to the end (padding-bottom = inset).
 *
 * Usage:
 *   node web/scripts/agent-profile-activity-safe-bottom-shots.mjs --label after
 */

import { chromium } from 'playwright';
import { mkdirSync } from 'fs';
import { resolve } from 'path';
import {
  TEST_TOKEN, TEST_USER, FAKE_CHANNELS, FAKE_HUMANS, FAKE_MACHINES,
} from './qa-lib.mjs';

const URL = process.env.ZOUK_URL || 'http://127.0.0.1:7777';
const VP = { width: 393, height: 852 };

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { label: 'after', out: null };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--label' && args[i + 1]) opts.label = args[++i];
    if (args[i] === '--out' && args[i + 1]) opts.out = resolve(args[++i]);
  }
  if (!opts.out) opts.out = resolve(process.cwd(), 'qa-screenshots', 'agent-profile-activity-safe-bottom');
  return opts;
}

const opts = parseArgs();
mkdirSync(opts.out, { recursive: true });

const AGENT_BOB = {
  id: 'agent-bob-001',
  name: 'bob',
  displayName: 'bob',
  description: 'General SWE agent',
  runtime: 'claude',
  model: 'claude-opus-4-7',
  status: 'active',
  activity: 'working',
  machineId: 'machine-001',
  workDir: '/Users/lululiang/.zouk/agents/agent-490a845f',
  channels: ['all', 'daemon', 'issue', 'ov'],
  skills: [],
  // Many entries so the activity feed scrolls.
  entries: Array.from({ length: 40 }, (_, i) => ({
    kind: 'tool',
    title: `Tool call ${i + 1}`,
    content: `Executed example tool action #${i + 1}`,
    timestamp: new Date(Date.now() - (40 - i) * 60_000).toISOString(),
    toolName: ['Bash', 'Read', 'Edit', 'Grep'][i % 4],
    toolInputSummary: `arg ${i + 1}`,
  })),
};

const CONFIG = {
  id: AGENT_BOB.id, name: AGENT_BOB.name, displayName: AGENT_BOB.displayName,
  description: AGENT_BOB.description, runtime: AGENT_BOB.runtime, model: AGENT_BOB.model,
  picture: null, workDir: AGENT_BOB.workDir, skills: [], instructions: '',
};

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

  await page.routeWebSocket(/\/ws/, (ws) => {
    ws.send(JSON.stringify({
      type: 'init',
      channels: FAKE_CHANNELS,
      agents: [AGENT_BOB],
      humans: FAKE_HUMANS,
      configs: [CONFIG],
      machines: FAKE_MACHINES,
    }));
    ws.onMessage(() => {});
    ws.onClose(() => {});
  });
  await page.route('**/api/messages*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ messages: [] }) }));
  await page.route('**/api/channels/*/messages*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ messages: [] }) }));
  await page.route('**/api/agents/*/activities*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ entries: [] }) }));
  await page.route('**/api/agents/*/ov/status', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ enabled: false }) }));

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

  // Open mobile sidebar, click bob avatar to open the profile panel.
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find(
      (b) => b.getAttribute('aria-label') === 'Open menu' || b.title === 'Open menu',
    );
    if (btn) btn.click();
  });
  await page.waitForTimeout(400);
  const clicked = await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll('[title], [role="button"]'));
    const avatar = all.find((el) => /View\s+@bob\s+profile/i.test(el.getAttribute('title') || ''));
    if (avatar) { avatar.click(); return true; }
    return false;
  });
  console.log('[avatar clicked]', clicked);
  await page.waitForTimeout(800);
  await page.evaluate(SAFE_AREA_FAKE_JS);
  await page.waitForTimeout(200);

  // Locate the activity scroll container.
  const listSelector = '.safe-bottom-fill';
  const info = await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll('.safe-bottom-fill'));
    const stats = els.map((el) => ({
      classes: el.className,
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
      paddingBottom: getComputedStyle(el).paddingBottom,
    }));
    return stats;
  });
  console.log('[safe-bottom-fill containers]', JSON.stringify(info, null, 2));

  // Find the activity feed specifically (the one inside the profile panel,
  // bottom-most, with content). Pick the last visible one with scrollable content.
  const activitySelector = '.flex-1.min-h-0.overflow-y-auto.scrollbar-thin.safe-bottom-fill';
  const scrollInfo = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return { found: false };
    return { found: true, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight, paddingBottom: getComputedStyle(el).paddingBottom };
  }, activitySelector);
  console.log('[activity]', JSON.stringify(scrollInfo));

  // Top scroll position.
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (el) el.scrollTop = 0;
  }, activitySelector);
  await page.waitForTimeout(200);
  await page.screenshot({ path: resolve(opts.out, `${opts.label}-top.png`) });
  console.log('Saved:', resolve(opts.out, `${opts.label}-top.png`));

  // Bottom scroll position.
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (el) el.scrollTop = el.scrollHeight;
  }, activitySelector);
  await page.waitForTimeout(200);
  await page.screenshot({ path: resolve(opts.out, `${opts.label}-bottom.png`) });
  console.log('Saved:', resolve(opts.out, `${opts.label}-bottom.png`));

  await browser.close();
}

run().catch((e) => { console.error(e); process.exit(1); });
