import type { AgentActivity, ServerAgent, ServerHuman } from '../types';

export type AvatarStatus = 'offline' | 'online' | 'working';

export function humanStatus(h: Pick<ServerHuman, 'online'>): AvatarStatus {
  return h.online === false ? 'offline' : 'online';
}

export function agentStatus(a: Pick<ServerAgent, 'status' | 'activity'>): AvatarStatus {
  if (!a.status || a.status === 'inactive') return 'offline';
  const activity: AgentActivity | undefined = a.activity;
  if (activity === 'thinking' || activity === 'working' || activity === 'error') return 'working';
  return 'online';
}

export const STATUS_CLASS: Record<AvatarStatus, string> = {
  offline: 'bg-nc-muted',
  online: 'bg-nc-green',
  working: 'bg-nc-yellow animate-pulse',
};
