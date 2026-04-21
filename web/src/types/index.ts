export interface MessageRecord {
  id: string;
  channel_type: 'channel' | 'dm' | 'thread';
  channel_name: string;
  parent_channel_name?: string;
  parent_channel_type?: string;
  parent_message_id?: string;
  message_id?: string;
  timestamp?: string;
  sender_type?: 'agent' | 'human' | 'system';
  sender_name?: string;
  content?: string;
  attachments?: Array<{ filename: string; id: string; contentType?: string }>;
  task_status?: string;
  task_number?: number;
  task_assignee_id?: string;
  task_assignee_type?: string;
  dm_parties?: string[];
  replies?: MessageRecord[];
  reply_count?: number;
}

export interface ServerChannel {
  id: string;
  name: string;
  description?: string;
  type?: 'channel' | 'dm';
}

export interface ServerAgent {
  id: string;
  name: string;
  displayName?: string;
  description?: string;
  instructions?: string;
  picture?: string;
  status: 'active' | 'inactive';
  activity?: AgentActivity;
  activityDetail?: string;
  entries?: AgentEntry[];
  runtime?: string;
  model?: string;
  machineId?: string;
  visibility?: 'workspace' | 'private';
  maxConcurrentTasks?: number;
  skills?: AgentSkill[];
  channels?: string[];
  workDir?: string;
  archivedAt?: string;
  autoStart?: boolean;
  contextUsage?: AgentContextUsageSnapshot;
}

export interface AgentSkill {
  id: string;
  name: string;
  description?: string;
}

export interface RuntimeDevice {
  id: string;
  name: string;
  runtimeMode: 'local' | 'cloud';
  provider: string;
  status: 'online' | 'offline';
  deviceInfo?: string;
}

export interface Skill {
  id: string;
  name: string;
  description?: string;
  content?: string;
}

export interface AgentTask {
  id: string;
  agentId: string;
  status: 'queued' | 'dispatched' | 'running' | 'completed' | 'failed' | 'cancelled';
  priority?: number;
  error?: string;
  createdAt?: string;
  completedAt?: string;
}

export interface MachineApiKey {
  id: string;
  name: string;
  keyPrefix: string;
  createdAt: string;
  lastUsedAt?: string;
}

export interface RuntimeConfig {
  provider: string;
  apiKey?: string;
  serverUrl?: string;
  envVars?: Record<string, string>;
}

export type AgentActivity = 'thinking' | 'working' | 'online' | 'offline' | 'error';

export interface AgentContextUsageModel {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  usedTokens: number;
  contextWindow?: number;
  maxOutputTokens?: number;
  percent?: number;
  costUSD?: number;
  webSearchRequests?: number;
}

export interface AgentContextUsageSnapshot {
  updatedAt: string;
  summary: AgentContextUsageModel;
  models: AgentContextUsageModel[];
  totalCostUSD?: number;
}

export type AgentEntryLevel = 'info' | 'success' | 'warning' | 'error';

export interface AgentEntry {
  kind: 'status' | 'note' | 'tool' | 'context_usage' | 'thinking' | 'text' | 'tool_start';
  title?: string;
  content?: string;
  timestamp?: string;
  level?: AgentEntryLevel;
  activity?: string;
  detail?: string;
  text?: string;
  toolName?: string;
  toolInput?: Record<string, unknown> | string;
  toolInputSummary?: string;
  contextUsage?: AgentContextUsageSnapshot;
  meta?: Record<string, unknown>;
}

export interface ServerHuman {
  id: string;
  name: string;
  picture?: string;
  gravatarUrl?: string;
  guest?: boolean;
  online?: boolean;
}

export interface AgentConfig {
  id?: string;
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
  autoStart?: boolean;
  picture?: string;
  // UI-edited fields that the server only persists into the config (they're
  // not echoed back on the live ServerAgent payload). Keeping them typed here
  // lets SettingsTab/InstructionsTab read the persisted value back instead of
  // falling through to undefined every time the component remounts.
  systemPrompt?: string;
  instructions?: string;
  visibility?: 'workspace' | 'private';
  maxConcurrentTasks?: number;
  workDir?: string;
  skills?: AgentSkill[];
}

export interface ServerMachine {
  id: string;
  hostname: string;
  alias?: string;
  os: string;
  status?: 'online' | 'offline';
  runtimes?: string[];
  agentIds?: string[];
}

export interface AgentProfilePreset {
  id: string;
  image: string;
}

export interface InitPayload {
  channels: ServerChannel[];
  agents: ServerAgent[];
  humans: ServerHuman[];
  configs: AgentConfig[];
  machines: ServerMachine[];
  profilePresets?: AgentProfilePreset[];
}

export interface WorkspaceFile {
  name: string;
  path?: string;
  isDirectory: boolean;
  size?: number;
  modifiedAt?: string;
}

export interface WorkspaceState {
  files: WorkspaceFile[];
  dirPath: string;
  fileContent?: { path: string; content: string; requestId: string } | null;
}

export interface MemoryEntry {
  uri: string;
  size?: number;
  isDir: boolean;
  modTime?: string;
  abstract?: string;
}

export type ViewMode = 'channel' | 'dm' | 'agents';
export type RightPanel = 'thread' | 'details' | 'members' | 'agents' | 'workspace' | 'memory' | 'agent_settings' | 'agent_profile' | null;
export type Theme = 'night-city' | 'brutalist' | 'washington-post' | 'carbon' | 'graphite';

export interface Toast {
  id: string;
  message: string;
  type: 'success' | 'warning' | 'error' | 'info';
}
