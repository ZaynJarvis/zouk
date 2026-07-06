#!/usr/bin/env node
/**
 * Phone-PWA QA for the AgentProfilePanel top bar.
 *
 * Reproduces Zayn's IMG_7840: the duplicate @name in the top header was
 * overlapping the iOS status bar. After the fix, the top bar has only the
 * close X (padded below safe-area-inset-top); the @name + AGENT badge + avatar
 * are all in the ProfileTab body below.
 *
 * Usage:
 *   node scripts/agent-profile-panel-phone-shots.mjs --label after
 */

import { chromium } from 'playwright';
import { mkdirSync } from 'fs';
import { resolve } from 'path';
import { TEST_USER, TEST_TOKEN, FAKE_CHANNELS, FAKE_HUMANS, FAKE_MACHINES } from './qa-lib.mjs';

const VP = { width: 393, height: 852 };
const URL = process.env.ZOUK_URL || 'http://localhost:5173';

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { label: 'after', out: null };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--label' && args[i + 1]) opts.label = args[++i];
    if (args[i] === '--out' && args[i + 1]) opts.out = resolve(args[++i]);
  }
  if (!opts.out) {
    opts.out = resolve(process.cwd(), 'qa-screenshots', 'agent-profile-panel-phone');
  }
  return opts;
}

const AGENT_FULL = {
  id: 'agent-bob-001',
  name: 'bob',
  displayName: 'bob',
  description: '',
  runtime: 'claude',
  model: 'claude-opus-4-7',
  status: 'active',
  activity: 'idle',
  machineId: 'machine-001',
  workDir: '/Users/shared/.zouk/agents/agent-490a845f',
  channels: ['all', 'daemon', 'issue', 'ov', 'plugins'],
  skills: [],
};

const CONFIG = {
  id: AGENT_FULL.id,
  name: AGENT_FULL.name,
  displayName: AGENT_FULL.displayName,
  description: AGENT_FULL.description,
  runtime: AGENT_FULL.runtime,
  model: AGENT_FULL.model,
  instructions: '',
  skills: [],
  workDir: AGENT_FULL.workDir,
};

const SAFE_AREA_FAKE_JS = `
(function() {
  const TOP = 47, BOT = 34;
  const style = document.createElement('style');
  style.textContent = \`
    .safe-top { padding-top: \${TOP}px !important; }
    .safe-bottom { padding-bottom: \${BOT}px !important; }
    body::before { content: "2:09"; position: fixed; top: 0; left: 0; right: 0; height: \${TOP}px; z-index: 9999; color: rgba(255,255,255,0.95); font: 600 16px -apple-system, sans-serif; display: flex; align-items: center; justify-content: center; pointer-events: none; mix-blend-mode: difference; }
    body::after { content: ""; position: fixed; left: 0; right: 0; top: 0; height: \${TOP}px; background: rgba(255, 0, 0, 0.18); pointer-events: none; z-index: 9998; }
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
  const { out, label } = parseArgs();
  mkdirSync(out, { recursive: true });

  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: VP,
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    bypassCSP: true,
    colorScheme: 'dark',
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
  });
  const page = await ctx.newPage();

  await page.routeWebSocket(/\/ws/, (ws) => {
    ws.send(JSON.stringify({
      type: 'init',
      channels: FAKE_CHANNELS,
      agents: [AGENT_FULL],
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

  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.evaluate(({ token, user }) => {
    localStorage.setItem('zouk_auth_token', token);
    localStorage.setItem('zouk_auth_user', JSON.stringify(user));
    localStorage.setItem('zouk_current_user', user.name);
  }, { token: TEST_TOKEN, user: TEST_USER });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await page.evaluate(SAFE_AREA_FAKE_JS);

  await page.screenshot({ path: resolve(out, `${label}-01-home.png`), fullPage: false });

  for (const view of ['channel', 'agents']) {
    if (view === 'agents') {
      // Open sidebar, switch to Agents view (non-chat — panel will cover top of viewport)
      await page.evaluate(() => {
        const btn = Array.from(document.querySelectorAll('button')).find(
          (b) => b.getAttribute('aria-label') === 'Open menu' || b.title === 'Open menu',
        );
        if (btn) btn.click();
      });
      await page.waitForTimeout(300);
      await page.evaluate(() => {
        const btn = Array.from(document.querySelectorAll('button[aria-label="Agents"]'))[0];
        if (btn) btn.click();
      });
      await page.waitForTimeout(800);
    }

    // Open sidebar and click bob avatar to open profile panel
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(
        (b) => b.getAttribute('aria-label') === 'Open menu' || b.title === 'Open menu',
      );
      if (btn) btn.click();
    });
    await page.waitForTimeout(400);
    const bobClicked = await page.evaluate(() => {
      const all = Array.from(document.querySelectorAll('[role="button"], [title]'));
      const bobAvatar = all.find((el) => /View\s+@bob\s+profile/i.test(el.getAttribute('title') || ''));
      if (bobAvatar) { bobAvatar.click(); return true; }
      return false;
    });
    console.log(`[${view}] bob clicked:`, bobClicked);
    await page.waitForTimeout(800);

    await page.screenshot({ path: resolve(out, `${label}-${view}-profile.png`), fullPage: false });
    console.log(`[shot] ${label}-${view}-profile`);

    // Close panel for next iteration
    await page.evaluate(() => {
      const closeBtn = Array.from(document.querySelectorAll('button')).find((b) => b.getAttribute('title') === 'Close');
      if (closeBtn) closeBtn.click();
    });
    await page.waitForTimeout(400);
  }

  await browser.close();
}

run().catch((e) => { console.error(e); process.exit(1); });
