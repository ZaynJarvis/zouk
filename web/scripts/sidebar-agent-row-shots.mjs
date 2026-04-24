#!/usr/bin/env node
import { chromium } from 'playwright';
import { mkdirSync } from 'fs';
import { resolve } from 'path';
import { loadApp, FAKE_CHANNELS, FAKE_HUMANS, FAKE_MACHINES } from './qa-lib.mjs';

const URL = process.env.URL || 'http://localhost:7777';
const OUT = resolve(process.cwd(), 'qa-screenshots/sidebar-agent-row');
mkdirSync(OUT, { recursive: true });

function usageSnap({ model = 'claude-sonnet-4-6', usedTokens, percent }) {
  const contextWindow = 200_000;
  const entry = {
    model,
    inputTokens: usedTokens,
    outputTokens: 0,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
    usedTokens,
    contextWindow,
    percent,
  };
  return {
    updatedAt: new Date().toISOString(),
    summary: entry,
    models: [entry],
  };
}

// Four scenarios to demonstrate the layout end-to-end:
//  plain active (just [profile][name][space][reset][setting])
//  active with context usage visible
//  active with unread badge next to name
//  active with BOTH unread + token usage
const AGENTS = [
  { id: 'ag-plain', name: 'plain-bot', displayName: 'Plain Bot', runtime: 'claude', model: 'claude-sonnet-4-6', status: 'active', activity: 'online', machineId: 'machine-001' },
  { id: 'ag-usage', name: 'busy-bot',  displayName: 'Busy Bot',  runtime: 'claude', model: 'claude-sonnet-4-6', status: 'active', activity: 'working', machineId: 'machine-001',
    contextUsage: usageSnap({ usedTokens: 82_000, percent: 0.41 }) },
  { id: 'ag-notif', name: 'pinged-bot', displayName: 'Pinged Bot', runtime: 'claude', model: 'claude-sonnet-4-6', status: 'active', activity: 'online', machineId: 'machine-001' },
  { id: 'ag-both',  name: 'hot-bot',    displayName: 'Hot Bot',    runtime: 'claude', model: 'claude-sonnet-4-6', status: 'active', activity: 'working', machineId: 'machine-001',
    contextUsage: usageSnap({ usedTokens: 168_000, percent: 0.84 }) },
  { id: 'ag-offline', name: 'offline-bot', displayName: 'Offline Bot', runtime: 'claude', model: 'claude-sonnet-4-6', status: 'inactive', activity: 'offline', machineId: 'machine-001' },
];

const CONFIGS = AGENTS.map(a => ({ id: a.id, name: a.name, displayName: a.displayName, runtime: a.runtime, model: a.model, description: `${a.displayName} demo`, picture: null }));

// Messages simulate prior DM traffic; they're used only to seed the DM history panel
// if the user opens it. Sidebar unread badges come from live new_message events below.
const MESSAGES = [];

async function run() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();

  await page.route('**/api/messages*', (route) => {
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ messages: MESSAGES }) });
  });
  await page.route('**/api/channels/*/messages*', (route) => {
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ messages: MESSAGES }) });
  });

  // Seed two unread DMs (pinged-bot + hot-bot) so their rows show the notification badge.
  // new_message events with channel_type='dm' and a sender_name that differs from the
  // current user will flow through the store's DM unread-bump path.
  const dmEvents = [
    {
      type: 'new_message',
      message: {
        id: 'dm-msg-1',
        channel_id: 'dm-pinged',
        channel_name: 'dm:QA Tester,pinged-bot',
        channel_type: 'dm',
        dm_parties: ['QA Tester', 'pinged-bot'],
        sender_name: 'pinged-bot',
        sender_type: 'agent',
        content: 'ping',
        timestamp: new Date(Date.now() - 30_000).toISOString(),
      },
    },
    {
      type: 'new_message',
      message: {
        id: 'dm-msg-2',
        channel_id: 'dm-hot',
        channel_name: 'dm:QA Tester,hot-bot',
        channel_type: 'dm',
        dm_parties: ['QA Tester', 'hot-bot'],
        sender_name: 'hot-bot',
        sender_type: 'agent',
        content: 'hi again',
        timestamp: new Date(Date.now() - 20_000).toISOString(),
      },
    },
    {
      type: 'new_message',
      message: {
        id: 'dm-msg-3',
        channel_id: 'dm-hot',
        channel_name: 'dm:QA Tester,hot-bot',
        channel_type: 'dm',
        dm_parties: ['QA Tester', 'hot-bot'],
        sender_name: 'hot-bot',
        sender_type: 'agent',
        content: 'still here',
        timestamp: new Date(Date.now() - 10_000).toISOString(),
      },
    },
  ];

  await loadApp(page, URL, {
    initOverride: {
      agents: AGENTS,
      humans: FAKE_HUMANS,
      configs: CONFIGS,
      machines: FAKE_MACHINES,
      channels: FAKE_CHANNELS,
    },
    extraMessages: dmEvents,
  });

  // Give the extra WS events time to apply.
  await page.waitForTimeout(1200);


  // Ensure sidebar is open (on desktop viewport it defaults to open, but be explicit).
  await page.evaluate(() => {
    document.body.click();
  });

  // Resolve the sidebar container by walking up from a known child (the "Zouk" / "ZOUK" title).
  const title = page.locator('h2').filter({ hasText: /^Zouk$|^ZOUK$/i }).first();
  await title.waitFor({ timeout: 10_000 });
  const sidebarHandle = await title.evaluateHandle(el => {
    let node = el;
    while (node && node.parentElement) {
      node = node.parentElement;
      const rect = node.getBoundingClientRect();
      // sidebar container has a tall height and a narrow width (200-320px)
      if (rect.height > 400 && rect.width > 180 && rect.width < 360) return node;
    }
    return el.closest('div') || el;
  });
  const sidebarBox = await sidebarHandle.asElement().boundingBox();
  if (!sidebarBox) throw new Error('Sidebar bounding box missing');

  // Full sidebar screenshot.
  await page.screenshot({
    path: resolve(OUT, 'sidebar-full.png'),
    clip: { x: sidebarBox.x, y: sidebarBox.y, width: sidebarBox.width, height: sidebarBox.height },
  });

  // Tight crop on just the Agents list area.
  const agentsHeader = page.getByText('Agents', { exact: true }).first();
  const headerBox = await agentsHeader.boundingBox();
  if (headerBox) {
    const cropY = Math.max(sidebarBox.y, headerBox.y - 6);
    const cropHeight = Math.min(sidebarBox.y + sidebarBox.height - cropY, 40 + AGENTS.length * 36);
    await page.screenshot({
      path: resolve(OUT, 'agents-section.png'),
      clip: { x: sidebarBox.x, y: cropY, width: sidebarBox.width, height: cropHeight },
    });
  }

  // Hover over an agent row to demonstrate reveal of reset/settings buttons.
  const busyRow = page.locator('button', { hasText: 'Busy Bot' }).first();
  await busyRow.hover();
  await page.waitForTimeout(200);
  const busyBox = await busyRow.boundingBox();
  if (busyBox) {
    await page.screenshot({
      path: resolve(OUT, 'agents-section-hover.png'),
      clip: {
        x: sidebarBox.x,
        y: Math.max(sidebarBox.y, busyBox.y - 90),
        width: sidebarBox.width,
        height: Math.min(sidebarBox.height, 220),
      },
    });
  }

  console.log('Wrote screenshots to', OUT);

  await browser.close();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
