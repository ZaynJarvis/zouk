import { useEffect } from 'react';
import { useApp } from '../store/AppContext';
import ThreadPanel from './ThreadPanel';
import DetailsPanel from './DetailsPanel';
import MembersPanel from './MembersPanel';
import WorkspacePanel from './WorkspacePanel';
import AgentSettingsPanel from './AgentSettingsPanel';
import AgentProfilePanel from './AgentProfilePanel';

export default function RightPanel() {
  const { rightPanel, agentSettingsId, agentProfileId, closeRightPanel } = useApp();

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
    case 'details':
      return <DetailsPanel />;
    case 'members':
      return <MembersPanel />;
    case 'workspace':
      return <WorkspacePanel />;
    case 'agent_settings':
      return <AgentSettingsPanel key={agentSettingsId ?? 'none'} />;
    case 'agent_profile':
      return <AgentProfilePanel key={agentProfileId ?? 'none'} />;
    default:
      return null;
  }
}
