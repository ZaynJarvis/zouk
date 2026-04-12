import { Bot, Plus, Server, Monitor, ChevronDown, ChevronRight, Play, Loader as Loader2, Settings } from 'lucide-react';
import { useState, useMemo } from 'react';
import { useApp } from '../store/AppContext';
import type { ServerAgent, ServerMachine } from '../types';
import AgentDetail from './AgentDetail';
import CreateAgentDialog from './CreateAgentDialog';
import MachineSetupDialog from './MachineSetupDialog';

const activityColors: Record<string, string> = {
  thinking: 'bg-cyber-yellow animate-pulse shadow-neon-yellow',
  working: 'bg-cyber-orange animate-pulse',
  online: 'bg-cyber-green shadow-neon-green',
  offline: 'bg-cyber-chrome-600',
  error: 'bg-cyber-red shadow-neon-red',
};

const PROVIDER_LABELS: Record<string, string> = {
  hermes: 'Hermes',
  claude: 'Claude',
  codex: 'Codex',
  opencode: 'OpenCode',
  openclaw: 'OpenClaw',
  kimi: 'Kimi',
};

function AgentListItem({
  agent,
  isSelected,
  onClick,
}: {
  agent: ServerAgent;
  isSelected: boolean;
  onClick: () => void;
}) {
  const activity = agent.activity || 'offline';

  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors border-b border-cyber-border ${
        isSelected
          ? 'bg-cyber-cyan/5 border-l-2 border-l-cyber-cyan'
          : 'hover:bg-cyber-elevated border-l-2 border-l-transparent'
      }`}
    >
      <div className="w-8 h-8 border border-cyber-cyan/30 bg-cyber-cyan/10 font-display font-bold text-xs flex items-center justify-center text-cyber-cyan shrink-0">
        {(agent.displayName || agent.name).charAt(0).toUpperCase()}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="truncate font-display font-bold text-sm text-cyber-chrome-100">
            {agent.displayName || agent.name}
          </span>
          <span className={`w-2 h-2 rounded-full shrink-0 ${activityColors[activity]}`} />
        </div>
        <div className="text-2xs text-cyber-chrome-400 truncate font-mono">
          {PROVIDER_LABELS[agent.runtime || ''] || agent.runtime || 'No runtime'} / {agent.model || '\u2014'}
        </div>
      </div>
      {agent.archivedAt && (
        <span className="text-2xs font-mono font-bold text-cyber-chrome-500 bg-cyber-elevated px-1.5 py-0.5 border border-cyber-border uppercase tracking-wider">
          archived
        </span>
      )}
    </button>
  );
}

function CompactMachineCard({ machine }: { machine: ServerMachine }) {
  return (
    <div className="flex items-center gap-2 px-4 py-2 border-b border-cyber-border">
      <Server size={12} className="text-cyber-chrome-500 shrink-0" />
      <span className="text-2xs font-bold text-cyber-chrome-200 truncate font-mono">{machine.alias || machine.hostname}</span>
      {machine.alias && <span className="text-2xs text-cyber-chrome-500 truncate font-mono">{machine.hostname}</span>}
      <span className="w-1.5 h-1.5 rounded-full bg-cyber-green shadow-neon-green shrink-0" />
      {machine.runtimes && (
        <span className="text-2xs text-cyber-chrome-500 truncate ml-auto font-mono">
          {machine.runtimes.join(', ')}
        </span>
      )}
    </div>
  );
}

function ConfigStartButton({
  config,
  isRunning,
  isStarting,
  onStart,
}: {
  config: { name: string; displayName?: string };
  isRunning: boolean;
  isStarting: boolean;
  onStart: () => void;
}) {
  return (
    <button
      onClick={() => !isRunning && !isStarting && onStart()}
      disabled={isRunning || isStarting}
      className={`flex items-center gap-1 px-2.5 py-1 border text-2xs font-mono font-bold tracking-wider transition-all ${
        isRunning
          ? 'border-cyber-border bg-cyber-elevated text-cyber-chrome-500 cursor-not-allowed'
          : 'border-cyber-green/40 bg-cyber-green/10 text-cyber-green hover:shadow-neon-green'
      }`}
    >
      {isStarting ? <Loader2 size={10} className="animate-spin" /> : <Play size={10} />}
      {config.displayName || config.name}
    </button>
  );
}

export default function AgentsView() {
  const { agents, configs, machines, startAgent, stopAgent, updateAgentConfig } = useApp();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [showMachineSetup, setShowMachineSetup] = useState(false);
  const [starting, setStarting] = useState<string | null>(null);
  const [machinesExpanded, setMachinesExpanded] = useState(true);
  const [configsExpanded, setConfigsExpanded] = useState(true);

  const filteredAgents = useMemo(() =>
    showArchived
      ? agents.filter((a) => a.archivedAt)
      : agents.filter((a) => !a.archivedAt),
    [agents, showArchived]
  );

  const archivedCount = useMemo(() => agents.filter((a) => a.archivedAt).length, [agents]);
  const selected = agents.find((a) => a.id === selectedId) ?? (filteredAgents.length > 0 ? filteredAgents[0] : null);

  const handleStartAgent = async (configName: string) => {
    const config = configs.find(c => c.name === configName);
    if (!config) return;
    setStarting(configName);
    await startAgent({
      name: config.name,
      displayName: config.displayName,
      description: config.description,
      runtime: config.runtime,
      model: config.model,
    });
    setStarting(null);
  };

  const handleCreateAgent = async (config: {
    name: string;
    description: string;
    runtime: string;
    model: string;
    workDir: string;
  }) => {
    await startAgent({
      name: config.name,
      description: config.description,
      runtime: config.runtime,
      model: config.model,
    });
    setShowCreate(false);
  };

  const handleUpdateAgent = async (updates: Partial<ServerAgent>) => {
    if (!selected) return;
    await updateAgentConfig(selected.id, updates);
  };

  return (
    <div className="flex-1 flex min-h-0 overflow-hidden">
      <div className="w-72 shrink-0 border-r border-cyber-border flex flex-col bg-cyber-surface">
        <div className="flex h-12 items-center justify-between border-b border-cyber-border px-4">
          <h1 className="font-display font-bold text-sm text-cyber-chrome-50 tracking-wider">AGENTS</h1>
          <div className="flex items-center gap-1.5">
            {archivedCount > 0 && (
              <button
                onClick={() => setShowArchived(!showArchived)}
                className={`px-2 py-0.5 border text-2xs font-mono font-bold tracking-wider transition-all ${
                  showArchived
                    ? 'border-cyber-cyan/30 bg-cyber-cyan/10 text-cyber-cyan'
                    : 'border-cyber-border text-cyber-chrome-500 hover:border-cyber-cyan/30'
                }`}
              >
                {showArchived ? 'ACTIVE' : `ARCHIVED (${archivedCount})`}
              </button>
            )}
            <button
              onClick={() => setShowCreate(true)}
              className="w-7 h-7 flex items-center justify-center border border-cyber-cyan/40 bg-cyber-cyan/10 text-cyber-cyan hover:shadow-neon-cyan transition-all"
              title="Create agent"
            >
              <Plus size={14} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          <div>
            <div className="flex items-center justify-between px-4 py-2">
              <button
                onClick={() => setMachinesExpanded(!machinesExpanded)}
                className="flex items-center gap-1.5 text-left hover:opacity-80 transition-opacity"
              >
                {machinesExpanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                <Monitor size={10} className="text-cyber-chrome-500" />
                <span className="text-2xs font-display font-bold uppercase tracking-widest text-cyber-chrome-400">
                  MACHINES ({machines.length})
                </span>
              </button>
              <button
                onClick={() => setShowMachineSetup(true)}
                className="w-6 h-6 flex items-center justify-center border border-cyber-border hover:border-cyber-cyan/30 hover:bg-cyber-elevated transition-all"
                title="Machine Setup"
              >
                <Settings size={10} className="text-cyber-chrome-500" />
              </button>
            </div>
            {machinesExpanded && (
              machines.length > 0 ? (
                machines.map(m => <CompactMachineCard key={m.id} machine={m} />)
              ) : (
                <div className="px-4 pb-2">
                  <button
                    onClick={() => setShowMachineSetup(true)}
                    className="w-full border border-dashed border-cyber-border px-3 py-2 text-2xs text-cyber-chrome-500 text-center hover:border-cyber-cyan/30 hover:text-cyber-cyan transition-colors font-mono"
                  >
                    + Connect a machine
                  </button>
                </div>
              )
            )}
          </div>

          {configs.length > 0 && (
            <div>
              <button
                onClick={() => setConfigsExpanded(!configsExpanded)}
                className="w-full flex items-center gap-1.5 px-4 py-2 text-left hover:bg-cyber-elevated transition-colors"
              >
                {configsExpanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                <span className="text-2xs font-display font-bold uppercase tracking-widest text-cyber-chrome-400">
                  CONFIGS ({configs.length})
                </span>
              </button>
              {configsExpanded && (
                <div className="flex flex-wrap gap-1.5 px-4 pb-2">
                  {configs.map(c => (
                    <ConfigStartButton
                      key={c.name}
                      config={c}
                      isRunning={agents.some(a => a.name === c.name && a.status === 'active')}
                      isStarting={starting === c.name}
                      onStart={() => handleStartAgent(c.name)}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {(machines.length > 0 || configs.length > 0) && (
            <div className="border-b border-cyber-border" />
          )}

          {filteredAgents.length > 0 ? (
            filteredAgents.map((agent) => (
              <AgentListItem
                key={agent.id}
                agent={agent}
                isSelected={agent.id === (selected?.id ?? '')}
                onClick={() => setSelectedId(agent.id)}
              />
            ))
          ) : (
            <div className="flex flex-col items-center justify-center px-4 py-12 text-center">
              <div className="w-12 h-12 border border-cyber-green/30 bg-cyber-green/10 flex items-center justify-center mb-3 shadow-neon-green">
                <Bot size={20} className="text-cyber-green" />
              </div>
              <p className="text-sm text-cyber-chrome-400 font-mono">
                {showArchived ? 'No archived agents' : 'No agents yet'}
              </p>
              {!showArchived && (
                <button
                  onClick={() => setShowCreate(true)}
                  className="mt-3 flex items-center gap-1 px-3 py-1.5 cyber-btn-primary text-sm font-display font-bold tracking-wider"
                >
                  <Plus size={12} /> CREATE
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 min-w-0 overflow-hidden">
        {selected ? (
          <AgentDetail
            agent={selected}
            onUpdate={handleUpdateAgent}
            onStop={() => stopAgent(selected.id)}
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center bg-cyber-surface">
            <div className="w-16 h-16 border border-cyber-cyan/30 bg-cyber-cyan/10 flex items-center justify-center shadow-neon-cyan mb-4">
              <Bot size={28} className="text-cyber-cyan" />
            </div>
            <h3 className="font-display font-bold text-xl text-cyber-chrome-50 mb-2 tracking-wider">NO AGENT SELECTED</h3>
            <p className="text-sm text-cyber-chrome-400 mb-4 font-mono">
              Select an agent or create a new one.
            </p>
            <button
              onClick={() => setShowCreate(true)}
              className="flex items-center gap-1.5 px-4 py-2 cyber-btn-primary text-sm font-display font-bold tracking-wider"
            >
              <Plus size={14} /> CREATE AGENT
            </button>
          </div>
        )}
      </div>

      {showCreate && (
        <CreateAgentDialog
          machines={machines}
          onClose={() => setShowCreate(false)}
          onCreate={handleCreateAgent}
          onOpenMachineSetup={() => { setShowCreate(false); setShowMachineSetup(true); }}
        />
      )}

      {showMachineSetup && (
        <MachineSetupDialog
          machines={machines}
          onClose={() => setShowMachineSetup(false)}
        />
      )}
    </div>
  );
}
