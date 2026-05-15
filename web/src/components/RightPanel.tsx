import { useEffect } from 'react';
import { useApp } from '../store/AppContext';
import ThreadPanel from './ThreadPanel';
import WorkspacePanel from './WorkspacePanel';
import AgentProfilePanel from './AgentProfilePanel';
import ChannelSettingsPanel from './ChannelSettingsPanel';

export default function RightPanel() {
  const { rightPanel, agentProfileId, channelSettingsId, closeRightPanel } = useApp();

  useEffect(() => {
    if (!rightPanel) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      closeRightPanel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [rightPanel, closeRightPanel]);

  if (!rightPanel) return null;

  switch (rightPanel) {
    case 'thread':
      return <ThreadPanel />;
    case 'workspace':
      return <WorkspacePanel />;
    case 'agent_profile':
      return <AgentProfilePanel key={agentProfileId ?? 'none'} />;
    case 'channel_settings':
      return <ChannelSettingsPanel key={channelSettingsId ?? 'none'} />;
    default:
      return null;
  }
}
