import type { MessageRecord, AgentConfig, MachineApiKey, AgentProfilePreset } from '../types';

function getBaseUrl(): string {
  return import.meta.env.VITE_SLOCK_SERVER_URL || '';
}

function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem('zouk_auth_token');
  if (token) return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  return { 'Content-Type': 'application/json' };
}

// Server returns camelCase, frontend uses snake_case — normalize here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function normalizeMessage(m: any): MessageRecord {
  const rawChannelType = m.channel_type || m.channelType || 'channel';
  const rawChannelName = m.channel_name || m.channelName || '';
  const rawThreadId = m.thread_id || m.threadId || null;
  const inferredThread = rawChannelType === 'thread' || !!rawThreadId;
  const parentChannelType = m.parent_channel_type || m.parentChannelType || (inferredThread ? (m.parentChannelType || m.parent_channel_type || 'channel') : undefined);
  const parentChannelNameRaw = m.parent_channel_name || m.parentChannelName || (inferredThread ? rawChannelName : undefined);
  const dmParties: string[] | undefined = m.dmParties || m.dm_parties;

  return {
    id: m.id,
    channel_type: inferredThread ? 'thread' : rawChannelType,
    channel_name: inferredThread
      ? (rawThreadId || rawChannelName)
      : rawChannelName,
    parent_channel_name: inferredThread ? parentChannelNameRaw : undefined,
    parent_channel_type: inferredThread ? parentChannelType : undefined,
    message_id: m.message_id || m.messageId || m.id,
    timestamp: m.timestamp || m.createdAt,
    sender_type: m.sender_type || m.senderType,
    sender_name: m.sender_name || m.senderName,
    content: m.content,
    attachments: m.attachments,
    task_status: m.task_status || m.taskStatus,
    task_number: m.task_number || m.taskNumber,
    task_assignee_id: m.task_assignee_id || m.taskAssigneeId,
    task_assignee_type: m.task_assignee_type || m.taskAssigneeType,
    dm_parties: dmParties,
  };
}

export interface FetchMessagesResult {
  messages: MessageRecord[];
  hasMore: boolean;
}

export async function fetchMessages(
  channelName: string,
  isDm = false,
  limit = 50,
  senderName?: string,
  beforeId?: string,
): Promise<FetchMessagesResult> {
  const target = isDm ? `dm:@${channelName}` : `#${channelName}`;
  // Pass channel/limit/sender/before as request headers — the Cloudflare proxy
  // rewrites both query strings and path segments during its 307 redirect
  // chain but leaves headers untouched.
  const headers: Record<string, string> = {
    'X-Channel': target,
    'X-Limit': String(limit),
  };
  if (senderName) headers['X-Sender'] = senderName;
  if (beforeId) headers['X-Before'] = beforeId;
  const res = await fetch(`${getBaseUrl()}/api/messages`, { cache: 'no-store', headers });
  if (!res.ok) throw new Error(`Failed to fetch messages: ${res.status}`);
  const data = await res.json();
  return {
    messages: (data.messages || []).map(normalizeMessage),
    hasMore: !!data.hasMore,
  };
}

export async function fetchThreadMessages(
  channelName: string,
  messageId: string,
  isDm = false,
  limit = 200,
  senderName?: string,
): Promise<MessageRecord[]> {
  const shortId = messageId.slice(0, 8);
  const parentTarget = isDm ? `dm:@${channelName}` : `#${channelName}`;
  const threadTarget = `${parentTarget}:${shortId}`;
  const headers: Record<string, string> = { 'X-Channel': threadTarget, 'X-Limit': String(limit) };
  // Without X-Sender the server can't canonicalize dm:<peer> to dm:<a>,<b>
  // and falls into a name-overlap match that can leak cross-DM rows.
  if (isDm && senderName) headers['X-Sender'] = senderName;
  const res = await fetch(`${getBaseUrl()}/api/messages`, { cache: 'no-store', headers });
  if (!res.ok) throw new Error(`Failed to fetch thread messages: ${res.status}`);
  const data = await res.json();
  return (data.messages || []).map(normalizeMessage);
}

export async function sendMessage(content: string, target: string, senderName: string): Promise<void> {
  const url = `${getBaseUrl()}/api/messages`;
  const res = await fetch(url, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({ content, target, senderName }),
  });
  if (!res.ok) throw new Error(`Failed to send message: ${res.status}`);
}

export async function createChannel(name: string): Promise<{ channel: { id: string; name: string } }> {
  const url = `${getBaseUrl()}/api/channels`;
  const res = await fetch(url, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error(`Failed to create channel: ${res.status}`);
  return res.json();
}

export async function deleteChannel(channelId: string): Promise<{ success: true; channel: { id: string; name: string } }> {
  const url = `${getBaseUrl()}/api/channels/${encodeURIComponent(channelId)}`;
  const res = await fetch(url, {
    method: 'DELETE',
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error(`Failed to delete channel: ${res.status}`);
  return res.json();
}

export async function startAgent(config: {
  id?: string;
  name: string;
  displayName?: string;
  description?: string;
  runtime: string;
  model?: string;
  machineId?: string;
  workDir?: string;
  channels?: string[];
}): Promise<{ agent: { id: string; name: string } }> {
  const url = `${getBaseUrl()}/api/agents/start`;
  const res = await fetch(url, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(config),
  });
  if (!res.ok) throw new Error(`Failed to start agent: ${res.status}`);
  return res.json();
}

export async function stopAgent(agentId: string): Promise<void> {
  const url = `${getBaseUrl()}/api/agents/${agentId}/stop`;
  const res = await fetch(url, { method: 'POST', headers: getAuthHeaders() });
  if (!res.ok) throw new Error(`Failed to stop agent: ${res.status}`);
}

export async function deleteAgent(agentId: string): Promise<void> {
  const url = `${getBaseUrl()}/api/agents/${agentId}`;
  const res = await fetch(url, { method: 'DELETE', headers: getAuthHeaders() });
  if (!res.ok) throw new Error(`Failed to delete agent: ${res.status}`);
}

export interface RuntimeModel {
  id: string;
  label: string;
}

// Ask the daemon behind the given machine to enumerate installed models for a
// runtime. Old daemons / runtimes without detectModels() will surface as
// {models: [], error} — caller should fall back to free-form input.
export async function fetchRuntimeModels(
  machineId: string,
  runtime: string
): Promise<{ models: RuntimeModel[]; default: string | null; error: string | null }> {
  const url = `${getBaseUrl()}/api/machines/${encodeURIComponent(machineId)}/runtimes/${encodeURIComponent(runtime)}/models`;
  const res = await fetch(url);
  if (!res.ok) {
    return { models: [], default: null, error: `http_${res.status}` };
  }
  const data = await res.json();
  return {
    models: Array.isArray(data.models) ? data.models : [],
    default: data.default ?? null,
    error: data.error ?? null,
  };
}

export async function updateAgentConfig(agentId: string, updates: Record<string, unknown>): Promise<void> {
  const url = `${getBaseUrl()}/api/agents/${agentId}/config`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: getAuthHeaders(),
    body: JSON.stringify(updates),
  });
  if (!res.ok) throw new Error(`Failed to update agent config: ${res.status}`);
}

export async function saveAgentConfig(config: AgentConfig): Promise<void> {
  const url = `${getBaseUrl()}/api/agent-configs`;
  const res = await fetch(url, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(config),
  });
  if (!res.ok) throw new Error(`Failed to save agent config: ${res.status}`);
}

export function getAttachmentUrl(attachmentId: string): string {
  return `${getBaseUrl()}/api/attachments/${attachmentId}`;
}

// Auth
export async function getAuthConfig(): Promise<{ googleClientId: string | null; allowlistActive?: boolean }> {
  const res = await fetch(`${getBaseUrl()}/api/auth/config`);
  if (!res.ok) throw new Error('Failed to fetch auth config');
  return res.json();
}

export async function googleLogin(credential: string): Promise<{ token: string; user: AuthUser }> {
  const res = await fetch(`${getBaseUrl()}/api/auth/google`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ credential }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error || 'Google login failed');
  }
  return res.json();
}

export async function logout(token: string): Promise<void> {
  await fetch(`${getBaseUrl()}/api/auth/logout`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function registerGuestSession(name: string): Promise<{ token?: string; user?: AuthUser }> {
  const res = await fetch(`${getBaseUrl()}/api/auth/guest-session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) return {};
  return res.json();
}

export interface AllowlistEntry {
  email: string;
  source: 'env' | 'db';
  addedAt?: string;
  addedBy?: string | null;
}

export interface AllowlistResponse {
  env: AllowlistEntry[];
  db: AllowlistEntry[];
  allowlistActive: boolean;
  dbWritable: boolean;
}

export async function getAllowlist(): Promise<AllowlistResponse> {
  const res = await fetch(`${getBaseUrl()}/api/settings/allowlist`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error(`Failed to load allowlist: ${res.status}`);
  return res.json();
}

export async function addAllowlistEntry(email: string): Promise<AllowlistEntry> {
  const res = await fetch(`${getBaseUrl()}/api/settings/allowlist`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({ email }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error || 'Failed to add allowlist entry');
  }
  const data = await res.json();
  return data.entry;
}

export async function removeAllowlistEntry(email: string): Promise<void> {
  const res = await fetch(`${getBaseUrl()}/api/settings/allowlist/${encodeURIComponent(email)}`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error || 'Failed to remove allowlist entry');
  }
}

export async function updateUserProfile(name: string, picture?: string): Promise<{ user: AuthUser }> {
  const body: Record<string, string> = { name };
  if (picture !== undefined) body.picture = picture;
  const res = await fetch(`${getBaseUrl()}/api/auth/profile`, {
    method: 'PUT',
    headers: getAuthHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error('Failed to update profile');
  return res.json();
}

export interface AuthUser {
  name: string;
  email: string;
  picture: string | null;
  gravatarUrl?: string | null;
}

// Machine API Key management
export async function generateMachineKey(name: string): Promise<{ key: MachineApiKey; rawKey: string }> {
  const url = `${getBaseUrl()}/api/machine-keys`;
  const res = await fetch(url, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error(`Failed to generate machine key: ${res.status}`);
  return res.json();
}

export async function listMachineKeys(): Promise<MachineApiKey[]> {
  const url = `${getBaseUrl()}/api/machine-keys`;
  const res = await fetch(url, { headers: getAuthHeaders() });
  if (!res.ok) throw new Error(`Failed to list machine keys: ${res.status}`);
  const data = await res.json();
  return data.keys || [];
}

export async function revokeMachineKey(keyId: string): Promise<void> {
  const url = `${getBaseUrl()}/api/machine-keys/${keyId}`;
  const res = await fetch(url, { method: 'DELETE', headers: getAuthHeaders() });
  if (!res.ok) throw new Error(`Failed to revoke machine key: ${res.status}`);
}

// ─── Agent profile presets ───────────────────────────────────────

export async function listProfilePresets(): Promise<{ presets: AgentProfilePreset[]; max: number }> {
  const res = await fetch(`${getBaseUrl()}/api/agent-profile-presets`);
  if (!res.ok) throw new Error(`Failed to list profile presets: ${res.status}`);
  return res.json();
}

export async function createProfilePreset(image: string): Promise<{ preset: AgentProfilePreset; count: number; max: number }> {
  const res = await fetch(`${getBaseUrl()}/api/agent-profile-presets`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({ image }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Failed to create preset: ${res.status}`);
  }
  return res.json();
}

export async function deleteProfilePreset(id: string): Promise<void> {
  const res = await fetch(`${getBaseUrl()}/api/agent-profile-presets/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error(`Failed to delete preset: ${res.status}`);
}
