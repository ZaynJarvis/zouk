#!/usr/bin/env node
/**
 * Regression check for agent activity rendering.
 *
 * Verifies:
 * - shell tool entries show the command, not raw JSON
 * - empty thinking-status heartbeats are suppressed
 */

import { chromium } from 'playwright';
import { mkdirSync } from 'fs';
import { resolve } from 'path';
import { loadApp, FAKE_AGENTS, FAKE_CONFIGS } from './qa-lib.mjs';

const OUT = resolve(process.cwd(), 'qa-screenshots', 'activity-feed-render');
const URL = process.argv.includes('--url')
  ? process.argv[process.argv.indexOf('--url') + 1]
  : 'http://localhost:5173';

const agent = {
  ...FAKE_AGENTS[0],
  id: 'agent-activity-render',
  name: 'render-bot',
  displayName: 'Render Bot',
  status: 'active',
  activity: 'working',
  activityDetail: 'Rendering activity feed',
  entries: [
    {
      kind: 'status',
      activity: 'thinking',
      title: 'THINKING',
      timestamp: new Date(Date.now() - 60_000).toISOString(),
    },
    {
      kind: 'note',
      title: 'Thinking',
      content: 'Reviewing the current activity events.',
      level: 'warning',
      timestamp: new Date(Date.now() - 55_000).toISOString(),
    },
    {
      kind: 'tool',
      title: 'Tool · shell',
      toolName: 'shell',
      content: JSON.stringify({ command: "/bin/zsh -lc 'git status --short --branch'" }),
      timestamp: new Date(Date.now() - 50_000).toISOString(),
    },
    {
      kind: 'tool',
      title: 'Tool · shell',
      toolName: 'shell',
      toolInputSummary: JSON.stringify({ command: "/bin/zsh -lc 'npm test'" }),
      timestamp: new Date(Date.now() - 45_000).toISOString(),
    },
  ],
};

const config = {
  ...FAKE_CONFIGS[0],
  id: agent.id,
  name: agent.name,
  displayName: agent.displayName,
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();

await page.route('**/api/messages*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ messages: [] }) }));
await page.route('**/api/channels/*/messages*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ messages: [] }) }));
await page.route('**/api/agents/*/activities*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ entries: agent.entries }) }));

await loadApp(page, URL, {
  initOverride: {
    agents: [agent],
    configs: [config],
  },
});

await page.click('[title="View @Render Bot profile"]');
await page.waitForTimeout(800);

const body = await page.locator('body').innerText();
assert(body.includes('git status --short --branch'), 'shell command summary should be visible');
assert(body.includes('npm test'), 'shell command summary from toolInputSummary should be visible');
assert(!body.includes('"command"'), 'raw shell JSON should not be visible');

assert(!body.includes('THINKING'), 'empty THINKING status heartbeat should be hidden');

await page.screenshot({ path: resolve(OUT, 'activity-feed-render.png'), fullPage: false });
await browser.close();

console.log(`[ok] activity feed render regression -> ${OUT}`);
