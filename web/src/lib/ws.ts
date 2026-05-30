import type {
  MessageRecord, ServerChannel, ServerAgent, ServerHuman,
  AgentConfig, ServerMachine, AgentActivity, AgentEntry,
  Workspace, AgentLifecycleStatus,
} from '../types';
import { getActiveWorkspaceId } from './workspaceRoute';

export type WsEventType =
  | 'init'
  | 'message' | 'new_message'
  | 'ping'
  | 'agent_status'
  | 'agent_activity'
  | 'daemon_connected' | 'daemon_disconnected'
  | 'channel_created'
  | 'workspace_updated' | 'workspace_deleted'
  | 'agent_started'
  | 'config_updated'
  | 'humans_updated'
  | 'machine:connected' | 'machine:disconnected' | 'machine:updated'
  | 'workspace:file_tree' | 'workspace:file_content'
  | 'memory:list_result' | 'memory:content'
  | 'skills:list_result'
  | 'machine:workspace:scan_result' | 'machine:workspace:delete_result';

export interface WsInitEvent {
  type: 'init';
  workspaceId?: string;
  workspaces?: Workspace[];
  channels: ServerChannel[];
  agents: ServerAgent[];
  humans: ServerHuman[];
  configs: AgentConfig[];
  machines: ServerMachine[];
}

export interface WsMessageEvent {
  type: 'message' | 'new_message';
  message: MessageRecord;
}

export interface WsAgentStatusEvent {
  type: 'agent_status';
  agentId: string;
  status: AgentLifecycleStatus | 'deleted';
}

export interface WsAgentActivityEvent {
  type: 'agent_activity';
  agentId: string;
  activity: AgentActivity;
  detail?: string;
  entries?: AgentEntry[];
  contextUsage?: import('../types').AgentContextUsageSnapshot;
}

export interface WsDaemonEvent {
  type: 'daemon_connected' | 'daemon_disconnected';
}

export interface WsChannelCreatedEvent {
  type: 'channel_created';
  channel: ServerChannel;
}

export interface WsWorkspaceUpdatedEvent {
  type: 'workspace_updated';
  workspace: Workspace;
}

export interface WsAgentStartedEvent {
  type: 'agent_started';
  agent: ServerAgent;
}

export interface WsConfigUpdatedEvent {
  type: 'config_updated';
  configs: AgentConfig[];
}

export interface WsHumansUpdatedEvent {
  type: 'humans_updated';
  humans: ServerHuman[];
}

export interface WsMachineConnectedEvent {
  type: 'machine:connected';
  machine: ServerMachine;
}

export interface WsMachineUpdatedEvent {
  type: 'machine:updated';
  machine: ServerMachine;
}

export interface WsMachineDisconnectedEvent {
  type: 'machine:disconnected';
  machineId: string;
}

export interface WsWorkspaceFileTreeEvent {
  type: 'workspace:file_tree';
  agentId: string;
  dirPath: string;
  workDir?: string;
  files: import('../types').WorkspaceFile[];
}

export interface WsWorkspaceFileContentEvent {
  type: 'workspace:file_content';
  agentId: string;
  requestId: string;
  content: string;
}

export interface WsMemoryListResultEvent {
  type: 'memory:list_result';
  agentId: string;
  uri: string;
  entries: import('../types').MemoryEntry[];
  error?: string;
}

export type MemoryLevel = 'l0' | 'l1' | 'l2';

export interface WsMemoryContentEvent {
  type: 'memory:content';
  agentId: string;
  requestId: string;
  uri: string;
  level: MemoryLevel | null;
  content: string | null;
  error?: string;
}

export interface WsSkillsListResultEvent {
  type: 'skills:list_result';
  agentId: string;
  global: import('../types').AgentAvailableSkill[];
  workspace: import('../types').AgentAvailableSkill[];
}

export type WsEvent =
  | WsInitEvent
  | WsMessageEvent
  | WsAgentStatusEvent
  | WsAgentActivityEvent
  | WsDaemonEvent
  | WsChannelCreatedEvent
  | WsWorkspaceUpdatedEvent
  | WsAgentStartedEvent
  | WsConfigUpdatedEvent
  | WsHumansUpdatedEvent
  | WsMachineConnectedEvent
  | WsMachineUpdatedEvent
  | WsMachineDisconnectedEvent
  | WsWorkspaceFileTreeEvent
  | WsWorkspaceFileContentEvent
  | WsMemoryListResultEvent
  | WsMemoryContentEvent
  | WsSkillsListResultEvent
  | { type: string; [key: string]: unknown };

export type WsEventHandler = (event: WsEvent) => void;

const PENDING_SEND_CAP = 100;

// Reconnect backoff. Earlier code used a flat 3s, which combined with stale
// browser tabs whose token had been revoked produced ~30 conn/s of failed
// /ws upgrades against the server. Once authenticated successfully the
// counter resets, so steady-state behaviour for healthy clients is unchanged.
const BASE_BACKOFF_MS = 3_000;
const MAX_BACKOFF_MS = 60_000;
// Fast probe after a connection that previously opened. Tuned to give a
// graceful server restart ~500ms head start without burning extra reconnects
// when servers are slow — second failure falls back to BASE_BACKOFF_MS.
const FAST_PROBE_MS = 500;
// After this many close-without-open events, validate the token via HTTP. If
// the server says it's no longer good, drop it locally so subsequent
// reconnects go as a guest (which lets the server accept them again) and the
// app can prompt re-login on the auth:expired event.
const VALIDATE_TOKEN_AFTER_FAILURES = 3;

function shouldForceReconnectOnVisible(): boolean {
  const ua = navigator.userAgent || '';
  const platform = navigator.platform || '';
  const maxTouchPoints = navigator.maxTouchPoints || 0;
  const isiOS = /iP(ad|hone|od)/.test(ua) || (platform === 'MacIntel' && maxTouchPoints > 1);
  const isSafari = /Safari/i.test(ua) && !/Chrome|Chromium|CriOS|FxiOS|Edg/i.test(ua);
  const displayStandalone = window.matchMedia?.('(display-mode: standalone)').matches || false;
  const navigatorStandalone = !!(navigator as Navigator & { standalone?: boolean }).standalone;
  return isiOS || (isSafari && (displayStandalone || navigatorStandalone));
}

// Lightweight connection-lifecycle logging. Kept permanent because the most
// common PWA debug — "why didn't my message send / why did WS take so long?" —
// is impossible to triage without seeing onopen / onclose / scheduleReconnect
// timings in the iOS Web Inspector console. Format is intentionally compact so
// it greps well on the constrained iPhone console UI.
const WS_MODULE_LOADED_AT = (typeof performance !== 'undefined' ? performance.now() : Date.now());
let wsInstanceCounter = 0;
function wsLog(instanceId: number, msg: string): void {
  const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const t = (now - WS_MODULE_LOADED_AT).toFixed(0);
  console.info(`[ws#${instanceId} +${t}ms] ${msg}`);
}

// iOS (Safari / PWA) silently kills WebSocket TCP connections when the app is
// backgrounded or the screen locks. Unlike a normal close, the OS never sends a
// FIN/RST, so `onclose` never fires and `readyState` stays OPEN — the socket is
// a zombie that receives nothing. Sources:
//   • WebKit bug 228296: iOS 15 regression — WS closed without close event
//   • WebKit bug 247943: Safari does not emit `onclose` when network drops
//   • graphql-ws #290, tRPC #4078, socket.io #2924 — all hit the same bug
//   • Apple Developer Forums TN2277: "WebSocket is a TCP socket subject to iOS
//     multitasking rules; background apps get seconds, not minutes"
//
// Two-layer defence:
//   1. `visibilitychange` — force-reconnect the moment the user returns to the
//      tab (instant recovery; same fix as Phoenix PR #6534, socket.io, etc.)
//   2. Inbound watchdog — if no frame arrives within INBOUND_WATCHDOG_MS, close
//      and reconnect. Catches stale connections that die without backgrounding:
//      NAT timeout (cellular gateways drop idle mappings in ~30s), Wi-Fi→cell
//      handoff, Cloudflare idle timeout, screen-lock while foregrounded.
const INBOUND_WATCHDOG_MS = 70_000; // 2× server ping interval + buffer

// Cap on events buffered before any handler subscribes. Sized to hold one
// `init` plus a small burst; oldest-first eviction past the cap keeps memory
// bounded if the app never mounts.
const EARLY_EVENT_BUFFER_CAP = 200;

export class SlockWebSocket {
  private ws: WebSocket | null = null;
  private handlers: WsEventHandler[] = [];
  // Events received before any consumer subscribed. Drained into the first
  // handler that calls .on(). Necessary because the singleton in
  // ./wsSingleton.ts starts handshaking at JS-parse time, well before
  // <AppProvider> mounts and the store subscribes — without buffering, the
  // `init` payload would land in /dev/null.
  private earlyEvents: WsEvent[] = [];
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private watchdogTimer: ReturnType<typeof setTimeout> | null = null;
  private visibilityBound: (() => void) | null = null;
  // React cleanup calls disconnect(); late close events from that socket must
  // not resurrect the old instance and create a second background connection.
  private reconnectEnabled = false;
  private serverUrl: string;
  private _connected = false;
  private pendingSends: string[] = [];
  // URL of the in-flight or last-opened connection. Used to short-circuit
  // duplicate connect() calls when the URL hasn't changed, and to force a
  // re-handshake when the workspaceId / token in the URL differs from current
  // state (the singleton outlives workspace switches; the eager connect at
  // JS-parse time captures the URL from localStorage, which may go stale by
  // the time AppProvider mounts and the active workspace gets resolved).
  private lastConnectUrl: string | null = null;
  // Counts close-without-open events since the last successful onopen. Drives
  // the exponential backoff and token-revalidation logic in scheduleReconnect.
  private failedAttempts = 0;
  private validatingToken = false;
  // True between onopen and onclose. We use it to short-circuit one fast
  // reconnect attempt — server restart / NAT drop / cellular hop almost
  // always means the next connect succeeds within a second, so waiting the
  // full slow-schedule 3s on every blip is wasted downtime. Flag clears after
  // the fast probe is scheduled so a second failure falls back to slow.
  private wasConnected = false;
  private readonly instanceId: number;

  constructor(serverUrl: string) {
    this.serverUrl = serverUrl;
    this.instanceId = ++wsInstanceCounter;
    wsLog(this.instanceId, `constructed serverUrl=${serverUrl || '(window.location)'}`);
  }

  get connected(): boolean {
    return this._connected;
  }

  private buildUrl(): string {
    // Re-read the token on every connect so reconnects after login/logout
    // use a fresh credential instead of the one captured at construction.
    const token = localStorage.getItem('zouk_auth_token');
    const workspaceId = getActiveWorkspaceId();
    const params = new URLSearchParams();
    if (token) params.set('token', token);
    params.set('workspaceId', workspaceId);
    const query = `?${params.toString()}`;
    if (this.serverUrl) {
      return `${this.serverUrl.replace(/^http/, 'ws')}/ws${query}`;
    }
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${window.location.host}/ws${query}`;
  }

  connect(): void {
    this.reconnectEnabled = true;
    if (!this.visibilityBound) {
      this.visibilityBound = () => this.handleVisibilityChange();
      document.addEventListener('visibilitychange', this.visibilityBound);
    }

    const newUrl = this.buildUrl();
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      if (this.lastConnectUrl === newUrl) {
        wsLog(this.instanceId, `connect() skipped readyState=${this.ws.readyState} (url unchanged)`);
        return;
      }
      // URL diverged (workspace switch, token refresh) — must re-handshake.
      wsLog(this.instanceId, `connect() URL changed, tearing down old socket`);
      const old = this.ws;
      old.onopen = null;
      old.onmessage = null;
      old.onerror = null;
      old.onclose = null;
      try { old.close(); } catch { /* ignore */ }
      this.ws = null;
      this._connected = false;
      this.clearWatchdog();
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }
    }

    const attemptStart = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    wsLog(this.instanceId, `connect() opening attempt=${this.failedAttempts + 1}`);
    this.lastConnectUrl = newUrl;

    let socket: WebSocket;
    try {
      socket = new WebSocket(newUrl);
      this.ws = socket;
    } catch (e) {
      wsLog(this.instanceId, `new WebSocket() threw: ${(e as Error)?.message || e}`);
      this.scheduleReconnect();
      return;
    }

    socket.onopen = () => {
      if (!this.reconnectEnabled || this.ws !== socket) return;
      const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
      wsLog(this.instanceId, `onopen handshake=${(now - attemptStart).toFixed(0)}ms pendingSends=${this.pendingSends.length}`);
      this._connected = true;
      this.wasConnected = true;
      this.failedAttempts = 0;
      this.resetWatchdog();
      this.flushPending();
      this.emit({ type: 'ws:connected' });
    };

    socket.onmessage = (event) => {
      if (!this.reconnectEnabled || this.ws !== socket) return;
      this.resetWatchdog();
      try {
        const data = JSON.parse(event.data) as WsEvent;
        this.emit(data);
      } catch {
        // ignore malformed messages
      }
    };

    socket.onclose = (e) => {
      if (!this.reconnectEnabled || this.ws !== socket) return;
      const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
      wsLog(this.instanceId, `onclose code=${e.code} reason=${e.reason || ''} elapsed=${(now - attemptStart).toFixed(0)}ms wasConnected=${this.wasConnected}`);
      this._connected = false;
      this.clearWatchdog();
      this.emit({ type: 'ws:disconnected' });
      this.scheduleReconnect();
    };

    socket.onerror = () => {
      if (!this.reconnectEnabled || this.ws !== socket) return;
      wsLog(this.instanceId, `onerror readyState=${socket.readyState}`);
      this._connected = false;
    };
  }

  disconnect(): void {
    this.reconnectEnabled = false;
    if (this.visibilityBound) {
      document.removeEventListener('visibilitychange', this.visibilityBound);
      this.visibilityBound = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.clearWatchdog();
    if (this.ws) {
      const socket = this.ws;
      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
      socket.close();
      this.ws = null;
    }
    this._connected = false;
    this.pendingSends = [];
  }

  send(data: Record<string, unknown>): void {
    const payload = JSON.stringify(data);
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(payload);
      return;
    }
    // Queue sends made before onopen (or during a reconnect) so the first
    // message after a reload / network blip isn't silently dropped. Cap
    // the queue to avoid unbounded memory if the server stays unreachable.
    if (this.pendingSends.length >= PENDING_SEND_CAP) {
      this.pendingSends.shift();
    }
    this.pendingSends.push(payload);
    wsLog(this.instanceId, `send() queued readyState=${this.ws?.readyState ?? 'null'} queueLen=${this.pendingSends.length}`);
  }

  private flushPending(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || this.pendingSends.length === 0) {
      return;
    }
    const queue = this.pendingSends;
    this.pendingSends = [];
    wsLog(this.instanceId, `flushPending sending=${queue.length}`);
    for (const payload of queue) {
      this.ws.send(payload);
    }
  }

  on(handler: WsEventHandler): () => void {
    this.handlers.push(handler);
    // Drain pre-mount events into the new subscriber. Only the very first
    // .on() ever sees a non-empty buffer; subsequent subscribers see only
    // the live stream from that point on.
    if (this.earlyEvents.length > 0) {
      const buffered = this.earlyEvents;
      this.earlyEvents = [];
      for (const event of buffered) handler(event);
    }
    return () => {
      this.handlers = this.handlers.filter(h => h !== handler);
    };
  }

  private emit(event: WsEvent): void {
    if (this.handlers.length === 0) {
      this.earlyEvents.push(event);
      if (this.earlyEvents.length > EARLY_EVENT_BUFFER_CAP) this.earlyEvents.shift();
      return;
    }
    for (const handler of this.handlers) {
      handler(event);
    }
  }

  private scheduleReconnect(): void {
    if (!this.reconnectEnabled) return;
    if (this.reconnectTimer) return;
    this.failedAttempts += 1;
    // Fast path: if the *previous* connection actually opened (server
    // restart, NAT drop, watchdog kicked us), try again in ~500ms instead
    // of the slow 3s baseline. The flag clears so a second failure falls
    // back to the slow schedule — protects against tabs with revoked tokens
    // spamming /ws upgrades after they could never open in the first place.
    const fastProbe = this.wasConnected;
    this.wasConnected = false;
    // 3s, 6s, 12s, 24s, 48s, then capped at 60s
    const delay = fastProbe
      ? FAST_PROBE_MS
      : Math.min(
          BASE_BACKOFF_MS * Math.pow(2, Math.max(0, this.failedAttempts - 1)),
          MAX_BACKOFF_MS,
        );
    wsLog(this.instanceId, `scheduleReconnect delay=${delay}ms failedAttempts=${this.failedAttempts} fastProbe=${fastProbe}`);
    if (this.failedAttempts === VALIDATE_TOKEN_AFTER_FAILURES) {
      // Fire-and-forget so the reconnect timer isn't blocked by the fetch.
      void this.maybeDropDeadToken();
    }
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.reconnectEnabled) return;
      this.connect();
    }, delay);
  }

  // After repeated close-without-open failures, the most likely cause is a
  // session token that the server no longer accepts (manual revoke, server
  // wipe, expired). HEAD it via /api/auth/me; on 401, drop the token so the
  // next reconnect goes as a guest and the app can prompt re-login.
  private async maybeDropDeadToken(): Promise<void> {
    if (this.validatingToken) return;
    if (typeof localStorage === 'undefined') return;
    const token = localStorage.getItem('zouk_auth_token');
    if (!token) return;
    this.validatingToken = true;
    try {
      const base = this.serverUrl || '';
      const res = await fetch(`${base}/api/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 401) {
        localStorage.removeItem('zouk_auth_token');
        this.emit({ type: 'auth:expired' });
      }
    } catch {
      // ignore network errors — backoff will keep the retry rate low anyway
    } finally {
      this.validatingToken = false;
    }
  }

  private resetWatchdog(): void {
    this.clearWatchdog();
    this.watchdogTimer = setTimeout(() => {
      this._connected = false;
      try {
        this.ws?.close();
      } catch {
        // ignore close failures; reconnect path below will recover
      }
    }, INBOUND_WATCHDOG_MS);
  }

  private clearWatchdog(): void {
    if (this.watchdogTimer) {
      clearTimeout(this.watchdogTimer);
      this.watchdogTimer = null;
    }
  }

  // See module-level comment for why this exists. Short version: iOS kills the
  // TCP socket silently on background without firing onclose. This handler is
  // the primary defence; the watchdog above is the secondary belt-and-suspenders.
  private handleVisibilityChange(): void {
    if (document.visibilityState !== 'visible') return;
    if (!this.reconnectEnabled) return;
    const state = this.ws?.readyState;
    if (!shouldForceReconnectOnVisible()) {
      if (state !== WebSocket.OPEN && state !== WebSocket.CONNECTING) {
        wsLog(this.instanceId, `visibilitychange reconnecting state=${state ?? 'null'}`);
        this.connect();
      }
      return;
    }
    wsLog(this.instanceId, `visibilitychange force-reconnect (iOS) state=${state ?? 'null'}`);
    // Detach all callbacks before closing so no stale handlers fire.
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onerror = null;
      this.ws.onclose = null;
      try { this.ws.close(); } catch { /* ignore */ }
      this.ws = null;
    }
    this.clearWatchdog();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this._connected = false;
    this.emit({ type: 'ws:disconnected' });
    this.connect();
  }
}
