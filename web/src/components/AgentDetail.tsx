import { useState, useEffect } from 'react';
import { FileText, FolderOpen, Activity, Settings, Save, Square, Globe, Lock, Zap, File, Folder, ChevronRight, ArrowLeft, RefreshCw } from 'lucide-react';
import type { ServerAgent, Skill } from '../types';
import { useApp } from '../store/AppContext';

type Tab = 'instructions' | 'workspace' | 'activity' | 'settings';

const TAB_CONFIG: { key: Tab; label: string; icon: typeof FileText }[] = [
  { key: 'instructions', label: 'Instructions', icon: FileText },
  { key: 'workspace', label: 'Workspace', icon: FolderOpen },
  { key: 'activity', label: 'Activity', icon: Activity },
  { key: 'settings', label: 'Settings', icon: Settings },
];

const PROVIDER_LABELS: Record<string, string> = {
  hermes: 'Hermes Agent',
  claude: 'Claude Code',
  codex: 'OpenAI Codex',
  opencode: 'OpenCode',
  openclaw: 'OpenClaw',
  kimi: 'Kimi',
};

const activityColors: Record<string, string> = {
  thinking: 'bg-cyber-yellow animate-pulse shadow-neon-yellow',
  working: 'bg-cyber-orange animate-pulse',
  online: 'bg-cyber-green shadow-neon-green',
  offline: 'bg-cyber-chrome-600',
  error: 'bg-cyber-red shadow-neon-red',
};

const activityLabels: Record<string, string> = {
  thinking: 'Thinking',
  working: 'Working',
  online: 'Online',
  offline: 'Offline',
  error: 'Error',
};

const AVAILABLE_SKILLS: Skill[] = [
  { id: 's1', name: 'Code Review', description: 'Reviews code for quality and security issues' },
  { id: 's2', name: 'Bug Triage', description: 'Analyzes and categorizes bug reports' },
  { id: 's3', name: 'E2E Testing', description: 'Writes and runs end-to-end tests' },
  { id: 's4', name: 'Security Audit', description: 'Scans code for security vulnerabilities' },
];

function InstructionsTab({
  agent,
  onUpdate,
}: {
  agent: ServerAgent;
  onUpdate: (updates: Partial<ServerAgent>) => void;
}) {
  const [instructions, setInstructions] = useState(agent.instructions || '');
  const isDirty = instructions !== (agent.instructions || '');

  const assignedSkills = agent.skills || [];
  const assignedIds = new Set(assignedSkills.map((s) => s.id));
  const availableSkills = AVAILABLE_SKILLS.filter((s) => !assignedIds.has(s.id));
  const [showPicker, setShowPicker] = useState(false);

  const handleAddSkill = (skill: Skill) => {
    onUpdate({ skills: [...assignedSkills, { id: skill.id, name: skill.name, description: skill.description }] });
    setShowPicker(false);
  };

  const handleRemoveSkill = (skillId: string) => {
    onUpdate({ skills: assignedSkills.filter((s) => s.id !== skillId) });
  };

  return (
    <div className="flex-1 flex flex-col p-5 overflow-y-auto">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="font-display font-bold text-sm text-cyber-chrome-100 tracking-wider">SYSTEM PROMPT</h3>
          <p className="text-xs text-cyber-chrome-400 mt-0.5 font-mono">Instructions that define agent behavior.</p>
        </div>
        {isDirty && (
          <button
            onClick={() => onUpdate({ instructions })}
            className="flex items-center gap-1 px-3 py-1.5 cyber-btn-primary text-sm font-display font-bold tracking-wider"
          >
            <Save size={12} /> SAVE
          </button>
        )}
      </div>
      <textarea
        value={instructions}
        onChange={(e) => setInstructions(e.target.value)}
        placeholder="Enter agent instructions..."
        className="min-h-[200px] resize-none w-full px-3 py-2 cyber-input text-sm font-mono"
      />

      <div className="flex items-center justify-between mt-6 mb-3">
        <div>
          <h3 className="font-display font-bold text-sm text-cyber-chrome-100 tracking-wider">SKILLS</h3>
          <p className="text-xs text-cyber-chrome-400 mt-0.5 font-mono">Reusable instructions and tooling.</p>
        </div>
        <button
          onClick={() => setShowPicker(!showPicker)}
          className="flex items-center gap-1 px-3 py-1.5 cyber-btn-primary text-sm font-display font-bold tracking-wider"
        >
          <Zap size={12} /> ADD
        </button>
      </div>

      {showPicker && availableSkills.length > 0 && (
        <div className="mb-3 border border-cyber-border bg-cyber-surface shadow-cyber-sm overflow-hidden">
          {availableSkills.map((skill) => (
            <button
              key={skill.id}
              onClick={() => handleAddSkill(skill)}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-cyber-elevated transition-colors border-b border-cyber-border last:border-b-0"
            >
              <div className="w-7 h-7 border border-cyber-yellow/30 bg-cyber-yellow/10 flex items-center justify-center shrink-0">
                <Zap size={12} className="text-cyber-yellow" />
              </div>
              <div className="flex-1 min-w-0">
                <span className="font-bold text-sm text-cyber-chrome-100">{skill.name}</span>
                {skill.description && <p className="text-xs text-cyber-chrome-400 truncate font-mono">{skill.description}</p>}
              </div>
            </button>
          ))}
        </div>
      )}

      {assignedSkills.length > 0 && (
        <div className="space-y-2">
          {assignedSkills.map((skill) => (
            <div key={skill.id} className="flex items-center gap-3 p-3 border border-cyber-border bg-cyber-surface">
              <div className="w-7 h-7 border border-cyber-yellow/30 bg-cyber-yellow/10 flex items-center justify-center shrink-0">
                <Zap size={12} className="text-cyber-yellow" />
              </div>
              <div className="flex-1 min-w-0">
                <span className="font-bold text-sm text-cyber-chrome-100">{skill.name}</span>
                {skill.description && <p className="text-xs text-cyber-chrome-400 font-mono">{skill.description}</p>}
              </div>
              <button
                onClick={() => handleRemoveSkill(skill.id)}
                className="text-cyber-chrome-500 hover:text-cyber-red text-sm transition-colors shrink-0 font-bold"
                title="Remove skill"
              >
                &times;
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function WorkspaceTab({ agent }: { agent: ServerAgent }) {
  const { workspaceFiles, workspaceFileContent, requestWorkspaceFiles, requestFileContent } = useApp();
  const ws = workspaceFiles[agent.id];
  const [viewingFile, setViewingFile] = useState<string | null>(null);

  useEffect(() => {
    if (agent.status === 'active') {
      requestWorkspaceFiles(agent.id);
    }
  }, [agent.id, agent.status, requestWorkspaceFiles]);

  const fileContent = workspaceFileContent?.agentId === agent.id && workspaceFileContent?.path === viewingFile
    ? workspaceFileContent.content
    : null;

  const handleFileClick = (name: string, type: string) => {
    if (type === 'directory') {
      const newPath = ws?.dirPath ? `${ws.dirPath}/${name}` : name;
      requestWorkspaceFiles(agent.id, newPath);
    } else {
      const filePath = ws?.dirPath ? `${ws.dirPath}/${name}` : name;
      setViewingFile(filePath);
      requestFileContent(agent.id, filePath);
    }
  };

  const handleBack = () => {
    if (viewingFile) {
      setViewingFile(null);
      return;
    }
    if (ws?.dirPath) {
      const parent = ws.dirPath.split('/').slice(0, -1).join('/') || undefined;
      requestWorkspaceFiles(agent.id, parent);
    }
  };

  if (agent.status !== 'active') {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center py-12">
        <div className="w-14 h-14 border border-cyber-border bg-cyber-elevated flex items-center justify-center mb-3">
          <FolderOpen size={24} className="text-cyber-chrome-500" />
        </div>
        <p className="text-sm text-cyber-chrome-400 font-mono">Agent is offline</p>
        <p className="text-xs text-cyber-chrome-500 mt-1 font-mono">Start the agent to browse workspace.</p>
      </div>
    );
  }

  if (viewingFile) {
    return (
      <div className="flex-1 flex flex-col p-5 overflow-hidden">
        <div className="flex items-center gap-2 mb-3">
          <button
            onClick={handleBack}
            className="w-7 h-7 border border-cyber-border bg-cyber-surface flex items-center justify-center hover:bg-cyber-elevated hover:text-cyber-cyan transition-colors"
          >
            <ArrowLeft size={14} />
          </button>
          <span className="text-xs font-mono text-cyber-chrome-400 truncate">{viewingFile}</span>
        </div>
        <pre className="flex-1 overflow-auto p-3 border border-cyber-border bg-cyber-void text-xs font-mono text-cyber-green whitespace-pre-wrap shadow-cyber-sm">
          {fileContent ?? 'Loading...'}
        </pre>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col p-5 overflow-y-auto">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          {ws?.dirPath && (
            <button
              onClick={handleBack}
              className="w-7 h-7 border border-cyber-border bg-cyber-surface flex items-center justify-center hover:bg-cyber-elevated hover:text-cyber-cyan transition-colors"
            >
              <ArrowLeft size={14} />
            </button>
          )}
          <h3 className="font-display font-bold text-sm text-cyber-chrome-100 tracking-wider">
            {ws?.dirPath || agent.workDir || 'WORKSPACE'}
          </h3>
        </div>
        <button
          onClick={() => requestWorkspaceFiles(agent.id, ws?.dirPath)}
          className="w-7 h-7 border border-cyber-border bg-cyber-surface flex items-center justify-center hover:bg-cyber-elevated hover:text-cyber-cyan transition-colors"
          title="Refresh"
        >
          <RefreshCw size={12} />
        </button>
      </div>

      {ws?.files && ws.files.length > 0 ? (
        <div className="border border-cyber-border bg-cyber-surface overflow-hidden">
          {ws.files.map((f) => (
            <button
              key={f.name}
              onClick={() => handleFileClick(f.name, f.type)}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-cyber-elevated transition-colors border-b border-cyber-border last:border-b-0"
            >
              {f.type === 'directory'
                ? <Folder size={14} className="flex-shrink-0 text-cyber-yellow" />
                : <File size={14} className="flex-shrink-0 text-cyber-chrome-400" />
              }
              <span className="flex-1 text-sm font-mono text-cyber-chrome-200 truncate">{f.name}</span>
              {f.type === 'directory' && <ChevronRight size={14} className="text-cyber-chrome-500 flex-shrink-0" />}
              {f.size !== undefined && f.type !== 'directory' && (
                <span className="text-2xs text-cyber-chrome-500 flex-shrink-0 font-mono">
                  {f.size < 1024 ? `${f.size}B` : `${(f.size / 1024).toFixed(1)}K`}
                </span>
              )}
            </button>
          ))}
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center text-center py-12">
          <div className="w-14 h-14 border border-cyber-yellow/30 bg-cyber-yellow/10 flex items-center justify-center mb-3">
            <FolderOpen size={24} className="text-cyber-yellow" />
          </div>
          <p className="text-sm text-cyber-chrome-400 font-mono">No files yet</p>
          <p className="text-xs text-cyber-chrome-500 mt-1 font-mono">Files appear when the agent creates them.</p>
        </div>
      )}
    </div>
  );
}

function ActivityTab({ agent }: { agent: ServerAgent }) {
  return (
    <div className="flex-1 flex flex-col p-5 overflow-y-auto">
      <div className="mb-4">
        <h3 className="font-display font-bold text-sm text-cyber-chrome-100 tracking-wider">ACTIVITY LOG</h3>
        <p className="text-xs text-cyber-chrome-400 mt-0.5 font-mono">Real-time activity stream.</p>
      </div>

      {agent.entries && agent.entries.length > 0 ? (
        <div className="space-y-1">
          {agent.entries.map((entry, i) => (
            <div
              key={i}
              className={`text-xs font-mono px-3 py-1.5 border border-cyber-border ${
                entry.kind === 'status'
                  ? 'bg-cyber-cyan/5 text-cyber-cyan'
                  : entry.kind === 'thinking'
                    ? 'bg-cyber-yellow/5 text-cyber-yellow'
                    : entry.kind === 'tool_start'
                      ? 'bg-cyber-green/5 text-cyber-green'
                      : 'bg-cyber-elevated text-cyber-chrome-300'
              }`}
            >
              {entry.kind === 'text' && <span>{entry.text}</span>}
              {entry.kind === 'status' && (
                <span className="flex items-center gap-1.5">
                  <span className={`w-1.5 h-1.5 rounded-full ${activityColors[entry.activity || 'offline']}`} />
                  [{entry.activity}] {entry.detail || ''}
                </span>
              )}
              {entry.kind === 'thinking' && <span>Thinking: {entry.text || ''}</span>}
              {entry.kind === 'tool_start' && <span>Tool: {entry.toolName}</span>}
            </div>
          ))}
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center text-center py-12">
          <div className="w-14 h-14 border border-cyber-green/30 bg-cyber-green/10 flex items-center justify-center mb-3">
            <Activity size={24} className="text-cyber-green" />
          </div>
          <p className="text-sm text-cyber-chrome-400 font-mono">No activity yet.</p>
          <p className="text-xs text-cyber-chrome-500 mt-1 font-mono">Activity appears when the agent starts working.</p>
        </div>
      )}
    </div>
  );
}

function SettingsTab({
  agent,
  onUpdate,
  onStop,
}: {
  agent: ServerAgent;
  onUpdate: (updates: Partial<ServerAgent>) => void;
  onStop: () => void;
}) {
  const [displayName, setDisplayName] = useState(agent.displayName || agent.name);
  const [description, setDescription] = useState(agent.description || '');
  const [visibility, setVisibility] = useState<'workspace' | 'private'>(agent.visibility || 'workspace');
  const [maxConcurrent, setMaxConcurrent] = useState(agent.maxConcurrentTasks ?? 6);

  const isDirty =
    displayName !== (agent.displayName || agent.name) ||
    description !== (agent.description || '') ||
    visibility !== (agent.visibility || 'workspace') ||
    maxConcurrent !== (agent.maxConcurrentTasks ?? 6);

  return (
    <div className="flex-1 flex flex-col p-5 overflow-y-auto">
      <div className="max-w-lg space-y-5">
        <div>
          <label className="block text-xs font-display font-bold text-cyber-chrome-400 mb-1.5 tracking-wider">DISPLAY NAME</label>
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="w-full px-3 py-2 cyber-input text-sm"
          />
        </div>

        <div>
          <label className="block text-xs font-display font-bold text-cyber-chrome-400 mb-1.5 tracking-wider">DESCRIPTION</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full px-3 py-2 cyber-input text-sm resize-none"
            rows={2}
            placeholder="What does this agent do?"
          />
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

        <div>
          <label className="block text-xs font-display font-bold text-cyber-chrome-400 mb-1.5 tracking-wider">
            MAX CONCURRENT TASKS: <span className="text-cyber-cyan">{maxConcurrent}</span>
          </label>
          <input
            type="range"
            min={1}
            max={20}
            value={maxConcurrent}
            onChange={(e) => setMaxConcurrent(Number(e.target.value))}
            className="w-full accent-cyber-cyan"
          />
          <div className="flex justify-between text-xs text-cyber-chrome-500 mt-1 font-mono">
            <span>1</span>
            <span>20</span>
          </div>
        </div>

        <div>
          <label className="block text-xs font-display font-bold text-cyber-chrome-400 mb-1.5 tracking-wider">RUNTIME</label>
          <div className="flex items-center gap-2 p-3 border border-cyber-border bg-cyber-elevated">
            <span className="font-bold text-sm text-cyber-chrome-100 font-mono">
              {PROVIDER_LABELS[agent.runtime || ''] || agent.runtime || 'Unknown'}
            </span>
            <span className="text-xs text-cyber-chrome-500 font-mono">/ {agent.model || '\u2014'}</span>
          </div>
        </div>

        <div>
          <label className="block text-xs font-display font-bold text-cyber-chrome-400 mb-1.5 tracking-wider">CHANNEL ACCESS</label>
          {agent.channels && agent.channels.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {agent.channels.map((ch) => (
                <span
                  key={ch}
                  className="px-2.5 py-1 border border-cyber-border bg-cyber-elevated text-xs font-mono text-cyber-chrome-200"
                >
                  #{ch}
                </span>
              ))}
            </div>
          ) : (
            <div className="p-3 border border-cyber-border bg-cyber-elevated text-xs text-cyber-chrome-500 font-mono">
              All channels
            </div>
          )}
        </div>

        {agent.workDir && (
          <div>
            <label className="block text-xs font-display font-bold text-cyber-chrome-400 mb-1.5 tracking-wider">WORKING DIRECTORY</label>
            <div className="p-3 border border-cyber-border bg-cyber-elevated text-xs font-mono text-cyber-chrome-200">
              {agent.workDir}
            </div>
          </div>
        )}

        <div className="flex items-center gap-3 pt-3 border-t border-cyber-border">
          {isDirty && (
            <button
              onClick={() => onUpdate({ displayName, description, visibility, maxConcurrentTasks: maxConcurrent })}
              className="flex items-center gap-1 px-4 py-2 cyber-btn-primary text-sm font-display font-bold tracking-wider"
            >
              <Save size={12} /> SAVE
            </button>
          )}
          {agent.status === 'active' && (
            <button
              onClick={onStop}
              className="flex items-center gap-1 px-4 py-2 cyber-btn-danger text-sm font-display font-bold tracking-wider ml-auto"
            >
              <Square size={12} /> STOP
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function AgentDetail({
  agent,
  onUpdate,
  onStop,
}: {
  agent: ServerAgent;
  onUpdate: (updates: Partial<ServerAgent>) => void;
  onStop: () => void;
}) {
  const [tab, setTab] = useState<Tab>('instructions');
  const activity = agent.activity || 'offline';
  const isActive = agent.status === 'active';

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-cyber-surface">
      <div className="flex items-center gap-4 px-5 py-4 border-b border-cyber-border">
        <div className="w-10 h-10 border border-cyber-cyan/30 bg-cyber-cyan/10 flex items-center justify-center shrink-0 font-display font-bold text-sm text-cyber-cyan">
          {(agent.displayName || agent.name).charAt(0).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="font-display font-bold text-lg text-cyber-chrome-50 truncate tracking-wide">
              @{agent.displayName || agent.name}
            </h2>
            <span className={`w-2.5 h-2.5 rounded-full ${activityColors[activity]}`} />
            <span className="text-xs text-cyber-chrome-400 font-mono">{isActive ? activityLabels[activity] : 'Inactive'}</span>
          </div>
          {agent.description && (
            <p className="text-xs text-cyber-chrome-400 truncate mt-0.5 font-mono">{agent.description}</p>
          )}
        </div>
        <div className="text-xs text-cyber-chrome-500 shrink-0 font-mono">
          {PROVIDER_LABELS[agent.runtime || ''] || agent.runtime} / {agent.model || '\u2014'}
        </div>
      </div>

      <div className="flex border-b border-cyber-border px-5">
        {TAB_CONFIG.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-bold border-b-2 -mb-px transition-colors font-display tracking-wider ${
              tab === key
                ? 'border-cyber-cyan text-cyber-cyan'
                : 'border-transparent text-cyber-chrome-500 hover:text-cyber-chrome-200'
            }`}
          >
            <Icon size={14} />
            {label}
          </button>
        ))}
      </div>

      <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
        {tab === 'instructions' && <InstructionsTab agent={agent} onUpdate={onUpdate} />}
        {tab === 'workspace' && <WorkspaceTab agent={agent} />}
        {tab === 'activity' && <ActivityTab agent={agent} />}
        {tab === 'settings' && <SettingsTab agent={agent} onUpdate={onUpdate} onStop={onStop} />}
      </div>
    </div>
  );
}
