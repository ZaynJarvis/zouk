#!/usr/bin/env node
/**
 * Syntax-highlight visual review tool.
 *
 * Seeds a set of fake messages exercising the best-effort syntax
 * highlighter — multiple registered languages, one unknown language,
 * and one fenced block with no language specified (must render plain
 * per product spec). Captures PC + mobile at medium font-size (the
 * existing markdown-readability-shots.mjs already covers small/large).
 *
 * Usage:
 *   node scripts/syntax-highlight-shots.mjs
 *   node scripts/syntax-highlight-shots.mjs --url http://localhost:5173
 */

import { chromium } from 'playwright';
import { mkdirSync } from 'fs';
import { resolve } from 'path';
import { mockWS, setupAuth, TEST_USER } from './qa-lib.mjs';

const PC = { width: 1280, height: 900 };
const MOBILE = { width: 390, height: 844 };

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    url: 'http://localhost:5173',
    out: null,
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--url' && args[i + 1]) opts.url = args[++i];
    if (args[i] === '--out' && args[i + 1]) opts.out = resolve(args[++i]);
  }
  if (!opts.out) {
    opts.out = resolve(process.cwd(), 'qa-screenshots', 'syntax-highlight');
  }
  return opts;
}

const MOCK_MESSAGES = [
  {
    sender_name: 'Alice',
    sender_type: 'agent',
    content: `**TypeScript** — React component w/ generics:
\`\`\`typescript
import { useState, useCallback } from 'react';

export function useCounter<T extends number>(initial: T) {
  const [count, setCount] = useState<T>(initial);
  const increment = useCallback(() => setCount(c => (c + 1) as T), []);
  // Returns a readonly tuple — caller destructures [value, inc]
  return [count, increment] as const;
}
\`\`\``,
  },
  {
    sender_name: 'Bob',
    sender_type: 'agent',
    content: `**Python** — FastAPI handler with type hints:
\`\`\`python
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

class User(BaseModel):
    id: int
    name: str
    active: bool = True

app = FastAPI()

@app.get("/users/{user_id}", response_model=User)
async def get_user(user_id: int) -> User:
    if user_id < 0:
        raise HTTPException(status_code=400, detail="Invalid ID")
    return User(id=user_id, name=f"user-{user_id}")
\`\`\``,
  },
  {
    sender_name: 'Zeus',
    sender_type: 'agent',
    content: [
      '**Bash** — deploy script:',
      '```bash',
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      '',
      'VERSION="${1:-latest}"',
      'echo "Deploying version: $VERSION"',
      '',
      'if [[ -z "$VERSION" ]]; then',
      '  echo "ERROR: version required" >&2',
      '  exit 1',
      'fi',
      '',
      'docker build -t zouk:"$VERSION" .',
      'docker push zouk:"$VERSION"',
      '```',
    ].join('\n'),
  },
  {
    sender_name: 'Tim',
    sender_type: 'agent',
    content: `**JSON** — manifest fragment:
\`\`\`json
{
  "name": "zouk",
  "version": "0.1.0",
  "features": ["chat", "pwa"],
  "icons": [
    { "src": "icon-192.png", "sizes": "192x192", "purpose": "any" }
  ],
  "theme_color": "#0a0a0f"
}
\`\`\``,
  },
  {
    sender_name: 'Hela',
    sender_type: 'agent',
    content: `**SQL** — a small query:
\`\`\`sql
SELECT u.id, u.name, COUNT(m.id) AS msg_count
FROM users u
LEFT JOIN messages m ON m.sender_id = u.id
WHERE u.active = TRUE
GROUP BY u.id, u.name
ORDER BY msg_count DESC
LIMIT 10;
\`\`\``,
  },
  {
    sender_name: 'Alice',
    sender_type: 'agent',
    content: `**Go** — tiny HTTP handler:
\`\`\`go
package main

import (
\t"encoding/json"
\t"net/http"
)

type Pong struct {
\tOK      bool   \`json:"ok"\`
\tMessage string \`json:"message"\`
}

func pingHandler(w http.ResponseWriter, r *http.Request) {
\tw.Header().Set("Content-Type", "application/json")
\tjson.NewEncoder(w).Encode(Pong{OK: true, Message: "pong"})
}
\`\`\``,
  },
  {
    sender_name: 'Bob',
    sender_type: 'agent',
    content: `**CSS** — neon card:
\`\`\`css
.card {
  background: rgb(var(--nc-elevated));
  border: 1px solid rgba(var(--nc-cyan) / 0.4);
  border-radius: 4px;
  padding: 1rem 1.25rem;
  box-shadow: 0 0 16px rgba(var(--nc-cyan) / 0.25);
}
.card:hover { transform: translateY(-1px); }
\`\`\``,
  },
  {
    sender_name: 'zaynjarvis',
    sender_type: 'human',
    content: `And a fence with **no language** — must render plain (no colors) per spec:
\`\`\`
this is a plain code block
no language fence provided
everything should be the default off-white mono color
\`\`\``,
  },
  {
    sender_name: 'zaynjarvis',
    sender_type: 'human',
    content: `And a fence with an **unknown language** (\`brainfuck\` isn't in hljs/common) — also plain:
\`\`\`brainfuck
+++++ +++++ [> +++++ ++ > ++++ +++++ + > +++ < < < -]
> ++ . > + . +++++ ++ . . +++ .
\`\`\``,
  },
  {
    sender_name: 'Alice',
    sender_type: 'agent',
    content: `Inline \`code\` still uses the existing inline pill style — unchanged by this PR. Only fenced blocks are affected.`,
  },
];

function buildExtraMessages() {
  const base = new Date(Date.now() - MOCK_MESSAGES.length * 60_000);
  return MOCK_MESSAGES.map((m, i) => ({
    type: 'message',
    message: {
      id: `mock-hljs-${i + 1}`,
      channel_type: 'channel',
      channel_name: 'all',
      sender_type: m.sender_type,
      sender_name: m.sender_name,
      content: m.content,
      timestamp: new Date(base.getTime() + i * 60_000).toISOString(),
    },
  }));
}

async function capture(browser, { name, viewport, url, outDir }) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const extraMessages = buildExtraMessages();
  await mockWS(page, { extraMessages });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await setupAuth(page, TEST_USER);
  await page.evaluate(() => {
    const prefs = { fontSize: 'medium', chatWidth: '4xl' };
    localStorage.setItem('zouk_preferences', JSON.stringify(prefs));
    document.documentElement.removeAttribute('data-font-size');
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  const allBtn = page.locator('button').filter({ hasText: /^#\s*all/i }).first();
  if (await allBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
    await allBtn.click().catch(() => {});
    await page.waitForTimeout(500);
  }

  // Capture several scroll positions so every code block is visible
  // somewhere across the set (chat messages live inside a scroll
  // container — fullPage alone only captures the visible viewport).
  const positions = [
    { suffix: 'top',    frac: 0.0 },
    { suffix: 'mid',    frac: 0.33 },
    { suffix: 'mid2',   frac: 0.66 },
    { suffix: 'bottom', frac: 1.0 },
  ];
  for (const pos of positions) {
    await page.evaluate((frac) => {
      const scrollers = document.querySelectorAll('[class*="overflow-y"]');
      scrollers.forEach(el => {
        const max = el.scrollHeight - el.clientHeight;
        el.scrollTop = max * frac;
      });
    }, pos.frac);
    await page.waitForTimeout(300);
    const path = resolve(outDir, `${name}-${pos.suffix}.png`);
    await page.screenshot({ path, fullPage: false });
    console.log(`  ✓ ${path}`);
  }

  await ctx.close();
}

async function main() {
  const opts = parseArgs();
  mkdirSync(opts.out, { recursive: true });
  console.log(`\nSyntax-highlight shots`);
  console.log(`  URL:  ${opts.url}`);
  console.log(`  Out:  ${opts.out}\n`);

  const browser = await chromium.launch();

  const combos = [
    { name: 'pc',     viewport: PC },
    { name: 'mobile', viewport: MOBILE },
  ];

  for (const combo of combos) {
    await capture(browser, { ...combo, url: opts.url, outDir: opts.out });
  }

  await browser.close();
  console.log(`\n✅ Done. ${combos.length} screenshots in ${opts.out}\n`);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
