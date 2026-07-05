/**
 * Manual visual verification for the unified right-rail (LIVE ↔ AGENT) feat.
 *
 * Setup: 2 active agents, viewport at desktop width so the rail is visible.
 * Stream: a couple of seed messages so the live rail has avatars to click.
 *
 * Expected:
 *   1. On boot, the rail renders AgentStatus (LIVE AGENTS aside @ 320px).
 *   2. Clicking a NowCard avatar morphs the rail into AGENT view (PROFILE
 *      tab visible) and widens to ~clamp(340, 30vw, 520). The wider 30vw
 *      AgentProfilePanel modal does NOT also appear over the chat (that was
 *      the pre-refactor behavior of `rightPanel='agent_profile'`).
 *   3. Clicking the X in the AGENT view returns the rail to LIVE @ 320px.
 *
 * Run:
 *   PORT=7777 node server/index.js &
 *   node web/scripts/verify-right-rail-morph.mjs
 */
import { chromium } from 'playwright';
import { loadApp } from './qa-lib.mjs';

const URL = 'http://localhost:7777';

const AGENTS = [
  { id: 'agent-hela', name: 'hela', displayName: 'Hela', runtime: 'claude', model: 'claude-sonnet-4-6', status: 'active', activity: 'working',  machineId: 'm1', channels: ['all'] },
  { id: 'agent-tim',  name: 'tim',  displayName: 'Tim',  runtime: 'claude', model: 'claude-sonnet-4-6', status: 'active', activity: 'thinking', machineId: 'm1', channels: ['all'] },
];
const CHANNELS = [{ id: 'ch-all', name: 'all', description: 'General' }];
const MACHINES = [{ id: 'm1', hostname: 'workstation', os: 'darwin arm64', runtimes: ['claude'] }];

const now = new Date().toISOString();
const extraMessages = [
  { type: 'message', message: { id: 'm1', channel_type: 'channel', channel_name: 'all',
      sender_type: 'agent', sender_name: 'hela', content: 'hela streaming', timestamp: now } },
  { type: 'message', message: { id: 'm2', channel_type: 'channel', channel_name: 'all',
      sender_type: 'agent', sender_name: 'tim',  content: 'tim thinking',   timestamp: now } },
];

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
await loadApp(page, URL, {
  extraMessages,
  initOverride: { channels: CHANNELS, agents: AGENTS, machines: MACHINES },
});
await page.waitForTimeout(800);

async function railSnapshot(page) {
  return page.evaluate(() => {
    const liveHeader = Array.from(document.querySelectorAll('*')).find(
      (n) => n.textContent && /NOW\s*·\s*LIVE\s*AGENTS/i.test(n.textContent.replace(/\s+/g, ' ')) && n.children.length === 0,
    );
    const profileTab = Array.from(document.querySelectorAll('button')).find(
      (b) => (b.textContent || '').trim() === 'PROFILE',
    );
    const filesTab = Array.from(document.querySelectorAll('button')).find(
      (b) => (b.textContent || '').trim() === 'FILES',
    );
    // The rail container in App.tsx carries an inline transition on width and
    // is the only element with `overflow: hidden` inline-styled at that point
    // in the tree. Walk up from the LIVE header / PROFILE tab until we hit it.
    function findRailWrapper(start) {
      let node = start;
      while (node && node !== document.body) {
        const style = node.getAttribute && node.getAttribute('style') || '';
        if (style.includes('width:') && /transition:\s*width/.test(style)) return node;
        node = node.parentElement;
      }
      return null;
    }
    const anchor = liveHeader || profileTab;
    const wrapper = anchor ? findRailWrapper(anchor) : null;
    const railWidth = wrapper ? Math.round(wrapper.getBoundingClientRect().width) : null;
    return {
      hasLive: !!liveHeader,
      hasProfileTab: !!profileTab,
      hasFilesTab: !!filesTab,
      railWidth,
    };
  });
}

const beforeClick = await railSnapshot(page);
await page.screenshot({ path: 'qa-screenshots/right-rail-live.png' });
console.log('initial state:', beforeClick);

// Click the first NowCard (the LIVE rail's clickable agent button).
const nowCard = page.locator('aside button:has(.zk-dot--working), aside button:has(.zk-dot--thinking)').first();
await nowCard.click();
await page.waitForTimeout(500);

const afterClick = await railSnapshot(page);
await page.screenshot({ path: 'qa-screenshots/right-rail-agent.png' });
console.log('after click NowCard:', afterClick);

// Click the X to return to LIVE.
const xBtn = page.locator('button[title="Close"]').first();
await xBtn.click();
await page.waitForTimeout(500);

const afterClose = await railSnapshot(page);
await page.screenshot({ path: 'qa-screenshots/right-rail-live-restored.png' });
console.log('after X close:', afterClose);

function check(label, cond) {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${label}`);
  return cond;
}

const ok1 = check('initial: LIVE rail visible, no PROFILE tab',
  beforeClick.hasLive && !beforeClick.hasProfileTab);
const ok2 = check('initial: rail width ≈ 320',
  beforeClick.railWidth !== null && Math.abs(beforeClick.railWidth - 320) <= 4);
const ok3 = check('after click: AGENT view (PROFILE + FILES tabs) visible, LIVE header gone',
  afterClick.hasProfileTab && afterClick.hasFilesTab && !afterClick.hasLive);
const ok4 = check('after click: rail width widened (> 339)',
  afterClick.railWidth !== null && afterClick.railWidth > 339);
const ok5 = check('after X: LIVE rail back, no PROFILE tab',
  afterClose.hasLive && !afterClose.hasProfileTab);
const ok6 = check('after X: rail width back to ≈ 320',
  afterClose.railWidth !== null && Math.abs(afterClose.railWidth - 320) <= 4);

await browser.close();
process.exit(ok1 && ok2 && ok3 && ok4 && ok5 && ok6 ? 0 : 1);
