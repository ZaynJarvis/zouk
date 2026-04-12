import { useState, useEffect, useMemo } from 'react';
import { X, Plus, ChevronDown, Globe, Lock, Server, AlertTriangle } from 'lucide-react';
import type { ServerMachine } from '../types';

const MODELS_BY_PROVIDER: Record<string, string[]> = {
  claude: ['opus', 'sonnet', 'haiku'],
  codex: ['gpt-4.1', 'o3', 'o4-mini'],
  hermes: ['gpt-5.4', 'gemini-2.5-flash', 'claude-sonnet-4-5'],
  opencode: ['gpt-4.1', 'o3'],
  openclaw: ['gpt-4.1'],
  kimi: ['kimi-latest'],
};

const DEFAULT_MODELS: Record<string, string> = {
  claude: 'sonnet',
  codex: 'gpt-4.1',
  hermes: 'gpt-5.4',
  opencode: 'gpt-4.1',
  openclaw: 'gpt-4.1',
  kimi: 'kimi-latest',
};

const RUNTIME_LABELS: Record<string, string> = {
  hermes: 'Hermes Agent',
  claude: 'Claude Code',
  codex: 'OpenAI Codex',
  opencode: 'OpenCode',
  openclaw: 'OpenClaw',
  kimi: 'Kimi',
};

export interface CreateAgentConfig {
  name: string;
  description: string;
  runtime: string;
  model: string;
  machineId?: string;
  visibility: 'workspace' | 'private';
  workDir: string;
}

export default function CreateAgentDialog({
  machines,
  onClose,
  onCreate,
  onOpenMachineSetup,
}: {
  machines: ServerMachine[];
  onClose: () => void;
  onCreate: (config: CreateAgentConfig) => void;
  onOpenMachineSetup?: () => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selectedMachineId, setSelectedMachineId] = useState<string>(machines[0]?.id ?? '');
  const [runtime, setRuntime] = useState('');
  const [model, setModel] = useState('');
  const [visibility, setVisibility] = useState<'workspace' | 'private'>('workspace');
  const [machineOpen, setMachineOpen] = useState(false);
  const [runtimeOpen, setRuntimeOpen] = useState(false);

  const selectedMachine = machines.find(m => m.id === selectedMachineId);
  const machineRuntimes = useMemo(() => selectedMachine?.runtimes || [], [selectedMachine]);

  // When machine changes, auto-select first available runtime
  useEffect(() => {
    if (machineRuntimes.length > 0 && !machineRuntimes.includes(runtime)) {
      setRuntime(machineRuntimes[0]);
    } else if (machineRuntimes.length === 0 && !runtime) {
      setRuntime('hermes');
    }
  }, [selectedMachineId, machineRuntimes, runtime]);

  // When runtime changes, auto-select default model
  useEffect(() => {
    const runtimeModels = MODELS_BY_PROVIDER[runtime] || [];
    setModel(DEFAULT_MODELS[runtime] || runtimeModels[0] || '');
  }, [runtime]);

  const models = MODELS_BY_PROVIDER[runtime] || [];
  const canSubmit = name.trim().length > 0 && runtime;
  const workDir = `~/.zouk/agents/${name.trim().toLowerCase() || '<name>'}`;

  const handleSubmit = () => {
    if (!canSubmit) return;
    const agentName = name.trim().toLowerCase();
    onCreate({
      name: agentName,
      description: description.trim(),
      runtime,
      model,
      machineId: selectedMachine?.id,
      visibility,
      workDir: `~/.zouk/agents/${agentName}`,
    });
  };

  return (
    <div
      className="fixed inset-0 bg-nb-black/40 flex items-center justify-center z-50 animate-fade-in"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-nb-white dark:bg-dark-surface border-3 border-nb-black dark:border-dark-border shadow-nb-lg w-[520px] max-h-[90vh] overflow-y-auto animate-bounce-in">
        {/* Header */}
        <div className="flex justify-between items-center px-6 pt-5 pb-3 border-b-2 border-nb-gray-200 dark:border-dark-border">
          <div>
            <h2 className="font-display font-black text-xl text-nb-black dark:text-dark-text">Create Agent</h2>
            <p className="text-xs text-nb-gray-500 dark:text-dark-muted mt-0.5">Create a new AI agent on a connected machine.</p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center border-2 border-nb-black dark:border-dark-border bg-nb-white dark:bg-dark-surface hover:bg-nb-red hover:text-nb-white transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        <div className="px-6 pb-5 space-y-5 pt-4">
          {/* No machines warning */}
          {machines.length === 0 && (
            <div className="border-3 border-nb-orange bg-nb-orange-light dark:bg-nb-orange/10 p-3 flex items-start gap-2">
              <AlertTriangle size={14} className="text-nb-orange shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="font-bold text-sm text-nb-black dark:text-dark-text">No machines connected</p>
                <p className="text-xs text-nb-gray-600 dark:text-dark-muted mt-0.5">
                  Connect a daemon to run agents.
                </p>
                {onOpenMachineSetup && (
                  <button
                    onClick={() => { onClose(); onOpenMachineSetup(); }}
                    className="mt-2 px-3 py-1 border-2 border-nb-black text-xs font-bold bg-nb-white dark:bg-dark-surface shadow-nb-sm hover:shadow-nb transition-all"
                  >
                    Machine Setup
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Name */}
          <div>
            <label className="block text-xs font-bold text-nb-gray-600 dark:text-dark-muted mb-1.5">Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. bob"
              className="w-full px-3 py-2 border-2 border-nb-black dark:border-dark-border bg-nb-white dark:bg-dark-surface text-sm text-nb-black dark:text-dark-text placeholder:text-nb-gray-400"
              autoFocus
            />
          </div>

          {/* Description (serves as system prompt / instructions) */}
          <div>
            <label className="block text-xs font-bold text-nb-gray-600 dark:text-dark-muted mb-1.5">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What does this agent do? e.g. 'Frontend specialist focused on React and TypeScript.'"
              className="w-full px-3 py-2 border-2 border-nb-black dark:border-dark-border bg-nb-white dark:bg-dark-surface text-sm text-nb-black dark:text-dark-text placeholder:text-nb-gray-400 resize-none"
              rows={2}
            />
          </div>

          {/* Machine Picker */}
          {machines.length > 0 && (
            <div>
              <label className="flex items-center gap-1.5 text-xs font-bold text-nb-gray-600 dark:text-dark-muted mb-1.5">
                <Server size={12} /> Machine
              </label>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setMachineOpen(!machineOpen)}
                  className="w-full flex items-center justify-between px-3 py-2.5 border-2 border-nb-black dark:border-dark-border bg-nb-white dark:bg-dark-surface text-left text-sm hover:bg-nb-gray-50 dark:hover:bg-dark-elevated transition-colors"
                >
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <span className="w-2 h-2 border border-nb-black dark:border-dark-border bg-nb-green shrink-0" />
                    <span className="font-bold text-nb-black dark:text-dark-text truncate">
                      {selectedMachine?.alias || selectedMachine?.hostname || 'Select machine...'}
                    </span>
                    {selectedMachine && (
                      <span className="text-2xs text-nb-gray-400 dark:text-dark-muted">
                        {selectedMachine.os} · {(selectedMachine.runtimes || []).length} runtime{(selectedMachine.runtimes || []).length !== 1 ? 's' : ''}
                      </span>
                    )}
                  </div>
                  <ChevronDown size={14} className={`text-nb-gray-400 transition-transform ${machineOpen ? 'rotate-180' : ''}`} />
                </button>
                {machineOpen && (
                  <div className="absolute z-10 mt-1 w-full border-2 border-nb-black dark:border-dark-border bg-nb-white dark:bg-dark-surface shadow-nb max-h-48 overflow-y-auto">
                    {machines.map((m) => (
                      <button
                        key={m.id}
                        onClick={() => { setSelectedMachineId(m.id); setMachineOpen(false); }}
                        className={`w-full flex items-center gap-2 px-3 py-2.5 text-left text-sm transition-colors ${
                          m.id === selectedMachineId ? 'bg-nb-gray-100 dark:bg-dark-elevated' : 'hover:bg-nb-gray-50 dark:hover:bg-dark-elevated/50'
                        }`}
                      >
                        <span className="w-2 h-2 border border-nb-black dark:border-dark-border bg-nb-green shrink-0" />
                        <div className="flex-1 min-w-0">
                          <span className="font-bold text-nb-black dark:text-dark-text">{m.alias || m.hostname}</span>
                          {m.alias && <span className="text-2xs text-nb-gray-400 dark:text-dark-muted ml-1.5">{m.hostname}</span>}
                          <div className="text-2xs text-nb-gray-400 dark:text-dark-muted">
                            {m.os} · Runtimes: {(m.runtimes || []).join(', ') || 'none'}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Runtime Picker */}
          <div>
            <label className="block text-xs font-bold text-nb-gray-600 dark:text-dark-muted mb-1.5">Runtime</label>
            {machineRuntimes.length > 0 ? (
              <div className="flex gap-2 flex-wrap">
                {machineRuntimes.map((rt) => (
                  <button
                    key={rt}
                    type="button"
                    onClick={() => setRuntime(rt)}
                    className={`px-3 py-1.5 border-2 text-sm font-bold transition-all ${
                      runtime === rt
                        ? 'border-nb-black bg-nb-blue text-nb-white shadow-nb-sm'
                        : 'border-nb-gray-200 dark:border-dark-border text-nb-gray-600 dark:text-dark-muted hover:bg-nb-gray-50 dark:hover:bg-dark-elevated'
                    }`}
                  >
                    {RUNTIME_LABELS[rt] || rt}
                  </button>
                ))}
              </div>
            ) : (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setRuntimeOpen(!runtimeOpen)}
                  className="w-full flex items-center justify-between px-3 py-2.5 border-2 border-nb-black dark:border-dark-border bg-nb-white dark:bg-dark-surface text-left text-sm hover:bg-nb-gray-50 dark:hover:bg-dark-elevated transition-colors"
                >
                  <span className="font-bold text-nb-black dark:text-dark-text">
                    {RUNTIME_LABELS[runtime] || runtime || 'Select runtime...'}
                  </span>
                  <ChevronDown size={14} className={`text-nb-gray-400 transition-transform ${runtimeOpen ? 'rotate-180' : ''}`} />
                </button>
                {runtimeOpen && (
                  <div className="absolute z-10 mt-1 w-full border-2 border-nb-black dark:border-dark-border bg-nb-white dark:bg-dark-surface shadow-nb max-h-48 overflow-y-auto">
                    {Object.entries(RUNTIME_LABELS).map(([key, label]) => (
                      <button
                        key={key}
                        onClick={() => { setRuntime(key); setRuntimeOpen(false); }}
                        className={`w-full flex items-center gap-2 px-3 py-2.5 text-left text-sm transition-colors ${
                          key === runtime ? 'bg-nb-gray-100 dark:bg-dark-elevated' : 'hover:bg-nb-gray-50 dark:hover:bg-dark-elevated/50'
                        }`}
                      >
                        <span className="font-bold text-nb-black dark:text-dark-text">{label}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Visibility */}
          <div>
            <label className="block text-xs font-bold text-nb-gray-600 dark:text-dark-muted mb-1.5">Visibility</label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setVisibility('workspace')}
                className={`flex items-center gap-2 border-2 px-3 py-2.5 text-left transition-all ${
                  visibility === 'workspace'
                    ? 'border-nb-blue bg-nb-blue-light dark:bg-nb-blue/10 shadow-nb-sm'
                    : 'border-nb-gray-200 dark:border-dark-border hover:bg-nb-gray-50 dark:hover:bg-dark-elevated'
                }`}
              >
                <Globe size={16} className="shrink-0 text-nb-gray-500" />
                <div>
                  <div className="font-bold text-sm text-nb-black dark:text-dark-text">Workspace</div>
                  <div className="text-xs text-nb-gray-400 dark:text-dark-muted">All members can assign</div>
                </div>
              </button>
              <button
                type="button"
                onClick={() => setVisibility('private')}
                className={`flex items-center gap-2 border-2 px-3 py-2.5 text-left transition-all ${
                  visibility === 'private'
                    ? 'border-nb-blue bg-nb-blue-light dark:bg-nb-blue/10 shadow-nb-sm'
                    : 'border-nb-gray-200 dark:border-dark-border hover:bg-nb-gray-50 dark:hover:bg-dark-elevated'
                }`}
              >
                <Lock size={16} className="shrink-0 text-nb-gray-500" />
                <div>
                  <div className="font-bold text-sm text-nb-black dark:text-dark-text">Private</div>
                  <div className="text-xs text-nb-gray-400 dark:text-dark-muted">Only you can assign</div>
                </div>
              </button>
            </div>
          </div>

          {/* Model */}
          {models.length > 0 && (
            <div>
              <label className="block text-xs font-bold text-nb-gray-600 dark:text-dark-muted mb-1.5">Model</label>
              <div className="flex gap-2 flex-wrap">
                {models.map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setModel(m)}
                    className={`px-3 py-1.5 border-2 text-sm font-bold transition-all ${
                      model === m
                        ? 'border-nb-black bg-nb-blue text-nb-white shadow-nb-sm'
                        : 'border-nb-gray-200 dark:border-dark-border text-nb-gray-600 dark:text-dark-muted hover:bg-nb-gray-50 dark:hover:bg-dark-elevated'
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Working Directory (read-only, auto-derived) */}
          <div>
            <label className="block text-xs font-bold text-nb-gray-600 dark:text-dark-muted mb-1.5">Working Directory</label>
            <div className="px-3 py-2 border-2 border-nb-gray-200 dark:border-dark-border bg-nb-gray-50 dark:bg-dark-elevated text-sm font-mono text-nb-gray-600 dark:text-dark-muted">
              {workDir}
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-3 border-t-2 border-nb-gray-200 dark:border-dark-border">
            <button
              onClick={handleSubmit}
              disabled={!canSubmit}
              className="flex-1 flex items-center justify-center gap-1.5 py-2.5 border-2 border-nb-black text-sm font-bold bg-nb-green text-nb-black shadow-nb-sm hover:shadow-nb active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none"
            >
              <Plus size={14} /> Create & Start
            </button>
            <button
              onClick={onClose}
              className="px-5 py-2.5 border-2 border-nb-black dark:border-dark-border text-sm font-bold bg-nb-white dark:bg-dark-surface hover:bg-nb-gray-50 dark:hover:bg-dark-elevated transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
