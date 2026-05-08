import { useState, useEffect, useCallback } from 'react';
import { FileText, FolderOpen, Activity, Settings, Save, Zap, ArrowLeft, RefreshCw, X } from 'lucide-react';
import type { ServerAgent, ServerMachine } from '../types';
import { useApp } from '../store/AppContext';
import { activityLabels } from '../lib/activityStatus';


import { formatRuntime } from '../lib/runtimeLabels';
import { AgentActivityFeed } from './agent/AgentActivityFeed';
import { WorkspaceTree } from './workspace/WorkspaceTree';
import { useWorkspaceTree } from './workspace/useWorkspaceTree';
import AgentConfigForm from './agent/AgentConfigForm';
import { AgentAvatar } from './zk/primitives';

type Tab = 'instructions' | 'workspace' | 'activity' | 'settings';

const TAB_CONFIG: { key: Tab; label: string; icon: typeof FileText }[] = [
  { key: 'instructions', label: 'Instructions', icon: FileText },
  { key: 'workspace',    label: 'Files',        icon: FolderOpen },
  { key: 'activity',     label: 'Activity',     icon: Activity },
  { key: 'settings',     label: 'Config',       icon: Settings },
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
          <h3 className="zk-display" style={{ fontSize: 14, fontWeight: 600, color: 'var(--zk-ink)' }}>System prompt</h3>
          <p style={{ fontSize: 12, color: 'var(--zk-ink-mute)', marginTop: 4 }}>
            Instructions that define how this agent behaves.
          </p>
        </div>
        {isDirty && (
          <button
            type="button"
            onClick={() => onUpdate({ instructions })}
            className="zk-btn zk-btn--primary"
          >
            <Save size={12} /> Save
          </button>
        )}
      </div>
      <textarea
        value={instructions}
        onChange={(e) => setInstructions(e.target.value)}
        placeholder="Enter agent instructions..."
        className="resize-none w-full transition-colors"
        style={{
          minHeight: 200,
          padding: '10px 12px',
          background: 'var(--zk-bg-1)',
          border: '1px solid var(--zk-line-2)',
          borderRadius: 8,
          color: 'var(--zk-ink)',
          fontFamily: 'var(--zk-font-mono)',
          fontSize: 12.5,
          lineHeight: 1.6,
          outline: 'none',
        }}
      />

      <div className="flex items-center justify-between mt-6 mb-3">
        <div>
          <h3 className="zk-display" style={{ fontSize: 14, fontWeight: 600, color: 'var(--zk-ink)' }}>Skills</h3>
          <p style={{ fontSize: 12, color: 'var(--zk-ink-mute)', marginTop: 4 }}>
            Reusable instructions and tooling for this agent.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowPicker(!showPicker)}
          className="zk-btn"
        >
          <Zap size={12} /> Add skill
        </button>
      </div>

      {showPicker && (
        availableSkills.length > 0 ? (
          <div className="zk-panel mb-3" style={{ overflow: 'hidden' }}>
            {availableSkills.map((skill, i) => (
              <button
                key={skill.name}
                onClick={() => handleAddSkill(skill)}
                className="w-full text-left transition-colors"
                style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '10px 14px',
                  background: 'transparent', border: 0,
                  borderBottom: i === availableSkills.length - 1 ? 0 : '1px solid var(--zk-line)',
                  cursor: 'pointer',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--zk-bg-2)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
              >
                <span style={{
                  width: 26, height: 26, flexShrink: 0,
                  background: 'var(--zk-warn-soft)',
                  border: '1px solid rgba(214,177,112,0.3)',
                  borderRadius: 6,
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <Zap size={12} color="var(--zk-warn)" />
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--zk-ink)' }}>
                    {skill.displayName || skill.name}
                  </div>
                  {skill.description && (
                    <div className="zk-truncate" style={{ fontSize: 11, color: 'var(--zk-ink-mute)' }}>
                      {skill.description}
                    </div>
                  )}
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div
            className="zk-panel"
            style={{ padding: 12, marginBottom: 12, fontSize: 12, color: 'var(--zk-ink-mute)' }}
          >
            {agent.status === 'active'
              ? discovered
                ? 'No skills found in runtime home or workspace.'
                : 'Scanning agent workspace for skills…'
              : 'Start the agent to scan its workspace for skills.'}
          </div>
        )
      )}

      {assignedSkills.length > 0 && (
        <div style={{ display: 'grid', gap: 8 }}>
          {assignedSkills.map((skill) => (
            <div
              key={skill.id}
              className="zk-panel"
              style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '10px 12px',
              }}
            >
              <span style={{
                width: 26, height: 26, flexShrink: 0,
                background: 'var(--zk-warn-soft)',
                border: '1px solid rgba(214,177,112,0.3)',
                borderRadius: 6,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <Zap size={12} color="var(--zk-warn)" />
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--zk-ink)' }}>
                  {skill.name}
                </div>
                {skill.description && (
                  <div style={{ fontSize: 11, color: 'var(--zk-ink-mute)' }}>{skill.description}</div>
                )}
              </div>
              <button
                onClick={() => handleRemoveSkill(skill.id)}
                className="zk-btn zk-btn--ghost zk-btn--icon"
                style={{ color: 'var(--zk-err)' }}
                title="Remove skill"
              >
                <X size={12} />
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
        <div
          style={{
            width: 56, height: 56, borderRadius: 14,
            background: 'var(--zk-bg-2)', border: '1px solid var(--zk-line)',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            marginBottom: 12,
          }}
        >
          <FolderOpen size={22} color="var(--zk-ink-mute)" />
        </div>
        <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--zk-ink)' }}>Agent offline</p>
        <p style={{ fontSize: 12, color: 'var(--zk-ink-mute)', marginTop: 4 }}>
          Start the agent to browse its workspace.
        </p>
      </div>
    );
  }

  const treePane = (
    <div className="flex-1 flex flex-col min-h-0 p-5 overflow-hidden">
      <div className="flex items-center justify-between mb-3 shrink-0">
        <h3 className="zk-display zk-truncate" style={{ fontSize: 14, fontWeight: 600, color: 'var(--zk-ink)' }}>
          {agent.workDir || 'Workspace'}
        </h3>
        <button
          onClick={refresh}
          className="zk-btn zk-btn--ghost zk-btn--icon"
          title="Refresh"
        >
          <RefreshCw size={12} />
        </button>
      </div>

      {rootFiles.length > 0 ? (
        <div className="zk-panel zk-scroll" style={{ overflow: 'auto', flex: 1, minHeight: 0 }}>
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
          <div
            style={{
              width: 56, height: 56, borderRadius: 14,
              background: 'var(--zk-warn-soft)',
              border: '1px solid rgba(214,177,112,0.3)',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              marginBottom: 12,
            }}
          >
            <FolderOpen size={22} color="var(--zk-warn)" />
          </div>
          <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--zk-ink)' }}>No files</p>
          <p style={{ fontSize: 12, color: 'var(--zk-ink-mute)', marginTop: 4 }}>
            Files will appear here when the agent creates them.
          </p>
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
        <span
          className="flex-1 zk-truncate"
          style={{ fontSize: 11, fontFamily: 'var(--zk-font-mono)', color: 'var(--zk-ink-mute)' }}
        >
          {viewingFile}
        </span>
        <button
          onClick={() => setViewingFile(null)}
          className="zk-btn zk-btn--ghost zk-btn--icon"
          title="Close file"
        >
          <X size={12} />
        </button>
      </div>
      <pre
        className="flex-1 zk-scroll"
        style={{
          overflow: 'auto', padding: 14,
          background: 'var(--zk-bg-1)',
          border: '1px solid var(--zk-line)',
          borderRadius: 8,
          fontFamily: 'var(--zk-font-mono)',
          fontSize: 12, lineHeight: 1.65,
          color: 'var(--zk-ink-dim)',
          whiteSpace: 'pre-wrap',
          margin: 0,
        }}
      >
        {fileContent ?? 'Loading…'}
      </pre>
    </div>
  );

  return (
    <div className="flex-1 flex flex-col lg:flex-row min-h-0 overflow-hidden">
      <div
        className="flex-1 min-h-0 flex flex-col lg:max-w-[40%]"
        style={{ borderBottom: '1px solid var(--zk-line)' }}
      >
        {treePane}
      </div>
      <div className="flex-1 min-h-0 flex flex-col" style={{ borderLeft: '1px solid var(--zk-line)' }}>
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
    <div className="flex-1 flex flex-col p-5 zk-scroll" style={{ overflowY: 'auto' }}>
      <div className="mb-4">
        <h3 className="zk-display" style={{ fontSize: 14, fontWeight: 600, color: 'var(--zk-ink)' }}>Activity log</h3>
        <p style={{ fontSize: 12, color: 'var(--zk-ink-mute)', marginTop: 4 }}>
          Real-time activity from this agent.
        </p>
      </div>

      {entries.length > 0 ? (
        <AgentActivityFeed entries={entries} className="space-y-1" />
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center text-center py-12">
          <div
            style={{
              width: 56, height: 56, borderRadius: 14,
              background: 'var(--zk-ok-soft)',
              border: '1px solid rgba(111,182,151,0.3)',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              marginBottom: 12,
            }}
          >
            <Activity size={22} color="var(--zk-ok)" />
          </div>
          <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--zk-ink)' }}>No activity</p>
          <p style={{ fontSize: 12, color: 'var(--zk-ink-mute)', marginTop: 4 }}>
            Activity will appear here when the agent starts working.
          </p>
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
  const [tab, setTab] = useState<Tab>(initialTab || 'instructions');
  const activity = agent.activity || 'offline';
  const isActive = agent.status === 'active';

  useEffect(() => {
    if (initialTab) setTab(initialTab);
  }, [initialTab, agent.id]);

  return (
    <div
      className="flex-1 flex flex-col h-full overflow-hidden"
      style={{ background: 'var(--zk-bg-0)', color: 'var(--zk-ink)' }}
    >
      <div
        className="flex items-center gap-4 px-4 sm:px-6 py-4"
        style={{ borderBottom: '1px solid var(--zk-line)' }}
      >
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="lg:hidden zk-btn zk-btn--ghost zk-btn--icon"
            aria-label="Back"
          >
            <ArrowLeft size={14} />
          </button>
        )}
        <div style={{ position: 'relative' }}>
          <AgentAvatar agent={agent} size="lg" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2">
            <h2
              className="zk-display zk-truncate"
              style={{ fontSize: 19, fontWeight: 600, letterSpacing: '-0.012em', color: 'var(--zk-ink)' }}
            >
              @{agent.displayName || agent.name}
            </h2>
            <span
              style={{ fontSize: 11, color: 'var(--zk-ink-mute)', fontFamily: 'var(--zk-font-mono)' }}
              className="hidden sm:inline"
            >
              {isActive ? activityLabels[activity].toLowerCase() : 'inactive'}
            </span>
          </div>
          {agent.description && (
            <p
              className="zk-truncate"
              style={{ fontSize: 12, color: 'var(--zk-ink-mute)', marginTop: 2 }}
            >
              {agent.description}
            </p>
          )}
        </div>
        <div
          className="hidden sm:block"
          style={{ fontSize: 11, color: 'var(--zk-ink-mute)', fontFamily: 'var(--zk-font-mono)' }}
        >
          {formatRuntime(agent.runtime)} · {agent.model || '—'}
          {agent.machineId && (
            <span style={{ marginLeft: 8, color: 'var(--zk-ok)' }}>
              · {machines?.find((m) => m.id === agent.machineId)?.alias
                || machines?.find((m) => m.id === agent.machineId)?.hostname
                || agent.machineId}
            </span>
          )}
        </div>
      </div>

      <div
        className="flex px-3 sm:px-6"
        style={{ borderBottom: '1px solid var(--zk-line)' }}
      >
        {TAB_CONFIG.map(({ key, label, icon: Icon }) => {
          const active = tab === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className="transition-colors"
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '10px 14px',
                fontSize: 13, fontWeight: 500,
                background: 'transparent',
                border: 0,
                borderBottom: `2px solid ${active ? 'var(--zk-ember)' : 'transparent'}`,
                marginBottom: -1,
                color: active ? 'var(--zk-ink)' : 'var(--zk-ink-mute)',
                cursor: 'pointer',
              }}
            >
              <Icon size={13} />
              <span className="hidden sm:inline">{label}</span>
            </button>
          );
        })}
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
