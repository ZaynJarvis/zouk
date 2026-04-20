import { useState, useEffect, useCallback, useRef } from 'react';
import { FileText, FolderOpen, Activity, Settings, Save, Square, Play, Globe, Lock, Zap, ArrowLeft, RefreshCw, Server, Trash2, Camera, X, Loader2 } from 'lucide-react';
import type { ServerAgent, ServerMachine, Skill } from '../types';
import { useApp } from '../store/AppContext';
import ScanlineTear from './glitch/ScanlineTear';
import { activityColors, activityLabels } from '../lib/activityStatus';
import { ncStyle } from '../lib/themeUtils';
import { formatRuntime } from '../lib/runtimeLabels';
import { resizeAndEncode } from '../lib/imageEncode';
import { fetchRuntimeModels, type RuntimeModel } from '../lib/api';
import { AgentActivityFeed } from './agent/AgentActivityFeed';
import { WorkspaceTree } from './workspace/WorkspaceTree';
import { useWorkspaceTree } from './workspace/useWorkspaceTree';

type Tab = 'instructions' | 'workspace' | 'activity' | 'settings';

const TAB_CONFIG: { key: Tab; label: string; icon: typeof FileText }[] = [
  { key: 'instructions', label: 'INSTR', icon: FileText },
  { key: 'workspace', label: 'FILES', icon: FolderOpen },
  { key: 'activity', label: 'ACTIVITY', icon: Activity },
  { key: 'settings', label: 'CONFIG', icon: Settings },
];

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
  // Instructions and skills only round-trip through the saved config — the
  // live ServerAgent payload doesn't carry them. Reading from `agent.X` would
  // wipe the user's saved value every time this tab remounts.
  const { configs } = useApp();
  const savedConfig = configs.find((c) => c.id === agent.id);
  const persistedInstructions = savedConfig?.instructions ?? agent.instructions ?? '';
  const persistedSkills = savedConfig?.skills ?? agent.skills ?? [];
  const [instructions, setInstructions] = useState(persistedInstructions);
  const isDirty = instructions !== persistedInstructions;

  const assignedSkills = persistedSkills;
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

function SettingsTab({
  agent,
  machines,
  onUpdate,
  onStop,
  onDelete,
}: {
  agent: ServerAgent;
  machines?: ServerMachine[];
  onUpdate: (updates: Partial<ServerAgent>) => void;
  onStop: () => void;
  onDelete: () => void;
}) {
  const { isGuest, configs, profilePresets, startAgent } = useApp();
  // description / visibility / maxConcurrentTasks / autoStart only round-trip
  // through the saved config — the live ServerAgent payload doesn't carry
  // them. Reading from `agent.X` would wipe the user's saved value every time
  // this tab remounts (and keep `isDirty` permanently true after SAVE).
  const savedConfig = configs.find((c) => c.id === agent.id);
  const persistedDisplayName = savedConfig?.displayName ?? agent.displayName ?? agent.name;
  const persistedDescription = savedConfig?.description ?? agent.description ?? '';
  const persistedVisibility = savedConfig?.visibility ?? agent.visibility ?? 'workspace';
  const persistedMaxConcurrent = savedConfig?.maxConcurrentTasks ?? agent.maxConcurrentTasks ?? 6;
  const persistedAutoStart = savedConfig?.autoStart ?? true;
  const persistedModel = savedConfig?.model ?? agent.model ?? '';

  const [displayName, setDisplayName] = useState(persistedDisplayName);
  const [description, setDescription] = useState(persistedDescription);
  const [visibility, setVisibility] = useState<'workspace' | 'private'>(persistedVisibility);
  const [maxConcurrent, setMaxConcurrent] = useState(persistedMaxConcurrent);
  const [autoStart, setAutoStart] = useState<boolean>(persistedAutoStart);
  const [model, setModel] = useState<string>(persistedModel);
  const [modelOptions, setModelOptions] = useState<RuntimeModel[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [customModel, setCustomModel] = useState(false);
  const [picture, setPicture] = useState<string | undefined>(agent.picture);
  const pictureInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!agent.machineId || !agent.runtime) return;
    let cancelled = false;
    setModelsLoading(true);
    fetchRuntimeModels(agent.machineId, agent.runtime)
      .then((result) => {
        if (cancelled) return;
        setModelOptions(result.models);
      })
      .catch(() => { if (!cancelled) setModelOptions([]); })
      .finally(() => { if (!cancelled) setModelsLoading(false); });
    return () => { cancelled = true; };
  }, [agent.machineId, agent.runtime]);

  useEffect(() => {
    if (modelOptions.length === 0) return;
    const persistedMatches = !persistedModel || modelOptions.some((m) => m.id === persistedModel);
    setCustomModel(!persistedMatches);
  }, [modelOptions, persistedModel]);

  const handlePictureUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const dataUrl = await resizeAndEncode(file, 128);
      setPicture(dataUrl);
      onUpdate({ picture: dataUrl });
    } catch {
      // silently fail — oversized/invalid image
    }
  }, [onUpdate]);

  const handlePresetSelect = useCallback((image: string) => {
    setPicture(image);
    onUpdate({ picture: image });
  }, [onUpdate]);

  const isDirty =
    displayName !== persistedDisplayName ||
    description !== persistedDescription ||
    visibility !== persistedVisibility ||
    maxConcurrent !== persistedMaxConcurrent ||
    autoStart !== persistedAutoStart ||
    model !== persistedModel;

  return (
    <div className="flex-1 flex flex-col p-5 overflow-y-auto scrollbar-thin">
      <div className="max-w-lg space-y-5">
        <div>
          <label className="block text-xs font-bold text-nc-muted mb-1.5 font-mono tracking-wider">PROFILE_PICTURE</label>
          <div className="flex items-center gap-4">
            <div
              className="relative w-16 h-16 border border-nc-cyan/30 bg-nc-cyan/10 flex items-center justify-center cursor-pointer group overflow-hidden font-display font-bold text-xl text-nc-cyan"
              onClick={() => pictureInputRef.current?.click()}
            >
              {picture ? (
                <img src={picture} alt="" className="w-full h-full object-cover" />
              ) : (
                (agent.displayName || agent.name).charAt(0).toUpperCase()
              )}
              <div className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                <Camera size={18} className="text-white" />
              </div>
              <input
                ref={pictureInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handlePictureUpload}
              />
            </div>
          </div>
          {profilePresets.length > 0 && (
            <div className="mt-3">
              <p className="text-2xs text-nc-muted font-mono mb-1.5 tracking-wider">OR_PICK_A_PRESET</p>
              <div className="flex flex-wrap gap-1.5">
                {profilePresets.map((p) => {
                  const active = picture === p.image;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => handlePresetSelect(p.image)}
                      className={`w-10 h-10 border overflow-hidden transition-all ${
                        active
                          ? 'border-nc-cyan shadow-nc-cyan'
                          : 'border-nc-border hover:border-nc-cyan/60'
                      }`}
                      title="Apply preset"
                    >
                      <img src={p.image} alt="" className="w-full h-full object-cover" />
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div>
          <label className="block text-xs font-bold text-nc-muted mb-1.5 font-mono tracking-wider">DISPLAY_NAME</label>
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="w-full px-3 py-2 border border-nc-border bg-nc-panel text-sm text-nc-text-bright font-mono focus:outline-none focus:border-nc-cyan focus:shadow-nc-cyan transition-all"
          />
          {agent.status === 'active' && displayName !== persistedDisplayName && (
            <p className="text-2xs text-nc-yellow mt-1 font-mono">
              Renaming a running agent updates the UI immediately, but the agent
              process keeps its old self-name (used for @mentions) until you
              stop and restart it.
            </p>
          )}
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
                className={`cyber-btn w-full flex items-center gap-2 border px-3 py-2.5 text-left ${
                  visibility === 'workspace'
                    ? 'border-nc-cyan bg-nc-cyan/10 shadow-nc-cyan'
                    : 'border-nc-border hover:bg-nc-elevated'
                }`}
              >
                <Globe size={16} className="shrink-0 text-nc-cyan" />
                <div className="min-w-0 flex-1">
                  <div className="font-bold text-sm text-nc-text-bright">Workspace</div>
                  <div className="text-xs text-nc-muted font-mono">All members</div>
                </div>
              </button>
            </ScanlineTear>
            <ScanlineTear config={{ trigger: 'hover', minInterval: 200, maxInterval: 600, minSeverity: 0.3, maxSeverity: 0.8 }}>
              <button
                type="button"
                onClick={() => setVisibility('private')}
                className={`cyber-btn w-full flex items-center gap-2 border px-3 py-2.5 text-left ${
                  visibility === 'private'
                    ? 'border-nc-cyan bg-nc-cyan/10 shadow-nc-cyan'
                    : 'border-nc-border hover:bg-nc-elevated'
                }`}
              >
                <Lock size={16} className="shrink-0 text-nc-red" />
                <div className="min-w-0 flex-1">
                  <div className="font-bold text-sm text-nc-text-bright">Private</div>
                  <div className="text-xs text-nc-muted font-mono">Only you</div>
                </div>
              </button>
            </ScanlineTear>
          </div>
        </div>

        <div>
          <label className="block text-xs font-bold text-nc-muted mb-1.5 font-mono tracking-wider">AUTO_RESTART</label>
          <div className="grid grid-cols-2 gap-3">
            <ScanlineTear config={{ trigger: 'hover', minInterval: 200, maxInterval: 600, minSeverity: 0.3, maxSeverity: 0.8 }}>
              <button
                type="button"
                onClick={() => setAutoStart(true)}
                className={`cyber-btn w-full flex items-center gap-2 border px-3 py-2.5 text-left ${
                  autoStart
                    ? 'border-nc-cyan bg-nc-cyan/10 shadow-nc-cyan'
                    : 'border-nc-border hover:bg-nc-elevated'
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="font-bold text-sm text-nc-text-bright">ON</div>
                  <div className="text-xs text-nc-muted font-mono">Restart on daemon reconnect</div>
                </div>
              </button>
            </ScanlineTear>
            <ScanlineTear config={{ trigger: 'hover', minInterval: 200, maxInterval: 600, minSeverity: 0.3, maxSeverity: 0.8 }}>
              <button
                type="button"
                onClick={() => setAutoStart(false)}
                className={`cyber-btn w-full flex items-center gap-2 border px-3 py-2.5 text-left ${
                  !autoStart
                    ? 'border-nc-cyan bg-nc-cyan/10 shadow-nc-cyan'
                    : 'border-nc-border hover:bg-nc-elevated'
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="font-bold text-sm text-nc-text-bright">OFF</div>
                  <div className="text-xs text-nc-muted font-mono">Manual start only</div>
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
              {formatRuntime(agent.runtime) || 'Unknown'}
            </span>
            <span className="text-2xs text-nc-muted font-mono ml-auto">Fixed</span>
          </div>
        </div>

        <div>
          <label className="flex items-center gap-2 text-xs font-bold text-nc-muted mb-1.5 font-mono tracking-wider">
            <span>MODEL</span>
            {modelsLoading && <Loader2 size={10} className="animate-spin text-nc-cyan" />}
          </label>
          {modelOptions.length > 0 && !customModel ? (
            <>
              <div className="flex gap-2 flex-wrap">
                {modelOptions.map((m) => (
                  <ScanlineTear key={m.id} config={{ trigger: 'hover', minInterval: 200, maxInterval: 600, minSeverity: 0.3, maxSeverity: 0.8 }}>
                    <button
                      type="button"
                      onClick={() => setModel(m.id)}
                      className={`cyber-btn px-3 py-1.5 border text-sm font-bold font-mono ${
                        model === m.id
                          ? 'border-nc-cyan bg-nc-cyan/10 text-nc-cyan shadow-nc-cyan'
                          : 'border-nc-border text-nc-muted hover:bg-nc-elevated'
                      }`}
                      title={m.id}
                    >
                      {m.label}
                    </button>
                  </ScanlineTear>
                ))}
              </div>
              <button
                type="button"
                onClick={() => { setCustomModel(true); }}
                className="mt-2 text-2xs font-mono text-nc-muted hover:text-nc-cyan underline underline-offset-2"
              >
                Use custom model ID
              </button>
            </>
          ) : (
            <>
              <input
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="Model identifier (leave blank for runtime default)"
                className="w-full px-3 py-2 border border-nc-border bg-nc-panel text-sm text-nc-text-bright placeholder:text-nc-muted font-mono focus:outline-none focus:border-nc-cyan focus:shadow-nc-cyan transition-all"
              />
              {modelOptions.length > 0 && (
                <button
                  type="button"
                  onClick={() => { setCustomModel(false); setModel(modelOptions[0].id); }}
                  className="mt-2 text-2xs font-mono text-nc-muted hover:text-nc-cyan underline underline-offset-2"
                >
                  Back to suggested models
                </button>
              )}
            </>
          )}
          {agent.status === 'active' && model !== persistedModel && (
            <p className="text-2xs text-nc-yellow mt-1 font-mono">
              Saving applies on next agent start — restart the agent to use the new model.
            </p>
          )}
        </div>

        {agent.machineId && (
          <div>
            <label className="flex items-center gap-1.5 text-xs font-bold text-nc-muted mb-1.5 font-mono tracking-wider">
              <Server size={12} className="text-nc-green" /> MACHINE
            </label>
            <div className="flex items-center gap-2 p-3 border border-nc-border bg-nc-elevated">
              <span className="w-2 h-2 bg-nc-green shrink-0" />
              <span className="font-bold text-sm text-nc-text-bright font-mono">
                {machines?.find(m => m.id === agent.machineId)?.alias ||
                 machines?.find(m => m.id === agent.machineId)?.hostname ||
                 agent.machineId}
              </span>
              {machines?.find(m => m.id === agent.machineId)?.hostname &&
               machines?.find(m => m.id === agent.machineId)?.alias && (
                <span className="text-xs text-nc-muted font-mono">
                  {machines?.find(m => m.id === agent.machineId)?.hostname}
                </span>
              )}
            </div>
          </div>
        )}

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
            <div className="p-3 border border-nc-border bg-nc-elevated text-xs font-mono text-nc-green" style={ncStyle({ textShadow: '0 0 4px rgb(var(--nc-green) / 0.3)' })}>
              {agent.workDir}
            </div>
          </div>
        )}

        {!isGuest && (
          <div className="flex items-center gap-3 pt-3 border-t border-nc-border flex-wrap">
            {isDirty && (
              <ScanlineTear config={{ trigger: 'hover', minInterval: 200, maxInterval: 600, minSeverity: 0.3, maxSeverity: 0.8 }}>
                <button
                  onClick={() => onUpdate({ displayName, description, visibility, maxConcurrentTasks: maxConcurrent, autoStart, picture, model })}
                  className="cyber-btn flex items-center gap-1 px-4 py-2 border border-nc-cyan bg-nc-cyan/10 text-sm font-bold text-nc-cyan hover:bg-nc-cyan/20 hover:shadow-nc-cyan font-mono"
                >
                  <Save size={12} /> SAVE
                </button>
              </ScanlineTear>
            )}
            <ScanlineTear config={{ trigger: 'hover', minInterval: 200, maxInterval: 600, minSeverity: 0.3, maxSeverity: 0.8 }}>
              <button
                onClick={onDelete}
                className="cyber-btn flex items-center gap-1 px-4 py-2 border border-nc-red bg-nc-red/10 text-sm font-bold text-nc-red hover:bg-nc-red/20 hover:shadow-nc-red font-mono"
              >
                <Trash2 size={12} /> DELETE_AGENT
              </button>
            </ScanlineTear>
            {agent.status === 'active' ? (
              <ScanlineTear className="ml-auto" config={{ trigger: 'hover', minInterval: 200, maxInterval: 600, minSeverity: 0.3, maxSeverity: 0.8 }}>
                <button
                  onClick={onStop}
                  className="cyber-btn flex items-center gap-1 px-4 py-2 border border-nc-red bg-nc-red/10 text-sm font-bold text-nc-red hover:bg-nc-red/20 hover:shadow-nc-red font-mono"
                >
                  <Square size={12} /> STOP_AGENT
                </button>
              </ScanlineTear>
            ) : (
              <ScanlineTear className="ml-auto" config={{ trigger: 'hover', minInterval: 200, maxInterval: 600, minSeverity: 0.3, maxSeverity: 0.8 }}>
                <button
                  onClick={() => startAgent({
                    id: agent.id,
                    name: agent.name,
                    displayName: agent.displayName,
                    description: agent.description,
                    runtime: agent.runtime ?? 'claude',
                    model: agent.model,
                  })}
                  className="cyber-btn flex items-center gap-1 px-4 py-2 border border-nc-green bg-nc-green/10 text-sm font-bold text-nc-green hover:bg-nc-green/20 hover:shadow-nc-green font-mono"
                >
                  <Play size={12} /> START_AGENT
                </button>
              </ScanlineTear>
            )}
          </div>
        )}
      </div>
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
        <div
          className="relative w-10 h-10 border border-nc-cyan/30 bg-nc-cyan/10 flex items-center justify-center shrink-0 font-display font-bold text-sm text-nc-cyan overflow-hidden"
        >
          {agent.picture ? (
            <img src={agent.picture} alt="" className="w-full h-full object-cover" />
          ) : (
            (agent.displayName || agent.name).charAt(0).toUpperCase()
          )}
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
          {formatRuntime(agent.runtime)} · {agent.model || '\u2014'}
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
        {tab === 'settings' && <SettingsTab agent={agent} machines={machines} onUpdate={onUpdate} onStop={onStop} onDelete={onDelete} />}
      </div>
    </div>
  );
}
