#!/usr/bin/env node
/**
 * Markdown readability visual review tool.
 *
 * Injects a curated set of fake messages exercising every markdown feature
 * the in-house parser supports, then captures PC + mobile screenshots at
 * all three font-size settings (small/medium/large). Output goes into a
 * per-round directory so reviewers can diff rounds.
 *
 * Usage:
 *   node scripts/markdown-readability-shots.mjs --round 1
 *   node scripts/markdown-readability-shots.mjs --round 2 --url http://localhost:5173
 */

import { chromium } from 'playwright';
import { mkdirSync } from 'fs';
import { resolve } from 'path';
import { mockWS, setupAuth, TEST_USER } from './qa-lib.mjs';

const PC = { width: 1280, height: 900 };
const MOBILE = { width: 390, height: 844 };
const FONT_SIZES = ['small', 'medium', 'large'];

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    url: 'http://localhost:5173',
    round: '1',
    out: null,
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--url' && args[i + 1]) opts.url = args[++i];
    if (args[i] === '--round' && args[i + 1]) opts.round = args[++i];
    if (args[i] === '--out' && args[i + 1]) opts.out = resolve(args[++i]);
  }
  if (!opts.out) {
    opts.out = resolve(process.cwd(), 'qa-screenshots', `markdown-round-${opts.round}`);
  }
  return opts;
}

// ─── Mock messages — cover every md feature the parser supports ──────────────
const MOCK_MESSAGES = [
  {
    sender_name: 'Hela',
    sender_type: 'agent',
    content: `# Deployment plan — Friday cut
We ship v2.3 behind the \`ops.release\` flag. Rollback is **automatic** on any *error-rate spike* above __2.5%__.
Status: _green_.`,
  },
  {
    sender_name: 'zaynjarvis',
    sender_type: 'human',
    content: `Hey @Bob — quick scan: is the readability on this okay for phone?
Inline stuff: \`const x = 1\`, bold **ship it**, italic *probably*, @Alice mentioned.`,
  },
  {
    sender_name: 'Bob',
    sender_type: 'agent',
    content: `## Checklist for round 1
- Body paragraph vs heading contrast
- Inline \`code\` sits on the line cleanly
- **Bold**, *italic*, ~~strikethrough~~ behave
- Long URLs wrap: https://example.com/very/long/path/that/should/break/cleanly?query=true&etc=1
- @zaynjarvis can verify on iPhone

### Sub-checks
1. Ordered list item one
2. Ordered list item two with a longer description that runs past the first line
3. Nested numbers keep aligning`,
  },
  {
    sender_name: 'Alice',
    sender_type: 'agent',
    content: `\`\`\`typescript
// Long code block — does it scroll cleanly on mobile?
export function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const segments: (MentionSegment | InlineSegment)[] = [];
  const mentionRegexG = new RegExp(MENTION_TOKEN_REGEX.source, 'gu');
  let m: RegExpExecArray | null;
  while ((m = mentionRegexG.exec(text)) !== null) {
    segments.push({ kind: 'mention', start: m.index, end: m.index + m[0].length, handle: m[2] });
  }
  return segments;
}
\`\`\`

Above should have a language pill, left-aligned code, and scroll horizontally if it overflows.`,
  },
  {
    sender_name: 'Tim',
    sender_type: 'agent',
    content: `> This is a blockquote about a subtle issue.
> It spans multiple lines, mixes *italics* and **bold**,
> and should visually feel distinct from body text.

Under the quote, regular paragraph text resumes with normal weight.`,
  },
  {
    sender_name: 'Zeus',
    sender_type: 'agent',
    content: `### Mixed message — a realistic chat reply

Plain intro line, then a list:
- First item — short
- Second item — has \`inline.code\`, **bold**, and a https://zouk.zaynjarvis.com link
- Third item talks about a longer scenario where the text wraps to a second line so you can check list item hanging indent

---

Then a divider above this paragraph, followed by a fenced block:

\`\`\`bash
# install
pnpm install --frozen-lockfile
pnpm run build
\`\`\`

And a short closer.`,
  },
  {
    sender_name: 'Bob',
    sender_type: 'agent',
    content: `### Rollout status — by region

| Region    | Status      |   Error rate | Owner       |
| :-------- | :---------: | -----------: | :---------- |
| us-east-1 | **green**   |       0.42 % | @Alice      |
| us-west-2 | *canary*    |       1.10 % | @Bob        |
| eu-west-1 | \`pending\`   |            — | @Tim        |
| ap-south-1| **blocked** |       3.20 % | @zaynjarvis |

Left / center / right alignment above comes from the delimiter row. Inline **bold**, *italic*, \`code\`, and @mentions should still render inside cells.`,
  },
  {
    sender_name: 'Hela',
    sender_type: 'agent',
    content: `Edge-case stress test 👇

**Dense inline:** \`x\`/\`y\`/\`z\` tokens in a row, **bold followed by \`code\`**, *italic-with-\`inline\`*, @Alice @Bob @Tim.

Mixed CJK + ASCII: 今天的状态是 **green**，我们继续执行 \`deploy\`。`,
  },
  {
    sender_name: 'zaynjarvis',
    sender_type: 'human',
    content: `One line — what does a single-line reply look like?`,
  },
  {
    sender_name: 'Bob',
    sender_type: 'agent',
    content: `Very long single paragraph to stress wrapping and line-height rhythm: Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.`,
  },
  {
    sender_name: 'Alice',
    sender_type: 'agent',
    content: `## Tasks summary
- [ ] This is how a raw \`- [ ]\` renders (we don't have real task boxes — should still read well)
- Multiple lines
  - nested is not supported yet, so this stays as a flat item

#### H4 — is this supported? (parser caps at h3)
Regular paragraph under a would-be-h4 marker.`,
  },
];

// Build WS message payloads in the order Zouk expects
function buildExtraMessages() {
  const base = new Date(Date.now() - MOCK_MESSAGES.length * 60_000);
  return MOCK_MESSAGES.map((m, i) => ({
    type: 'message',
    message: {
      id: `mock-md-${i + 1}`,
      channel_type: 'channel',
      channel_name: 'all',
      sender_type: m.sender_type,
      sender_name: m.sender_name,
      content: m.content,
      timestamp: new Date(base.getTime() + i * 60_000).toISOString(),
    },
  }));
}

async function capture(browser, { name, viewport, fontSize, url, outDir }) {
  const ctx = await browser.newContext({
    viewport,
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();
  const extraMessages = buildExtraMessages();
  await mockWS(page, { extraMessages });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await setupAuth(page, TEST_USER);
  // Pre-seed font-size so the first paint has the right value
  await page.evaluate((fs) => {
    const prefs = { fontSize: fs, chatWidth: '4xl' };
    localStorage.setItem('zouk_preferences', JSON.stringify(prefs));
    if (fs === 'medium') {
      document.documentElement.removeAttribute('data-font-size');
    } else {
      document.documentElement.setAttribute('data-font-size', fs);
    }
  }, fontSize);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  // Ensure the 'all' channel is active (it should be by default, but be explicit)
  const allBtn = page.locator('button').filter({ hasText: /^#\s*all/i }).first();
  if (await allBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
    await allBtn.click().catch(() => {});
    await page.waitForTimeout(500);
  }

  // Scroll to bottom to show newest message
  await page.evaluate(() => {
    const scrollers = document.querySelectorAll('[class*="overflow-y"]');
    scrollers.forEach(el => { el.scrollTop = el.scrollHeight; });
  });
  await page.waitForTimeout(300);

  // fullPage captures the whole scroll container
  const path = resolve(outDir, `${name}.png`);
  await page.screenshot({ path, fullPage: true });
  console.log(`  ✓ ${path}`);

  // Also capture a viewport-only shot scrolled halfway up so the code-block
  // message (Alice's `typescript` block) is likely in-frame — easier to spot
  // block-code issues during review.
  await page.evaluate(() => {
    const scrollers = document.querySelectorAll('[class*="overflow-y"]');
    scrollers.forEach(el => { el.scrollTop = Math.max(0, el.scrollHeight - el.clientHeight * 2.2); });
  });
  await page.waitForTimeout(200);
  const codePath = resolve(outDir, `${name}-codeblock.png`);
  await page.screenshot({ path: codePath, fullPage: false });
  console.log(`  ✓ ${codePath}`);

  await ctx.close();
}

async function main() {
  const opts = parseArgs();
  mkdirSync(opts.out, { recursive: true });
  console.log(`\nMarkdown readability shots — round ${opts.round}`);
  console.log(`  URL:  ${opts.url}`);
  console.log(`  Out:  ${opts.out}\n`);

  const browser = await chromium.launch();

  const combos = [];
  for (const fs of FONT_SIZES) {
    combos.push({ name: `pc-${fs}`,     viewport: PC,     fontSize: fs });
    combos.push({ name: `mobile-${fs}`, viewport: MOBILE, fontSize: fs });
  }

  for (const combo of combos) {
    await capture(browser, { ...combo, url: opts.url, outDir: opts.out });
  }

  await browser.close();
  console.log(`\n✅ Done. ${combos.length} screenshots in ${opts.out}\n`);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
