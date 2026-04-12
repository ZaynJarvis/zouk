export interface MessageRecord {
  id: string;
  channel_type: 'channel' | 'dm' | 'thread';
  channel_name: string;
  parent_channel_name?: string;
  parent_channel_type?: string;
  message_id?: string;
  timestamp?: string;
  sender_type?: 'agent' | 'human';
  sender_name?: string;
  content?: string;
  attachments?: Array<{ filename: string; id: string }>;
  task_status?: string;
  task_number?: number;
  task_assignee_id?: string;
  task_assignee_type?: string;
}

export interface ServerChannel {
  id: string;
  name: string;
}

export interface ServerAgent {
  id: string;
  name: string;
  displayName?: string;
  description?: string;
  status: 'active' | 'inactive';
  activity?: AgentActivity;
  activityDetail?: string;
  entries?: AgentEntry[];
}

export type AgentActivity = 'thinking' | 'working' | 'online' | 'offline' | 'error';

export interface AgentEntry {
  kind: 'status' | 'thinking' | 'text' | 'tool_start';
  activity?: string;
  detail?: string;
  text?: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
}

export interface ServerHuman {
  id: string;
  name: string;
}

export interface AgentConfig {
  name: string;
  displayName?: string;
  description?: string;
  runtime: string;
  model?: string;
  sessionId?: string;
  serverUrl: string;
  authToken?: string;
  envVars?: Record<string, string>;
  reasoningEffort?: string;
}

export interface ServerMachine {
  id: string;
  hostname: string;
  os: string;
  runtimes?: string[];
  agentIds?: string[];
}

export interface InitPayload {
  channels: ServerChannel[];
  agents: ServerAgent[];
  humans: ServerHuman[];
  configs: AgentConfig[];
  machines: ServerMachine[];
}

export type ViewMode = 'channel' | 'dm' | 'threads' | 'agents';
export type RightPanel = 'thread' | 'details' | 'members' | 'agents' | null;
export type Theme = 'light' | 'dark';

export interface Toast {
  id: string;
  message: string;
  type: 'success' | 'warning' | 'error' | 'info';
}
