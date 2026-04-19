#!/usr/bin/env node
/**
 * Desktop composer visual check — 1280×800 with a few seeded messages so we
 * can see the color transition (or lack thereof) between chat body and the
 * composer. Compare against pwa-safe-area-shot.mjs for mobile PWA view.
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
  { type: 'new_message', message: { id: 'm1', channel_name: 'all', channel_type: 'channel', sender_name: 'zaynjarvis', sender_type: 'human', content: 'Hey team, pushing a composer polish fix today.', timestamp: new Date(now - 120000).toISOString() } },
  { type: 'new_message', message: { id: 'm2', channel_name: 'all', channel_type: 'channel', sender_name: 'hela-bot', sender_type: 'agent', content: 'Acknowledged — removing the distinct bg band below the composer so the chat bg extends seamlessly to the viewport edge.', timestamp: new Date(now - 90000).toISOString() } },
  { type: 'new_message', message: { id: 'm3', channel_name: 'all', channel_type: 'channel', sender_name: 'qa-bot', sender_type: 'agent', content: 'Standing by for re-eval with desktop + PWA screenshots.', timestamp: new Date(now - 60000).toISOString() } },
];

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();
await loadApp(page, URL, { extraMessages });
await page.waitForTimeout(600);
const shot = resolve(OUT, 'desktop-composer.png');
await page.screenshot({ path: shot, fullPage: false });
console.log('Saved:', shot);
await browser.close();
