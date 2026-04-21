#!/usr/bin/env node
/**
 * Visual QA for the thread-polish PR:
 *  1. click outside hides thread (UX change, verified on device)
 *  2. "Reply in thread" text stripped; icon stays (+ count)
 *  3. phone/PWA always-show the hover reply button
 *
 * Output under web/qa-screenshots/thread-polish/:
 *   desktop-hover-reply.png    — hover reveals the reply icon (no text)
 *   desktop-inline-preview.png — inline thread preview shows icon + count
 *   desktop-thread-open.png    — thread panel open in the right rail
 *   mobile-reply-icons.png     — phone viewport; reply icons visible by default
 */

import { chromium } from 'playwright';
import { mkdirSync } from 'fs';
import { resolve } from 'path';
import { loadApp } from './qa-lib.mjs';

const URL = process.env.ZOUK_URL || 'http://127.0.0.1:5199';
const OUT = resolve(process.cwd(), 'qa-screenshots/thread-polish');
mkdirSync(OUT, { recursive: true });

const parentId = 'msg-parent-1';
const threadShortId = parentId.slice(0, 8);
const now = Date.now();

const seedMessages = [
  { id: 'msg-a', channel_name: 'all', channel_type: 'channel', sender_name: 'tim', sender_type: 'agent', content: 'status-dot audit clean — zero regressions.', timestamp: new Date(now - 180000).toISOString() },
  {
    id: parentId,
    channel_name: 'all',
    channel_type: 'channel',
    sender_name: 'zaynjarvis',
    sender_type: 'human',
    content: 'shipping the thread-polish batch: click-outside-to-hide, text stripped from the entry, hover button always visible on touch.',
    timestamp: new Date(now - 120000).toISOString(),
    replies: [
      { id: 'msg-reply-1', channel_name: `all:${threadShortId}`, channel_type: 'thread', sender_name: 'Hela',  sender_type: 'agent', content: 'approved — merge after QA shots.', timestamp: new Date(now - 90000).toISOString() },
      { id: 'msg-reply-2', channel_name: `all:${threadShortId}`, channel_type: 'thread', sender_name: 'alice', sender_type: 'agent', content: 'on it — cropping the desktop + phone views now.', timestamp: new Date(now - 60000).toISOString() },
    ],
  },
  { id: 'msg-b', channel_name: 'all', channel_type: 'channel', sender_name: 'zeus', sender_type: 'agent', content: 'CI green for PR 149; waiting on device QA.', timestamp: new Date(now - 80000).toISOString() },
  { id: 'msg-c', channel_name: 'all', channel_type: 'channel', sender_name: 'alice', sender_type: 'agent', content: 'entry point now reads as a compact glyph — less chrome at rest.', timestamp: new Date(now - 40000).toISOString() },
];

const threadReplies = seedMessages[1].replies.map((m) => ({
  id: m.id,
  channel_name: m.channel_name,
  channel_type: m.channel_type,
  parent_message_id: parentId,
  sender_name: m.sender_name,
  sender_type: m.sender_type,
  content: m.content,
  timestamp: m.timestamp,
}));

const extraMessages = seedMessages.map((message) => ({ type: 'new_message', message }));

async function boot(page) {
  await page.route('**/api/messages*', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ messages: seedMessages }),
  }));
  await page.route('**/api/channels/*/messages*', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ messages: seedMessages }),
  }));
  await page.route('**/api/threads/**', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ messages: threadReplies }),
  }));
  await loadApp(page, URL, { extraMessages });
  await page.waitForTimeout(600);
}

async function full(page, file) {
  await page.screenshot({ path: resolve(OUT, file), fullPage: false });
  console.log('Saved:', file);
}

// ── Desktop ────────────────────────────────────────────────────────────────
{
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await boot(page);

  // Hover msg-c in message list to reveal the reply icon.
  const msgCRow = page.locator('.group').filter({ hasText: 'entry point now reads as a compact glyph' }).first();
  await msgCRow.scrollIntoViewIfNeeded();
  await msgCRow.hover();
  await page.waitForTimeout(300);
  await full(page, 'desktop-hover-reply.png');

  // Inline thread preview shot (scoped to the parent message).
  const parentRow = page.locator('.group').filter({ hasText: 'shipping the thread-polish batch' }).first();
  await parentRow.scrollIntoViewIfNeeded();
  const box = await parentRow.boundingBox();
  if (box) {
    await page.screenshot({
      path: resolve(OUT, 'desktop-inline-preview.png'),
      clip: {
        x: Math.max(0, box.x - 20),
        y: Math.max(0, box.y - 10),
        width: Math.min(1100, 1440 - Math.max(0, box.x - 20)),
        height: Math.min(240, 900 - Math.max(0, box.y - 10)),
      },
    });
    console.log('Saved: desktop-inline-preview.png');
  }

  // Open thread via inline preview footer button (has reply count in title).
  const inlineBtn = page.locator('button[title*="replies"], button[title*="1 reply"]').first();
  await inlineBtn.click();
  await page.waitForTimeout(500);
  await full(page, 'desktop-thread-open.png');

  await ctx.close();
  await browser.close();
}

// ── Mobile: reply icons visible by default on coarse pointer ───────────────
{
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 393, height: 852 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
  });
  // Force-match pointer:coarse for CSS evaluation (Playwright's Chromium
  // otherwise reports pointer:fine even with hasTouch).
  await ctx.addInitScript(() => {
    const origMatch = window.matchMedia;
    window.matchMedia = (q) => {
      if (/pointer:\s*coarse/.test(q)) {
        return { matches: true, media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false };
      }
      return origMatch.call(window, q);
    };
  });
  const page = await ctx.newPage();
  await boot(page);
  await page.waitForTimeout(600);
  await full(page, 'mobile-reply-icons.png');
  await ctx.close();
  await browser.close();
}

console.log('Done. See', OUT);
