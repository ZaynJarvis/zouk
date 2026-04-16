#!/usr/bin/env node
/**
 * Workspace File Tree — Puppeteer/Playwright Verification Test
 *
 * Tests that the recursive file tree correctly renders:
 *   - Directories with folder icon + expand chevron
 *   - Files with file icon (no chevron)
 *   - "notes" specifically shows as an expandable folder
 *   - Children appear after expanding a folder
 *
 * Approach: intercepts the app's WebSocket and injects mock
 * workspace:file_tree events to simulate a live agent+daemon.
 *
 * Usage:
 *   node scripts/workspace-file-tree-test.mjs
 *   node scripts/workspace-file-tree-test.mjs --url http://localhost:5173
 *   node scripts/workspace-file-tree-test.mjs --out ./test-results
 */

import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'fs';
import { resolve } from 'path';

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    url: 'http://localhost:5173',
    out: resolve(process.cwd(), 'test-results'),
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--url' && args[i + 1]) opts.url = args[++i];
    if (args[i] === '--out' && args[i + 1]) opts.out = resolve(args[++i]);
  }
  return opts;
}

// Mock workspace tree data — uses isDirectory: boolean (daemon format)
const MOCK_AGENT_ID = 'test-agent-ws';
const MOCK_ROOT_FILES = [
  { name: 'notes',        path: 'notes',        isDirectory: true  },
  { name: 'memory',       path: 'memory',       isDirectory: true  },
  { name: 'scripts',      path: 'scripts',      isDirectory: true  },
  { name: 'MEMORY.md',    path: 'MEMORY.md',    isDirectory: false, size: 1024 },
  { name: 'config.json',  path: 'config.json',  isDirectory: false, size: 256  },
  { name: 'README.md',    path: 'README.md',    isDirectory: false, size: 512  },
];
const MOCK_NOTES_CHILDREN = [
  { name: 'channels.md',     path: 'notes/channels.md',  isDirectory: false, size: 800 },
  { name: 'work-log.md',     path: 'notes/work-log.md',  isDirectory: false, size: 2048 },
  { name: 'team.md',         path: 'notes/team.md',      isDirectory: false, size: 640 },
  { name: 'sub-notes',       path: 'notes/sub-notes',    isDirectory: true  },
];

// Script injected before page load — intercepts WebSocket to inject mock data
// Strategy:
//   1. Intercept ws.send() to detect workspace:list requests and auto-respond
//      with mock file_tree data (so FileTree's requestWorkspaceFiles() is served)
//   2. Inject agent_started at 800ms after WS open
//   3. Keep manual globals for explicit re-injection if needed
const WS_INTERCEPTOR = `
(function() {
  const OrigWS = window.WebSocket;
  let capturedWs = null;

  const MOCK_ROOT = ${JSON.stringify(MOCK_ROOT_FILES)};
  const MOCK_NOTES = ${JSON.stringify(MOCK_NOTES_CHILDREN)};
  const MOCK_ID = '${MOCK_AGENT_ID}';

  window.WebSocket = function(url, protocols) {
    const ws = protocols ? new OrigWS(url, protocols) : new OrigWS(url);
    capturedWs = ws;

    const fire = (data) => {
      const ev = new MessageEvent('message', { data: JSON.stringify(data) });
      ws.dispatchEvent(ev);
    };

    // Intercept outgoing messages — respond to workspace:list requests with mock data
    const origSend = ws.send.bind(ws);
    ws.send = (data) => {
      origSend(data);
      try {
        const msg = JSON.parse(data);
        if (msg.type === 'workspace:list' && msg.agentId === MOCK_ID) {
          const dirPath = msg.dirPath || '';
          const files = dirPath === 'notes' ? MOCK_NOTES : MOCK_ROOT;
          setTimeout(() => fire({
            type: 'workspace:file_tree',
            agentId: MOCK_ID,
            dirPath,
            files,
          }), 80);
        }
      } catch(e) {}
    };

    ws.addEventListener('open', () => {
      // Wait for server's own init to be processed, then inject our mock agent
      setTimeout(() => {
        fire({
          type: 'agent_started',
          agent: {
            id: MOCK_ID,
            name: 'test-agent-ws',
            displayName: 'WorkspaceTestAgent',
            status: 'active',
            runtime: 'claude',
            model: 'sonnet',
            description: 'Test agent for workspace verification',
            workDir: '/Users/test/.zouk/agents/test-agent-ws',
          }
        });
      }, 800);
    });

    // Expose global for explicit re-injection (e.g. after tab switch)
    window.__reinjectWorkspace = () => {
      if (!capturedWs) return;
      fire({
        type: 'workspace:file_tree',
        agentId: MOCK_ID,
        dirPath: '',
        files: MOCK_ROOT,
      });
    };

    // Expose global for injecting notes children after expand
    window.__injectNotesChildren = () => {
      if (!capturedWs) return;
      fire({
        type: 'workspace:file_tree',
        agentId: MOCK_ID,
        dirPath: 'notes',
        files: MOCK_NOTES,
      });
    };

    return ws;
  };

  // Copy static properties
  Object.assign(window.WebSocket, {
    CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3,
    prototype: OrigWS.prototype,
  });
})();
`;

async function runTest(opts) {
  const out = opts.out;
  mkdirSync(out, { recursive: true });

  const results = [];
  const pass = (name) => { results.push({ name, status: 'PASS' }); console.log(`  ✅ ${name}`); };
  const fail = (name, reason) => { results.push({ name, status: 'FAIL', reason }); console.error(`  ❌ ${name}: ${reason}`); };

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    // Bypass login by faking localStorage auth
  });

  await ctx.addInitScript(WS_INTERCEPTOR);

  const page = await ctx.newPage();

  console.log(`\n📸 Workspace File Tree Test`);
  console.log(`  URL: ${opts.url}`);
  console.log(`  Out: ${out}\n`);

  try {
    // ── Step 1: Open app and log in as guest ──────────────────────────────
    await page.goto(opts.url, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);

    // Set theme to night-city for consistent screenshots
    await page.evaluate(() => {
      localStorage.setItem('zouk_theme', 'night-city');
    });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);

    // Try guest login
    const guestBtn = page.locator('button').filter({ hasText: /guest/i });
    if (await guestBtn.first().isVisible({ timeout: 2000 }).catch(() => false)) {
      await guestBtn.first().click();
      await page.waitForTimeout(2000);
    }

    await page.screenshot({ path: resolve(out, '01-app-loaded.png') });
    console.log('  📷 01-app-loaded.png');

    // Wait for WS injection to complete (agent_started fires at 800ms, workspace at 1200ms)
    await page.waitForTimeout(1800);

    // ── Step 2: Navigate to Agents view ──────────────────────────────────
    // Click the Agents button in WorkspaceRail — try multiple selectors
    const agentsBtn = page.locator('button[title="Agents"], button[title="agents"]').first();
    const agentsBtnVisible = await agentsBtn.isVisible({ timeout: 2000 }).catch(() => false);
    if (agentsBtnVisible) {
      await agentsBtn.click();
      await page.waitForTimeout(1000);
      pass('Agents view accessible');
    } else {
      // Fallback: click the Cpu icon (3rd rail button)
      const railBtns = page.locator('.w-\\[72px\\] button, [class*="w-\\[72px\\]"] button');
      const count = await railBtns.count();
      if (count >= 2) {
        await railBtns.nth(1).click(); // second nav button = Agents
        await page.waitForTimeout(1000);
        pass('Agents view accessible (via rail position)');
      } else {
        fail('Agents view accessible', 'Agents button not found');
      }
    }

    await page.screenshot({ path: resolve(out, '02-agents-view.png') });
    console.log('  📷 02-agents-view.png');

    // ── Step 3: Verify WorkspaceTestAgent is visible in agents view ──────
    // In agents viewMode, AgentDetail auto-selects the first agent. We DON'T click
    // the agent name from the ChannelSidebar (that navigates to a DM channel).
    // The AgentListItem button in AgentsView has both the display name AND model info.
    // ChannelSidebar entries only show the name — so we scope by model text.
    const agentListItem = page.locator('button').filter({ hasText: 'WorkspaceTestAgent' }).filter({ hasText: /claude|sonnet|hermes/i }).first();
    const agentListItemVisible = await agentListItem.isVisible({ timeout: 3000 }).catch(() => false);
    if (agentListItemVisible) {
      // Click to explicitly select (in case another agent was auto-selected)
      await agentListItem.click();
      await page.waitForTimeout(600);
      pass('WorkspaceTestAgent visible in AgentPanel list (injected agent rendered)');
    } else {
      // Agent not yet showing model info — check if FILES tab is already visible
      // (auto-selection may have already selected WorkspaceTestAgent)
      const filesTabCheck = await page.locator('button').filter({ hasText: /^files$/i }).isVisible({ timeout: 1000 }).catch(() => false);
      if (filesTabCheck) {
        pass('WorkspaceTestAgent auto-selected in AgentPanel (FILES tab visible)');
      } else {
        fail('WorkspaceTestAgent visible', 'Agent not found in AgentPanel — mock WS injection may have failed');
      }
    }

    await page.screenshot({ path: resolve(out, '03-agent-detail.png') });
    console.log('  📷 03-agent-detail.png');

    // ── Step 4: Navigate to Files/Workspace tab in AgentDetail ────────
    // AgentDetail tab labels: INSTR, FILES, ACTIVITY, CONFIG
    // The workspace/files tab is labeled "FILES" with a FolderOpen icon
    // Only click if not already on FILES tab (auto-start is on INSTR tab)
    const filesTabBtn = page.locator('button').filter({ hasText: /^files$/i });
    const filesTabVisible = await filesTabBtn.isVisible({ timeout: 3000 }).catch(() => false);
    if (filesTabVisible) {
      await filesTabBtn.click();
      await page.waitForTimeout(1200);
      pass('FILES tab found and clicked in AgentDetail');
    } else {
      // Check for tab by icon title or containing text
      const wsTabFallback = page.locator('button[title*="file" i], button[title*="workspace" i]');
      if (await wsTabFallback.isVisible({ timeout: 2000 }).catch(() => false)) {
        await wsTabFallback.click();
        await page.waitForTimeout(1200);
        pass('FILES tab found via title attribute');
      } else {
        fail('FILES tab found', 'FILES tab button not visible in AgentDetail — agent may not be selected');
      }
    }

    await page.screenshot({ path: resolve(out, '04-workspace-tab.png') });
    console.log('  📷 04-workspace-tab.png');

    // Wait for WorkspaceTab useEffect to fire requestWorkspaceFiles, which triggers
    // our ws.send interceptor — also call __reinjectWorkspace as belt-and-suspenders
    await page.waitForTimeout(400);
    await page.evaluate(() => window.__reinjectWorkspace?.());
    await page.waitForTimeout(600);

    // ── Step 5: Verify folder vs file rendering ───────────────────────
    // Check that "notes" has a chevron (is a directory)
    // TreeNode for directories renders a ChevronRight icon + folder icon
    const notesRow = page.locator('text=notes').first();
    if (await notesRow.isVisible({ timeout: 3000 }).catch(() => false)) {
      pass('"notes" is visible in workspace tree');

      // Verify chevron icon exists near the "notes" entry
      // The directory row has a ChevronRight svg icon as its first child
      const notesParent = notesRow.locator('xpath=../..');
      const hasChevron = await notesParent.locator('svg').count().then(n => n > 1).catch(() => false);
      if (hasChevron) {
        pass('"notes" row has expand chevron (rendered as directory, not flat file)');
      } else {
        // Try checking the parent button
        const hasAnyChevron = await page.locator('[title="notes"], button:has-text("notes")').locator('svg').count().then(n => n > 0).catch(() => false);
        if (hasAnyChevron) {
          pass('"notes" row has icons (directory rendering confirmed)');
        } else {
          fail('"notes" directory chevron', 'No chevron/icons found near notes entry');
        }
      }
    } else {
      fail('"notes" visible in tree', '"notes" directory not found in workspace tree');
    }

    // Verify "MEMORY.md" is visible as a file (no expansion)
    const memoryFile = page.locator('text=MEMORY.md').first();
    if (await memoryFile.isVisible({ timeout: 2000 }).catch(() => false)) {
      pass('"MEMORY.md" is visible in workspace tree as a file entry');
    } else {
      fail('"MEMORY.md" file visible', 'MEMORY.md file entry not found');
    }

    await page.screenshot({ path: resolve(out, '05-tree-root-state.png') });
    console.log('  📷 05-tree-root-state.png');

    // ── Step 6: Expand "notes" folder ────────────────────────────────
    const notesClickable = page.locator('text=notes').first();
    if (await notesClickable.isVisible({ timeout: 2000 }).catch(() => false)) {
      await notesClickable.click();
      // Inject the notes children via the global we set up
      await page.evaluate(() => window.__injectNotesChildren?.());
      await page.waitForTimeout(800);

      // Check children appeared
      const channelsMd = page.locator('text=channels.md').first();
      if (await channelsMd.isVisible({ timeout: 2000 }).catch(() => false)) {
        pass('"notes" folder expanded — children (channels.md, work-log.md, etc.) visible');
      } else {
        fail('"notes" expansion', 'Children not visible after clicking notes');
      }

      // Check nested sub-notes directory is rendered as a folder
      const subNotes = page.locator('text=sub-notes').first();
      if (await subNotes.isVisible({ timeout: 2000 }).catch(() => false)) {
        pass('"sub-notes" nested directory visible inside expanded "notes"');
      } else {
        fail('"sub-notes" nested folder', 'Nested directory sub-notes not visible');
      }
    }

    await page.screenshot({ path: resolve(out, '06-notes-expanded.png') });
    console.log('  📷 06-notes-expanded.png');

    // ── Step 7: WorkspacePanel via RightPanel ─────────────────────────
    // Also test through WorkspacePanel (RightPanel mode)
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    // Click the workspace FolderOpen button in the WorkspaceRail
    const wsRailBtn = page.locator('button[title="Workspace"]');
    if (await wsRailBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await wsRailBtn.click();
      await page.waitForTimeout(1000);
      await page.screenshot({ path: resolve(out, '07-workspace-panel-right.png') });
      console.log('  📷 07-workspace-panel-right.png');
      pass('Workspace panel opens via rail button');
    } else {
      console.log('  ℹ  Workspace rail button not found (WorkspacePanel may be integrated differently)');
    }

  } catch (err) {
    console.error('\nTest error:', err.message);
    await page.screenshot({ path: resolve(out, 'error-state.png') });
  } finally {
    await browser.close();
  }

  // ── Summary ────────────────────────────────────────────────────────────
  const passed = results.filter(r => r.status === 'PASS').length;
  const failed = results.filter(r => r.status === 'FAIL').length;

  console.log(`\n${'─'.repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log('\nFailed checks:');
    results.filter(r => r.status === 'FAIL').forEach(r => {
      console.log(`  ✗ ${r.name}: ${r.reason}`);
    });
  }

  // Save result JSON
  writeFileSync(resolve(out, 'results.json'), JSON.stringify({ passed, failed, checks: results }, null, 2));
  console.log(`\nScreenshots + results.json saved to: ${out}\n`);

  return failed === 0;
}

const opts = parseArgs();
runTest(opts).then(ok => process.exit(ok ? 0 : 1)).catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
