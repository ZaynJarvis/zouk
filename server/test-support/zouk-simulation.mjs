import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.resolve(__dirname, '..');
const REPO_DIR = path.resolve(SERVER_DIR, '..');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getFreePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  await new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
  return port;
}

function appendLog(current, chunk) {
  const next = current + chunk.toString();
  return next.length > 24_000 ? next.slice(-24_000) : next;
}

function bodyPreview(body) {
  if (body === undefined || body === null) return '';
  if (typeof body === 'string') return body;
  try {
    return JSON.stringify(body);
  } catch {
    return String(body);
  }
}

function shouldJsonEncodeBody(value) {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return false;
  if (Buffer.isBuffer(value)) return false;
  if (value instanceof URLSearchParams) return false;
  if (typeof FormData !== 'undefined' && value instanceof FormData) return false;
  return true;
}

async function waitForExit(proc, timeoutMs) {
  if (!proc || proc.exitCode !== null || proc.signalCode !== null) return true;
  return await new Promise((resolve) => {
    const timer = setTimeout(() => {
      proc.off('exit', onExit);
      resolve(false);
    }, timeoutMs);
    const onExit = () => {
      clearTimeout(timer);
      resolve(true);
    };
    proc.once('exit', onExit);
  });
}

function waitForOpen(ws, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out opening websocket after ${timeoutMs}ms`));
    }, timeoutMs);
    const cleanup = () => {
      clearTimeout(timer);
      ws.off('open', onOpen);
      ws.off('error', onError);
      ws.off('unexpected-response', onUnexpectedResponse);
    };
    const onOpen = () => {
      cleanup();
      resolve();
    };
    const onError = (err) => {
      cleanup();
      reject(err);
    };
    const onUnexpectedResponse = (_req, res) => {
      cleanup();
      reject(new Error(`Unexpected websocket response ${res.statusCode}`));
    };
    ws.once('open', onOpen);
    ws.once('error', onError);
    ws.once('unexpected-response', onUnexpectedResponse);
  });
}

class SimulatedSocket {
  constructor(ws, label) {
    this.ws = ws;
    this.label = label;
    this.messages = [];
    this.waiters = new Set();
    this.closed = false;

    ws.on('message', (raw) => {
      let event;
      try {
        event = JSON.parse(raw.toString());
      } catch {
        event = { type: '__raw', raw: raw.toString() };
      }
      this.#record(event);
    });

    ws.on('close', () => {
      this.closed = true;
      for (const waiter of this.waiters) {
        clearTimeout(waiter.timer);
        if (waiter.rejectOnTimeout) {
          waiter.reject(new Error(`${this.label} websocket closed before expected event`));
        } else {
          waiter.resolve(null);
        }
      }
      this.waiters.clear();
    });
  }

  #record(event) {
    for (const waiter of this.waiters) {
      if (!waiter.predicate(event)) continue;
      clearTimeout(waiter.timer);
      this.waiters.delete(waiter);
      waiter.resolve(event);
      return;
    }
    this.messages.push(event);
  }

  #takeBuffered(predicate) {
    const idx = this.messages.findIndex(predicate);
    if (idx < 0) return null;
    const [event] = this.messages.splice(idx, 1);
    return event;
  }

  #waitFor(predicate, timeoutMs, rejectOnTimeout) {
    const buffered = this.#takeBuffered(predicate);
    if (buffered) return Promise.resolve(buffered);
    if (this.closed) {
      if (rejectOnTimeout) return Promise.reject(new Error(`${this.label} websocket is closed`));
      return Promise.resolve(null);
    }
    return new Promise((resolve, reject) => {
      const waiter = { predicate, resolve, reject, rejectOnTimeout, timer: null };
      waiter.timer = setTimeout(() => {
        this.waiters.delete(waiter);
        if (rejectOnTimeout) {
          reject(new Error(`Timed out waiting for ${this.label} websocket event after ${timeoutMs}ms`));
        } else {
          resolve(null);
        }
      }, timeoutMs);
      this.waiters.add(waiter);
    });
  }

  waitFor(predicate, timeoutMs = 3000) {
    return this.#waitFor(predicate, timeoutMs, true);
  }

  waitForOrNull(predicate, timeoutMs = 600) {
    return this.#waitFor(predicate, timeoutMs, false);
  }

  waitForType(type, timeoutMs = 3000) {
    return this.waitFor((event) => event.type === type, timeoutMs);
  }

  send(event) {
    if (this.ws.readyState !== WebSocket.OPEN) {
      throw new Error(`${this.label} websocket is not open`);
    }
    this.ws.send(JSON.stringify(event));
  }

  async close() {
    if (this.ws.readyState === WebSocket.CLOSED || this.ws.readyState === WebSocket.CLOSING) return;
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 75);
      this.ws.once('close', () => {
        clearTimeout(timer);
        resolve();
      });
      this.ws.close();
    });
  }
}

class SimulatedDaemon extends SimulatedSocket {
  ready({
    hostname = 'sim-host.local',
    os: osName = 'test-os',
    runtimes = ['claude'],
    capabilities = [],
    runningAgents = [],
  } = {}) {
    this.send({
      type: 'ready',
      hostname,
      os: osName,
      runtimes,
      capabilities,
      runningAgents,
    });
  }

  waitForStart(agentId, timeoutMs = 3000) {
    return this.waitFor((event) => event.type === 'agent:start' && event.agentId === agentId, timeoutMs);
  }

  waitForStop(agentId, timeoutMs = 3000) {
    return this.waitFor((event) => event.type === 'agent:stop' && event.agentId === agentId, timeoutMs);
  }

  waitForDelivery(agentId, predicate = () => true, timeoutMs = 3000) {
    return this.waitFor((event) => (
      event.type === 'agent:deliver'
      && event.agentId === agentId
      && predicate(event)
    ), timeoutMs);
  }

  agentStatus(agentId, {
    status = 'active',
    runtime = 'claude',
    model = 'sonnet',
    workDir,
    sessionId,
  } = {}) {
    const payload = { type: 'agent:status', agentId, status, runtime, model };
    if (workDir) payload.workDir = workDir;
    if (sessionId) payload.sessionId = sessionId;
    this.send(payload);
  }

  agentActivity(agentId, {
    activity = 'working',
    detail,
    entries,
    contextUsage,
  } = {}) {
    const payload = { type: 'agent:activity', agentId, activity };
    if (detail !== undefined) payload.detail = detail;
    if (entries !== undefined) payload.entries = entries;
    if (contextUsage !== undefined) payload.contextUsage = contextUsage;
    this.send(payload);
  }

  health(payload = {}) {
    this.send({
      type: 'daemon:health',
      seq: payload.seq ?? Date.now(),
      reason: payload.reason || 'simulation',
      agentId: payload.agentId,
      launchId: payload.launchId,
      sentAt: payload.sentAt || new Date().toISOString(),
    });
  }

  deliverAck(agentId, seq) {
    this.send({ type: 'agent:deliver:ack', agentId, seq });
  }
}

export class ZoukSimulation {
  constructor(options = {}) {
    this.name = options.name || 'zouk-sim';
    this.port = options.port || null;
    this.keepTemp = !!options.keepTemp;
    this.mock = !!options.mock;
    this.rootToken = options.rootToken || 'sim-root-token';
    this.rootUser = {
      name: options.rootName || 'sim-root',
      email: options.rootEmail || 'sim-root@example.com',
      picture: null,
      ...(options.rootUser || {}),
    };
    this.env = options.env || {};
    this.proc = null;
    this.stdout = '';
    this.stderr = '';
    this.configDir = null;
    this.uploadsDir = null;
    this.sockets = new Set();
    this.stopped = false;
  }

  get baseUrl() {
    return `http://127.0.0.1:${this.port}`;
  }

  get wsUrl() {
    return `ws://127.0.0.1:${this.port}`;
  }

  url(route) {
    if (/^https?:\/\//.test(route)) return route;
    return `${this.baseUrl}${route.startsWith('/') ? route : `/${route}`}`;
  }

  async start() {
    if (this.proc) return this;
    this.port ||= await getFreePort();
    this.configDir = fs.mkdtempSync(path.join(os.tmpdir(), `${this.name}-config-`));
    this.uploadsDir = fs.mkdtempSync(path.join(os.tmpdir(), `${this.name}-uploads-`));
    fs.writeFileSync(
      path.join(this.configDir, 'sessions.json'),
      JSON.stringify([[this.rootToken, this.rootUser]], null, 2),
      'utf8',
    );

    const env = {
      ...process.env,
      DATABASE_URL: '',
      NODE_ENV: 'test',
      PORT: String(this.port),
      PUBLIC_URL: this.baseUrl,
      ZOUK_CONFIG_DIR: this.configDir,
      ZOUK_UPLOADS_DIR: this.uploadsDir,
      ZOUK_SUPERUSERS: this.rootUser.email || '',
      ZOUK_PERF_LOG: '0',
      ...(!this.mock ? { ZOUK_NO_MOCK: '1' } : {}),
      ...this.env,
    };

    this.proc = spawn(process.execPath, [path.join(SERVER_DIR, 'index.js')], {
      cwd: REPO_DIR,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.proc.stdout.on('data', (chunk) => { this.stdout = appendLog(this.stdout, chunk); });
    this.proc.stderr.on('data', (chunk) => { this.stderr = appendLog(this.stderr, chunk); });

    await this.waitForReady();
    return this;
  }

  async waitForReady(timeoutMs = 10_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (this.proc?.exitCode !== null) break;
      try {
        const res = await fetch(this.url('/api/auth/config'));
        if (res.ok) return;
      } catch {
        // keep polling
      }
      await sleep(100);
    }
    throw new Error(
      `Zouk simulation did not become ready within ${timeoutMs}ms\n`
      + `stdout:\n${this.stdout}\n\nstderr:\n${this.stderr}`,
    );
  }

  async stop() {
    if (this.stopped) return;
    this.stopped = true;
    await Promise.allSettled([...this.sockets].map((socket) => socket.close()));
    this.sockets.clear();

    if (this.proc && this.proc.exitCode === null && this.proc.signalCode === null) {
      this.proc.kill('SIGTERM');
      const exited = await waitForExit(this.proc, 2500);
      if (!exited && this.proc.exitCode === null && this.proc.signalCode === null) {
        this.proc.kill('SIGKILL');
        await waitForExit(this.proc, 1000);
      }
    }
    if (!this.keepTemp) {
      if (this.configDir) fs.rmSync(this.configDir, { recursive: true, force: true });
      if (this.uploadsDir) fs.rmSync(this.uploadsDir, { recursive: true, force: true });
    }
  }

  async request(method, route, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (options.token) headers.Authorization = `Bearer ${options.token}`;
    if (options.apiKey) headers['X-API-Key'] = options.apiKey;
    if (options.workspaceId) headers['X-Workspace-Id'] = options.workspaceId;

    let body = options.body;
    if (shouldJsonEncodeBody(body)) {
      if (!headers['Content-Type'] && !headers['content-type']) headers['Content-Type'] = 'application/json';
      body = JSON.stringify(body);
    }

    return await fetch(this.url(route), { method, headers, body });
  }

  async json(method, route, options = {}) {
    const res = await this.request(method, route, options);
    const text = await res.text();
    let body = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    }
    return { res, status: res.status, ok: res.ok, body };
  }

  async jsonOk(method, route, options = {}) {
    const result = await this.json(method, route, options);
    if (!result.ok) {
      throw new Error(`${method} ${route} failed with ${result.status}: ${bodyPreview(result.body)}`);
    }
    return result.body;
  }

  get(route, options = {}) {
    return this.jsonOk('GET', route, options);
  }

  post(route, body, options = {}) {
    return this.jsonOk('POST', route, { ...options, body });
  }

  patch(route, body, options = {}) {
    return this.jsonOk('PATCH', route, { ...options, body });
  }

  createGuest(name, options = {}) {
    return this.post('/api/auth/guest-session', { name, ...(options.body || {}) }, options);
  }

  sendHumanMessage({ token = this.rootToken, target = '#all', content, attachmentIds, clientMsgId, workspaceId } = {}) {
    return this.post('/api/messages', { target, content, attachmentIds, clientMsgId }, { token, workspaceId });
  }

  getMessages({ token, channel = '#all', limit = 50, before, after, workspaceId, sender } = {}) {
    const headers = {
      'X-Channel': channel,
      'X-Limit': String(limit),
    };
    if (before) headers['X-Before'] = before;
    if (after) headers['X-After'] = after;
    if (sender) headers['X-Sender'] = sender;
    return this.get('/api/messages', { token, workspaceId, headers });
  }

  trigger({ apiKey = 'test', target = '#all', content, workspaceId } = {}) {
    return this.post('/api/trigger', { target, content }, { apiKey, workspaceId });
  }

  createMachineKey(name = 'sim-machine', options = {}) {
    return this.post('/api/machine-keys', { name }, { token: options.token || this.rootToken, workspaceId: options.workspaceId });
  }

  listMachines(options = {}) {
    return this.get('/api/machines', { token: options.token || this.rootToken, workspaceId: options.workspaceId });
  }

  createAgentConfig(config, options = {}) {
    return this.post('/api/agent-configs', {
      runtime: 'claude',
      model: 'sonnet',
      displayName: config.displayName || config.name || config.id,
      description: '',
      ...config,
    }, { token: options.token || this.rootToken, workspaceId: options.workspaceId });
  }

  startAgent(config, options = {}) {
    return this.post('/api/agents/start', {
      runtime: 'claude',
      model: 'sonnet',
      openvikingEnabled: false,
      ...config,
    }, { token: options.token || this.rootToken, workspaceId: options.workspaceId });
  }

  stopAgent(agentId, options = {}) {
    return this.post(`/api/agents/${encodeURIComponent(agentId)}/stop`, {}, {
      token: options.token || this.rootToken,
      workspaceId: options.workspaceId,
    });
  }

  setAgentSubscription(agentId, { channelName = 'all', channelId, channelType = 'channel', canRead = true, subscribed = true } = {}) {
    return this.patch(`/internal/agent/${encodeURIComponent(agentId)}/subscriptions`, {
      channelId,
      channelName,
      channelType,
      canRead,
      subscribed,
    });
  }

  agentReceive(agentId) {
    return this.get(`/internal/agent/${encodeURIComponent(agentId)}/receive`);
  }

  agentSend(agentId, { target = '#all', content, attachmentIds } = {}) {
    return this.post(`/internal/agent/${encodeURIComponent(agentId)}/send`, { target, content, attachmentIds });
  }

  agentHistory(agentId, { channel = '#all', limit = 50, before, after, around } = {}) {
    const params = new URLSearchParams({ channel, limit: String(limit) });
    if (before !== undefined) params.set('before', String(before));
    if (after !== undefined) params.set('after', String(after));
    if (around !== undefined) params.set('around', String(around));
    return this.get(`/internal/agent/${encodeURIComponent(agentId)}/history?${params}`);
  }

  agentSearch(agentId, { q, channel, limit = 10 } = {}) {
    const params = new URLSearchParams({ q: q || '', limit: String(limit) });
    if (channel) params.set('channel', channel);
    return this.get(`/internal/agent/${encodeURIComponent(agentId)}/search?${params}`);
  }

  async connectWebClient({ token, workspaceId, timeoutMs = 3000 } = {}) {
    const url = new URL(`${this.wsUrl}/ws`);
    if (token) url.searchParams.set('token', token);
    if (workspaceId) url.searchParams.set('workspaceId', workspaceId);
    const ws = new WebSocket(url);
    const client = new SimulatedSocket(ws, 'web');
    await waitForOpen(ws, timeoutMs);
    this.sockets.add(client);
    return client;
  }

  async connectDaemon({ key = 'test', timeoutMs = 3000 } = {}) {
    const url = new URL(`${this.wsUrl}/daemon/connect`);
    url.searchParams.set('key', key);
    const ws = new WebSocket(url);
    const daemon = new SimulatedDaemon(ws, 'daemon');
    await waitForOpen(ws, timeoutMs);
    this.sockets.add(daemon);
    return daemon;
  }

  async waitUntil(check, description = 'condition', timeoutMs = 3000, intervalMs = 50) {
    const deadline = Date.now() + timeoutMs;
    let lastError = null;
    while (Date.now() < deadline) {
      try {
        const result = await check();
        if (result) return result;
      } catch (err) {
        lastError = err;
      }
      await sleep(intervalMs);
    }
    const suffix = lastError ? ` Last error: ${lastError.message}` : '';
    throw new Error(`Timed out waiting for ${description} after ${timeoutMs}ms.${suffix}`);
  }

  waitForMachineReady(machineId, { runtime = 'claude', timeoutMs = 3000 } = {}) {
    return this.waitUntil(async () => {
      const { machines } = await this.listMachines();
      return machines.find((machine) => (
        machine.id === machineId
        && (!runtime || machine.runtimes?.includes(runtime))
      ));
    }, `machine ${machineId} ready`, timeoutMs);
  }
}

export async function createZoukSimulation(options = {}) {
  const sim = new ZoukSimulation(options);
  await sim.start();
  return sim;
}
