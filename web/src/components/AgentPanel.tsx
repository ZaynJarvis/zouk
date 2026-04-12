import { Bot, Play, Square, ChevronDown, ChevronRight, Loader2, Trash2, Pencil, Check, X, Plus, Server, Monitor } from 'lucide-react';
import { useState } from 'react';
import { useApp } from '../store/AppContext';
import type { ServerAgent, ServerMachine, AgentConfig } from '../types';

const activityColors: Record<string, string> = {
  thinking: 'bg-nb-yellow animate-pulse',
  working: 'bg-nb-orange animate-pulse',
  online: 'bg-nb-green',
  offline: 'bg-nb-gray-400',
  error: 'bg-nb-red',
};

const activityLabels: Record<string, string> = {
  thinking: 'Thinking',
  working: 'Working',
  online: 'Online',
  offline: 'Offline',
  error: 'Error',
};

function AgentCard({ agent, onStop, onDelete, onUpdateConfig }: {
  agent: ServerAgent;
  onStop: (id: string) => void;
  onDelete: (id: string) => void;
  onUpdateConfig: (id: string, updates: { displayName?: string; description?: string }) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(agent.displayName || agent.name);
  const [editDesc, setEditDesc] = useState(agent.description || '');
  const activity = agent.activity || 'offline';
  const isActive = agent.status === 'active';

  const handleSaveEdit = () => {
    onUpdateConfig(agent.id, { displayName: editName, description: editDesc });
    setEditing(false);
  };

  return (
    <div className="border-3 border-nb-black dark:border-dark-border bg-nb-white dark:bg-dark-surface shadow-nb-sm">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-nb-gray-50 dark:hover:bg-dark-elevated transition-colors"
      >
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <div className="w-8 h-8 border-2 border-nb-black dark:border-dark-border font-display font-bold text-xs flex items-center justify-center bg-nb-yellow-light">
          <Bot size={14} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-display font-bold text-sm text-nb-black dark:text-dark-text truncate">
            {agent.displayName || agent.name}
          </div>
          <div className="flex items-center gap-1.5">
            <span className={`w-2 h-2 border border-nb-black dark:border-dark-border ${activityColors[activity]}`} />
            <span className="text-2xs text-nb-gray-500 dark:text-dark-muted">{activityLabels[activity]}</span>
          </div>
        </div>
        <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
          {isActive && (
            <button
              onClick={() => onStop(agent.id)}
              className="w-7 h-7 flex items-center justify-center border-2 border-nb-black dark:border-dark-border bg-nb-red text-nb-white hover:shadow-nb-sm transition-shadow"
              title="Stop agent"
            >
              <Square size={12} />
            </button>
          )}
          <button
            onClick={() => setEditing(true)}
            className="w-7 h-7 flex items-center justify-center border-2 border-nb-black dark:border-dark-border bg-nb-white dark:bg-dark-surface hover:bg-nb-gray-100 transition-colors"
            title="Edit agent"
          >
            <Pencil size={12} />
          </button>
          <button
            onClick={() => { if (confirm(`Delete agent "${agent.displayName || agent.name}"?`)) onDelete(agent.id); }}
            className="w-7 h-7 flex items-center justify-center border-2 border-nb-black dark:border-dark-border bg-nb-white dark:bg-dark-surface hover:bg-nb-red hover:text-nb-white transition-colors"
            title="Delete agent"
          >
            <Trash2 size={12} />
          </button>
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-3 border-t-2 border-nb-gray-200 dark:border-dark-border">
          {editing ? (
            <div className="mt-2 space-y-2">
              <input
                className="w-full px-2 py-1 border-2 border-nb-black dark:border-dark-border text-sm bg-nb-white dark:bg-dark-surface"
                value={editName}
                onChange={e => setEditName(e.target.value)}
                placeholder="Display name"
              />
              <textarea
                className="w-full px-2 py-1 border-2 border-nb-black dark:border-dark-border text-xs bg-nb-white dark:bg-dark-surface resize-none"
                rows={2}
                value={editDesc}
                onChange={e => setEditDesc(e.target.value)}
                placeholder="Description"
              />
              <div className="flex gap-2">
                <button onClick={handleSaveEdit} className="flex items-center gap-1 px-2 py-1 border-2 border-nb-black bg-nb-green text-xs font-bold">
                  <Check size={10} /> Save
                </button>
                <button onClick={() => setEditing(false)} className="flex items-center gap-1 px-2 py-1 border-2 border-nb-black text-xs font-bold">
                  <X size={10} /> Cancel
                </button>
              </div>
            </div>
          ) : (
          <>
          {agent.description && (
            <p className="text-xs text-nb-gray-600 dark:text-dark-muted mt-2">{agent.description}</p>
          )}
          {agent.activityDetail && (
            <div className="mt-2 px-2 py-1.5 bg-nb-gray-100 dark:bg-dark-elevated border border-nb-gray-200 dark:border-dark-border text-xs text-nb-gray-600 dark:text-dark-muted font-mono">
              {agent.activityDetail}
            </div>
          )}
          {agent.entries && agent.entries.length > 0 && (
            <div className="mt-2 space-y-1">
              {agent.entries.slice(-5).map((entry, i) => (
                <div key={i} className="text-2xs text-nb-gray-500 dark:text-dark-muted font-mono truncate">
                  {entry.kind === 'text' && entry.text}
                  {entry.kind === 'status' && `[${entry.activity}] ${entry.detail || ''}`}
                  {entry.kind === 'thinking' && `Thinking: ${entry.text || ''}`}
                  {entry.kind === 'tool_start' && `Tool: ${entry.toolName}`}
                </div>
              ))}
            </div>
          )}
          <div className="mt-2 flex items-center gap-2 text-2xs text-nb-gray-400 dark:text-dark-muted">
            <span>ID: {agent.id}</span>
            <span>Status: {agent.status}</span>
          </div>
          </>
          )}
        </div>
      )}
    </div>
  );
}

function MachineCard({ machine }: { machine: ServerMachine }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="border-3 border-nb-black dark:border-dark-border bg-nb-white dark:bg-dark-surface shadow-nb-sm">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-nb-gray-50 dark:hover:bg-dark-elevated transition-colors"
      >
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <div className="w-8 h-8 border-2 border-nb-black dark:border-dark-border font-display font-bold text-xs flex items-center justify-center bg-nb-green-light">
          <Server size={14} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-display font-bold text-sm text-nb-black dark:text-dark-text truncate">
            {machine.hostname || 'Unknown Host'}
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 border border-nb-black dark:border-dark-border bg-nb-green" />
            <span className="text-2xs text-nb-gray-500 dark:text-dark-muted">Connected</span>
          </div>
        </div>
      </button>
      {expanded && (
        <div className="px-4 pb-3 border-t-2 border-nb-gray-200 dark:border-dark-border space-y-1">
          <div className="mt-2 text-xs text-nb-gray-600 dark:text-dark-muted">
            <span className="font-bold">OS:</span> {machine.os || 'unknown'}
          </div>
          {machine.runtimes && machine.runtimes.length > 0 && (
            <div className="text-xs text-nb-gray-600 dark:text-dark-muted">
              <span className="font-bold">Runtimes:</span> {machine.runtimes.join(', ')}
            </div>
          )}
          <div className="text-2xs text-nb-gray-400 dark:text-dark-muted">
            ID: {machine.id.slice(0, 8)}
          </div>
        </div>
      )}
    </div>
  );
}

function AddAgentConfigForm({ onSave }: { onSave: (config: AgentConfig) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [runtime, setRuntime] = useState('claude');
  const [model, setModel] = useState('');
  const [description, setDescription] = useState('');

  const handleSubmit = () => {
    if (!name.trim()) return;
    onSave({
      name: name.trim(),
      displayName: displayName.trim() || undefined,
      description: description.trim() || undefined,
      runtime,
      model: model.trim() || undefined,
      serverUrl: '',
    } as AgentConfig);
    setName('');
    setDisplayName('');
    setRuntime('claude');
    setModel('');
    setDescription('');
    setOpen(false);
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 px-3 py-1.5 border-2 border-nb-black dark:border-dark-border text-sm font-bold bg-nb-blue text-nb-white shadow-nb-sm hover:shadow-nb active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all"
      >
        <Plus size={14} /> Add Agent Config
      </button>
    );
  }

  return (
    <div className="border-3 border-nb-black dark:border-dark-border bg-nb-white dark:bg-dark-surface shadow-nb-sm p-4 space-y-3">
      <h4 className="font-display font-bold text-sm text-nb-black dark:text-dark-text">New Agent Config</h4>
      <div className="space-y-2">
        <input
          className="w-full px-2 py-1.5 border-2 border-nb-black dark:border-dark-border text-sm bg-nb-white dark:bg-dark-surface"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Name (required)"
        />
        <input
          className="w-full px-2 py-1.5 border-2 border-nb-black dark:border-dark-border text-sm bg-nb-white dark:bg-dark-surface"
          value={displayName}
          onChange={e => setDisplayName(e.target.value)}
          placeholder="Display name (optional)"
        />
        <select
          className="w-full px-2 py-1.5 border-2 border-nb-black dark:border-dark-border text-sm bg-nb-white dark:bg-dark-surface"
          value={runtime}
          onChange={e => setRuntime(e.target.value)}
        >
          <option value="claude">Claude</option>
          <option value="codex">Codex</option>
          <option value="kimi">Kimi</option>
          <option value="hermes">Hermes</option>
        </select>
        <input
          className="w-full px-2 py-1.5 border-2 border-nb-black dark:border-dark-border text-sm bg-nb-white dark:bg-dark-surface"
          value={model}
          onChange={e => setModel(e.target.value)}
          placeholder="Model (optional)"
        />
        <textarea
          className="w-full px-2 py-1.5 border-2 border-nb-black dark:border-dark-border text-xs bg-nb-white dark:bg-dark-surface resize-none"
          rows={2}
          value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder="Description (optional)"
        />
      </div>
      <div className="flex gap-2">
        <button
          onClick={handleSubmit}
          disabled={!name.trim()}
          className="flex items-center gap-1 px-3 py-1.5 border-2 border-nb-black text-sm font-bold bg-nb-green shadow-nb-sm hover:shadow-nb disabled:opacity-50 disabled:cursor-not-allowed transition-all"
        >
          <Check size={12} /> Save
        </button>
        <button
          onClick={() => setOpen(false)}
          className="flex items-center gap-1 px-3 py-1.5 border-2 border-nb-black text-sm font-bold bg-nb-white dark:bg-dark-surface transition-all"
        >
          <X size={12} /> Cancel
        </button>
      </div>
    </div>
  );
}

export default function AgentsView() {
  const { agents, configs, machines, startAgent, stopAgent, deleteAgent, updateAgentConfig, saveAgentConfig } = useApp();
  const [starting, setStarting] = useState<string | null>(null);

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

  const activeAgents = agents.filter(a => a.status === 'active');
  const inactiveAgents = agents.filter(a => a.status === 'inactive');

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="px-6 py-4">
        <h2 className="font-display font-black text-2xl text-nb-black dark:text-dark-text mb-4">Agents</h2>

        {/* Connected Machines / Servers */}
        <div className="mb-6">
          <h3 className="text-xs font-bold uppercase tracking-wider text-nb-gray-500 dark:text-dark-muted mb-2">
            <span className="flex items-center gap-1.5"><Monitor size={12} /> Connected Servers ({machines.length})</span>
          </h3>
          {machines.length > 0 ? (
            <div className="space-y-2">
              {machines.map(m => <MachineCard key={m.id} machine={m} />)}
            </div>
          ) : (
            <div className="border-2 border-dashed border-nb-gray-300 dark:border-dark-border px-4 py-3 text-sm text-nb-gray-400 dark:text-dark-muted">
              No servers connected. Start a zouk-daemon to connect.
            </div>
          )}
        </div>

        {/* Add Agent Config */}
        <div className="mb-6">
          <AddAgentConfigForm onSave={saveAgentConfig} />
        </div>

        {configs.length > 0 && (
          <div className="mb-6">
            <h3 className="text-xs font-bold uppercase tracking-wider text-nb-gray-500 dark:text-dark-muted mb-2">
              Available Configs
            </h3>
            <div className="flex flex-wrap gap-2">
              {configs.map(c => {
                const alreadyRunning = agents.some(a => a.name === c.name && a.status === 'active');
                const isStarting = starting === c.name;
                return (
                  <button
                    key={c.name}
                    onClick={() => !alreadyRunning && !isStarting && handleStartAgent(c.name)}
                    disabled={alreadyRunning || isStarting}
                    className={`flex items-center gap-1.5 px-3 py-1.5 border-2 text-sm font-bold transition-all ${
                      alreadyRunning
                        ? 'border-nb-gray-300 dark:border-dark-border bg-nb-gray-100 dark:bg-dark-elevated text-nb-gray-400 cursor-not-allowed'
                        : 'border-nb-black bg-nb-green text-nb-black shadow-nb-sm hover:shadow-nb active:translate-x-[2px] active:translate-y-[2px] active:shadow-none'
                    }`}
                  >
                    {isStarting ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
                    {c.displayName || c.name}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {activeAgents.length > 0 && (
          <div className="mb-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-nb-gray-500 dark:text-dark-muted mb-2">
              Active ({activeAgents.length})
            </h3>
            <div className="space-y-2">
              {activeAgents.map(a => (
                <AgentCard key={a.id} agent={a} onStop={stopAgent} onDelete={deleteAgent} onUpdateConfig={updateAgentConfig} />
              ))}
            </div>
          </div>
        )}

        {inactiveAgents.length > 0 && (
          <div className="mb-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-nb-gray-500 dark:text-dark-muted mb-2">
              Inactive ({inactiveAgents.length})
            </h3>
            <div className="space-y-2">
              {inactiveAgents.map(a => (
                <AgentCard key={a.id} agent={a} onStop={stopAgent} onDelete={deleteAgent} onUpdateConfig={updateAgentConfig} />
              ))}
            </div>
          </div>
        )}

        {agents.length === 0 && configs.length === 0 && (
          <div className="text-center border-3 border-nb-black dark:border-dark-border bg-nb-white dark:bg-dark-surface p-8 shadow-nb max-w-sm mx-auto">
            <div className="w-16 h-16 border-3 border-nb-black dark:border-dark-border bg-nb-yellow-light dark:bg-dark-elevated mx-auto mb-4 flex items-center justify-center shadow-nb-sm">
              <Bot size={28} className="text-nb-orange" />
            </div>
            <h3 className="font-display font-black text-xl text-nb-black dark:text-dark-text mb-2">No Agents</h3>
            <p className="text-sm text-nb-gray-500 dark:text-dark-muted">
              Connect a daemon to start and manage agents.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
