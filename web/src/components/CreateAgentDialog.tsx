import { useState, useEffect, useMemo } from 'react';
import { X, Plus, ChevronDown, Globe, Lock, Server, TriangleAlert as AlertTriangle } from 'lucide-react';
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

  useEffect(() => {
    if (machineRuntimes.length > 0 && !machineRuntimes.includes(runtime)) {
      setRuntime(machineRuntimes[0]);
    } else if (machineRuntimes.length === 0 && !runtime) {
      setRuntime('hermes');
    }
  }, [selectedMachineId, machineRuntimes, runtime]);

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
      className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 animate-fade-in"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-cyber-surface border border-cyber-border shadow-neon-cyan-lg w-[520px] max-h-[90vh] overflow-y-auto animate-bounce-in relative">
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-cyber-cyan to-transparent" />

        <div className="flex justify-between items-center px-6 pt-5 pb-3 border-b border-cyber-border">
          <div>
            <h2 className="font-display font-bold text-xl text-cyber-cyan tracking-wider">CREATE AGENT</h2>
            <p className="text-xs text-cyber-chrome-400 mt-0.5 font-mono">Initialize a new AI agent instance.</p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center border border-cyber-border bg-cyber-surface hover:bg-cyber-red/10 hover:border-cyber-red/40 hover:text-cyber-red transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        <div className="px-6 pb-5 space-y-5 pt-4">
          {machines.length === 0 && (
            <div className="border border-cyber-orange/40 bg-cyber-orange/5 p-3 flex items-start gap-2">
              <AlertTriangle size={14} className="text-cyber-orange shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="font-bold text-sm text-cyber-chrome-100">No machines connected</p>
                <p className="text-xs text-cyber-chrome-400 mt-0.5 font-mono">Connect a daemon to run agents.</p>
                {onOpenMachineSetup && (
                  <button
                    onClick={() => { onClose(); onOpenMachineSetup(); }}
                    className="mt-2 px-3 py-1 cyber-btn-primary text-xs font-display font-bold tracking-wider"
                  >
                    MACHINE SETUP
                  </button>
                )}
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs font-display font-bold text-cyber-chrome-400 mb-1.5 tracking-wider">NAME</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. bob"
              className="w-full px-3 py-2 cyber-input text-sm font-mono"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-xs font-display font-bold text-cyber-chrome-400 mb-1.5 tracking-wider">DESCRIPTION</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What does this agent do?"
              className="w-full px-3 py-2 cyber-input text-sm resize-none"
              rows={2}
            />
          </div>

          {machines.length > 0 && (
            <div>
              <label className="flex items-center gap-1.5 text-xs font-display font-bold text-cyber-chrome-400 mb-1.5 tracking-wider">
                <Server size={12} /> MACHINE
              </label>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setMachineOpen(!machineOpen)}
                  className="w-full flex items-center justify-between px-3 py-2.5 border border-cyber-border bg-cyber-surface text-left text-sm hover:bg-cyber-elevated transition-colors"
                >
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <span className="w-2 h-2 rounded-full bg-cyber-green shadow-neon-green shrink-0" />
                    <span className="font-bold text-cyber-chrome-100 truncate font-mono">
                      {selectedMachine?.alias || selectedMachine?.hostname || 'Select machine...'}
                    </span>
                    {selectedMachine && (
                      <span className="text-2xs text-cyber-chrome-500 font-mono">
                        {selectedMachine.os} / {(selectedMachine.runtimes || []).length} runtime{(selectedMachine.runtimes || []).length !== 1 ? 's' : ''}
                      </span>
                    )}
                  </div>
                  <ChevronDown size={14} className={`text-cyber-chrome-500 transition-transform ${machineOpen ? 'rotate-180' : ''}`} />
                </button>
                {machineOpen && (
                  <div className="absolute z-10 mt-1 w-full border border-cyber-border bg-cyber-surface shadow-neon-cyan max-h-48 overflow-y-auto">
                    {machines.map((m) => (
                      <button
                        key={m.id}
                        onClick={() => { setSelectedMachineId(m.id); setMachineOpen(false); }}
                        className={`w-full flex items-center gap-2 px-3 py-2.5 text-left text-sm transition-colors ${
                          m.id === selectedMachineId ? 'bg-cyber-elevated' : 'hover:bg-cyber-elevated/50'
                        }`}
                      >
                        <span className="w-2 h-2 rounded-full bg-cyber-green shadow-neon-green shrink-0" />
                        <div className="flex-1 min-w-0">
                          <span className="font-bold text-cyber-chrome-100 font-mono">{m.alias || m.hostname}</span>
                          {m.alias && <span className="text-2xs text-cyber-chrome-500 ml-1.5 font-mono">{m.hostname}</span>}
                          <div className="text-2xs text-cyber-chrome-500 font-mono">
                            {m.os} / Runtimes: {(m.runtimes || []).join(', ') || 'none'}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs font-display font-bold text-cyber-chrome-400 mb-1.5 tracking-wider">RUNTIME</label>
            {machineRuntimes.length > 0 ? (
              <div className="flex gap-2 flex-wrap">
                {machineRuntimes.map((rt) => (
                  <button
                    key={rt}
                    type="button"
                    onClick={() => setRuntime(rt)}
                    className={`px-3 py-1.5 border text-sm font-mono font-bold tracking-wider transition-all ${
                      runtime === rt
                        ? 'border-cyber-cyan/40 bg-cyber-cyan/10 text-cyber-cyan shadow-cyber-sm'
                        : 'border-cyber-border text-cyber-chrome-400 hover:bg-cyber-elevated'
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
                  className="w-full flex items-center justify-between px-3 py-2.5 border border-cyber-border bg-cyber-surface text-left text-sm hover:bg-cyber-elevated transition-colors"
                >
                  <span className="font-bold text-cyber-chrome-100 font-mono">
                    {RUNTIME_LABELS[runtime] || runtime || 'Select runtime...'}
                  </span>
                  <ChevronDown size={14} className={`text-cyber-chrome-500 transition-transform ${runtimeOpen ? 'rotate-180' : ''}`} />
                </button>
                {runtimeOpen && (
                  <div className="absolute z-10 mt-1 w-full border border-cyber-border bg-cyber-surface shadow-neon-cyan max-h-48 overflow-y-auto">
                    {Object.entries(RUNTIME_LABELS).map(([key, label]) => (
                      <button
                        key={key}
                        onClick={() => { setRuntime(key); setRuntimeOpen(false); }}
                        className={`w-full flex items-center gap-2 px-3 py-2.5 text-left text-sm transition-colors ${
                          key === runtime ? 'bg-cyber-elevated' : 'hover:bg-cyber-elevated/50'
                        }`}
                      >
                        <span className="font-bold text-cyber-chrome-100 font-mono">{label}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs font-display font-bold text-cyber-chrome-400 mb-1.5 tracking-wider">VISIBILITY</label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setVisibility('workspace')}
                className={`flex items-center gap-2 border px-3 py-2.5 text-left transition-all ${
                  visibility === 'workspace'
                    ? 'border-cyber-cyan/40 bg-cyber-cyan/10 shadow-cyber-sm'
                    : 'border-cyber-border hover:bg-cyber-elevated'
                }`}
              >
                <Globe size={16} className="shrink-0 text-cyber-chrome-400" />
                <div>
                  <div className="font-bold text-sm text-cyber-chrome-100">Workspace</div>
                  <div className="text-xs text-cyber-chrome-500 font-mono">All members</div>
                </div>
              </button>
              <button
                type="button"
                onClick={() => setVisibility('private')}
                className={`flex items-center gap-2 border px-3 py-2.5 text-left transition-all ${
                  visibility === 'private'
                    ? 'border-cyber-cyan/40 bg-cyber-cyan/10 shadow-cyber-sm'
                    : 'border-cyber-border hover:bg-cyber-elevated'
                }`}
              >
                <Lock size={16} className="shrink-0 text-cyber-chrome-400" />
                <div>
                  <div className="font-bold text-sm text-cyber-chrome-100">Private</div>
                  <div className="text-xs text-cyber-chrome-500 font-mono">Only you</div>
                </div>
              </button>
            </div>
          </div>

          {models.length > 0 && (
            <div>
              <label className="block text-xs font-display font-bold text-cyber-chrome-400 mb-1.5 tracking-wider">MODEL</label>
              <div className="flex gap-2 flex-wrap">
                {models.map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setModel(m)}
                    className={`px-3 py-1.5 border text-sm font-mono font-bold tracking-wider transition-all ${
                      model === m
                        ? 'border-cyber-cyan/40 bg-cyber-cyan/10 text-cyber-cyan shadow-cyber-sm'
                        : 'border-cyber-border text-cyber-chrome-400 hover:bg-cyber-elevated'
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs font-display font-bold text-cyber-chrome-400 mb-1.5 tracking-wider">WORKING DIRECTORY</label>
            <div className="px-3 py-2 border border-cyber-border bg-cyber-elevated text-sm font-mono text-cyber-chrome-400">
              {workDir}
            </div>
          </div>

          <div className="flex gap-3 pt-3 border-t border-cyber-border">
            <button
              onClick={handleSubmit}
              disabled={!canSubmit}
              className="flex-1 flex items-center justify-center gap-1.5 py-2.5 cyber-btn-green font-display font-bold text-sm tracking-wider disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Plus size={14} /> CREATE & START
            </button>
            <button
              onClick={onClose}
              className="px-5 py-2.5 border border-cyber-border text-sm font-display font-bold text-cyber-chrome-300 hover:bg-cyber-elevated transition-colors tracking-wider"
            >
              CANCEL
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
