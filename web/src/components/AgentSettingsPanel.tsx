import { useState, useCallback, useRef, useMemo } from 'react';
import { Save, Square, Globe, Lock, Trash2, Camera, Server, Settings as SettingsIcon } from 'lucide-react';
import { useApp } from '../store/AppContext';
import type { ServerAgent } from '../types';
import ScanlineTear from './glitch/ScanlineTear';
import { formatRuntime } from '../lib/runtimeLabels';
import { resizeAndEncode } from '../lib/imageEncode';
import PanelShell from './panel/PanelShell';
import PanelHeader from './panel/PanelHeader';

const settingsPanelWidthClassName = 'w-screen lg:w-[30vw] lg:min-w-[340px] lg:max-w-[520px]';

export default function AgentSettingsPanel() {
  const {
    agents, configs, machines, profilePresets,
    closeRightPanel, agentSettingsId,
    updateAgentConfig, stopAgent, deleteAgent, setAgentSettingsId, isGuest,
  } = useApp();

  const liveAgent = agents.find((a) => a.id === agentSettingsId);
  const config = configs.find((c) => c.id === agentSettingsId);

  // Reconstruct an "agent-shaped" object from saved config when daemon isn't running
  const agent: ServerAgent | null = useMemo(() => {
    if (liveAgent) return liveAgent;
    if (!config?.id) return null;
    return {
      id: config.id,
      name: config.name,
      displayName: config.displayName,
      description: config.description,
      runtime: config.runtime ?? 'claude',
      model: config.model,
      picture: config.picture,
      visibility: config.visibility,
      maxConcurrentTasks: config.maxConcurrentTasks,
      autoStart: config.autoStart,
      instructions: config.instructions,
      skills: config.skills,
      workDir: config.workDir,
      status: 'inactive',
      activity: 'offline',
    };
  }, [liveAgent, config]);

  const persistedDisplayName = config?.displayName ?? agent?.displayName ?? agent?.name ?? '';
  const persistedDescription = config?.description ?? agent?.description ?? '';
  const persistedVisibility = config?.visibility ?? agent?.visibility ?? 'workspace';
  const persistedMaxConcurrent = config?.maxConcurrentTasks ?? agent?.maxConcurrentTasks ?? 6;

  const [displayName, setDisplayName] = useState(persistedDisplayName);
  const [description, setDescription] = useState(persistedDescription);
  const [visibility, setVisibility] = useState<'workspace' | 'private'>(persistedVisibility);
  const [maxConcurrent, setMaxConcurrent] = useState(persistedMaxConcurrent);
  const [picture, setPicture] = useState<string | undefined>(agent?.picture);
  const pictureInputRef = useRef<HTMLInputElement>(null);

  const handlePictureUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !agent) return;
    try {
      const dataUrl = await resizeAndEncode(file, 128);
      setPicture(dataUrl);
      await updateAgentConfig(agent.id, { picture: dataUrl });
    } catch {
      // silently fail
    }
  }, [agent, updateAgentConfig]);

  const handlePresetSelect = useCallback((image: string) => {
    if (!agent) return;
    setPicture(image);
    updateAgentConfig(agent.id, { picture: image });
  }, [agent, updateAgentConfig]);

  if (!agent) {
    return (
      <PanelShell widthClassName={settingsPanelWidthClassName} centered>
        <p className="text-sm text-nc-muted font-mono mb-3">AGENT_NOT_FOUND</p>
        <button
          type="button"
          onClick={closeRightPanel}
          className="px-3 py-1.5 border border-nc-border text-xs text-nc-muted hover:text-nc-text-bright font-mono"
        >
          CLOSE
        </button>
      </PanelShell>
    );
  }

  const isDirty =
    displayName !== persistedDisplayName ||
    description !== persistedDescription ||
    visibility !== persistedVisibility ||
    maxConcurrent !== persistedMaxConcurrent;

  const handleSave = () => {
    updateAgentConfig(agent.id, {
      displayName,
      description,
      visibility,
      maxConcurrentTasks: maxConcurrent,
      autoStart: true,
      picture,
    });
  };

  const handleDelete = async () => {
    const label = agent.displayName || agent.name;
    if (!window.confirm(`Delete agent ${label}? This removes the saved config and disconnects the running agent.`)) return;
    await deleteAgent(agent.id);
    setAgentSettingsId(null);
    closeRightPanel();
  };

  const machine = agent.machineId ? machines.find((m) => m.id === agent.machineId) : null;

  return (
    <PanelShell widthClassName={settingsPanelWidthClassName} animated>
      <PanelHeader
        onClose={closeRightPanel}
        className="shrink-0"
        leftClassName="flex items-center gap-2"
        closeTitle="Close"
      >
        <>
          <SettingsIcon size={14} className="text-nc-cyan shrink-0" />
          <h3 className="font-display font-extrabold text-base text-nc-text-bright tracking-wider truncate">
            CONFIG · @{agent.displayName || agent.name}
          </h3>
        </>
      </PanelHeader>

      <div className="flex-1 overflow-y-auto scrollbar-thin p-4 space-y-4">
        <div>
          <label className="block text-xs font-bold text-nc-muted mb-1.5 font-mono tracking-wider">PROFILE_PICTURE</label>
          <div className="flex items-center gap-3">
            <div
              className="relative w-14 h-14 border border-nc-cyan/30 bg-nc-cyan/10 flex items-center justify-center cursor-pointer group overflow-hidden font-display font-bold text-lg text-nc-cyan"
              onClick={() => pictureInputRef.current?.click()}
            >
              {picture ? (
                <img src={picture} alt="" className="w-full h-full object-cover" />
              ) : (
                (agent.displayName || agent.name).charAt(0).toUpperCase()
              )}
              <div className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                <Camera size={16} className="text-white" />
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
            <div className="mt-2.5">
              <p className="text-2xs text-nc-muted font-mono mb-1.5 tracking-wider">OR_PICK_A_PRESET</p>
              <div className="flex flex-wrap gap-1.5">
                {profilePresets.map((p) => {
                  const active = picture === p.image;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => handlePresetSelect(p.image)}
                      className={`w-9 h-9 border overflow-hidden transition-all ${
                        active ? 'border-nc-cyan shadow-nc-cyan' : 'border-nc-border hover:border-nc-cyan/60'
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
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setVisibility('workspace')}
              className={`flex items-center gap-2 border px-2.5 py-2 text-left ${
                visibility === 'workspace'
                  ? 'border-nc-cyan bg-nc-cyan/10'
                  : 'border-nc-border hover:bg-nc-elevated'
              }`}
            >
              <Globe size={14} className="shrink-0 text-nc-cyan" />
              <div className="min-w-0 flex-1">
                <div className="font-bold text-xs text-nc-text-bright">Workspace</div>
                <div className="text-2xs text-nc-muted font-mono">All members</div>
              </div>
            </button>
            <button
              type="button"
              onClick={() => setVisibility('private')}
              className={`flex items-center gap-2 border px-2.5 py-2 text-left ${
                visibility === 'private'
                  ? 'border-nc-cyan bg-nc-cyan/10'
                  : 'border-nc-border hover:bg-nc-elevated'
              }`}
            >
              <Lock size={14} className="shrink-0 text-nc-red" />
              <div className="min-w-0 flex-1">
                <div className="font-bold text-xs text-nc-text-bright">Private</div>
                <div className="text-2xs text-nc-muted font-mono">Only you</div>
              </div>
            </button>
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
        </div>

        <div>
          <label className="block text-xs font-bold text-nc-muted mb-1.5 font-mono tracking-wider">RUNTIME</label>
          <div className="flex items-center gap-2 px-3 py-2 border border-nc-border bg-nc-elevated">
            <span className="font-bold text-xs text-nc-text-bright font-mono">
              {formatRuntime(agent.runtime) || 'Unknown'}
            </span>
            <span className="text-2xs text-nc-muted font-mono">/ {agent.model || '\u2014'}</span>
          </div>
        </div>

        {machine && (
          <div>
            <label className="flex items-center gap-1.5 text-xs font-bold text-nc-muted mb-1.5 font-mono tracking-wider">
              <Server size={11} className="text-nc-green" /> MACHINE
            </label>
            <div className="flex items-center gap-2 px-3 py-2 border border-nc-border bg-nc-elevated">
              <span className="w-2 h-2 bg-nc-green shrink-0" />
              <span className="font-bold text-xs text-nc-text-bright font-mono truncate">
                {machine.alias || machine.hostname}
              </span>
            </div>
          </div>
        )}
      </div>

      {!isGuest && (
        <div className="border-t border-nc-border p-3 flex items-center gap-2 flex-wrap shrink-0 bg-nc-surface">
          {isDirty && (
            <ScanlineTear config={{ trigger: 'hover', minInterval: 200, maxInterval: 600, minSeverity: 0.3, maxSeverity: 0.8 }}>
              <button
                onClick={handleSave}
                className="cyber-btn flex items-center gap-1 px-3 py-1.5 border border-nc-cyan bg-nc-cyan/10 text-xs font-bold text-nc-cyan hover:bg-nc-cyan/20 hover:shadow-nc-cyan font-mono"
              >
                <Save size={12} /> SAVE
              </button>
            </ScanlineTear>
          )}
          <button
            onClick={handleDelete}
            className="cyber-btn flex items-center gap-1 px-3 py-1.5 border border-nc-red bg-nc-red/10 text-xs font-bold text-nc-red hover:bg-nc-red/20 hover:shadow-nc-red font-mono"
          >
            <Trash2 size={12} /> DELETE
          </button>
          {agent.status === 'active' && (
            <button
              onClick={() => stopAgent(agent.id)}
              className="cyber-btn ml-auto flex items-center gap-1 px-3 py-1.5 border border-nc-red bg-nc-red/10 text-xs font-bold text-nc-red hover:bg-nc-red/20 hover:shadow-nc-red font-mono"
            >
              <Square size={12} /> STOP
            </button>
          )}
        </div>
      )}
    </PanelShell>
  );
}
