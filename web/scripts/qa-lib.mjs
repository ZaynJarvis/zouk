/**
 * Shared QA utilities for Zouk Playwright tests.
 * Import in test runners to avoid duplicating setup code.
 */

export const TEST_TOKEN = 'qa-test-token-2026';
export const TEST_USER = { name: 'QA Tester', email: 'qa@test.local', picture: null };

// 1×1 red pixel PNG — distinguishable from initial-tile avatar fallback
export const TEST_AVATAR_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADklEQVQI12P4z8BQDwAEgAF/QualIQAAAABJRU5ErkJggg==';

export const FAKE_AGENTS = [
  { id: 'agent-hela-001', name: 'hela-bot', displayName: 'Hela', runtime: 'claude', model: 'claude-sonnet-4-6', status: 'active', machineId: 'machine-001' },
  { id: 'agent-tim-002',  name: 'tim-bot',  displayName: 'Tim',  runtime: 'claude', model: 'claude-sonnet-4-6', status: 'idle',   machineId: 'machine-001' },
  { id: 'agent-qa-003',  name: 'qa-bot',   displayName: 'QA Bot', runtime: 'claude', model: 'claude-sonnet-4-6', status: 'active', machineId: 'machine-001' },
];
export const FAKE_CONFIGS = [
  { id: 'agent-hela-001', name: 'hela-bot', displayName: 'Hela', runtime: 'claude', model: 'claude-sonnet-4-6', description: 'Team coordinator', picture: null },
  { id: 'agent-tim-002',  name: 'tim-bot',  displayName: 'Tim',  runtime: 'claude', model: 'claude-sonnet-4-6', description: 'Infrastructure', picture: null },
];
export const FAKE_HUMANS = [
  { id: 'human-001', name: 'zaynjarvis',  email: 'zaynjarvis@gmail.com', picture: null },
  { id: 'human-002', name: 'QA Tester',   email: 'qa@test.local',        picture: null },
];
export const FAKE_CHANNELS = [
  { id: 'ch-all',  name: 'all',  description: 'General', members: [] },
  { id: 'ch-zouk', name: 'zouk', description: 'Dev',     members: [] },
];
export const FAKE_MACHINES = [
  { id: 'machine-001', hostname: 'bytedance', os: 'darwin arm64', runtimes: ['claude'], capabilities: ['agent:start'] },
];

/**
 * Inject auth credentials into the page's localStorage.
 * Must be called before page.reload() to take effect.
 */
export async function setupAuth(page, user = TEST_USER) {
  await page.evaluate(({ token, user }) => {
    localStorage.setItem('zouk_auth_token', token);
    localStorage.setItem('zouk_auth_user', JSON.stringify(user));
    localStorage.setItem('zouk_current_user', user.name);
  }, { token: TEST_TOKEN, user });
}

/**
 * Register a WebSocket route that sends the init event on connect.
 * @param {import('playwright').Page} page
 * @param {object} opts
 * @param {object[]} [opts.extraMessages]  - extra WS messages to send 500ms after init
 * @param {object}  [opts.initOverride]   - merge into the init payload
 */
export async function mockWS(page, { extraMessages = [], initOverride = {} } = {}) {
  await page.routeWebSocket(/\/ws/, (ws) => {
    ws.send(JSON.stringify({
      type: 'init',
      channels: FAKE_CHANNELS,
      agents: FAKE_AGENTS,
      humans: FAKE_HUMANS,
      configs: FAKE_CONFIGS,
      machines: FAKE_MACHINES,
      ...initOverride,
    }));
    if (extraMessages.length) {
      setTimeout(() => {
        for (const msg of extraMessages) {
          try { ws.send(JSON.stringify(msg)); } catch (_) {}
        }
      }, 600);
    }
    ws.onMessage(() => {});
    ws.onClose(() => {});
  });
}

/**
 * Full page boot: mockWS → goto → setupAuth → reload → settle.
 * Returns the page ready for test interactions.
 * @param {import('playwright').Page} page
 * @param {string} url
 * @param {object} [opts]
 * @param {object} [opts.user]           - override test user (e.g. add gravatarUrl)
 * @param {object[]} [opts.extraMessages]
 * @param {object}  [opts.initOverride]
 */
export async function loadApp(page, url, { user = TEST_USER, extraMessages = [], initOverride = {} } = {}) {
  await mockWS(page, { extraMessages, initOverride });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await setupAuth(page, user);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
}
