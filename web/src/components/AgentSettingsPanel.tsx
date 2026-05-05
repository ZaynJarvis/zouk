import { useMemo } from 'react';
import { Settings as SettingsIcon } from 'lucide-react';
import { useApp } from '../store/AppContext';
import type { ServerAgent } from '../types';
import PanelShell from './panel/PanelShell';
import PanelHeader from './panel/PanelHeader';
import AgentConfigForm from './agent/AgentConfigForm';

const settingsPanelWidthClassName = 'w-screen lg:w-[30vw] lg:min-w-[340px] lg:max-w-[520px]';

export default function AgentSettingsPanel() {
  const {
    agents, configs, machines,
    closeRightPanel, agentSettingsId,
    stopAgent, deleteAgent, setAgentSettingsId,
  } = useApp();

  const liveAgent = agents.find((a) => a.id === agentSettingsId);
  const config = configs.find((c) => c.id === agentSettingsId);

  // Reconstruct an "agent-shaped" object from saved config when daemon isn't running
  const agent: ServerAgent | null = useMemo(() => {
    if (liveAgent) return liveAgent;
    if (!config?.id) return null;
    return {
      id: config.id,
      name: config.name,
      displayName: config.displayName,
      description: config.description,
      runtime: config.runtime ?? 'claude',
      model: config.model,
      picture: config.picture,
      visibility: config.visibility,
      maxConcurrentTasks: config.maxConcurrentTasks,
      autoStart: config.autoStart,
      instructions: config.instructions,
      skills: config.skills,
      workDir: config.workDir,
      lifecycle: config.lifecycle,
      envVars: config.envVars,
      status: 'inactive',
      activity: 'offline',
    };
  }, [liveAgent, config]);

  if (!agent) {
    return (
      <PanelShell widthClassName={settingsPanelWidthClassName} centered>
        <p className="text-sm text-nc-muted font-mono mb-3">AGENT_NOT_FOUND</p>
        <button
          type="button"
          onClick={closeRightPanel}
          className="px-3 py-1.5 border border-nc-border text-xs text-nc-muted hover:text-nc-text-bright font-mono"
        >
          CLOSE
        </button>
      </PanelShell>
    );
  }

  const handleDelete = async () => {
    const label = agent.displayName || agent.name;
    if (!window.confirm(`Delete agent ${label}? This removes the saved config and disconnects the running agent.`)) return;
    await deleteAgent(agent.id);
    setAgentSettingsId(null);
    closeRightPanel();
  };

  return (
    <PanelShell widthClassName={settingsPanelWidthClassName} animated>
      <PanelHeader
        onClose={closeRightPanel}
        className="shrink-0"
        leftClassName="flex items-center gap-2"
        closeTitle="Close"
      >
        <>
          <SettingsIcon size={14} className="text-nc-cyan shrink-0" />
          <h3 className="font-display font-extrabold text-base text-nc-text-bright tracking-wider truncate">
            CONFIG · @{agent.displayName || agent.name}
          </h3>
        </>
      </PanelHeader>

      <AgentConfigForm
        agent={agent}
        machines={machines}
        onStop={() => stopAgent(agent.id)}
        onDelete={handleDelete}
        compact
      />
    </PanelShell>
  );
}
