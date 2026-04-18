import { useApp } from '../store/AppContext';
import ThreadPanel from './ThreadPanel';
import DetailsPanel from './DetailsPanel';
import MembersPanel from './MembersPanel';
import WorkspacePanel from './WorkspacePanel';
import AgentSettingsPanel from './AgentSettingsPanel';

export default function RightPanel() {
  const { rightPanel } = useApp();

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
      return <AgentSettingsPanel />;
    default:
      return null;
  }
}
