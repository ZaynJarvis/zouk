import { useState } from 'react';
import { FileText, Zap, CheckSquare, Settings, Save, Square, Globe, Lock } from 'lucide-react';
import type { ServerAgent, Skill } from '../types';

type Tab = 'instructions' | 'skills' | 'tasks' | 'settings';

const TAB_CONFIG: { key: Tab; label: string; icon: typeof FileText }[] = [
  { key: 'instructions', label: 'Instructions', icon: FileText },
  { key: 'skills', label: 'Skills', icon: Zap },
  { key: 'tasks', label: 'Tasks', icon: CheckSquare },
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

const AVAILABLE_SKILLS: Skill[] = [
  { id: 's1', name: 'Code Review', description: 'Reviews code for quality and security issues' },
  { id: 's2', name: 'Bug Triage', description: 'Analyzes and categorizes bug reports' },
  { id: 's3', name: 'E2E Testing', description: 'Writes and runs end-to-end tests' },
  { id: 's4', name: 'Security Audit', description: 'Scans code for security vulnerabilities' },
];

/* ── Instructions Tab ── */
function InstructionsTab({
  agent,
  onUpdate,
}: {
  agent: ServerAgent;
  onUpdate: (updates: Partial<ServerAgent>) => void;
}) {
  const [instructions, setInstructions] = useState(agent.instructions || '');
  const isDirty = instructions !== (agent.instructions || '');

  return (
    <div className="flex-1 flex flex-col p-5 overflow-y-auto">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="font-display font-bold text-sm text-nb-black dark:text-dark-text">System Prompt</h3>
          <p className="text-xs text-nb-gray-500 dark:text-dark-muted mt-0.5">Instructions that define how this agent behaves.</p>
        </div>
        {isDirty && (
          <button
            onClick={() => onUpdate({ instructions })}
            className="flex items-center gap-1 px-3 py-1.5 border-2 border-nb-black text-sm font-bold bg-nb-blue text-nb-white shadow-nb-sm hover:shadow-nb active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all"
          >
            <Save size={12} /> Save
          </button>
        )}
      </div>
      <textarea
        value={instructions}
        onChange={(e) => setInstructions(e.target.value)}
        placeholder="Enter agent instructions... e.g. 'You are a deep researcher and security auditor. Focus on thorough analysis and clear explanations.'"
        className="flex-1 min-h-[300px] resize-none w-full px-3 py-2 border-2 border-nb-black dark:border-dark-border bg-nb-white dark:bg-dark-surface text-sm font-mono text-nb-black dark:text-dark-text placeholder:text-nb-gray-400"
      />
    </div>
  );
}

/* ── Skills Tab ── */
function SkillsTab({
  agent,
  onUpdate,
}: {
  agent: ServerAgent;
  onUpdate: (updates: Partial<ServerAgent>) => void;
}) {
  const assignedSkills = agent.skills || [];
  const assignedIds = new Set(assignedSkills.map((s) => s.id));
  const availableSkills = AVAILABLE_SKILLS.filter((s) => !assignedIds.has(s.id));
  const [showPicker, setShowPicker] = useState(false);

  const handleAdd = (skill: Skill) => {
    onUpdate({ skills: [...assignedSkills, { id: skill.id, name: skill.name, description: skill.description }] });
    setShowPicker(false);
  };

  const handleRemove = (skillId: string) => {
    onUpdate({ skills: assignedSkills.filter((s) => s.id !== skillId) });
  };

  return (
    <div className="flex-1 flex flex-col p-5 overflow-y-auto">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="font-display font-bold text-sm text-nb-black dark:text-dark-text">Assigned Skills</h3>
          <p className="text-xs text-nb-gray-500 dark:text-dark-muted mt-0.5">Skills define reusable instructions and tooling for this agent.</p>
        </div>
        <button
          onClick={() => setShowPicker(!showPicker)}
          className="flex items-center gap-1 px-3 py-1.5 border-2 border-nb-black text-sm font-bold bg-nb-blue text-nb-white shadow-nb-sm hover:shadow-nb active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all"
        >
          <Zap size={12} /> Add Skill
        </button>
      </div>

      {showPicker && availableSkills.length > 0 && (
        <div className="mb-4 border-2 border-nb-black dark:border-dark-border bg-nb-white dark:bg-dark-surface shadow-nb-sm overflow-hidden">
          {availableSkills.map((skill) => (
            <button
              key={skill.id}
              onClick={() => handleAdd(skill)}
              className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-nb-gray-50 dark:hover:bg-dark-elevated transition-colors border-b border-nb-gray-200 dark:border-dark-border last:border-b-0"
            >
              <div className="w-8 h-8 border-2 border-nb-black dark:border-dark-border bg-nb-yellow-light dark:bg-dark-elevated flex items-center justify-center shrink-0">
                <Zap size={14} />
              </div>
              <div className="flex-1 min-w-0">
                <span className="font-bold text-sm text-nb-black dark:text-dark-text">{skill.name}</span>
                {skill.description && <p className="text-xs text-nb-gray-500 dark:text-dark-muted truncate">{skill.description}</p>}
              </div>
            </button>
          ))}
        </div>
      )}

      {assignedSkills.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center py-12">
          <div className="w-14 h-14 border-3 border-nb-black dark:border-dark-border bg-nb-yellow-light dark:bg-dark-elevated flex items-center justify-center mb-3 shadow-nb-sm">
            <Zap size={24} className="text-nb-orange" />
          </div>
          <p className="text-sm text-nb-gray-500 dark:text-dark-muted font-bold">No skills assigned yet.</p>
          <p className="text-xs text-nb-gray-400 dark:text-dark-muted mt-1">Add skills to give this agent specialized capabilities.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {assignedSkills.map((skill) => (
            <div key={skill.id} className="flex items-center gap-3 p-3 border-2 border-nb-gray-200 dark:border-dark-border bg-nb-white dark:bg-dark-surface">
              <div className="w-8 h-8 border-2 border-nb-black dark:border-dark-border bg-nb-yellow-light dark:bg-dark-elevated flex items-center justify-center shrink-0">
                <Zap size={14} />
              </div>
              <div className="flex-1 min-w-0">
                <span className="font-bold text-sm text-nb-black dark:text-dark-text">{skill.name}</span>
                {skill.description && <p className="text-xs text-nb-gray-500 dark:text-dark-muted">{skill.description}</p>}
              </div>
              <button
                onClick={() => handleRemove(skill.id)}
                className="text-nb-gray-400 hover:text-nb-red text-sm transition-colors shrink-0 font-bold"
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

/* ── Tasks Tab ── */
function TasksTab({ agent }: { agent: ServerAgent }) {
  return (
    <div className="flex-1 flex flex-col p-5 overflow-y-auto">
      <div className="mb-4">
        <h3 className="font-display font-bold text-sm text-nb-black dark:text-dark-text">Task History</h3>
        <p className="text-xs text-nb-gray-500 dark:text-dark-muted mt-0.5">Tasks assigned to and completed by this agent.</p>
      </div>

      {agent.entries && agent.entries.length > 0 ? (
        <div className="space-y-1">
          {agent.entries.map((entry, i) => (
            <div key={i} className="text-xs text-nb-gray-600 dark:text-dark-muted font-mono px-3 py-1.5 border border-nb-gray-200 dark:border-dark-border bg-nb-gray-50 dark:bg-dark-elevated">
              {entry.kind === 'text' && entry.text}
              {entry.kind === 'status' && <span>[{entry.activity}] {entry.detail || ''}</span>}
              {entry.kind === 'thinking' && <span className="text-nb-orange">Thinking: {entry.text || ''}</span>}
              {entry.kind === 'tool_start' && <span className="text-nb-blue">Tool: {entry.toolName}</span>}
            </div>
          ))}
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center text-center py-12">
          <div className="w-14 h-14 border-3 border-nb-black dark:border-dark-border bg-nb-green-light dark:bg-dark-elevated flex items-center justify-center mb-3 shadow-nb-sm">
            <CheckSquare size={24} className="text-nb-green" />
          </div>
          <p className="text-sm text-nb-gray-500 dark:text-dark-muted font-bold">No task history yet.</p>
          <p className="text-xs text-nb-gray-400 dark:text-dark-muted mt-1">Tasks will appear here when the agent starts working.</p>
        </div>
      )}
    </div>
  );
}

/* ── Settings Tab ── */
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
          <label className="block text-xs font-bold text-nb-gray-600 dark:text-dark-muted mb-1.5">Display Name</label>
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="w-full px-3 py-2 border-2 border-nb-black dark:border-dark-border bg-nb-white dark:bg-dark-surface text-sm text-nb-black dark:text-dark-text"
          />
        </div>

        <div>
          <label className="block text-xs font-bold text-nb-gray-600 dark:text-dark-muted mb-1.5">Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full px-3 py-2 border-2 border-nb-black dark:border-dark-border bg-nb-white dark:bg-dark-surface text-sm text-nb-black dark:text-dark-text resize-none"
            rows={2}
            placeholder="What does this agent do?"
          />
        </div>

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
                <div className="text-xs text-nb-gray-400 dark:text-dark-muted">All members</div>
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
                <div className="text-xs text-nb-gray-400 dark:text-dark-muted">Only you</div>
              </div>
            </button>
          </div>
        </div>

        <div>
          <label className="block text-xs font-bold text-nb-gray-600 dark:text-dark-muted mb-1.5">
            Max Concurrent Tasks: <span className="text-nb-black dark:text-dark-text">{maxConcurrent}</span>
          </label>
          <input
            type="range"
            min={1}
            max={20}
            value={maxConcurrent}
            onChange={(e) => setMaxConcurrent(Number(e.target.value))}
            className="w-full accent-nb-blue"
          />
          <div className="flex justify-between text-xs text-nb-gray-400 dark:text-dark-muted mt-1">
            <span>1</span>
            <span>20</span>
          </div>
        </div>

        <div>
          <label className="block text-xs font-bold text-nb-gray-600 dark:text-dark-muted mb-1.5">Runtime</label>
          <div className="flex items-center gap-2 p-3 border-2 border-nb-gray-200 dark:border-dark-border bg-nb-gray-50 dark:bg-dark-elevated">
            <span className="font-bold text-sm text-nb-black dark:text-dark-text">
              {PROVIDER_LABELS[agent.runtime || ''] || agent.runtime || 'Unknown'}
            </span>
            <span className="text-xs text-nb-gray-400 dark:text-dark-muted">/ {agent.model || '—'}</span>
          </div>
        </div>

        {/* Channel Access */}
        <div>
          <label className="block text-xs font-bold text-nb-gray-600 dark:text-dark-muted mb-1.5">Channel Access</label>
          {agent.channels && agent.channels.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {agent.channels.map((ch) => (
                <span
                  key={ch}
                  className="px-2.5 py-1 border-2 border-nb-gray-200 dark:border-dark-border bg-nb-gray-50 dark:bg-dark-elevated text-xs font-bold text-nb-black dark:text-dark-text"
                >
                  #{ch}
                </span>
              ))}
            </div>
          ) : (
            <div className="p-3 border-2 border-nb-gray-200 dark:border-dark-border bg-nb-gray-50 dark:bg-dark-elevated text-xs text-nb-gray-400 dark:text-dark-muted">
              All channels
            </div>
          )}
        </div>

        {/* Working Directory */}
        {agent.workDir && (
          <div>
            <label className="block text-xs font-bold text-nb-gray-600 dark:text-dark-muted mb-1.5">Working Directory</label>
            <div className="p-3 border-2 border-nb-gray-200 dark:border-dark-border bg-nb-gray-50 dark:bg-dark-elevated text-xs font-mono text-nb-black dark:text-dark-text">
              {agent.workDir}
            </div>
          </div>
        )}

        <div className="flex items-center gap-3 pt-3 border-t-2 border-nb-gray-200 dark:border-dark-border">
          {isDirty && (
            <button
              onClick={() => onUpdate({ displayName, description, visibility, maxConcurrentTasks: maxConcurrent })}
              className="flex items-center gap-1 px-4 py-2 border-2 border-nb-black text-sm font-bold bg-nb-blue text-nb-white shadow-nb-sm hover:shadow-nb active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all"
            >
              <Save size={12} /> Save Changes
            </button>
          )}
          {agent.status === 'active' && (
            <button
              onClick={onStop}
              className="flex items-center gap-1 px-4 py-2 border-2 border-nb-black text-sm font-bold bg-nb-red text-nb-white shadow-nb-sm hover:shadow-nb active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all ml-auto"
            >
              <Square size={12} /> Stop Agent
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Main AgentDetail ── */
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
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-nb-white dark:bg-dark-surface">
      {/* Header */}
      <div className="flex items-center gap-4 px-5 py-4 border-b-2 border-nb-gray-200 dark:border-dark-border">
        <div className="w-10 h-10 border-2 border-nb-black dark:border-dark-border bg-nb-yellow-light dark:bg-dark-elevated flex items-center justify-center shrink-0 font-display font-bold text-sm">
          {(agent.displayName || agent.name).charAt(0).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="font-display font-black text-lg text-nb-black dark:text-dark-text truncate">
              @{agent.displayName || agent.name}
            </h2>
            <span className={`w-2.5 h-2.5 border border-nb-black dark:border-dark-border ${activityColors[activity]}`} />
            <span className="text-xs text-nb-gray-500 dark:text-dark-muted">{isActive ? activityLabels[activity] : 'Inactive'}</span>
          </div>
          {agent.description && (
            <p className="text-xs text-nb-gray-500 dark:text-dark-muted truncate mt-0.5">{agent.description}</p>
          )}
        </div>
        <div className="text-xs text-nb-gray-400 dark:text-dark-muted shrink-0 font-mono">
          {PROVIDER_LABELS[agent.runtime || ''] || agent.runtime} · {agent.model || '—'}
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex border-b-2 border-nb-gray-200 dark:border-dark-border px-5">
        {TAB_CONFIG.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-bold border-b-3 -mb-[2px] transition-colors ${
              tab === key
                ? 'border-nb-black dark:border-dark-text text-nb-black dark:text-dark-text'
                : 'border-transparent text-nb-gray-400 hover:text-nb-black dark:hover:text-dark-text'
            }`}
          >
            <Icon size={14} />
            {label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
        {tab === 'instructions' && <InstructionsTab agent={agent} onUpdate={onUpdate} />}
        {tab === 'skills' && <SkillsTab agent={agent} onUpdate={onUpdate} />}
        {tab === 'tasks' && <TasksTab agent={agent} />}
        {tab === 'settings' && <SettingsTab agent={agent} onUpdate={onUpdate} onStop={onStop} />}
      </div>
    </div>
  );
}
