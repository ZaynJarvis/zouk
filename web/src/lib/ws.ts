import type {
  MessageRecord, ServerChannel, ServerAgent, ServerHuman,
  AgentConfig, ServerMachine, AgentActivity, AgentEntry,
} from '../types';

export type WsEventType =
  | 'init'
  | 'message' | 'new_message'
  | 'agent_status'
  | 'agent_activity'
  | 'daemon_connected' | 'daemon_disconnected'
  | 'channel_created'
  | 'agent_started'
  | 'config_updated'
  | 'machine:connected' | 'machine:disconnected' | 'machine:updated'
  | 'workspace:file_tree' | 'workspace:file_content'
  | 'skills:list_result'
  | 'machine:workspace:scan_result' | 'machine:workspace:delete_result';

export interface WsInitEvent {
  type: 'init';
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
  files: import('../types').WorkspaceFile[];
}

export interface WsWorkspaceFileContentEvent {
  type: 'workspace:file_content';
  agentId: string;
  requestId: string;
  content: string;
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
  | WsMachineConnectedEvent
  | WsMachineUpdatedEvent
  | WsMachineDisconnectedEvent
  | WsWorkspaceFileTreeEvent
  | WsWorkspaceFileContentEvent
  | { type: string; [key: string]: unknown };

export type WsEventHandler = (event: WsEvent) => void;

const PENDING_SEND_CAP = 100;

export class SlockWebSocket {
  private ws: WebSocket | null = null;
  private handlers: WsEventHandler[] = [];
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
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
      this.flushPending();
      this.emit({ type: 'ws:connected' });
    };

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as WsEvent;
        this.emit(data);
      } catch {
        // ignore malformed messages
      }
    };

    this.ws.onclose = () => {
      this._connected = false;
      this.emit({ type: 'ws:disconnected' });
      this.scheduleReconnect();
    };

    this.ws.onerror = () => {
      this._connected = false;
    };
  }

  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
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
}
