import type { AgentActivity, ServerAgent, ServerHuman } from '../types';

export type AvatarStatus = 'offline' | 'online' | 'working';

export function humanStatus(h: Pick<ServerHuman, 'online'>): AvatarStatus {
  return h.online === false ? 'offline' : 'online';
}

export function agentStatus(a: Pick<ServerAgent, 'status' | 'activity'>): AvatarStatus {
  if (!a.status || a.status === 'inactive') return 'offline';
  const activity: AgentActivity | undefined = a.activity;
  if (activity === 'offline') return 'offline';
  if (activity === 'thinking' || activity === 'working' || activity === 'error') return 'working';
  return 'online';
}

export const STATUS_CLASS: Record<AvatarStatus, string> = {
  offline: 'bg-nc-muted',
  online: 'bg-nc-green',
  working: 'bg-nc-yellow animate-pulse',
};

// Offline swaps the whole palette to nc-muted (not just a grayscale filter) —
// `grayscale` on washington-post's low-saturation cyan/green tokens leaves
// icon-only avatars nearly identical to active ones.
export function avatarPaletteClass(
  status: AvatarStatus,
  family: 'cyan' | 'green' = 'cyan',
): string {
  if (status === 'offline') {
    return 'border-nc-muted/30 bg-nc-muted/10 text-nc-muted grayscale opacity-50';
  }
  return family === 'green'
    ? 'border-nc-green/30 bg-nc-green/10 text-nc-green'
    : 'border-nc-cyan/30 bg-nc-cyan/10 text-nc-cyan';
}
