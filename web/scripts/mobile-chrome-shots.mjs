#!/usr/bin/env node
/**
 * QA for mobile chrome fixes:
 *   1. Menu button pinned bottom-left, always visible (even when typing, even on agents/tasks).
 *   2. Graphite composer radius on mobile matches base themes (19px pill).
 *   3. TopBar channel-settings cog hidden on mobile.
 */

import { chromium } from 'playwright';
import { mkdirSync } from 'fs';
import { resolve } from 'path';
import { loadApp } from './qa-lib.mjs';

const URL = process.env.ZOUK_URL || 'http://localhost:5188';
const OUT = resolve(process.cwd(), 'qa-screenshots');
mkdirSync(OUT, { recursive: true });

const now = Date.now();
const extraMessages = [
  { type: 'new_message', message: { id: 'm1', channel_name: 'all', channel_type: 'channel', sender_name: 'zaynjarvis', sender_type: 'human', content: '修个 mobile end 的问题。', timestamp: new Date(now - 90000).toISOString() } },
  { type: 'new_message', message: { id: 'm2', channel_name: 'all', channel_type: 'channel', sender_name: 'hela-bot', sender_type: 'agent', content: 'Menu 钉左下、Graphite 对齐 radius、Settings cog 隐藏。', timestamp: new Date(now - 30000).toISOString() } },
];

const HOME_INDICATOR_CSS = `
  body::after {
    content: "";
    position: fixed;
    bottom: 8px; left: 50%;
    transform: translateX(-50%);
    width: 140px; height: 5px;
    border-radius: 3px;
    background: rgba(255,255,255,0.6);
    z-index: 100;
    pointer-events: none;
  }
`;

async function shot(label, { theme = null, view = 'channel', focusComposer = false, typedText = '' } = {}) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 393, height: 852 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    bypassCSP: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
  });
  if (theme) {
    await ctx.addInitScript((t) => { localStorage.setItem('zouk_theme', t); }, theme);
  }
  // sidebar closed so the round FAB shows
  await ctx.addInitScript(() => { localStorage.setItem('zouk_sidebar_open', 'false'); });
  const page = await ctx.newPage();
  await loadApp(page, URL, { extraMessages });
  await page.addStyleTag({ content: HOME_INDICATOR_CSS });
  await page.waitForTimeout(500);

  if (view === 'agents') {
    await page.locator('button[aria-label="Agents"]:visible').first().click();
    await page.waitForTimeout(500);
  } else if (view === 'tasks') {
    await page.locator('button[aria-label="Tasks"]:visible').first().click();
    await page.waitForTimeout(500);
  }

  if (focusComposer) {
    const ta = page.locator('textarea[placeholder*="Message"]').first();
    await ta.focus();
    if (typedText) await ta.type(typedText);
    await page.waitForTimeout(300);
  }

  const out = resolve(OUT, `mobile-chrome-${label}.png`);
  await page.screenshot({ path: out, fullPage: false });
  console.log('Saved:', out);
  await browser.close();
}

// Task 1: menu button always bottom-left (chat view — typed composer still shows FAB)
await shot('chat-idle-nc', { theme: 'night-city' });
await shot('chat-typing-nc', { theme: 'night-city', focusComposer: true, typedText: 'hello — composer is focused + menu FAB still pinned bottom-left' });
await shot('agents-view-nc', { theme: 'night-city', view: 'agents' });
await shot('tasks-view-nc', { theme: 'night-city', view: 'tasks' });

// Task 2: graphite composer radius matches on mobile
await shot('chat-graphite', { theme: 'graphite' });
await shot('chat-graphite-typing', { theme: 'graphite', focusComposer: true, typedText: 'graphite on phone' });

// Task 3: TopBar no channel-settings cog on mobile — chat-idle-nc already shows top-right
