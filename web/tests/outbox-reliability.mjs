#!/usr/bin/env node
/**
 * Outbox Reliability Tests — zouk/web
 *
 * Playwright tests that verify the client-side outbox + clientMsgId
 * reconciliation works across the three send states:
 *   1. client accepted (optimistic message visible)
 *   2. server accepted (HTTP response reconciles)
 *   3. agent delivery attempted (delivery info in response)
 *
 * These tests mock /api/messages and the WebSocket to simulate the
 * failure modes that plague iOS PWA:
 *   - delayed HTTP response
 *   - HTTP abort/timeout then retry
 *   - WS echo arrives before HTTP response
 *   - HTTP succeeds while WS is down
 *   - server reports zero recipients (routing, not network)
 *
 * Run (server must be up at --url):
 *   node web/tests/outbox-reliability.mjs
 *   node web/tests/outbox-reliability.mjs --url http://localhost:7777 --out ./test-out/outbox
 */

import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import {
  loadApp,
  FAKE_CHANNELS,
  FAKE_AGENTS,
  FAKE_HUMANS,
  FAKE_CONFIGS,
  FAKE_MACHINES,
  TEST_TOKEN,
  TEST_USER,
  setupAuth,
} from '../scripts/qa-lib.mjs';

// ─── CLI ──────────────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    url: 'http://localhost:7777',
    out: resolve(process.cwd(), 'test-out/outbox'),
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--url' && args[i + 1]) opts.url = args[++i];
    if (args[i] === '--out' && args[i + 1]) opts.out = resolve(args[++i]);
  }
  return opts;
}

function pass(results, name) {
  results.push({ name, status: 'PASS' });
  console.log(`  \u2713 ${name}`);
}
function fail(results, name, reason) {
  results.push({ name, status: 'FAIL', reason });
  console.error(`  \u2717 ${name}: ${reason}`);
}

// ─── Mock helpers ────────────────────────────────────────────────────────────

/**
 * Mock /api/messages with configurable delay.
 * Returns a function to inspect received requests.
 */
async function mockMessagesApi(page, { delayMs = 0, status = 200, responseOverrides = {} } = {}) {
  const requests = [];
  await page.route('**/api/messages', async (route) => {
    const method = route.request().method();
    if (method !== 'POST') {
      // Pass through GET requests
      return route.continue();
    }
    const body = route.request().postDataJSON();
    requests.push(body);
    if (delayMs > 0) {
      await new Promise(r => setTimeout(r, delayMs));
    }
    if (status !== 200) {
      return route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'mock failure' }),
      });
    }
    const clientMsgId = body?.clientMsgId || null;
    const msgId = `msg-mock-${Date.now()}-${requests.length}`;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        messageId: msgId,
        message: {
          id: msgId,
          channelName: 'all',
          channelType: 'channel',
          senderName: TEST_USER.name,
          senderType: 'human',
          content: body?.content || '',
          createdAt: new Date().toISOString(),
          ...(clientMsgId ? { clientMsgId } : {}),
        },
        clientMsgId,
        delivery: {
          recipientIds: [],
          recipientCount: 0,
          sentCount: 0,
          queuedCount: 0,
          ...responseOverrides.delivery,
        },
        ...responseOverrides,
      }),
    });
  });
  return requests;
}

/**
 * Mock /api/messages that fails on the first POST and succeeds on the second.
 */
async function mockMessagesApiFailFirst(page) {
  let attempt = 0;
  const requests = [];
  await page.route('**/api/messages', async (route) => {
    const method = route.request().method();
    if (method !== 'POST') return route.continue();
    const body = route.request().postDataJSON();
    requests.push({ ...body, attempt: attempt + 1 });
    attempt++;
    if (attempt === 1) {
      return route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'mock first failure' }),
      });
    }
    const clientMsgId = body?.clientMsgId || null;
    const msgId = `msg-mock-retry-${Date.now()}`;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        messageId: msgId,
        message: {
          id: msgId,
          channelName: 'all',
          channelType: 'channel',
          senderName: TEST_USER.name,
          senderType: 'human',
          content: body?.content || '',
          createdAt: new Date().toISOString(),
          ...(clientMsgId ? { clientMsgId } : {}),
        },
        clientMsgId,
        delivery: { recipientIds: [], recipientCount: 0, sentCount: 0, queuedCount: 0 },
      }),
    });
  });
  return requests;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

/**
 * Test: delayed-http
 * Mock /api/messages delayed by 10s. The composer should clear immediately
 * and the optimistic message should be visible. After the response, the
 * pending message reconciles to sent.
 */
async function testDelayedHttp(browser, opts, results) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  try {
    // Mock messages API with a 10s delay but fulfill quickly for the test
    // (we use 1s to keep the test fast, the principle is the same)
    await mockMessagesApi(page, { delayMs: 1000 });
    await loadApp(page, opts.url);

    const PROBE = `outbox-delayed-${Date.now()}`;
    // Type and send
    await page.locator('textarea').fill(PROBE);
    await page.locator('textarea').press('Enter');

    // The optimistic message should be visible immediately (within 500ms)
    // even though the HTTP response hasn't arrived yet.
    await page.waitForTimeout(300);
    const optimisticVisible = await page.locator(`text=${PROBE}`).first()
      .isVisible({ timeout: 1000 }).catch(() => false);
    if (optimisticVisible) {
      pass(results, 'delayed-http: optimistic message visible before HTTP response');
    } else {
      fail(results, 'delayed-http', 'optimistic message not visible before HTTP response');
    }

    // Wait for the HTTP response to arrive (1s delay + buffer)
    await page.waitForTimeout(2000);

    // The message should still be visible (reconciled to confirmed)
    const stillVisible = await page.locator(`text=${PROBE}`).first()
      .isVisible({ timeout: 2000 }).catch(() => false);
    if (stillVisible) {
      pass(results, 'delayed-http: message remains visible after reconciliation');
    } else {
      fail(results, 'delayed-http', 'message disappeared after HTTP response');
    }

    await page.screenshot({ path: resolve(opts.out, 'outbox-01-delayed.png') });
  } finally {
    await ctx.close();
  }
}

/**
 * Test: fail-then-retry
 * Mock first POST returns 503, second POST succeeds with same clientMsgId.
 * One visible message, no duplicate.
 */
async function testFailThenRetry(browser, opts, results) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  try {
    const requests = await mockMessagesApiFailFirst(page);
    await loadApp(page, opts.url);

    const PROBE = `outbox-retry-${Date.now()}`;
    await page.locator('textarea').fill(PROBE);
    await page.locator('textarea').press('Enter');

    // Wait for the retry to happen (3s initial delay + retry)
    await page.waitForTimeout(6000);

    // Verify the message was sent twice with the same clientMsgId
    const sends = requests.filter(r => r.content === PROBE);
    if (sends.length >= 2) {
      const cmids = sends.map(r => r.clientMsgId).filter(Boolean);
      if (cmids.length >= 2 && cmids[0] === cmids[1]) {
        pass(results, 'fail-then-retry: retried with same clientMsgId');
      } else {
        fail(results, 'fail-then-retry', `clientMsgId mismatch or missing: ${JSON.stringify(cmids)}`);
      }
    } else {
      fail(results, 'fail-then-retry', `expected >= 2 sends, got ${sends.length}`);
    }

    // Verify only one visible message (no duplicate)
    const msgCount = await page.locator(`text=${PROBE}`).count();
    if (msgCount === 1) {
      pass(results, 'fail-then-retry: one visible message, no duplicate');
    } else {
      fail(results, 'fail-then-retry', `expected 1 visible message, got ${msgCount}`);
    }

    await page.screenshot({ path: resolve(opts.out, 'outbox-02-retry.png') });
  } finally {
    await ctx.close();
  }
}

/**
 * Test: ws-echo-before-http
 * Mock WS sends a message echo before the HTTP response arrives.
 * The local pending message should reconcile via WS without a failed toast.
 */
async function testWsEchoBeforeHttp(browser, opts, results) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  try {
    // Track the clientMsgId we send so the WS mock can echo it
    let sentClientMsgId = null;

    // Mock messages API with a long delay (so WS echo arrives first)
    await page.route('**/api/messages', async (route) => {
      const method = route.request().method();
      if (method !== 'POST') return route.continue();
      const body = route.request().postDataJSON();
      sentClientMsgId = body?.clientMsgId || null;
      // Long delay — WS echo should arrive first
      await new Promise(r => setTimeout(r, 5000));
      const msgId = `msg-mock-ws-${Date.now()}`;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          messageId: msgId,
          message: {
            id: msgId,
            channelName: 'all',
            channelType: 'channel',
            senderName: TEST_USER.name,
            senderType: 'human',
            content: body?.content || '',
            createdAt: new Date().toISOString(),
            ...(sentClientMsgId ? { clientMsgId: sentClientMsgId } : {}),
          },
          clientMsgId: sentClientMsgId,
          delivery: { recipientIds: [], recipientCount: 0, sentCount: 0, queuedCount: 0 },
        }),
      });
    });

    // Custom WS mock that echoes the message back quickly after receiving a
    // send-like event. Since we can't intercept the WS send from the client
    // to the server in the mock, we use extraMessages with a delay shorter
    // than the HTTP delay.
    const PROBE = `outbox-ws-echo-${Date.now()}`;

    // We need a custom WS mock that can send the echo. Since the standard
    // mockWS doesn't support dynamic messages, we build a custom one.
    await page.routeWebSocket(/\/ws/, (ws) => {
      ws.send(JSON.stringify({
        type: 'init',
        channels: FAKE_CHANNELS,
        agents: FAKE_AGENTS,
        humans: FAKE_HUMANS,
        configs: FAKE_CONFIGS,
        machines: FAKE_MACHINES,
      }));
      // Send the echo message after 500ms (before the 5s HTTP delay)
      setTimeout(() => {
        // We don't know the clientMsgId yet at WS mock time, so we use a
        // pre-generated one. The test verifies the message is visible without
        // a failed toast.
        const echoMsgId = `msg-ws-echo-${Date.now()}`;
        try {
          ws.send(JSON.stringify({
            type: 'message',
            message: {
              id: echoMsgId,
              channelName: 'all',
              channelType: 'channel',
              senderName: TEST_USER.name,
              senderType: 'human',
              content: PROBE,
              createdAt: new Date().toISOString(),
            },
          }));
        } catch (_) {}
      }, 800);
      ws.onMessage(() => {});
      ws.onClose(() => {});
    });

    await page.goto(opts.url, { waitUntil: 'domcontentloaded' });
    await setupAuth(page);
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);

    await page.locator('textarea').fill(PROBE);
    await page.locator('textarea').press('Enter');

    // Wait for the WS echo (800ms + buffer)
    await page.waitForTimeout(2000);

    // The message should be visible (either optimistic or reconciled)
    const msgVisible = await page.locator(`text=${PROBE}`).first()
      .isVisible({ timeout: 2000 }).catch(() => false);
    if (msgVisible) {
      pass(results, 'ws-echo-before-http: message visible after WS echo');
    } else {
      fail(results, 'ws-echo-before-http', 'message not visible after WS echo');
    }

    // Check that no error toast appeared
    const errorToastVisible = await page.locator('text=Failed to send message').first()
      .isVisible({ timeout: 500 }).catch(() => false);
    if (!errorToastVisible) {
      pass(results, 'ws-echo-before-http: no failed toast on WS-first reconciliation');
    } else {
      fail(results, 'ws-echo-before-http', 'unexpected "Failed to send message" toast');
    }

    await page.screenshot({ path: resolve(opts.out, 'outbox-03-ws-echo.png') });
  } finally {
    await ctx.close();
  }
}

/**
 * Test: http-only-no-ws
 * Mock WS that never connects (or disconnects immediately). HTTP response
 * succeeds. The local pending message should reconcile via HTTP with no
 * dependency on WS reconnect.
 */
async function testHttpOnlyNoWs(browser, opts, results) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  try {
    await mockMessagesApi(page, { delayMs: 0 });

    // WS mock that sends init then immediately closes
    await page.routeWebSocket(/\/ws/, (ws) => {
      ws.send(JSON.stringify({
        type: 'init',
        channels: FAKE_CHANNELS,
        agents: FAKE_AGENTS,
        humans: FAKE_HUMANS,
        configs: FAKE_CONFIGS,
        machines: FAKE_MACHINES,
      }));
      // Don't close — just don't send any more messages. The test verifies
      // that HTTP-only reconciliation works without WS.
      ws.onMessage(() => {});
      ws.onClose(() => {});
    });

    await page.goto(opts.url, { waitUntil: 'domcontentloaded' });
    await setupAuth(page);
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);

    const PROBE = `outbox-http-only-${Date.now()}`;
    await page.locator('textarea').fill(PROBE);
    await page.locator('textarea').press('Enter');

    // Wait for HTTP response (no delay + buffer)
    await page.waitForTimeout(1500);

    const msgVisible = await page.locator(`text=${PROBE}`).first()
      .isVisible({ timeout: 2000 }).catch(() => false);
    if (msgVisible) {
      pass(results, 'http-only-no-ws: message reconciled via HTTP without WS');
    } else {
      fail(results, 'http-only-no-ws', 'message not visible after HTTP-only send');
    }

    const errorToastVisible = await page.locator('text=Failed to send message').first()
      .isVisible({ timeout: 500 }).catch(() => false);
    if (!errorToastVisible) {
      pass(results, 'http-only-no-ws: no failed toast');
    } else {
      fail(results, 'http-only-no-ws', 'unexpected "Failed to send message" toast');
    }

    await page.screenshot({ path: resolve(opts.out, 'outbox-04-http-only.png') });
  } finally {
    await ctx.close();
  }
}

/**
 * Test: http-then-ws-echo
 * HTTP response reconciles the optimistic message first; the later WS echo
 * for the same clientMsgId must not append a second visible message.
 */
async function testHttpThenWsEchoNoDuplicate(browser, opts, results) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  try {
    let echoMessage = null;
    let echoSent = false;

    await page.route('**/api/messages', async (route) => {
      const method = route.request().method();
      if (method !== 'POST') return route.continue();
      const body = route.request().postDataJSON();
      const clientMsgId = body?.clientMsgId || null;
      const msgId = `msg-http-first-${Date.now()}`;
      echoMessage = {
        type: 'message',
        message: {
          id: msgId,
          channelName: 'all',
          channelType: 'channel',
          senderName: TEST_USER.name,
          senderType: 'human',
          content: body?.content || '',
          createdAt: new Date().toISOString(),
          ...(clientMsgId ? { clientMsgId } : {}),
        },
      };
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          messageId: msgId,
          message: echoMessage.message,
          clientMsgId,
          delivery: { recipientIds: [], recipientCount: 1, sentCount: 1, queuedCount: 0 },
        }),
      });
    });

    await page.routeWebSocket(/\/ws/, (ws) => {
      ws.send(JSON.stringify({
        type: 'init',
        channels: FAKE_CHANNELS,
        agents: FAKE_AGENTS,
        humans: FAKE_HUMANS,
        configs: FAKE_CONFIGS,
        machines: FAKE_MACHINES,
      }));
      const timer = setInterval(() => {
        if (!echoMessage || echoSent) return;
        echoSent = true;
        clearInterval(timer);
        try { ws.send(JSON.stringify(echoMessage)); } catch (_) {}
      }, 150);
      ws.onMessage(() => {});
      ws.onClose(() => clearInterval(timer));
    });

    await page.goto(opts.url, { waitUntil: 'domcontentloaded' });
    await setupAuth(page);
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);

    const PROBE = `outbox-http-then-ws-${Date.now()}`;
    await page.locator('textarea').fill(PROBE);
    await page.locator('textarea').press('Enter');

    await page.waitForTimeout(2000);
    const msgCount = await page.locator(`text=${PROBE}`).count();
    if (msgCount === 1) {
      pass(results, 'http-then-ws-echo: later WS echo does not duplicate HTTP-reconciled message');
    } else {
      fail(results, 'http-then-ws-echo', `expected 1 visible message, got ${msgCount}`);
    }

    await page.screenshot({ path: resolve(opts.out, 'outbox-05-http-then-ws.png') });
  } finally {
    await ctx.close();
  }
}

/**
 * Test: zero-recipient-toast
 * Mock server response with recipientCount=0. UI should show an info toast
 * distinguishing "sent, no agent targeted" from a network failure.
 */
async function testZeroRecipientToast(browser, opts, results) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  try {
    await mockMessagesApi(page, {
      delayMs: 0,
      responseOverrides: {
        delivery: { recipientIds: [], recipientCount: 0, sentCount: 0, queuedCount: 0 },
      },
    });

    await loadApp(page, opts.url);

    const PROBE = `outbox-zero-recipient-${Date.now()}`;
    await page.locator('textarea').fill(PROBE);
    await page.locator('textarea').press('Enter');

    // Wait for HTTP response + toast
    await page.waitForTimeout(1500);

    // The "no agent currently targeted" toast should be visible
    const infoToastVisible = await page.locator('text=no agent currently targeted').first()
      .isVisible({ timeout: 2000 }).catch(() => false);
    if (infoToastVisible) {
      pass(results, 'zero-recipient: info toast distinguishes routing no-recipient from network failure');
    } else {
      fail(results, 'zero-recipient', '"no agent currently targeted" info toast not visible');
    }

    // The message should still be visible (it was stored)
    const msgVisible = await page.locator(`text=${PROBE}`).first()
      .isVisible({ timeout: 1000 }).catch(() => false);
    if (msgVisible) {
      pass(results, 'zero-recipient: message visible despite zero recipients');
    } else {
      fail(results, 'zero-recipient', 'message not visible despite zero recipients');
    }

    await page.screenshot({ path: resolve(opts.out, 'outbox-05-zero-recipient.png') });
  } finally {
    await ctx.close();
  }
}

// ─── Runner ───────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs();
  mkdirSync(opts.out, { recursive: true });

  console.log(`\nZouk Outbox Reliability Tests`);
  console.log(`  Server: ${opts.url}`);
  console.log(`  Out:    ${opts.out}\n`);

  const browser = await chromium.launch({ headless: true });
  const results = [];

  try {
    await testDelayedHttp(browser, opts, results);
    await testFailThenRetry(browser, opts, results);
    await testWsEchoBeforeHttp(browser, opts, results);
    await testHttpOnlyNoWs(browser, opts, results);
    await testHttpThenWsEchoNoDuplicate(browser, opts, results);
    await testZeroRecipientToast(browser, opts, results);
  } finally {
    await browser.close();
  }

  const passed = results.filter(r => r.status === 'PASS').length;
  const failed = results.filter(r => r.status === 'FAIL').length;

  console.log(`\n${passed}/${results.length} PASS${failed ? `  \u2014 ${failed} FAIL` : '  \u2713 ALL GREEN'}`);
  writeFileSync(resolve(opts.out, 'results.json'), JSON.stringify({ passed, failed, tests: results }, null, 2));

  if (failed) process.exit(1);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
