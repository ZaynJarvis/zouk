#!/usr/bin/env node
import { chromium } from 'playwright';
import { mkdirSync } from 'fs';
import { resolve } from 'path';
import { loadApp } from './qa-lib.mjs';

const URL = process.env.URL || 'http://localhost:7777';
const OUT = resolve(process.cwd(), 'qa-screenshots/status-dots');
mkdirSync(OUT, { recursive: true });

const AGENTS = [
  { id: 'ag-work', name: 'working-bot', displayName: 'Working Bot', runtime: 'claude', model: 'claude-sonnet-4-6', status: 'active', activity: 'working', activityDetail: 'running tool', machineId: 'm1' },
  { id: 'ag-think', name: 'thinking-bot', displayName: 'Thinking Bot', runtime: 'claude', model: 'claude-sonnet-4-6', status: 'active', activity: 'thinking', activityDetail: '', machineId: 'm1' },
  { id: 'ag-idle', name: 'idle-bot', displayName: 'Idle Bot', runtime: 'claude', model: 'claude-sonnet-4-6', status: 'active', activity: 'online', machineId: 'm1' },
  { id: 'ag-off', name: 'offline-bot', displayName: 'Offline Bot', runtime: 'claude', model: 'claude-sonnet-4-6', status: 'inactive', activity: 'offline', machineId: 'm1' },
  { id: 'ag-off-active', name: 'offline-active-bot', displayName: 'Offline (Active) Bot', runtime: 'claude', model: 'claude-sonnet-4-6', status: 'active', activity: 'offline', machineId: 'm1' },
];

const CONFIGS = AGENTS.map(a => ({ id: a.id, name: a.name, displayName: a.displayName, runtime: a.runtime, model: a.model, description: `${a.displayName} demo agent`, picture: null }));

const HUMANS = [
  { id: 'h-on',  name: 'alice-online',  email: 'a@test.local', picture: null, online: true },
  { id: 'h-off', name: 'bob-offline',   email: 'b@test.local', picture: null, online: false },
  { id: 'h-me',  name: 'QA Tester',     email: 'qa@test.local', picture: null, online: true },
];

const MACHINES = [{ id: 'm1', hostname: 'demo', os: 'darwin arm64', runtimes: ['claude'], capabilities: [] }];

const CHANNELS = [{ id: 'ch-all', name: 'all', description: 'General', members: [] }];

const MESSAGES = [
  { id: 'msg-1', channel_id: 'ch-all', channel: 'all', sender_name: 'Working Bot', sender_type: 'agent', content: 'I am currently working — a yellow dot should appear on my avatar.', timestamp: new Date(Date.now() - 60_000).toISOString() },
  { id: 'msg-2', channel_id: 'ch-all', channel: 'all', sender_name: 'Idle Bot', sender_type: 'agent', content: 'I am online but idle. No dot on my message avatar.', timestamp: new Date(Date.now() - 40_000).toISOString() },
  { id: 'msg-3', channel_id: 'ch-all', channel: 'all', sender_name: 'alice-online', sender_type: 'human', content: 'Humans never show yellow.', timestamp: new Date(Date.now() - 20_000).toISOString() },
];

async function run() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  await page.route('**/api/messages*', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ messages: MESSAGES }),
    });
  });
  await page.route('**/api/channels/*/messages*', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ messages: MESSAGES }),
    });
  });

  await loadApp(page, URL, {
    initOverride: {
      agents: AGENTS,
      humans: HUMANS,
      configs: CONFIGS,
      machines: MACHINES,
      channels: CHANNELS,
    },
    extraMessages: MESSAGES.map((m) => ({ type: 'message', message: m })),
  });

  // 1. Full home view (channel + messages visible)
  await page.screenshot({ path: `${OUT}/01-home.png`, fullPage: false });

  // 2. Open MembersPanel (right panel toggler) — press "Members" button if present
  const membersBtn = page.getByRole('button', { name: /Members/i }).first();
  if (await membersBtn.isVisible().catch(() => false)) {
    await membersBtn.click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/02-members-panel.png` });
  }

  // 3. Mention dropdown — click composer, type @
  const composer = page.locator('textarea').first();
  await composer.click();
  await composer.fill('@');
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/03-mention-dropdown.png` });
  await composer.fill('');

  // 4. Agents view — click agents icon in sidebar (TopBar or similar)
  const agentsBtn = page.getByRole('button', { name: /agents|agent/i }).first();
  if (await agentsBtn.isVisible().catch(() => false)) {
    await agentsBtn.click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${OUT}/04-agents-view.png` });
  }

  console.log(`Screenshots written to ${OUT}`);
  await browser.close();
}

run().catch((e) => { console.error(e); process.exit(1); });
