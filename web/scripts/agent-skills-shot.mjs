#!/usr/bin/env node
/**
 * Verifies that the Agent Detail → INSTR tab → ADD_SKILL picker now surfaces
 * the real skills returned by zouk-daemon's listSkills instead of the
 * hardcoded Code Review / Bug Triage / E2E Testing / Security Audit mock.
 *
 * Usage:
 *   node scripts/agent-skills-shot.mjs --round 1
 */

import { chromium } from 'playwright';
import { mkdirSync } from 'fs';
import { resolve } from 'path';
import { TEST_USER, TEST_TOKEN, FAKE_CHANNELS, FAKE_HUMANS, FAKE_MACHINES } from './qa-lib.mjs';

const PC = { width: 1280, height: 900 };

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { url: 'http://localhost:5173', round: '1', out: null };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--url' && args[i + 1]) opts.url = args[++i];
    if (args[i] === '--round' && args[i + 1]) opts.round = args[++i];
    if (args[i] === '--out' && args[i + 1]) opts.out = resolve(args[++i]);
  }
  if (!opts.out) {
    opts.out = resolve(process.cwd(), 'web/qa-screenshots', `agent-skills-round-${opts.round}`);
  }
  return opts;
}

// Mirrors what zouk-daemon's listSkills returns for a claude-runtime agent
// after the SKILL_PATHS fix: top-level ~/.claude/skills + plugin marketplace
// entries. Names chosen from real skills on a dev machine.
const SKILLS_PAYLOAD = {
  type: 'skills:list_result',
  agentId: 'agent-alice-001',
  global: [
    { name: 'baidu-netdisk',          displayName: 'baidu-netdisk',           description: '操作百度网盘（Baidu Netdisk）via BaiduPCS-Go CLI.', userInvocable: false, sourcePath: '~/.claude/skills' },
    { name: 'build-mcp-server',       displayName: 'build-mcp-server',        description: 'Build an MCP server — determines deployment model and hands off to specialized skills.', userInvocable: false, sourcePath: '~/.claude/plugins/marketplaces/claude-plugins-official/plugins/mcp-server-dev/skills' },
    { name: 'claude-automation-recommender', displayName: 'claude-automation-recommender', description: 'Analyze a codebase and recommend Claude Code automations (hooks, subagents, skills, plugins, MCP servers).', userInvocable: false, sourcePath: '~/.claude/plugins/marketplaces/claude-plugins-official/plugins/claude-code-setup/skills' },
    { name: 'frontend-design',        displayName: 'frontend-design',         description: 'Create distinctive, production-grade frontend interfaces with high design quality.', userInvocable: false, sourcePath: '~/.claude/plugins/marketplaces/claude-plugins-official/plugins/frontend-design/skills' },
    { name: 'skill-creator',          displayName: 'skill-creator',           description: 'Create new skills, modify and improve existing skills, and measure skill performance.', userInvocable: false, sourcePath: '~/.claude/plugins/cache/claude-plugins-official/skill-creator/unknown/skills' },
    { name: 'commit',                 displayName: 'commit',                  description: 'Create a well-formed git commit from staged changes.', userInvocable: true,  sourcePath: '~/.claude/plugins/marketplaces/claude-plugins-official/plugins/commit-commands/commands' },
  ],
  workspace: [],
};

const AGENT = {
  id: 'agent-alice-001',
  name: 'alice',
  displayName: 'Alice',
  description: 'Operations agent — screenshot QA + local ops on lululiang machine.',
  runtime: 'claude',
  model: 'claude-opus-4-7',
  status: 'active',
  activity: 'idle',
  machineId: 'machine-001',
};

const CONFIG = {
  id: AGENT.id,
  name: AGENT.name,
  displayName: AGENT.displayName,
  description: AGENT.description,
  runtime: AGENT.runtime,
  model: AGENT.model,
  instructions: 'You are Alice. Run local ops and frontend screenshot QA.',
  skills: [],
};

async function run() {
  const { url, out } = parseArgs();
  mkdirSync(out, { recursive: true });

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: PC });
  const page = await ctx.newPage();

  // Custom mockWS: respond to skills:list with our precomputed payload so we
  // can verify the round-trip without a live daemon.
  await page.routeWebSocket(/\/ws/, (ws) => {
    ws.send(JSON.stringify({
      type: 'init',
      channels: FAKE_CHANNELS,
      agents: [AGENT],
      humans: FAKE_HUMANS,
      configs: [CONFIG],
      machines: FAKE_MACHINES,
    }));
    ws.onMessage((raw) => {
      try {
        const msg = JSON.parse(String(raw));
        if (msg?.type === 'skills:list' && msg.agentId === AGENT.id) {
          setTimeout(() => {
            try { ws.send(JSON.stringify(SKILLS_PAYLOAD)); } catch (_) {}
          }, 50);
        }
      } catch (_) {}
    });
    ws.onClose(() => {});
  });

  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.evaluate(({ token, user }) => {
    localStorage.setItem('zouk_auth_token', token);
    localStorage.setItem('zouk_auth_user', JSON.stringify(user));
    localStorage.setItem('zouk_current_user', user.name);
  }, { token: TEST_TOKEN, user: TEST_USER });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  // Switch to AGENTS view via the left workspace rail. With a single agent
  // in the fake init payload, AgentPanel auto-selects Alice and shows the
  // INSTR tab on mount, so no extra click is needed.
  await page.click('button[aria-label="Agents"]');
  await page.waitForTimeout(800);

  await page.screenshot({ path: resolve(out, '01-agent-instructions-tab.png'), fullPage: false });
  console.log('[shot] agent INSTR tab saved');

  // Click ADD_SKILL
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find(b => /add_skill/i.test(b.textContent?.trim() || ''));
    btn?.click();
  });
  await page.waitForTimeout(500);

  await page.screenshot({ path: resolve(out, '02-add-skill-picker-open.png'), fullPage: false });
  console.log('[shot] ADD_SKILL picker open saved');

  await browser.close();
  console.log(`[done] → ${out}`);
}

run().catch(e => { console.error(e); process.exit(1); });
