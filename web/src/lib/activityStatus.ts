import type { AgentActivity } from '../types';

export const activityColors: Record<AgentActivity, string> = {
  thinking: 'bg-nc-yellow animate-pulse',
  working: 'bg-nc-red animate-pulse',
  online: 'bg-nc-green',
  offline: 'bg-nc-muted/30',
  error: 'bg-nc-red',
};

export const activityLabels: Record<AgentActivity, string> = {
  thinking: 'THINKING',
  working: 'WORKING',
  online: 'ONLINE',
  offline: 'OFFLINE',
  error: 'ERROR',
};

function isAgentActivity(activity?: string): activity is AgentActivity {
  return !!activity && activity in activityColors;
}

export function getActivityColor(activity?: string): string {
  return isAgentActivity(activity) ? activityColors[activity] : activityColors.offline;
}

export function getActivityLabel(activity?: string): string {
  return isAgentActivity(activity) ? activityLabels[activity] : activityLabels.offline;
}
