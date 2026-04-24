#!/usr/bin/env node
import { chromium } from 'playwright';
import { mkdirSync } from 'fs';
import { resolve } from 'path';
import { loadApp, FAKE_CHANNELS, FAKE_HUMANS, FAKE_MACHINES } from './qa-lib.mjs';

const URL = process.env.URL || 'http://localhost:5173';
const OUT = resolve(process.cwd(), 'qa-screenshots/mobile-panel-replace');
mkdirSync(OUT, { recursive: true });

const AGENTS = [
  { id: 'ag-alice', name: 'alice', displayName: 'Alice', runtime: 'claude', model: 'claude-sonnet-4-6', status: 'active', activity: 'online', machineId: 'machine-001' },
  { id: 'ag-bob',   name: 'bob',   displayName: 'Bob',   runtime: 'claude', model: 'claude-sonnet-4-6', status: 'active', activity: 'online', machineId: 'machine-001' },
  { id: 'ag-pinged', name: 'pinged-bot', displayName: 'Pinged Bot', runtime: 'claude', model: 'claude-sonnet-4-6', status: 'active', activity: 'online', machineId: 'machine-001' },
];

const CONFIGS = AGENTS.map(a => ({ id: a.id, name: a.name, displayName: a.displayName, runtime: a.runtime, model: a.model, description: `${a.displayName}`, picture: null }));

// Seed unread DMs so Pinged Bot shows the notification-on-settings badge.
const dmEvents = Array.from({ length: 3 }, (_, i) => ({
  type: 'new_message',
  message: {
    id: `dm-msg-${i + 1}`,
    channel_id: 'dm-pinged',
    channel_name: 'dm:QA Tester,pinged-bot',
    channel_type: 'dm',
    dm_parties: ['QA Tester', 'pinged-bot'],
    sender_name: 'pinged-bot',
    sender_type: 'agent',
    content: `ping ${i + 1}`,
    timestamp: new Date(Date.now() - (30_000 - i * 10_000)).toISOString(),
  },
}));

async function waitUI(page, ms = 500) { await page.waitForTimeout(ms); }

async function shot(page, name) {
  await page.screenshot({ path: resolve(OUT, `${name}.png`), fullPage: false });
}

async function bootApp(page) {
  await page.route('**/api/messages*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ messages: [] }) }));
  await page.route('**/api/channels/*/messages*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ messages: [] }) }));
  await page.route('**/api/auth/config', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ googleClientId: null, allowlistActive: false }) }));

  await loadApp(page, URL, {
    initOverride: {
      agents: AGENTS,
      humans: FAKE_HUMANS,
      configs: CONFIGS,
      machines: FAKE_MACHINES,
      channels: FAKE_CHANNELS,
    },
    extraMessages: dmEvents,
  });
  await waitUI(page, 1200);
}

async function openSidebar(page) {
  // Force-open via store (more reliable than hunting for the FAB across views).
  await page.evaluate(() => {
    // The FAB lives in MessageComposer (channel view) or bottom of AppShell (agents/tasks).
    const btns = document.querySelectorAll('button[aria-label="Open sidebar"]');
    for (const b of btns) {
      const r = b.getBoundingClientRect();
      if (r.width && r.height) { b.click(); return; }
    }
  });
  await waitUI(page, 400);
}

async function runMobile() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await bootApp(page);

  // 01 — channel view #all, no panel
  await shot(page, '01-mobile-channel-all');

  // Open sidebar, show agent list with notification badge on pinged-bot settings icon.
  await openSidebar(page);
  await shot(page, '02-mobile-sidebar-agents');

  // Tap Pinged Bot avatar to open agent_profile panel. Panel covers the message area
  // but NOT the top bar, so top-bar nav still works.
  const pingedAvatar = page.locator('[title="View @Pinged Bot profile"]').first();
  await pingedAvatar.waitFor({ timeout: 10_000 });
  await pingedAvatar.click();
  await waitUI(page, 600);

  // 03 — profile panel takes full mobile viewport
  await shot(page, '03-mobile-profile-panel');

  // KEY FIX TEST #1: tap TopBar "Agents" nav while profile panel is open →
  // navigateToView should close the panel on mobile.
  const agentsNav = page.locator('button[aria-label="Agents"]:visible').first();
  await agentsNav.click();
  await waitUI(page, 600);

  // 04 — agents list shown, panel closed (the fix: mobile nav replaces view)
  await shot(page, '04-mobile-nav-to-agents-panel-closed');

  // Verify DOM: no RightPanel content rendered.
  const panelStillOpen = await page.locator('.animate-slide-in-right').count();
  console.log('mobile: panel DOM after nav:', panelStillOpen, '(expected: 0)');

  // KEY FIX TEST #2: back to channel view, open profile, then switch channel via sidebar.
  const homeNav = page.locator('button[aria-label="Home"]:visible').first();
  await homeNav.click();
  await waitUI(page, 400);
  await openSidebar(page);
  const pingedAvatar2 = page.locator('[title="View @Pinged Bot profile"]').first();
  await pingedAvatar2.click();
  await waitUI(page, 600);
  await shot(page, '05-mobile-profile-reopen');

  // Open sidebar on top of panel via edge-swipe simulation (touch events at left edge).
  await page.evaluate(() => {
    const x0 = 5, y = 400;
    const touchStart = new TouchEvent('touchstart', { bubbles: true, cancelable: true, touches: [ new Touch({ identifier: 0, target: document.body, clientX: x0, clientY: y }) ] });
    document.body.dispatchEvent(touchStart);
    const touchMove = new TouchEvent('touchmove', { bubbles: true, cancelable: true, touches: [ new Touch({ identifier: 0, target: document.body, clientX: x0 + 80, clientY: y }) ] });
    document.body.dispatchEvent(touchMove);
    const touchEnd = new TouchEvent('touchend', { bubbles: true, cancelable: true, touches: [] });
    document.body.dispatchEvent(touchEnd);
  }).catch(() => {});
  await waitUI(page, 400);

  // Tap a channel — selectChannel on mobile should closeRightPanel + close sidebar.
  // The sidebar may or may not be open here (edge-swipe may not fire in emulation).
  // Either way, the zoukRow click should land via the sidebar overlay.
  await openSidebar(page);
  const zoukRow = page.locator('button', { hasText: /^zouk$/ }).first();
  if (await zoukRow.count()) {
    await zoukRow.click();
    await waitUI(page, 600);
  }
  await shot(page, '06-mobile-after-channel-switch');

  const panelAfterChannelSwitch = await page.locator('.animate-slide-in-right').count();
  console.log('mobile: panel DOM after channel-switch:', panelAfterChannelSwitch, '(expected: 0)');

  // Verify: top-right PanelRight toggle button is hidden on mobile
  const closePanelBtn = await page.locator('button[aria-label="Close side panel"], button[aria-label="Open side panel"]').first().isVisible().catch(() => false);
  console.log('mobile: PanelRight toggle visible:', closePanelBtn, '(expected: false)');

  await browser.close();
  return { panelAfterNav: panelStillOpen, panelAfterSwitch: panelAfterChannelSwitch, toggleBtn: closePanelBtn };
}

async function runDesktop() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await bootApp(page);

  await shot(page, '10-desktop-main');

  // Desktop behavior: clicking agent avatar opens profile side panel. Sidebar + panel both visible.
  const pingedAvatar = page.locator('[title="View @Pinged Bot profile"]').first();
  await pingedAvatar.click();
  await waitUI(page, 500);
  await shot(page, '11-desktop-profile-open');

  // KEY DESKTOP BEHAVIOR: switching channel should KEEP profile panel open (not close).
  const zoukRow = page.locator('button', { hasText: /^zouk$/ }).first();
  await zoukRow.click();
  await waitUI(page, 500);
  await shot(page, '12-desktop-channel-switch-panel-stays');

  const panelAfterSwitch = await page.locator('.animate-slide-in-right').count();
  console.log('desktop: panel still open after channel switch:', panelAfterSwitch, '(expected: >=1)');

  const closeBtn = await page.locator('button[aria-label="Close side panel"], button[aria-label="Open side panel"]').first().isVisible().catch(() => false);
  console.log('desktop: PanelRight toggle visible:', closeBtn, '(expected: true)');

  // Close profile via its X to reset.
  const profileCloseBtn = page.locator('.animate-slide-in-right button[title="Close"]').first();
  if (await profileCloseBtn.count()) await profileCloseBtn.click();
  await waitUI(page, 300);

  // Crop: sidebar agent row with notification badge overlaying settings button.
  const sidebarTitle = page.locator('h2').filter({ hasText: /^Zouk$|^ZOUK$/i }).first();
  await sidebarTitle.waitFor({ timeout: 10_000 });
  const sidebarHandle = await sidebarTitle.evaluateHandle((el) => {
    let node = el;
    while (node && node.parentElement) {
      node = node.parentElement;
      const r = node.getBoundingClientRect();
      if (r.height > 400 && r.width > 180 && r.width < 360) return node;
    }
    return el.closest('div') || el;
  });
  const sidebarBox = await sidebarHandle.asElement().boundingBox();
  if (sidebarBox) {
    const pingedRow = page.locator('button', { hasText: 'Pinged Bot' }).first();
    const rowBox = await pingedRow.boundingBox();
    if (rowBox) {
      await page.mouse.move(sidebarBox.x + sidebarBox.width + 100, sidebarBox.y + 100);
      await waitUI(page, 200);
      await page.screenshot({
        path: resolve(OUT, '13-desktop-agent-row-badge-idle.png'),
        clip: { x: sidebarBox.x, y: Math.max(sidebarBox.y, rowBox.y - 8), width: sidebarBox.width, height: 48 },
      });
      await pingedRow.hover();
      await waitUI(page, 200);
      await page.screenshot({
        path: resolve(OUT, '14-desktop-agent-row-badge-hover.png'),
        clip: { x: sidebarBox.x, y: Math.max(sidebarBox.y, rowBox.y - 8), width: sidebarBox.width, height: 48 },
      });
    }
  }

  await browser.close();
  return { panelAfterSwitch, toggleBtn: closeBtn };
}

async function main() {
  const mob = await runMobile();
  const desk = await runDesktop();

  console.log('\nSummary');
  console.log('  mobile — nav closes panel:', mob.panelAfterNav === 0 ? 'PASS' : 'FAIL', `(panel-dom=${mob.panelAfterNav})`);
  console.log('  mobile — channel-switch closes panel:', mob.panelAfterSwitch === 0 ? 'PASS' : 'FAIL', `(panel-dom=${mob.panelAfterSwitch})`);
  console.log('  mobile — PanelRight toggle hidden:', !mob.toggleBtn ? 'PASS' : 'FAIL');
  console.log('  desktop — PanelRight toggle visible:', desk.toggleBtn ? 'PASS' : 'FAIL');
  console.log('  desktop — profile stays open after channel switch:', desk.panelAfterSwitch >= 1 ? 'PASS' : 'FAIL', `(panel-dom=${desk.panelAfterSwitch})`);
  console.log('\nWrote screenshots to', OUT);
}

main().catch((err) => { console.error(err); process.exit(1); });
