#!/usr/bin/env node
/**
 * QA shots for the bundle:
 *   1. Thread opens scrolled to the latest reply (instant, no animation)
 *   2. Avatar border-radius softened only on `washington-post` and `carbon`
 *   3. Title-bar notification badge removed
 *   4. Wakeable offline avatar (status=active, activity=offline): palette
 *      stays live (cyan/green), only the status dot is gray
 *
 * PC + phone shots per theme.
 *
 *   node scripts/thread-scroll-avatar-radius-shots.mjs
 *   node scripts/thread-scroll-avatar-radius-shots.mjs --url http://localhost:5210
 */

import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { loadApp, FAKE_AGENTS, FAKE_HUMANS, FAKE_CHANNELS, FAKE_MACHINES } from './qa-lib.mjs';

const URL = process.env.ZOUK_URL || 'http://localhost:5210';
const OUT = resolve(process.cwd(), 'qa-screenshots/thread-scroll-avatar-radius');
mkdirSync(OUT, { recursive: true });

const THEMES = ['carbon', 'washington-post', 'brutalist', 'graphite', 'night-city'];

const PARENT_ID = 'thread-parent-msg';
const SHORT_ID = PARENT_ID.slice(0, 8);
const now = Date.now();

// One parent + 30 replies — many enough that the bottom is well below the fold.
const replies = Array.from({ length: 30 }, (_, i) => ({
  id: `thread-reply-${i + 1}`,
  channel_name: `all:${SHORT_ID}`,
  channel_type: 'thread',
  parent_message_id: PARENT_ID,
  sender_name: i % 2 === 0 ? 'zaynjarvis' : 'alice',
  sender_type: i % 2 === 0 ? 'human' : 'agent',
  content: i === 29
    ? '✅ THIS_IS_THE_BOTTOM — ensures auto-scroll lands here on open'
    : `reply #${i + 1} — bulk filler so the thread scroll has somewhere to go`,
  timestamp: new Date(now - (60 - i) * 60000).toISOString(),
}));

const parentMsg = {
  id: PARENT_ID,
  channel_name: 'all',
  channel_type: 'channel',
  sender_name: 'zaynjarvis',
  sender_type: 'human',
  content: 'thread parent — opening this should land at the bottom (latest reply) instantly',
  timestamp: new Date(now - 70 * 60000).toISOString(),
  replies,
};

const channelMessages = [
  { id: 'msg-pre', channel_name: 'all', channel_type: 'channel', sender_name: 'tim', sender_type: 'agent', content: 'pre-thread message for context', timestamp: new Date(now - 80 * 60000).toISOString() },
  parentMsg,
];

const threadReplies = replies.map((m) => ({ ...m }));

// Override fake agents so one is wakeable-offline (status=active, activity=offline)
// and one is truly inactive (status=inactive). The remaining stays online.
const TWEAKED_AGENTS = [
  { ...FAKE_AGENTS[0], activity: 'online' },
  { ...FAKE_AGENTS[1], status: 'active', activity: 'offline' }, // wakeable-offline
  { id: 'agent-inactive-001', name: 'lost-bot', displayName: 'Lost', runtime: 'claude', model: 'claude-sonnet-4-6', status: 'inactive', activity: 'offline' },
];

async function setTheme(page, theme) {
  await page.evaluate((t) => {
    localStorage.setItem('zouk_theme', t);
    document.documentElement.setAttribute('data-theme', t);
  }, theme);
  await page.waitForTimeout(200);
}

async function bootRoutes(page) {
  await page.route('**/api/messages*', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ messages: channelMessages }),
  }));
  await page.route('**/api/channels/*/messages*', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ messages: channelMessages }),
  }));
  await page.route('**/api/threads/**', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ messages: threadReplies }),
  }));
}

async function bootApp(page) {
  await bootRoutes(page);
  await loadApp(page, URL, {
    initOverride: { agents: TWEAKED_AGENTS, humans: FAKE_HUMANS, channels: FAKE_CHANNELS, machines: FAKE_MACHINES },
  });
}

async function shotDesktop(theme) {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  try {
    await bootApp(page);
    await setTheme(page, theme);
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);

    // Sidebar shot — captures: title (no badge), avatar radius, wakeable-offline palette
    await page.screenshot({
      path: resolve(OUT, `desktop-${theme}-sidebar.png`),
      clip: { x: 0, y: 0, width: 320, height: 600 },
    });

    // Open the thread on the parent message — auto-scroll should land at the bottom
    // Use the inline thread preview footer "X replies" which is always rendered.
    const parent = page.getByText('thread parent — opening this should land').first();
    await parent.waitFor({ state: 'visible', timeout: 8000 });
    // Click the message body container's "thread" button — start a new thread by
    // hovering the row + clicking the in-line reply button if present, or by
    // clicking inline thread footer.
    const inlineReplyButton = page.locator('button[aria-label="Reply in thread"]');
    if (await inlineReplyButton.first().isVisible({ timeout: 800 }).catch(() => false)) {
      await inlineReplyButton.first().click();
    } else {
      // Fallback: hover parent row, then click reply button
      await parent.hover();
      await page.locator('button[title="Reply in thread"]').first().click();
    }
    await page.waitForTimeout(500);

    // Verify "THIS_IS_THE_BOTTOM" sentinel is visible
    const bottomLine = page.getByText('THIS_IS_THE_BOTTOM').first();
    const bottomVisible = await bottomLine.isVisible({ timeout: 2000 }).catch(() => false);

    await page.screenshot({
      path: resolve(OUT, `desktop-${theme}-thread.png`),
      fullPage: false,
    });

    return { theme, viewport: 'desktop', bottomVisible };
  } finally {
    await ctx.close();
    await browser.close();
  }
}

async function shotMobile(theme) {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  try {
    // Inject fake unread counts on the mobile shot — bump #zouk and Tim's DM
    // by sending real `new_message` events from other senders so appStore
    // increments unreadCounts naturally.
    await bootRoutes(page);
    const stamp = Date.now();
    await loadApp(page, URL, {
      initOverride: { agents: TWEAKED_AGENTS, humans: FAKE_HUMANS, channels: FAKE_CHANNELS, machines: FAKE_MACHINES },
      extraMessages: [
        { type: 'new_message', message: { id: 'm-zouk-1', channel_name: 'zouk', channel_type: 'channel', sender_name: 'Hela', sender_type: 'agent', content: 'unread bump 1', timestamp: new Date(stamp - 4000).toISOString() } },
        { type: 'new_message', message: { id: 'm-zouk-2', channel_name: 'zouk', channel_type: 'channel', sender_name: 'Hela', sender_type: 'agent', content: 'unread bump 2', timestamp: new Date(stamp - 3000).toISOString() } },
        { type: 'new_message', message: { id: 'm-zouk-3', channel_name: 'zouk', channel_type: 'channel', sender_name: 'Hela', sender_type: 'agent', content: 'unread bump 3', timestamp: new Date(stamp - 2000).toISOString() } },
        { type: 'new_message', message: { id: 'm-tim-1', channel_name: 'tim-bot', channel_type: 'dm', sender_name: 'tim-bot', sender_type: 'agent', content: 'tim DM bump 1', timestamp: new Date(stamp - 1500).toISOString(), dm_parties: ['QA Tester', 'tim-bot'] } },
        { type: 'new_message', message: { id: 'm-tim-2', channel_name: 'tim-bot', channel_type: 'dm', sender_name: 'tim-bot', sender_type: 'agent', content: 'tim DM bump 2', timestamp: new Date(stamp - 1000).toISOString(), dm_parties: ['QA Tester', 'tim-bot'] } },
      ],
    });
    await setTheme(page, theme);
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);

    // Open sidebar drawer on mobile so the title + avatars are visible
    const menuFab = page.locator('button[aria-label="Open sidebar"]').first();
    if (await menuFab.isVisible({ timeout: 800 }).catch(() => false)) {
      await menuFab.click();
      await page.waitForTimeout(400);
    }
    await page.screenshot({
      path: resolve(OUT, `mobile-${theme}-sidebar.png`),
      fullPage: false,
    });

    return { theme, viewport: 'mobile' };
  } finally {
    await ctx.close();
    await browser.close();
  }
}

async function main() {
  const summary = [];
  for (const theme of THEMES) {
    try {
      const d = await shotDesktop(theme);
      summary.push(d);
      console.log(`✓ desktop-${theme} bottomVisible=${d.bottomVisible}`);
    } catch (e) {
      console.log(`✗ desktop-${theme}: ${e.message}`);
      summary.push({ theme, viewport: 'desktop', error: e.message });
    }
    try {
      const m = await shotMobile(theme);
      summary.push(m);
      console.log(`✓ mobile-${theme}`);
    } catch (e) {
      console.log(`✗ mobile-${theme}: ${e.message}`);
      summary.push({ theme, viewport: 'mobile', error: e.message });
    }
  }
  writeFileSync(resolve(OUT, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log('\nOut:', OUT);
}

main().catch((e) => { console.error('Fatal:', e); process.exit(1); });
