import type { AgentActivity, ServerAgent, ServerHuman, Theme } from '../types';

export type AvatarStatus = 'offline' | 'online' | 'working';

export function humanStatus(h: Pick<ServerHuman, 'online'>): AvatarStatus {
  return h.online === false ? 'offline' : 'online';
}

export function agentStatus(a: Pick<ServerAgent, 'status' | 'activity'>): AvatarStatus {
  if (!a.status || a.status === 'inactive') return 'offline';
  const activity: AgentActivity | undefined = a.activity;
  if (activity === 'thinking' || activity === 'working' || activity === 'error') return 'working';
  if (activity === 'online') return 'online';
  // Undefined or 'offline' → offline. Mirrors the `agent.activity || 'offline'`
  // label fallback used in AgentProfilePanel/AgentDetail so the dot does not
  // contradict the OFFLINE text sitting next to it.
  return 'offline';
}

// Avatar palette is gray only when the agent is truly inactive (machine gone,
// can't be respawned). When the machine is still present (status === 'active')
// but the process is offline, the avatar stays "live" — only the status dot
// goes gray, signaling "wakeable".
export function agentAvatarStatus(a: Pick<ServerAgent, 'status' | 'activity'>): AvatarStatus {
  if (!a.status || a.status === 'inactive') return 'offline';
  return agentStatus(a) === 'working' ? 'working' : 'online';
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

// Soften avatar corners only on the editorial themes (washington-post, carbon).
// The cyber/brutalist/graphite themes keep their existing aesthetic.
export function avatarRadiusClass(theme: Theme): string {
  return theme === 'washington-post' || theme === 'carbon' ? 'rounded-md' : '';
}
