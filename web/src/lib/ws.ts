import type {
  MessageRecord, ServerChannel, ServerAgent, ServerHuman,
  AgentConfig, ServerMachine, AgentActivity, AgentEntry, AgentProfilePreset,
} from '../types';

export type WsEventType =
  | 'init'
  | 'message' | 'new_message'
  | 'ping'
  | 'agent_status'
  | 'agent_activity'
  | 'daemon_connected' | 'daemon_disconnected'
  | 'channel_created'
  | 'agent_started'
  | 'config_updated'
  | 'humans_updated'
  | 'agent_profile_presets_updated'
  | 'machine:connected' | 'machine:disconnected' | 'machine:updated'
  | 'workspace:file_tree' | 'workspace:file_content'
  | 'memory:list_result' | 'memory:content'
  | 'skills:list_result'
  | 'machine:workspace:scan_result' | 'machine:workspace:delete_result';

export interface WsInitEvent {
  type: 'init';
  channels: ServerChannel[];
  agents: ServerAgent[];
  humans: ServerHuman[];
  configs: AgentConfig[];
  machines: ServerMachine[];
  profilePresets?: AgentProfilePreset[];
}

export interface WsProfilePresetsUpdatedEvent {
  type: 'agent_profile_presets_updated';
  presets: AgentProfilePreset[];
}

export interface WsMessageEvent {
  type: 'message' | 'new_message';
  message: MessageRecord;
}

export interface WsAgentStatusEvent {
  type: 'agent_status';
  agentId: string;
  status: 'active' | 'inactive';
}

export interface WsAgentActivityEvent {
  type: 'agent_activity';
  agentId: string;
  activity: AgentActivity;
  detail?: string;
  entries?: AgentEntry[];
}

export interface WsDaemonEvent {
  type: 'daemon_connected' | 'daemon_disconnected';
}

export interface WsChannelCreatedEvent {
  type: 'channel_created';
  channel: ServerChannel;
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

export interface WsMemoryContentEvent {
  type: 'memory:content';
  agentId: string;
  requestId: string;
  uri: string;
  content: string | null;
  error?: string;
}

export type WsEvent =
  | WsInitEvent
  | WsMessageEvent
  | WsAgentStatusEvent
  | WsAgentActivityEvent
  | WsDaemonEvent
  | WsChannelCreatedEvent
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
  | WsProfilePresetsUpdatedEvent
  | { type: string; [key: string]: unknown };

export type WsEventHandler = (event: WsEvent) => void;

const PENDING_SEND_CAP = 100;

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

export class SlockWebSocket {
  private ws: WebSocket | null = null;
  private handlers: WsEventHandler[] = [];
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private watchdogTimer: ReturnType<typeof setTimeout> | null = null;
  private visibilityBound: (() => void) | null = null;
  private serverUrl: string;
  private _connected = false;
  private pendingSends: string[] = [];

  constructor(serverUrl: string) {
    this.serverUrl = serverUrl;
  }

  get connected(): boolean {
    return this._connected;
  }

  private buildUrl(): string {
    // Re-read the token on every connect so reconnects after login/logout
    // use a fresh credential instead of the one captured at construction.
    const token = localStorage.getItem('zouk_auth_token');
    const tokenQuery = token ? `?token=${encodeURIComponent(token)}` : '';
    if (this.serverUrl) {
      return `${this.serverUrl.replace(/^http/, 'ws')}/ws${tokenQuery}`;
    }
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${window.location.host}/ws${tokenQuery}`;
  }

  connect(): void {
    if (!this.visibilityBound) {
      this.visibilityBound = () => this.handleVisibilityChange();
      document.addEventListener('visibilitychange', this.visibilityBound);
    }

    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    try {
      this.ws = new WebSocket(this.buildUrl());
    } catch {
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this._connected = true;
      this.resetWatchdog();
      this.flushPending();
      this.emit({ type: 'ws:connected' });
    };

    this.ws.onmessage = (event) => {
      this.resetWatchdog();
      try {
        const data = JSON.parse(event.data) as WsEvent;
        this.emit(data);
      } catch {
        // ignore malformed messages
      }
    };

    this.ws.onclose = () => {
      this._connected = false;
      this.clearWatchdog();
      this.emit({ type: 'ws:disconnected' });
      this.scheduleReconnect();
    };

    this.ws.onerror = () => {
      this._connected = false;
    };
  }

  disconnect(): void {
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
      this.ws.close();
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
  }

  private flushPending(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || this.pendingSends.length === 0) {
      return;
    }
    const queue = this.pendingSends;
    this.pendingSends = [];
    for (const payload of queue) {
      this.ws.send(payload);
    }
  }

  on(handler: WsEventHandler): () => void {
    this.handlers.push(handler);
    return () => {
      this.handlers = this.handlers.filter(h => h !== handler);
    };
  }

  private emit(event: WsEvent): void {
    for (const handler of this.handlers) {
      handler(event);
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 3000);
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
