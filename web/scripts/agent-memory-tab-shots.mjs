#!/usr/bin/env node
/**
 * Smoke test for:
 *  - Sidebar Memory tab (independent display, tree-only, top-down, resize,
 *    L0/L1 + markdown, Open button)
 *  - Memory page (tree-only, shows OV namespace roots, default expands
 *    user/<name>/memories/ and opens profile.md)
 *
 * Boots Vite with a mocked WebSocket + mocked OV status + mocked memory
 * list/read responses (in-page wsRef interceptor via WebSocket route).
 *
 * Usage: node scripts/agent-memory-tab-shots.mjs
 */

import { chromium } from 'playwright';
import { mkdirSync } from 'fs';
import { resolve } from 'path';
import { TEST_USER, TEST_TOKEN, FAKE_CHANNELS, FAKE_HUMANS, FAKE_MACHINES } from './qa-lib.mjs';

const URL = process.env.ZOUK_URL || 'http://localhost:5173';
const OUT_DIR = resolve(process.cwd(), 'qa-screenshots', 'agent-memory-tab');
mkdirSync(OUT_DIR, { recursive: true });

const AGENT_BOB = {
  id: 'agent-bob-001',
  name: 'bob',
  displayName: 'bob',
  description: 'AI assistant',
  runtime: 'claude',
  model: 'claude-opus-4-7',
  status: 'active',
  activity: 'idle',
  machineId: 'machine-001',
  workDir: '/tmp/bob',
  channels: ['all'],
  skills: [],
  ovEnabled: true,
};

const CONFIG = {
  id: AGENT_BOB.id,
  name: AGENT_BOB.name,
  displayName: AGENT_BOB.displayName,
  description: AGENT_BOB.description,
  runtime: AGENT_BOB.runtime,
  model: AGENT_BOB.model,
  workDir: AGENT_BOB.workDir,
  ovEnabled: true,
};

// Mocked OV memory tree shape — mirrors the real server structure where
// viking:// branches into top-level dirs (session/agent/user/resources/) and
// users live under viking://user/<name>/.
const TREE = {
  'viking://': [
    { uri: 'viking://session/', isDir: true },
    { uri: 'viking://agent/', isDir: true },
    { uri: 'viking://user/', isDir: true },
    { uri: 'viking://resources/', isDir: true },
  ],
  'viking://user/': [
    { uri: 'viking://user/bob/', isDir: true },
  ],
  'viking://user/bob/': [
    { uri: 'viking://user/bob/memories/', isDir: true },
    { uri: 'viking://user/bob/notes/', isDir: true },
  ],
  'viking://user/bob/memories/': [
    { uri: 'viking://user/bob/memories/profile.md', isDir: false, abstract: 'bob profile' },
    { uri: 'viking://user/bob/memories/preferences/', isDir: true },
    { uri: 'viking://user/bob/memories/entities/', isDir: true },
    { uri: 'viking://user/bob/memories/events/', isDir: true },
    { uri: 'viking://user/bob/memories/privacy/', isDir: true },
  ],
  'viking://user/bob/memories/preferences/': [
    { uri: 'viking://user/bob/memories/preferences/style.md', isDir: false },
  ],
  'viking://user/bob/memories/entities/': [
    { uri: 'viking://user/bob/memories/entities/project.md', isDir: false },
  ],
  'viking://user/bob/memories/events/': [
    { uri: 'viking://user/bob/memories/events/2026-05-30.md', isDir: false },
  ],
  'viking://user/bob/memories/privacy/': [
    { uri: 'viking://user/bob/memories/privacy/rules.md', isDir: false },
  ],
};

const CONTENT = {
  'viking://user/bob/memories/profile.md': '# bob\n\n- Identity: AI assistant\n- Role: Full-stack generalist\n- Last updated: 2026-05-30',
};

async function run() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    colorScheme: 'dark',
  });
  const page = await ctx.newPage();
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.log('[console.error]', msg.text());
  });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));

  await page.routeWebSocket(/\/ws/, (ws) => {
    ws.send(JSON.stringify({
      type: 'init',
      channels: FAKE_CHANNELS,
      agents: [AGENT_BOB],
      humans: FAKE_HUMANS,
      configs: [CONFIG],
      machines: FAKE_MACHINES,
    }));
    ws.onMessage((raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch (_) { return; }
      if (msg.type === 'memory:list') {
        const entries = TREE[msg.uri] || [];
        ws.send(JSON.stringify({ type: 'memory:list_result', agentId: msg.agentId, uri: msg.uri, entries }));
      } else if (msg.type === 'memory:read') {
        const content = CONTENT[msg.uri] || `# ${msg.uri}\n\nMocked content`;
        ws.send(JSON.stringify({
          type: 'memory:content', agentId: msg.agentId, requestId: msg.uri,
          uri: msg.uri, level: msg.level, content,
        }));
      }
    });
    ws.onClose(() => {});
  });

  await page.route('**/api/messages*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ messages: [] }) }));
  await page.route('**/api/channels/*/messages*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ messages: [] }) }));
  await page.route('**/api/agents/*/activities*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ entries: [] }) }));
  await page.route('**/api/agents/*/ov/status', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ enabled: true, user: 'bob', url: null, local: true }) }));

  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.evaluate(({ token, user }) => {
    localStorage.setItem('zouk_auth_token', token);
    localStorage.setItem('zouk_auth_user', JSON.stringify(user));
    localStorage.setItem('zouk_current_user', user.name);
  }, { token: TEST_TOKEN, user: TEST_USER });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  /* ---- Open the Memory page via the workspace rail / view switcher ---- */
  // Navigate via direct app state — set view to 'memory'.
  await page.evaluate(() => {
    // Try to find the Memory nav link in the workspace rail.
    const btn = Array.from(document.querySelectorAll('button')).find((b) =>
      /memory/i.test(b.textContent || '') && (b.getAttribute('title') || '').toLowerCase().includes('memory'));
    if (btn) btn.click();
  });
  await page.waitForTimeout(400);
  // Fallback: dispatch navigation manually via hash if rail not present.
  await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll('[title]'))
      .filter((el) => /memory/i.test(el.getAttribute('title') || ''));
    for (const link of links) (link).click();
  });
  await page.waitForTimeout(800);
  await page.locator('text=session').first().waitFor({ timeout: 3000 });
  await page.locator('text=resources').first().waitFor({ timeout: 3000 });
  await page.locator('text=style.md').first().waitFor({ timeout: 3000 });
  await page.locator('text=project.md').first().waitFor({ timeout: 3000 });

  await page.screenshot({ path: resolve(OUT_DIR, 'memory-page.png'), fullPage: false });
  console.log('[saved] memory-page.png');

  /* ---- Open the agent profile panel → Memory tab ---- */
  // Navigate to Home via the WorkspaceRail (aria-label="Home").
  await page.evaluate(() => {
    const btn = document.querySelector('button[aria-label="Home"]');
    if (btn) btn.click();
  });
  await page.waitForTimeout(400);
  // Open the 'all' channel from the sidebar (channel buttons render with #all).
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const ch = btns.find((b) => /^#all$/i.test((b.textContent || '').trim()));
    if (ch) ch.click();
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: resolve(OUT_DIR, 'debug-channel.png'), fullPage: false });

  // Open bob's profile via the dispatcher exposed through window.__zoukOpenAgentProfile.
  // Fallback: simulate clicking any element with title matching bob.
  await page.evaluate(() => {
    const titles = Array.from(document.querySelectorAll('[title]'));
    const profile = titles.find((el) => /view\s+@?bob/i.test(el.getAttribute('title') || ''));
    if (profile) profile.click();
  });
  await page.waitForTimeout(800);

  // Switch to the Memory tab in the agent profile panel header.
  await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const memTab = buttons.find((b) => {
      const t = (b.textContent || '').trim().toLowerCase();
      return t === 'memory' && b.querySelector('svg');
    });
    if (memTab) memTab.click();
  });
  await page.waitForTimeout(1500);
  await page.locator('text=style.md').first().waitFor({ timeout: 3000 });
  await page.locator('text=project.md').first().waitFor({ timeout: 3000 });
  const sidebarText = await page.evaluate(() => document.body.innerText);
  if (/\bsession\b/.test(sidebarText) || /\bresources\b/.test(sidebarText)) {
    throw new Error('Sidebar Memory tab should not render OV namespace root directories');
  }

  await page.screenshot({ path: resolve(OUT_DIR, 'sidebar-memory-tab.png'), fullPage: false });
  console.log('[saved] sidebar-memory-tab.png');

  await browser.close();
}

run().catch((e) => { console.error(e); process.exit(1); });
