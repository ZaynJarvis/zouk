import { useState, useEffect } from 'react';
import { FileText, FolderOpen, Activity, Settings, Save, Square, Globe, Lock, Zap, File, Folder, ChevronRight, ArrowLeft, RefreshCw } from 'lucide-react';
import type { ServerAgent, Skill } from '../types';
import { useApp } from '../store/AppContext';
import ScanlineTear from './glitch/ScanlineTear';

type Tab = 'instructions' | 'workspace' | 'activity' | 'settings';

const TAB_CONFIG: { key: Tab; label: string; icon: typeof FileText }[] = [
  { key: 'instructions', label: 'INSTR', icon: FileText },
  { key: 'workspace', label: 'FILES', icon: FolderOpen },
  { key: 'activity', label: 'ACTIVITY', icon: Activity },
  { key: 'settings', label: 'CONFIG', icon: Settings },
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
  thinking: 'bg-nc-yellow animate-pulse',
  working: 'bg-nc-red animate-pulse',
  online: 'bg-nc-green',
  offline: 'bg-nc-muted/30',
  error: 'bg-nc-red',
};

const activityLabels: Record<string, string> = {
  thinking: 'THINKING',
  working: 'WORKING',
  online: 'ONLINE',
  offline: 'OFFLINE',
  error: 'ERROR',
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
    <div className="flex-1 flex flex-col p-5 overflow-y-auto scrollbar-thin">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="font-display font-bold text-sm text-nc-text-bright tracking-wider">SYSTEM_PROMPT</h3>
          <p className="text-xs text-nc-muted mt-0.5 font-mono">Instructions that define how this agent behaves.</p>
        </div>
        {isDirty && (
          <ScanlineTear config={{ trigger: 'hover', minInterval: 200, maxInterval: 600, minSeverity: 0.3, maxSeverity: 0.8 }}>
            <button
              onClick={() => onUpdate({ instructions })}
              className="cyber-btn flex items-center gap-1 px-3 py-1.5 border border-nc-cyan bg-nc-cyan/10 text-sm font-bold text-nc-cyan hover:bg-nc-cyan/20 hover:shadow-nc-cyan font-mono"
            >
              <Save size={12} /> SAVE
            </button>
          </ScanlineTear>
        )}
      </div>
      <textarea
        value={instructions}
        onChange={(e) => setInstructions(e.target.value)}
        placeholder="Enter agent instructions..."
        className="min-h-[200px] resize-none w-full px-3 py-2 border border-nc-border bg-nc-panel text-sm font-mono text-nc-text placeholder:text-nc-muted focus:outline-none focus:border-nc-cyan focus:shadow-nc-cyan transition-all"
      />

      <div className="flex items-center justify-between mt-6 mb-3">
        <div>
          <h3 className="font-display font-bold text-sm text-nc-text-bright tracking-wider">SKILLS</h3>
          <p className="text-xs text-nc-muted mt-0.5 font-mono">Reusable instructions and tooling for this agent.</p>
        </div>
        <ScanlineTear config={{ trigger: 'hover', minInterval: 200, maxInterval: 600, minSeverity: 0.3, maxSeverity: 0.8 }}>
          <button
            onClick={() => setShowPicker(!showPicker)}
            className="cyber-btn flex items-center gap-1 px-3 py-1.5 border border-nc-yellow bg-nc-yellow/10 text-sm font-bold text-nc-yellow hover:bg-nc-yellow/20 hover:shadow-nc-yellow font-mono"
          >
            <Zap size={12} /> ADD_SKILL
          </button>
        </ScanlineTear>
      </div>

      {showPicker && availableSkills.length > 0 && (
        <div className="mb-3 border border-nc-border bg-nc-panel overflow-hidden">
          {availableSkills.map((skill) => (
            <button
              key={skill.id}
              onClick={() => handleAddSkill(skill)}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-nc-elevated transition-colors border-b border-nc-border last:border-b-0"
            >
              <div className="w-7 h-7 border border-nc-yellow/30 bg-nc-yellow/10 flex items-center justify-center shrink-0">
                <Zap size={12} className="text-nc-yellow" />
              </div>
              <div className="flex-1 min-w-0">
                <span className="font-bold text-sm text-nc-text-bright">{skill.name}</span>
                {skill.description && <p className="text-xs text-nc-muted truncate font-mono">{skill.description}</p>}
              </div>
            </button>
          ))}
        </div>
      )}

      {assignedSkills.length > 0 && (
        <div className="space-y-2">
          {assignedSkills.map((skill) => (
            <div key={skill.id} className="flex items-center gap-3 p-3 border border-nc-border bg-nc-panel">
              <div className="w-7 h-7 border border-nc-yellow/30 bg-nc-yellow/10 flex items-center justify-center shrink-0">
                <Zap size={12} className="text-nc-yellow" />
              </div>
              <div className="flex-1 min-w-0">
                <span className="font-bold text-sm text-nc-text-bright">{skill.name}</span>
                {skill.description && <p className="text-xs text-nc-muted font-mono">{skill.description}</p>}
              </div>
              <button
                onClick={() => handleRemoveSkill(skill.id)}
                className="text-nc-muted hover:text-nc-red text-sm transition-colors shrink-0 font-bold"
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
        <div className="w-14 h-14 border border-nc-muted/30 bg-nc-elevated flex items-center justify-center mb-3">
          <FolderOpen size={24} className="text-nc-muted" />
        </div>
        <p className="text-sm text-nc-muted font-bold font-mono">AGENT_OFFLINE</p>
        <p className="text-xs text-nc-muted mt-1 font-mono">Start the agent to browse its workspace.</p>
      </div>
    );
  }

  if (viewingFile) {
    return (
      <div className="flex-1 flex flex-col p-5 overflow-hidden">
        <div className="flex items-center gap-2 mb-3">
          <button
            onClick={handleBack}
            className="cyber-btn w-7 h-7 border border-nc-border bg-nc-panel flex items-center justify-center hover:bg-nc-elevated hover:border-nc-cyan text-nc-muted hover:text-nc-cyan"
          >
            <ArrowLeft size={14} />
          </button>
          <span className="text-xs font-mono text-nc-muted truncate">{viewingFile}</span>
        </div>
        <pre className="flex-1 overflow-auto p-3 border border-nc-border bg-nc-black text-xs font-mono text-nc-green whitespace-pre-wrap scrollbar-thin" style={{ textShadow: '0 0 4px rgb(var(--nc-green) / 0.3)' }}>
          {fileContent ?? 'Loading...'}
        </pre>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col p-5 overflow-y-auto scrollbar-thin">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          {ws?.dirPath && (
            <button
              onClick={handleBack}
              className="cyber-btn w-7 h-7 border border-nc-border bg-nc-panel flex items-center justify-center hover:bg-nc-elevated hover:border-nc-cyan text-nc-muted hover:text-nc-cyan"
            >
              <ArrowLeft size={14} />
            </button>
          )}
          <h3 className="font-display font-bold text-sm text-nc-text-bright tracking-wider">
            {ws?.dirPath || agent.workDir || 'WORKSPACE'}
          </h3>
        </div>
        <button
          onClick={() => requestWorkspaceFiles(agent.id, ws?.dirPath)}
          className="cyber-btn w-7 h-7 border border-nc-border bg-nc-panel flex items-center justify-center hover:bg-nc-elevated hover:border-nc-cyan text-nc-muted hover:text-nc-cyan"
          title="Refresh"
        >
          <RefreshCw size={12} />
        </button>
      </div>

      {ws?.files && ws.files.length > 0 ? (
        <div className="border border-nc-border bg-nc-panel overflow-hidden">
          {ws.files.map((f) => (
            <button
              key={f.name}
              onClick={() => handleFileClick(f.name, f.type)}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-nc-elevated transition-colors border-b border-nc-border last:border-b-0"
            >
              {f.type === 'directory'
                ? <Folder size={14} className="flex-shrink-0 text-nc-yellow" />
                : <File size={14} className="flex-shrink-0 text-nc-muted" />
              }
              <span className="flex-1 text-sm font-mono text-nc-text-bright truncate">{f.name}</span>
              {f.type === 'directory' && <ChevronRight size={14} className="text-nc-muted flex-shrink-0" />}
              {f.size !== undefined && f.type !== 'directory' && (
                <span className="text-2xs text-nc-muted flex-shrink-0 font-mono">
                  {f.size < 1024 ? `${f.size}B` : `${(f.size / 1024).toFixed(1)}K`}
                </span>
              )}
            </button>
          ))}
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center text-center py-12">
          <div className="w-14 h-14 border border-nc-yellow/30 bg-nc-yellow/10 flex items-center justify-center mb-3">
            <FolderOpen size={24} className="text-nc-yellow" />
          </div>
          <p className="text-sm text-nc-muted font-bold font-mono">NO_FILES</p>
          <p className="text-xs text-nc-muted mt-1 font-mono">Files will appear here when the agent creates them.</p>
        </div>
      )}
    </div>
  );
}

function ActivityTab({ agent }: { agent: ServerAgent }) {
  return (
    <div className="flex-1 flex flex-col p-5 overflow-y-auto scrollbar-thin">
      <div className="mb-4">
        <h3 className="font-display font-bold text-sm text-nc-text-bright tracking-wider">ACTIVITY_LOG</h3>
        <p className="text-xs text-nc-muted mt-0.5 font-mono">Real-time activity from this agent.</p>
      </div>

      {agent.entries && agent.entries.length > 0 ? (
        <div className="space-y-1">
          {agent.entries.map((entry, i) => (
            <div
              key={i}
              className={`text-xs font-mono px-3 py-1.5 border border-nc-border ${
                entry.kind === 'status'
                  ? 'bg-nc-cyan/5 text-nc-cyan border-nc-cyan/20'
                  : entry.kind === 'thinking'
                    ? 'bg-nc-yellow/5 text-nc-yellow border-nc-yellow/20'
                    : entry.kind === 'tool_start'
                      ? 'bg-nc-green/5 text-nc-green border-nc-green/20'
                      : 'bg-nc-elevated text-nc-muted'
              }`}
            >
              {entry.kind === 'text' && <span>{entry.text}</span>}
              {entry.kind === 'status' && (
                <span className="flex items-center gap-1.5">
                  <span className={`w-1.5 h-1.5 ${activityColors[entry.activity || 'offline']}`} />
                  [{entry.activity}] {entry.detail || ''}
                </span>
              )}
              {entry.kind === 'thinking' && <span>THINKING: {entry.text || ''}</span>}
              {entry.kind === 'tool_start' && <span>TOOL: {entry.toolName}</span>}
            </div>
          ))}
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center text-center py-12">
          <div className="w-14 h-14 border border-nc-green/30 bg-nc-green/10 flex items-center justify-center mb-3">
            <Activity size={24} className="text-nc-green" />
          </div>
          <p className="text-sm text-nc-muted font-bold font-mono">NO_ACTIVITY</p>
          <p className="text-xs text-nc-muted mt-1 font-mono">Activity will appear here when the agent starts working.</p>
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
    <div className="flex-1 flex flex-col p-5 overflow-y-auto scrollbar-thin">
      <div className="max-w-lg space-y-5">
        <div>
          <label className="block text-xs font-bold text-nc-muted mb-1.5 font-mono tracking-wider">DISPLAY_NAME</label>
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="w-full px-3 py-2 border border-nc-border bg-nc-panel text-sm text-nc-text-bright font-mono focus:outline-none focus:border-nc-cyan focus:shadow-nc-cyan transition-all"
          />
        </div>

        <div>
          <label className="block text-xs font-bold text-nc-muted mb-1.5 font-mono tracking-wider">DESCRIPTION</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full px-3 py-2 border border-nc-border bg-nc-panel text-sm text-nc-text-bright font-mono resize-none focus:outline-none focus:border-nc-cyan focus:shadow-nc-cyan transition-all"
            rows={2}
            placeholder="What does this agent do?"
          />
        </div>

        <div>
          <label className="block text-xs font-bold text-nc-muted mb-1.5 font-mono tracking-wider">VISIBILITY</label>
          <div className="grid grid-cols-2 gap-3">
            <ScanlineTear config={{ trigger: 'hover', minInterval: 200, maxInterval: 600, minSeverity: 0.3, maxSeverity: 0.8 }}>
              <button
                type="button"
                onClick={() => setVisibility('workspace')}
                className={`cyber-btn flex items-center gap-2 border px-3 py-2.5 text-left ${
                  visibility === 'workspace'
                    ? 'border-nc-cyan bg-nc-cyan/10 shadow-nc-cyan'
                    : 'border-nc-border hover:bg-nc-elevated'
                }`}
              >
                <Globe size={16} className="shrink-0 text-nc-cyan" />
                <div>
                  <div className="font-bold text-sm text-nc-text-bright">Workspace</div>
                  <div className="text-xs text-nc-muted font-mono">All members</div>
                </div>
              </button>
            </ScanlineTear>
            <ScanlineTear config={{ trigger: 'hover', minInterval: 200, maxInterval: 600, minSeverity: 0.3, maxSeverity: 0.8 }}>
              <button
                type="button"
                onClick={() => setVisibility('private')}
                className={`cyber-btn flex items-center gap-2 border px-3 py-2.5 text-left ${
                  visibility === 'private'
                    ? 'border-nc-cyan bg-nc-cyan/10 shadow-nc-cyan'
                    : 'border-nc-border hover:bg-nc-elevated'
                }`}
              >
                <Lock size={16} className="shrink-0 text-nc-red" />
                <div>
                  <div className="font-bold text-sm text-nc-text-bright">Private</div>
                  <div className="text-xs text-nc-muted font-mono">Only you</div>
                </div>
              </button>
            </ScanlineTear>
          </div>
        </div>

        <div>
          <label className="block text-xs font-bold text-nc-muted mb-1.5 font-mono tracking-wider">
            MAX_CONCURRENT_TASKS: <span className="text-nc-cyan">{maxConcurrent}</span>
          </label>
          <input
            type="range"
            min={1}
            max={20}
            value={maxConcurrent}
            onChange={(e) => setMaxConcurrent(Number(e.target.value))}
            className="w-full accent-nc-cyan"
          />
          <div className="flex justify-between text-xs text-nc-muted mt-1 font-mono">
            <span>1</span>
            <span>20</span>
          </div>
        </div>

        <div>
          <label className="block text-xs font-bold text-nc-muted mb-1.5 font-mono tracking-wider">RUNTIME</label>
          <div className="flex items-center gap-2 p-3 border border-nc-border bg-nc-elevated">
            <span className="font-bold text-sm text-nc-text-bright font-mono">
              {PROVIDER_LABELS[agent.runtime || ''] || agent.runtime || 'Unknown'}
            </span>
            <span className="text-xs text-nc-muted font-mono">/ {agent.model || '\u2014'}</span>
          </div>
        </div>

        <div>
          <label className="block text-xs font-bold text-nc-muted mb-1.5 font-mono tracking-wider">CHANNEL_ACCESS</label>
          {agent.channels && agent.channels.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {agent.channels.map((ch) => (
                <span
                  key={ch}
                  className="px-2.5 py-1 border border-nc-cyan/30 bg-nc-cyan/10 text-xs font-bold text-nc-cyan font-mono"
                >
                  #{ch}
                </span>
              ))}
            </div>
          ) : (
            <div className="p-3 border border-nc-border bg-nc-elevated text-xs text-nc-muted font-mono">
              ALL_CHANNELS
            </div>
          )}
        </div>

        {agent.workDir && (
          <div>
            <label className="block text-xs font-bold text-nc-muted mb-1.5 font-mono tracking-wider">WORK_DIR</label>
            <div className="p-3 border border-nc-border bg-nc-elevated text-xs font-mono text-nc-green" style={{ textShadow: '0 0 4px rgb(var(--nc-green) / 0.3)' }}>
              {agent.workDir}
            </div>
          </div>
        )}

        <div className="flex items-center gap-3 pt-3 border-t border-nc-border">
          {isDirty && (
            <ScanlineTear config={{ trigger: 'hover', minInterval: 200, maxInterval: 600, minSeverity: 0.3, maxSeverity: 0.8 }}>
              <button
                onClick={() => onUpdate({ displayName, description, visibility, maxConcurrentTasks: maxConcurrent })}
                className="cyber-btn flex items-center gap-1 px-4 py-2 border border-nc-cyan bg-nc-cyan/10 text-sm font-bold text-nc-cyan hover:bg-nc-cyan/20 hover:shadow-nc-cyan font-mono"
              >
                <Save size={12} /> SAVE
              </button>
            </ScanlineTear>
          )}
          {agent.status === 'active' && (
            <ScanlineTear className="ml-auto" config={{ trigger: 'hover', minInterval: 200, maxInterval: 600, minSeverity: 0.3, maxSeverity: 0.8 }}>
              <button
                onClick={onStop}
                className="cyber-btn flex items-center gap-1 px-4 py-2 border border-nc-red bg-nc-red/10 text-sm font-bold text-nc-red hover:bg-nc-red/20 hover:shadow-nc-red font-mono"
              >
                <Square size={12} /> STOP_AGENT
              </button>
            </ScanlineTear>
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
  onBack,
}: {
  agent: ServerAgent;
  onUpdate: (updates: Partial<ServerAgent>) => void;
  onStop: () => void;
  onBack?: () => void;
}) {
  const [tab, setTab] = useState<Tab>('instructions');
  const activity = agent.activity || 'offline';
  const isActive = agent.status === 'active';

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-nc-surface">
      <div className="flex items-center gap-3 sm:gap-4 px-3 sm:px-5 py-4 border-b border-nc-border">
        {onBack && (
          <button
            onClick={onBack}
            className="cyber-btn lg:hidden w-8 h-8 border border-nc-border flex items-center justify-center text-nc-muted hover:bg-nc-elevated hover:text-nc-cyan transition-colors shrink-0"
          >
            <ArrowLeft size={14} />
          </button>
        )}
        <div className="w-10 h-10 border border-nc-cyan/30 bg-nc-cyan/10 flex items-center justify-center shrink-0 font-display font-bold text-sm text-nc-cyan">
          {(agent.displayName || agent.name).charAt(0).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="font-display font-black text-lg text-nc-text-bright truncate tracking-wider">
              @{agent.displayName || agent.name}
            </h2>
            <span className={`w-2.5 h-2.5 ${activityColors[activity]}`} />
            <span className="text-xs text-nc-muted font-mono hidden sm:inline">{isActive ? activityLabels[activity] : 'INACTIVE'}</span>
          </div>
          {agent.description && (
            <p className="text-xs text-nc-muted truncate mt-0.5 font-mono">{agent.description}</p>
          )}
        </div>
        <div className="text-xs text-nc-muted shrink-0 font-mono hidden sm:block">
          {PROVIDER_LABELS[agent.runtime || ''] || agent.runtime} · {agent.model || '\u2014'}
        </div>
      </div>

      <div className="flex border-b border-nc-border px-2 sm:px-5">
        {TAB_CONFIG.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex items-center gap-1.5 px-2 sm:px-4 py-2.5 text-sm font-bold font-mono border-b-2 -mb-[1px] transition-colors tracking-wider ${
              tab === key
                ? 'border-nc-cyan text-nc-cyan'
                : 'border-transparent text-nc-muted hover:text-nc-text-bright'
            }`}
          >
            <Icon size={14} />
            <span className="hidden sm:inline">{label}</span>
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
