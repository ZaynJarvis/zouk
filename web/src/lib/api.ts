import type { MessageRecord, AgentConfig, MachineApiKey } from '../types';

function getBaseUrl(): string {
  return import.meta.env.VITE_SLOCK_SERVER_URL || '';
}

// Server returns camelCase, frontend uses snake_case — normalize here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function normalizeMessage(m: any): MessageRecord {
  return {
    id: m.id,
    channel_type: m.channel_type || m.channelType || 'channel',
    channel_name: m.channel_name || m.channelName || '',
    parent_channel_name: m.parent_channel_name || m.parentChannelName,
    parent_channel_type: m.parent_channel_type || m.parentChannelType,
    message_id: m.message_id || m.id,
    timestamp: m.timestamp || m.createdAt,
    sender_type: m.sender_type || m.senderType,
    sender_name: m.sender_name || m.senderName,
    content: m.content,
    attachments: m.attachments,
    task_status: m.task_status || m.taskStatus,
    task_number: m.task_number || m.taskNumber,
    task_assignee_id: m.task_assignee_id || m.taskAssigneeId,
    task_assignee_type: m.task_assignee_type || m.taskAssigneeType,
  };
}

export async function fetchMessages(channelName: string, isDm = false, limit = 200): Promise<MessageRecord[]> {
  const target = isDm ? `dm:@${channelName}` : `#${channelName}`;
  const url = `${getBaseUrl()}/api/messages?channel=${encodeURIComponent(target)}&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch messages: ${res.status}`);
  const data = await res.json();
  return (data.messages || []).map(normalizeMessage);
}

export async function fetchThreadMessages(channelName: string, messageId: string, isDm = false, limit = 200): Promise<MessageRecord[]> {
  const shortId = messageId.slice(0, 8);
  const parentTarget = isDm ? `dm:@${channelName}` : `#${channelName}`;
  const threadTarget = `${parentTarget}:${shortId}`;
  const url = `${getBaseUrl()}/api/messages?channel=${encodeURIComponent(threadTarget)}&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch thread messages: ${res.status}`);
  const data = await res.json();
  return (data.messages || []).map(normalizeMessage);
}

export async function sendMessage(content: string, target: string, senderName: string): Promise<void> {
  const url = `${getBaseUrl()}/api/messages`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, target, senderName }),
  });
  if (!res.ok) throw new Error(`Failed to send message: ${res.status}`);
}

export async function createChannel(name: string): Promise<{ channel: { id: string; name: string } }> {
  const url = `${getBaseUrl()}/api/channels`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error(`Failed to create channel: ${res.status}`);
  return res.json();
}

export async function startAgent(config: {
  name: string;
  displayName?: string;
  description?: string;
  runtime: string;
  model?: string;
  channels?: string[];
}): Promise<{ agent: { id: string; name: string } }> {
  const url = `${getBaseUrl()}/api/agents/start`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });
  if (!res.ok) throw new Error(`Failed to start agent: ${res.status}`);
  return res.json();
}

export async function stopAgent(agentId: string): Promise<void> {
  const url = `${getBaseUrl()}/api/agents/${agentId}/stop`;
  const res = await fetch(url, { method: 'POST' });
  if (!res.ok) throw new Error(`Failed to stop agent: ${res.status}`);
}

export async function deleteAgent(agentId: string): Promise<void> {
  const url = `${getBaseUrl()}/api/agents/${agentId}`;
  const res = await fetch(url, { method: 'DELETE' });
  if (!res.ok) throw new Error(`Failed to delete agent: ${res.status}`);
}

export async function updateAgentConfig(agentId: string, updates: Record<string, unknown>): Promise<void> {
  const url = `${getBaseUrl()}/api/agents/${agentId}/config`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
  if (!res.ok) throw new Error(`Failed to update agent config: ${res.status}`);
}

export async function saveAgentConfig(config: AgentConfig): Promise<void> {
  const url = `${getBaseUrl()}/api/agent-configs`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });
  if (!res.ok) throw new Error(`Failed to save agent config: ${res.status}`);
}

export function getAttachmentUrl(attachmentId: string): string {
  return `${getBaseUrl()}/api/attachments/${attachmentId}`;
}

// Auth
export async function getAuthConfig(): Promise<{ googleClientId: string | null }> {
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
  if (!res.ok) throw new Error('Google login failed');
  return res.json();
}

export async function logout(token: string): Promise<void> {
  await fetch(`${getBaseUrl()}/api/auth/logout`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
}

export interface AuthUser {
  name: string;
  email: string;
  picture: string | null;
}

// Machine API Key management
export async function generateMachineKey(name: string): Promise<{ key: MachineApiKey; rawKey: string }> {
  const url = `${getBaseUrl()}/api/machine-keys`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error(`Failed to generate machine key: ${res.status}`);
  return res.json();
}

export async function listMachineKeys(): Promise<MachineApiKey[]> {
  const url = `${getBaseUrl()}/api/machine-keys`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to list machine keys: ${res.status}`);
  const data = await res.json();
  return data.keys || [];
}

export async function revokeMachineKey(keyId: string): Promise<void> {
  const url = `${getBaseUrl()}/api/machine-keys/${keyId}`;
  const res = await fetch(url, { method: 'DELETE' });
  if (!res.ok) throw new Error(`Failed to revoke machine key: ${res.status}`);
}
