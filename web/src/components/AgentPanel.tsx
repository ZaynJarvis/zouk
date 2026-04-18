import { Bot, Plus, Server, Monitor, ChevronDown, ChevronRight, Play, Loader as Loader2, Settings } from 'lucide-react';
import { useState, useMemo } from 'react';
import { useApp } from '../store/AppContext';
import type { ServerAgent, ServerMachine } from '../types';
import AgentDetail from './AgentDetail';
import CreateAgentDialog from './CreateAgentDialog';
import MachineSetupDialog from './MachineSetupDialog';
import ScanlineTear from './glitch/ScanlineTear';
import { formatRuntime, formatRuntimes } from '../lib/runtimeLabels';

const activityColors: Record<string, string> = {
  thinking: 'bg-nc-yellow animate-pulse',
  working: 'bg-nc-red animate-pulse',
  online: 'bg-nc-green',
  offline: 'bg-nc-muted/30',
  error: 'bg-nc-red',
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
      className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-all border-b border-nc-border ${
        isSelected
          ? 'bg-nc-elevated border-l-2 border-l-nc-cyan'
          : 'hover:bg-nc-elevated/50'
      }`}
    >
      <div className="w-8 h-8 border border-nc-cyan/30 bg-nc-cyan/10 font-display font-bold text-xs flex items-center justify-center text-nc-cyan shrink-0 overflow-hidden">
        {agent.picture ? (
          <img src={agent.picture} alt="" className="w-full h-full object-cover" />
        ) : (
          (agent.displayName || agent.name).charAt(0).toUpperCase()
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="truncate font-display font-bold text-sm text-nc-text-bright">
            {agent.displayName || agent.name}
          </span>
          <span className={`w-2 h-2 shrink-0 ${activityColors[activity]}`} />
        </div>
        <div className="text-2xs text-nc-muted truncate font-mono">
          {formatRuntime(agent.runtime) || 'No runtime'} · {agent.model || '—'}
        </div>
      </div>
      {agent.archivedAt && (
        <span className="status-chip-sm tone-neutral font-mono">
          ARCHIVED
        </span>
      )}
    </button>
  );
}

function CompactMachineCard({ machine }: { machine: ServerMachine }) {
  return (
    <div className="flex items-center gap-2 px-4 py-2 border-b border-nc-border">
      <Server size={12} className="text-nc-green shrink-0" />
      <span className="text-2xs font-bold text-nc-text-bright truncate font-mono">{machine.alias || machine.hostname}</span>
      {machine.alias && <span className="text-2xs text-nc-muted truncate font-mono">{machine.hostname}</span>}
      <span className="w-1.5 h-1.5 bg-nc-green shrink-0" />
      {machine.runtimes && (
        <span className="text-2xs text-nc-muted truncate ml-auto font-mono">
          {formatRuntimes(machine.runtimes)}
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
    <ScanlineTear config={{ trigger: 'hover', minInterval: 200, maxInterval: 600, minSeverity: 0.3, maxSeverity: 0.8 }}>
      <button
        onClick={() => !isRunning && !isStarting && onStart()}
        disabled={isRunning || isStarting}
        className={`cyber-btn flex items-center gap-1 px-2.5 py-1 border text-2xs font-bold font-mono ${
          isRunning
            ? 'border-nc-border bg-nc-elevated text-nc-muted cursor-not-allowed'
            : 'border-nc-green bg-nc-green/10 text-nc-green hover:bg-nc-green/20 hover:shadow-nc-green'
        }`}
      >
        {isStarting ? <Loader2 size={10} className="animate-spin" /> : <Play size={10} />}
        {config.displayName || config.name}
      </button>
    </ScanlineTear>
  );
}

export default function AgentsView() {
  const { agents, configs, machines, startAgent, stopAgent, updateAgentConfig, deleteAgent, isGuest } = useApp();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [showMachineSetup, setShowMachineSetup] = useState(false);
  const [starting, setStarting] = useState<string | null>(null);
  const [machinesExpanded, setMachinesExpanded] = useState(true);
  const [configsExpanded, setConfigsExpanded] = useState(true);
  const [mobileShowDetail, setMobileShowDetail] = useState(false);

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
      id: config.id,
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
    machineId?: string;
    workDir: string;
  }) => {
    await startAgent({
      name: config.name,
      description: config.description,
      runtime: config.runtime,
      model: config.model,
      machineId: config.machineId,
    });
    setShowCreate(false);
  };

  const handleUpdateAgent = async (updates: Partial<ServerAgent>) => {
    if (!selected) return;
    await updateAgentConfig(selected.id, updates);
  };

  const handleSelectAgent = (id: string) => {
    setSelectedId(id);
    if (window.innerWidth < 1024) setMobileShowDetail(true);
  };

  const handleDeleteAgent = async () => {
    if (!selected) return;
    const label = selected.displayName || selected.name;
    const confirmed = window.confirm(`Delete agent ${label}? This removes the saved config and disconnects the running agent.`);
    if (!confirmed) return;
    await deleteAgent(selected.id);
    setSelectedId((current) => (current === selected.id ? null : current));
    if (window.innerWidth < 1024) setMobileShowDetail(false);
  };

  return (
    <div className="flex-1 flex min-h-0 overflow-hidden">
      <div className={`${mobileShowDetail ? 'hidden' : 'flex'} lg:flex w-full lg:w-72 shrink-0 border-r-0 lg:border-r border-nc-border flex-col bg-nc-surface`}>
        <div className="flex h-12 items-center justify-between border-b border-nc-border px-4">
          <h1 className="font-display font-black text-sm text-nc-text-bright tracking-wider">AGENTS</h1>
          <div className="flex items-center gap-1.5">
            {archivedCount > 0 && (
              <ScanlineTear config={{ trigger: 'hover', minInterval: 200, maxInterval: 600, minSeverity: 0.3, maxSeverity: 0.8 }}>
                <button
                  onClick={() => setShowArchived(!showArchived)}
                  className={`cyber-btn px-2 py-0.5 border text-2xs font-bold font-mono transition-all ${
                    showArchived
                      ? 'border-nc-cyan bg-nc-cyan/10 text-nc-cyan'
                      : 'border-nc-border text-nc-muted hover:border-nc-cyan hover:text-nc-cyan'
                  }`}
                >
                  {showArchived ? 'ACTIVE' : `ARCHIVED (${archivedCount})`}
                </button>
              </ScanlineTear>
            )}
            {!isGuest && (
              <ScanlineTear config={{ trigger: 'hover', minInterval: 200, maxInterval: 600, minSeverity: 0.3, maxSeverity: 0.8 }}>
                <button
                  onClick={() => setShowCreate(true)}
                  className="cyber-btn flex items-center gap-1.5 px-3 h-8 border border-nc-cyan bg-nc-cyan/10 text-xs font-bold font-mono text-nc-cyan hover:bg-nc-cyan/20 hover:shadow-nc-cyan"
                  title="Add agent"
                >
                  <Plus size={14} />
                  ADD_AGENT
                </button>
              </ScanlineTear>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto scrollbar-thin">
          <div>
            <div className="flex items-center justify-between px-4 py-2">
              <button
                onClick={() => setMachinesExpanded(!machinesExpanded)}
                className="flex items-center gap-1.5 text-left hover:opacity-80 transition-opacity"
              >
                {machinesExpanded ? <ChevronDown size={10} className="text-nc-muted" /> : <ChevronRight size={10} className="text-nc-muted" />}
                <Monitor size={10} className="text-nc-green" />
                <span className="text-2xs font-bold uppercase tracking-wider text-nc-muted font-mono">
                  Machines ({machines.length})
                </span>
              </button>
              {!isGuest && (
                <ScanlineTear config={{ trigger: 'hover', minInterval: 200, maxInterval: 600, minSeverity: 0.3, maxSeverity: 0.8 }}>
                  <button
                    onClick={() => setShowMachineSetup(true)}
                    className="cyber-btn w-6 h-6 flex items-center justify-center border border-nc-border hover:border-nc-cyan hover:text-nc-cyan hover:bg-nc-cyan/10 text-nc-muted"
                    title="Machine Setup & API Keys"
                  >
                    <Settings size={10} />
                  </button>
                </ScanlineTear>
              )}
            </div>
            {machinesExpanded && (
              machines.length > 0 ? (
                machines.map(m => <CompactMachineCard key={m.id} machine={m} />)
              ) : (
                <div className="px-4 pb-2">
                  {isGuest ? (
                    <p className="text-2xs text-nc-muted text-center font-mono py-2">NO_MACHINES_CONNECTED</p>
                  ) : (
                    <ScanlineTear className="w-full" config={{ trigger: 'hover', minInterval: 200, maxInterval: 600, minSeverity: 0.3, maxSeverity: 0.8 }}>
                      <button
                        onClick={() => setShowMachineSetup(true)}
                        className="cyber-btn w-full border border-dashed border-nc-border px-3 py-2 text-2xs text-nc-muted text-center hover:border-nc-cyan hover:text-nc-cyan font-mono"
                      >
                        + CONNECT_MACHINE
                      </button>
                    </ScanlineTear>
                  )}
                </div>
              )
            )}
          </div>

          {configs.length > 0 && (
            <div>
              <button
                onClick={() => setConfigsExpanded(!configsExpanded)}
                className="w-full flex items-center gap-1.5 px-4 py-2 text-left hover:bg-nc-elevated transition-colors"
              >
                {configsExpanded ? <ChevronDown size={10} className="text-nc-muted" /> : <ChevronRight size={10} className="text-nc-muted" />}
                <span className="text-2xs font-bold uppercase tracking-wider text-nc-muted font-mono">
                  Configs ({configs.length})
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
            <div className="cyber-divider mx-4 my-1" />
          )}

          {filteredAgents.length > 0 ? (
            filteredAgents.map((agent) => (
              <AgentListItem
                key={agent.id}
                agent={agent}
                isSelected={agent.id === (selected?.id ?? '')}
                onClick={() => handleSelectAgent(agent.id)}
              />
            ))
          ) : (
            <div className="flex flex-col items-center justify-center px-4 py-12 text-center">
              <div className="w-12 h-12 border border-nc-green/30 bg-nc-green/10 flex items-center justify-center mb-3">
                <Bot size={20} className="text-nc-green" />
              </div>
              <p className="text-sm text-nc-muted font-bold font-mono">
                {showArchived ? 'NO_ARCHIVED_AGENTS' : 'NO_AGENTS_FOUND'}
              </p>
              {!showArchived && !isGuest && (
                <ScanlineTear config={{ trigger: 'hover', minInterval: 200, maxInterval: 600, minSeverity: 0.3, maxSeverity: 0.8 }}>
                  <button
                    onClick={() => setShowCreate(true)}
                    className="cyber-btn mt-3 flex items-center gap-1 px-3 py-1.5 border border-nc-cyan bg-nc-cyan/10 text-sm font-bold text-nc-cyan hover:bg-nc-cyan/20 hover:shadow-nc-cyan font-mono"
                  >
                    <Plus size={12} /> CREATE_AGENT
                  </button>
                </ScanlineTear>
              )}
            </div>
          )}
        </div>
      </div>

      <div className={`${mobileShowDetail ? 'flex' : 'hidden'} lg:flex flex-1 min-w-0 overflow-hidden flex-col`}>
        {selected ? (
          <AgentDetail
            agent={selected}
            machines={machines}
            onUpdate={handleUpdateAgent}
            onStop={() => stopAgent(selected.id)}
            onDelete={handleDeleteAgent}
            onBack={() => setMobileShowDetail(false)}
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center bg-nc-surface">
            <div className="w-16 h-16 border border-nc-green/30 bg-nc-green/10 flex items-center justify-center mb-4">
              <Bot size={28} className="text-nc-green" />
            </div>
            <h3 className="font-display font-black text-xl text-nc-text-bright mb-2 tracking-wider">NO_AGENT_SELECTED</h3>
            <p className="text-sm text-nc-muted font-mono">
              Select an agent from the list or create a new one.
            </p>
          </div>
        )}
      </div>

      {showCreate && !isGuest && (
        <CreateAgentDialog
          machines={machines}
          onClose={() => setShowCreate(false)}
          onCreate={handleCreateAgent}
          onOpenMachineSetup={() => { setShowCreate(false); setShowMachineSetup(true); }}
        />
      )}

      {showMachineSetup && !isGuest && (
        <MachineSetupDialog
          machines={machines}
          onClose={() => setShowMachineSetup(false)}
        />
      )}
    </div>
  );
}
