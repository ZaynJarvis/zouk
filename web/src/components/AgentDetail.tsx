import { useState, useEffect, useCallback } from 'react';
import { FileText, FolderOpen, Activity, Settings, Save, Zap, ArrowLeft, RefreshCw, X } from 'lucide-react';
import type { ServerAgent, ServerMachine } from '../types';
import { useApp } from '../store/AppContext';
import ScanlineTear from './glitch/ScanlineTear';
import { activityLabels } from '../lib/activityStatus';
import StatusDot from './StatusDot';
import { agentAvatarStatus, agentLifecycle, agentStatus, avatarPaletteClass, avatarRadiusClass } from '../lib/avatarStatus';
import { ncStyle } from '../lib/themeUtils';
import { formatRuntime } from '../lib/runtimeLabels';
import { AgentActivityFeed } from './agent/AgentActivityFeed';
import { WorkspaceTree } from './workspace/WorkspaceTree';
import { useWorkspaceTree } from './workspace/useWorkspaceTree';
import AgentConfigForm from './agent/AgentConfigForm';

type Tab = 'instructions' | 'workspace' | 'activity' | 'settings';

const TAB_CONFIG: { key: Tab; label: string; icon: typeof FileText }[] = [
  { key: 'instructions', label: 'INSTR', icon: FileText },
  { key: 'workspace', label: 'FILES', icon: FolderOpen },
  { key: 'activity', label: 'ACTIVITY', icon: Activity },
  { key: 'settings', label: 'CONFIG', icon: Settings },
];

function InstructionsTab({
  agent,
  onUpdate,
}: {
  agent: ServerAgent;
  onUpdate: (updates: Partial<ServerAgent>) => void;
}) {
  // Instructions and skills only round-trip through the saved config — the
  // live ServerAgent payload doesn't carry them. Reading from `agent.X` would
  // wipe the user's saved value every time this tab remounts.
  const { configs, skillsCache, requestSkills } = useApp();
  const savedConfig = configs.find((c) => c.id === agent.id);
  const persistedInstructions = savedConfig?.instructions ?? agent.instructions ?? '';
  const persistedSkills = savedConfig?.skills ?? agent.skills ?? [];
  const [instructions, setInstructions] = useState(persistedInstructions);
  const isDirty = instructions !== persistedInstructions;

  // The daemon scans SKILL.md + command markdown from the agent's runtime
  // home dir + workspace and answers skills:list. Request lazily on mount;
  // the daemon-side dedup already merges global+workspace.
  useEffect(() => {
    if (agent.status !== 'active') return;
    requestSkills(agent.id, agent.runtime);
  }, [agent.id, agent.status, agent.runtime, requestSkills]);

  const discovered = skillsCache[agent.id];
  const availableFromDaemon = [...(discovered?.global || []), ...(discovered?.workspace || [])];

  const assignedSkills = persistedSkills;
  const assignedIds = new Set(assignedSkills.map((s) => s.id));
  const availableSkills = availableFromDaemon.filter((s) => !assignedIds.has(s.name));
  const [showPicker, setShowPicker] = useState(false);

  const handleAddSkill = (skill: { name: string; displayName: string; description: string }) => {
    onUpdate({ skills: [...assignedSkills, { id: skill.name, name: skill.displayName || skill.name, description: skill.description }] });
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

      {showPicker && (
        availableSkills.length > 0 ? (
          <div className="mb-3 border border-nc-border bg-nc-panel overflow-hidden">
            {availableSkills.map((skill) => (
              <button
                key={skill.name}
                onClick={() => handleAddSkill(skill)}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-nc-elevated transition-colors border-b border-nc-border last:border-b-0"
              >
                <div className="w-7 h-7 border border-nc-yellow/30 bg-nc-yellow/10 flex items-center justify-center shrink-0">
                  <Zap size={12} className="text-nc-yellow" />
                </div>
                <div className="flex-1 min-w-0">
                  <span className="font-bold text-sm text-nc-text-bright">{skill.displayName || skill.name}</span>
                  {skill.description && <p className="text-xs text-nc-muted truncate font-mono">{skill.description}</p>}
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className="mb-3 p-3 border border-nc-border bg-nc-panel text-xs text-nc-muted font-mono">
            {agent.status === 'active'
              ? discovered
                ? 'No skills found in runtime home or workspace.'
                : 'Scanning agent workspace for skills...'
              : 'Start the agent to scan its workspace for skills.'}
          </div>
        )
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
  const { workspaceFileContent, requestFileContent } = useApp();
  const [viewingFile, setViewingFile] = useState<string | null>(null);
  const { expandedDirs, refresh, rootFiles, toggleDir, treeCache } = useWorkspaceTree(agent);

  const fileContent = workspaceFileContent?.agentId === agent.id && workspaceFileContent?.path === viewingFile
    ? workspaceFileContent.content
    : null;

  const handleViewFile = useCallback((filePath: string) => {
    setViewingFile(filePath);
    requestFileContent(agent.id, filePath);
  }, [agent.id, requestFileContent]);

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

  const treePane = (
    <div className="flex-1 flex flex-col min-h-0 p-5 overflow-hidden">
      <div className="flex items-center justify-between mb-3 shrink-0">
        <h3 className="font-display font-bold text-sm text-nc-text-bright tracking-wider truncate">
          {agent.workDir || 'WORKSPACE'}
        </h3>
        <button
          onClick={refresh}
          className="cyber-btn w-7 h-7 border border-nc-border bg-nc-panel flex items-center justify-center hover:bg-nc-elevated hover:border-nc-cyan text-nc-muted hover:text-nc-cyan shrink-0"
          title="Refresh"
        >
          <RefreshCw size={12} />
        </button>
      </div>

      {rootFiles.length > 0 ? (
        <div className="border border-nc-border bg-nc-panel overflow-y-auto scrollbar-thin flex-1 min-h-0">
          <WorkspaceTree
            files={rootFiles}
            treeCache={treeCache}
            expandedDirs={expandedDirs}
            onToggleDir={toggleDir}
            onFileSelect={handleViewFile}
            variant="detail"
          />
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

  if (!viewingFile) {
    return <div className="flex-1 flex flex-col min-h-0 overflow-hidden">{treePane}</div>;
  }

  const previewPane = (
    <div className="flex-1 flex flex-col min-h-0 p-5 overflow-hidden">
      <div className="flex items-center gap-2 mb-3 shrink-0">
        <span className="flex-1 text-xs font-mono text-nc-muted truncate">{viewingFile}</span>
        <button
          onClick={() => setViewingFile(null)}
          className="cyber-btn w-7 h-7 border border-nc-border bg-nc-panel flex items-center justify-center hover:bg-nc-elevated hover:border-nc-red hover:text-nc-red text-nc-muted shrink-0"
          title="Close file"
        >
          <X size={14} />
        </button>
      </div>
      <pre className="flex-1 overflow-auto p-3 border border-nc-border bg-nc-black text-xs font-mono text-nc-green whitespace-pre-wrap scrollbar-thin" style={ncStyle({ textShadow: '0 0 4px rgb(var(--nc-green) / 0.3)' })}>
        {fileContent ?? 'Loading...'}
      </pre>
    </div>
  );

  return (
    <div className="flex-1 flex flex-col lg:flex-row min-h-0 overflow-hidden">
      <div className="flex-1 min-h-0 flex flex-col lg:max-w-[40%] border-b lg:border-b-0 lg:border-r border-nc-border">
        {treePane}
      </div>
      <div className="flex-1 min-h-0 flex flex-col">
        {previewPane}
      </div>
    </div>
  );
}

function ActivityTab({ agent }: { agent: ServerAgent }) {
  const { loadAgentActivities } = useApp();
  const entries = agent.entries || [];

  useEffect(() => {
    // Fetch once per agent mount. The store action captures the pre-fetch live
    // count and merges so nothing accumulated during the round trip is lost.
    loadAgentActivities(agent.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent.id]);

  return (
    <div className="flex-1 flex flex-col p-5 overflow-y-auto scrollbar-thin">
      <div className="mb-4">
        <h3 className="font-display font-bold text-sm text-nc-text-bright tracking-wider">ACTIVITY_LOG</h3>
        <p className="text-xs text-nc-muted mt-0.5 font-mono">Real-time activity from this agent.</p>
      </div>

      {entries.length > 0 ? (
        <AgentActivityFeed entries={entries} className="space-y-1" />
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

export default function AgentDetail({
  agent,
  machines,
  initialTab,
  onUpdate,
  onStop,
  onDelete,
  onBack,
}: {
  agent: ServerAgent;
  machines?: ServerMachine[];
  initialTab?: Tab;
  onUpdate: (updates: Partial<ServerAgent>) => void;
  onStop: () => void;
  onDelete: () => void;
  onBack?: () => void;
}) {
  const { theme } = useApp();
  const [tab, setTab] = useState<Tab>(initialTab || 'instructions');
  const activity = agent.activity || 'offline';
  const isActive = agent.status === 'active';

  useEffect(() => {
    if (initialTab) setTab(initialTab);
  }, [initialTab, agent.id]);

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
        <div className="relative w-10 h-10 shrink-0">
          <div className={`w-full h-full border flex items-center justify-center font-display font-bold text-sm overflow-hidden ${avatarPaletteClass(agentAvatarStatus(agent), 'cyan', agentLifecycle(agent))} ${avatarRadiusClass(theme)}`}>
            {agent.picture ? (
              <img src={agent.picture} alt="" className="w-full h-full object-cover" />
            ) : (
              (agent.displayName || agent.name).charAt(0).toUpperCase()
            )}
          </div>
          <StatusDot status={agentStatus(agent)} ringClass="border-nc-surface" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="font-display font-black text-lg text-nc-text-bright truncate tracking-wider">
              @{agent.displayName || agent.name}
            </h2>
            <span className="text-xs text-nc-muted font-mono hidden sm:inline">{isActive ? activityLabels[activity] : 'INACTIVE'}</span>
          </div>
          {agent.description && (
            <p className="text-xs text-nc-muted truncate mt-0.5 font-mono">{agent.description}</p>
          )}
        </div>
        <div className="text-xs text-nc-muted shrink-0 font-mono hidden sm:block">
          {formatRuntime(agent.runtime)} · {agent.model || '—'}
          {agent.machineId && (
            <span className="ml-2 text-nc-green">
              · {machines?.find(m => m.id === agent.machineId)?.alias ||
                 machines?.find(m => m.id === agent.machineId)?.hostname ||
                 agent.machineId}
            </span>
          )}
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
        {tab === 'settings' && <AgentConfigForm agent={agent} machines={machines} onStop={onStop} onDelete={onDelete} />}
      </div>
    </div>
  );
}
