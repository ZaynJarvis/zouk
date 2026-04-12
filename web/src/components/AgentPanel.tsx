import { Bot, Plus, Server, Monitor, ChevronDown, ChevronRight, Play, Loader2, Settings } from 'lucide-react';
import { useState, useMemo } from 'react';
import { useApp } from '../store/AppContext';
import type { ServerAgent, ServerMachine } from '../types';
import AgentDetail from './AgentDetail';
import CreateAgentDialog from './CreateAgentDialog';
import MachineSetupDialog from './MachineSetupDialog';

const activityColors: Record<string, string> = {
  thinking: 'bg-nb-yellow animate-pulse',
  working: 'bg-nb-orange animate-pulse',
  online: 'bg-nb-green',
  offline: 'bg-nb-gray-400',
  error: 'bg-nb-red',
};

const PROVIDER_LABELS: Record<string, string> = {
  hermes: 'Hermes',
  claude: 'Claude',
  codex: 'Codex',
  opencode: 'OpenCode',
  openclaw: 'OpenClaw',
  kimi: 'Kimi',
};

/* ── Agent List Item ── */
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
      className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors border-b border-nb-gray-200 dark:border-dark-border ${
        isSelected
          ? 'bg-nb-yellow-light dark:bg-dark-elevated'
          : 'hover:bg-nb-gray-50 dark:hover:bg-dark-elevated'
      }`}
    >
      <div className="w-8 h-8 border-2 border-nb-black dark:border-dark-border font-display font-bold text-xs flex items-center justify-center bg-nb-yellow-light dark:bg-dark-elevated shrink-0">
        {(agent.displayName || agent.name).charAt(0).toUpperCase()}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="truncate font-display font-bold text-sm text-nb-black dark:text-dark-text">
            {agent.displayName || agent.name}
          </span>
          <span className={`w-2 h-2 border border-nb-black dark:border-dark-border shrink-0 ${activityColors[activity]}`} />
        </div>
        <div className="text-2xs text-nb-gray-500 dark:text-dark-muted truncate">
          {PROVIDER_LABELS[agent.runtime || ''] || agent.runtime || 'No runtime'} · {agent.model || '—'}
        </div>
      </div>
      {agent.archivedAt && (
        <span className="text-2xs font-bold text-nb-gray-400 bg-nb-gray-100 dark:bg-dark-elevated px-1.5 py-0.5 border border-nb-gray-200 dark:border-dark-border">
          archived
        </span>
      )}
    </button>
  );
}

/* ── Compact Machine Card ── */
function CompactMachineCard({ machine }: { machine: ServerMachine }) {
  return (
    <div className="flex items-center gap-2 px-4 py-2 border-b border-nb-gray-200 dark:border-dark-border">
      <Server size={12} className="text-nb-gray-400 shrink-0" />
      <span className="text-2xs font-bold text-nb-black dark:text-dark-text truncate">{machine.alias || machine.hostname}</span>
      {machine.alias && <span className="text-2xs text-nb-gray-400 dark:text-dark-muted truncate">{machine.hostname}</span>}
      <span className="w-1.5 h-1.5 border border-nb-black dark:border-dark-border bg-nb-green shrink-0" />
      {machine.runtimes && (
        <span className="text-2xs text-nb-gray-400 dark:text-dark-muted truncate ml-auto">
          {machine.runtimes.join(', ')}
        </span>
      )}
    </div>
  );
}

/* ── Config Start Button ── */
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
      className={`flex items-center gap-1 px-2.5 py-1 border-2 text-2xs font-bold transition-all ${
        isRunning
          ? 'border-nb-gray-300 dark:border-dark-border bg-nb-gray-100 dark:bg-dark-elevated text-nb-gray-400 cursor-not-allowed'
          : 'border-nb-black bg-nb-green text-nb-black shadow-nb-sm hover:shadow-nb active:translate-x-[2px] active:translate-y-[2px] active:shadow-none'
      }`}
    >
      {isStarting ? <Loader2 size={10} className="animate-spin" /> : <Play size={10} />}
      {config.displayName || config.name}
    </button>
  );
}

/* ── Main AgentsView ── */
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
      {/* Left panel — Agent list */}
      <div className="w-72 shrink-0 border-r-2 border-nb-gray-200 dark:border-dark-border flex flex-col bg-nb-white dark:bg-dark-surface">
        {/* Header */}
        <div className="flex h-12 items-center justify-between border-b-2 border-nb-gray-200 dark:border-dark-border px-4">
          <h1 className="font-display font-black text-sm text-nb-black dark:text-dark-text">Agents</h1>
          <div className="flex items-center gap-1.5">
            {archivedCount > 0 && (
              <button
                onClick={() => setShowArchived(!showArchived)}
                className={`px-2 py-0.5 border-2 text-2xs font-bold transition-all ${
                  showArchived
                    ? 'border-nb-black bg-nb-gray-100 dark:bg-dark-elevated text-nb-black dark:text-dark-text'
                    : 'border-nb-gray-200 dark:border-dark-border text-nb-gray-400 hover:border-nb-black'
                }`}
              >
                {showArchived ? 'Active' : `Archived (${archivedCount})`}
              </button>
            )}
            <button
              onClick={() => setShowCreate(true)}
              className="w-7 h-7 flex items-center justify-center border-2 border-nb-black dark:border-dark-border bg-nb-blue text-nb-white shadow-nb-sm hover:shadow-nb active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all"
              title="Create agent"
            >
              <Plus size={14} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* Connected Machines */}
          <div>
            <div className="flex items-center justify-between px-4 py-2">
              <button
                onClick={() => setMachinesExpanded(!machinesExpanded)}
                className="flex items-center gap-1.5 text-left hover:opacity-80 transition-opacity"
              >
                {machinesExpanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                <Monitor size={10} className="text-nb-gray-400" />
                <span className="text-2xs font-bold uppercase tracking-wider text-nb-gray-500 dark:text-dark-muted">
                  Machines ({machines.length})
                </span>
              </button>
              <button
                onClick={() => setShowMachineSetup(true)}
                className="w-6 h-6 flex items-center justify-center border border-nb-gray-200 dark:border-dark-border hover:border-nb-black dark:hover:border-dark-text hover:bg-nb-gray-50 dark:hover:bg-dark-elevated transition-all"
                title="Machine Setup & API Keys"
              >
                <Settings size={10} className="text-nb-gray-400" />
              </button>
            </div>
            {machinesExpanded && (
              machines.length > 0 ? (
                machines.map(m => <CompactMachineCard key={m.id} machine={m} />)
              ) : (
                <div className="px-4 pb-2">
                  <button
                    onClick={() => setShowMachineSetup(true)}
                    className="w-full border-2 border-dashed border-nb-gray-300 dark:border-dark-border px-3 py-2 text-2xs text-nb-gray-400 dark:text-dark-muted text-center hover:border-nb-black dark:hover:border-dark-text hover:text-nb-gray-600 transition-colors"
                  >
                    + Connect a machine
                  </button>
                </div>
              )
            )}
          </div>

          {/* Saved Configs */}
          {configs.length > 0 && (
            <div>
              <button
                onClick={() => setConfigsExpanded(!configsExpanded)}
                className="w-full flex items-center gap-1.5 px-4 py-2 text-left hover:bg-nb-gray-50 dark:hover:bg-dark-elevated transition-colors"
              >
                {configsExpanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                <span className="text-2xs font-bold uppercase tracking-wider text-nb-gray-500 dark:text-dark-muted">
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

          {/* Divider */}
          {(machines.length > 0 || configs.length > 0) && (
            <div className="border-b-2 border-nb-gray-200 dark:border-dark-border" />
          )}

          {/* Agent list */}
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
              <div className="w-12 h-12 border-3 border-nb-black dark:border-dark-border bg-nb-yellow-light dark:bg-dark-elevated flex items-center justify-center mb-3 shadow-nb-sm">
                <Bot size={20} className="text-nb-orange" />
              </div>
              <p className="text-sm text-nb-gray-500 dark:text-dark-muted font-bold">
                {showArchived ? 'No archived agents' : 'No agents yet'}
              </p>
              {!showArchived && (
                <button
                  onClick={() => setShowCreate(true)}
                  className="mt-3 flex items-center gap-1 px-3 py-1.5 border-2 border-nb-black text-sm font-bold bg-nb-blue text-nb-white shadow-nb-sm hover:shadow-nb active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all"
                >
                  <Plus size={12} /> Create Agent
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Right panel — Agent detail */}
      <div className="flex-1 min-w-0 overflow-hidden">
        {selected ? (
          <AgentDetail
            agent={selected}
            onUpdate={handleUpdateAgent}
            onStop={() => stopAgent(selected.id)}
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center bg-nb-white dark:bg-dark-surface">
            <div className="w-16 h-16 border-3 border-nb-black dark:border-dark-border bg-nb-yellow-light dark:bg-dark-elevated flex items-center justify-center shadow-nb-sm mb-4">
              <Bot size={28} className="text-nb-orange" />
            </div>
            <h3 className="font-display font-black text-xl text-nb-black dark:text-dark-text mb-2">No Agent Selected</h3>
            <p className="text-sm text-nb-gray-500 dark:text-dark-muted mb-4">
              Select an agent from the list or create a new one.
            </p>
            <button
              onClick={() => setShowCreate(true)}
              className="flex items-center gap-1.5 px-4 py-2 border-2 border-nb-black text-sm font-bold bg-nb-blue text-nb-white shadow-nb-sm hover:shadow-nb active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all"
            >
              <Plus size={14} /> Create Agent
            </button>
          </div>
        )}
      </div>

      {/* Create dialog */}
      {showCreate && (
        <CreateAgentDialog
          machines={machines}
          onClose={() => setShowCreate(false)}
          onCreate={handleCreateAgent}
          onOpenMachineSetup={() => { setShowCreate(false); setShowMachineSetup(true); }}
        />
      )}

      {/* Machine Setup dialog */}
      {showMachineSetup && (
        <MachineSetupDialog
          machines={machines}
          onClose={() => setShowMachineSetup(false)}
        />
      )}
    </div>
  );
}
