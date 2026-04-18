import { useApp } from '../store/AppContext';
import ThreadPanel from './ThreadPanel';
import DetailsPanel from './DetailsPanel';
import MembersPanel from './MembersPanel';
import WorkspacePanel from './WorkspacePanel';
import AgentSettingsPanel from './AgentSettingsPanel';
import AgentProfilePanel from './AgentProfilePanel';

export default function RightPanel() {
  const { rightPanel, agentSettingsId, agentProfileId } = useApp();

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
