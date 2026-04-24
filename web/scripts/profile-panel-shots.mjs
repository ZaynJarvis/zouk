#!/usr/bin/env node
/**
 * Screenshots for AgentProfilePanel compaction + activity-merge.
 *
 * Usage:
 *   node scripts/profile-panel-shots.mjs --label after --round 1
 */

import { chromium } from 'playwright';
import { mkdirSync } from 'fs';
import { resolve } from 'path';
import { TEST_USER, TEST_TOKEN, FAKE_CHANNELS, FAKE_HUMANS, FAKE_MACHINES } from './qa-lib.mjs';

const PC = { width: 1280, height: 900 };

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { url: 'http://localhost:5173', label: 'after', round: '1', out: null };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--url' && args[i + 1]) opts.url = args[++i];
    if (args[i] === '--label' && args[i + 1]) opts.label = args[++i];
    if (args[i] === '--round' && args[i + 1]) opts.round = args[++i];
    if (args[i] === '--out' && args[i + 1]) opts.out = resolve(args[++i]);
  }
  if (!opts.out) {
    opts.out = resolve(process.cwd(), 'web/qa-screenshots', `profile-panel-round-${opts.round}`);
  }
  return opts;
}

const nowIso = () => new Date().toISOString();

const AGENT_FULL = {
  id: 'agent-alice-001',
  name: 'alice',
  displayName: 'Alice',
  description: 'Operations agent — frontend screenshot QA + local ops on lululiang iMac. Pairs with Bob on UI polish and owns the screenshot-eval pattern.',
  runtime: 'claude',
  model: 'claude-opus-4-7',
  status: 'active',
  activity: 'working',
  activityDetail: 'editing AgentProfilePanel.tsx',
  machineId: 'machine-001',
  workDir: '/Users/lululiang/.zouk/agents/agent-c97d0a85',
  channels: ['all', 'zouk', 'small-fix', 'ov'],
  skills: [
    { id: 's1', name: 'skill-creator', description: 'Create and optimize Claude skills.' },
    { id: 's2', name: 'baidu-netdisk', description: '操作百度网盘 via BaiduPCS-Go CLI.' },
    { id: 's3', name: 'frontend-design', description: 'Production-grade frontend interfaces.' },
    { id: 's4', name: 'claude-api', description: 'Claude/Anthropic SDK work with caching.' },
  ],
  entries: [
    { kind: 'status', activity: 'online', detail: 'session started', timestamp: new Date(Date.now() - 12 * 60_000).toISOString() },
    { kind: 'tool', toolName: 'Read', toolInputSummary: 'web/src/components/AgentProfilePanel.tsx', level: 'info', timestamp: new Date(Date.now() - 10 * 60_000).toISOString() },
    { kind: 'thinking', text: 'Mapping current tab layout onto a compact single-page profile…', timestamp: new Date(Date.now() - 9 * 60_000).toISOString() },
    { kind: 'tool', toolName: 'Edit', toolInputSummary: 'AgentProfilePanel.tsx: fold ACTIVITY tab into PROFILE', level: 'info', timestamp: new Date(Date.now() - 7 * 60_000).toISOString() },
    { kind: 'status', activity: 'working', detail: 'running typecheck', timestamp: new Date(Date.now() - 4 * 60_000).toISOString() },
    { kind: 'tool', toolName: 'Bash', toolInputSummary: 'npm run typecheck', level: 'success', timestamp: new Date(Date.now() - 3 * 60_000).toISOString() },
    { kind: 'note', title: 'typecheck', content: 'clean', level: 'success', timestamp: new Date(Date.now() - 2 * 60_000).toISOString() },
    { kind: 'status', activity: 'working', detail: 'screenshotting', timestamp: nowIso() },
  ],
};

const CONFIG = {
  id: AGENT_FULL.id,
  name: AGENT_FULL.name,
  displayName: AGENT_FULL.displayName,
  description: AGENT_FULL.description,
  runtime: AGENT_FULL.runtime,
  model: AGENT_FULL.model,
  instructions: '',
  skills: AGENT_FULL.skills,
  workDir: AGENT_FULL.workDir,
};

async function run() {
  const { url, out, label } = parseArgs();
  mkdirSync(out, { recursive: true });

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: PC });
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

  await page.route('**/api/messages*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ messages: [] }) }));
  await page.route('**/api/channels/*/messages*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ messages: [] }) }));
  await page.route('**/api/agents/*/activities*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ entries: AGENT_FULL.entries }) }));

  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.evaluate(({ token, user }) => {
    localStorage.setItem('zouk_auth_token', token);
    localStorage.setItem('zouk_auth_user', JSON.stringify(user));
    localStorage.setItem('zouk_current_user', user.name);
  }, { token: TEST_TOKEN, user: TEST_USER });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  // Click the agent avatar in the sidebar → opens AgentProfilePanel
  await page.click('[title="View @Alice profile"]');
  await page.waitForTimeout(800);

  // Full-page shot captures sidebar + panel
  await page.screenshot({ path: resolve(out, `${label}-01-profile-tab-full.png`), fullPage: false });
  console.log(`[shot] ${label}-01-profile-tab-full`);

  // Panel-only close-up: locate the right panel and screenshot it
  const panel = await page.$('.animate-slide-in-right');
  if (panel) {
    await panel.screenshot({ path: resolve(out, `${label}-02-profile-tab-panel.png`) });
    console.log(`[shot] ${label}-02-profile-tab-panel`);
  }

  await browser.close();
  console.log(`[done] → ${out}`);
}

run().catch((e) => { console.error(e); process.exit(1); });
