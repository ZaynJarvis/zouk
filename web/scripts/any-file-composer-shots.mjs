#!/usr/bin/env node
/**
 * Visual QA for the any-file composer (replaces image-only restriction).
 * Produces under qa-screenshots/:
 *   any-file-composer-empty.png       — composer with new Paperclip icon
 *   any-file-composer-mixed.png       — composer with an image preview + a non-image file chip pending
 */

import { chromium } from 'playwright';
import { mkdirSync } from 'fs';
import { resolve } from 'path';
import { loadApp } from './qa-lib.mjs';

const URL = process.env.ZOUK_URL || 'http://localhost:5188';
const OUT = resolve(process.cwd(), 'qa-screenshots');
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();
await loadApp(page, URL);
await page.waitForTimeout(500);

const empty = resolve(OUT, 'any-file-composer-empty.png');
await page.screenshot({ path: empty, fullPage: false });
console.log('Saved:', empty);

// Attach via the hidden file input — both an image and a text file.
const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9YwQ8QAAAABJRU5ErkJggg==',
  'base64',
);
const TEXT_BYTES = Buffer.from('# notes\nhello from any-file upload\n', 'utf8');

const fileInput = page.locator('input[type="file"]').first();
await fileInput.setInputFiles([
  { name: 'screenshot.png', mimeType: 'image/png', buffer: PNG_BYTES },
  { name: 'notes.md',       mimeType: 'text/markdown', buffer: TEXT_BYTES },
]);
await page.waitForTimeout(300);

const mixed = resolve(OUT, 'any-file-composer-mixed.png');
await page.screenshot({ path: mixed, fullPage: false });
console.log('Saved:', mixed);

await browser.close();
