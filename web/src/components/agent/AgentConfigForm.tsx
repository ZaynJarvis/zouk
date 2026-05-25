import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Save, Square, Play, Trash2, Camera, Server,
  Copy, Check,
} from 'lucide-react';
import type { ServerAgent, ServerMachine } from '../../types';
import { useApp } from '../../store/AppContext';
import ScanlineTear from '../glitch/ScanlineTear';
import { formatRuntime } from '../../lib/runtimeLabels';
import { resizeAndEncode } from '../../lib/imageEncode';
import AgentSettingsFields from './AgentSettingsFields';
import { fetchRuntimeModels, fetchAgentChannels, type RuntimeModel } from '../../lib/api';
import { ncStyle } from '../../lib/themeUtils';

export default function AgentConfigForm({
  agent,
  machines,
  onStop,
  onDelete,
  compact = false,
}: {
  agent: ServerAgent;
  machines?: ServerMachine[];
  onStop: () => void;
  onDelete: () => void;
  compact?: boolean;
}) {
  const { configs, profilePresets, isGuest, startAgent, updateAgentConfig } = useApp();

  const savedConfig = configs.find((c) => c.id === agent.id);
  const persistedDisplayName = savedConfig?.displayName ?? agent.displayName ?? agent.name;
  const persistedDescription = savedConfig?.description ?? agent.description ?? '';
  const persistedLifecycle: 'persistent' | 'ephemeral' =
    savedConfig?.lifecycle === 'ephemeral'
      ? 'ephemeral'
      : agent.lifecycle === 'ephemeral'
      ? 'ephemeral'
      : 'persistent';
  const persistedModel = savedConfig?.model ?? agent.model ?? '';
  const persistedEnvVars = savedConfig?.envVars ?? {};
  const persistedOvMode: 'provisioned' | 'custom' =
    savedConfig?.openvikingMode === 'custom' ? 'custom' : 'provisioned';
  const persistedOvUseAgentNameAsUser = savedConfig?.openvikingUseAgentNameAsUser === true;
  const persistedOvCustomUrl = savedConfig?.openvikingCustomUrl ?? '';
  const persistedOvCustomConfigured = !!savedConfig?.openvikingCustomConfigured;
  // Per-agent OV on/off — `openvikingEnabled` is the raw user override
  // (boolean | undefined). `agent.ovEnabled` is the server-resolved effective
  // value honoring the runtime default; we seed local state from that so the
  // UI starts in sync regardless of whether the user has ever flipped it.
  const persistedOvEnabledRaw = savedConfig?.openvikingEnabled;
  const persistedOvEnabledResolved = typeof agent.ovEnabled === 'boolean' ? agent.ovEnabled : false;
  const persistedOvIsDefault = agent.ovEnabledIsDefault !== false;
  const persistedOvDefault = !!agent.ovDefault;
  const persistedOvMcpEnabledRaw = savedConfig?.ovMcpEnabled;
  const persistedOvMcpEnabledResolved = typeof agent.ovMcpEnabled === 'boolean' ? agent.ovMcpEnabled : false;
  const persistedOvMcpIsDefault = agent.ovMcpEnabledIsDefault !== false;
  const persistedOvMcpDefault = !!agent.ovMcpDefault;
  const machine = agent.machineId ? machines?.find((m) => m.id === agent.machineId) : undefined;
  const machineLabel = machine?.alias || machine?.hostname || agent.machineId;

  const [displayName, setDisplayName] = useState(persistedDisplayName);
  const [description, setDescription] = useState(persistedDescription);
  const [lifecycle, setLifecycle] = useState<'persistent' | 'ephemeral'>(persistedLifecycle);
  const [model, setModel] = useState<string>(persistedModel);
  const [idCopied, setIdCopied] = useState(false);
  const [modelOptions, setModelOptions] = useState<RuntimeModel[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [customModel, setCustomModel] = useState(false);
  const [picture, setPicture] = useState<string | undefined>(agent.picture);
  const [envVars, setEnvVars] = useState<Record<string, string>>(persistedEnvVars);
  const [visibleChannels, setVisibleChannels] = useState<string[] | null>(agent.channels ?? null);
  const [ovEnabled, setOvEnabled] = useState<boolean>(persistedOvEnabledResolved);
  const [ovMcpEnabled, setOvMcpEnabled] = useState<boolean>(persistedOvMcpEnabledResolved);
  const [ovMode, setOvMode] = useState<'provisioned' | 'custom'>(persistedOvMode);
  const [ovUseAgentNameAsUser, setOvUseAgentNameAsUser] = useState<boolean>(persistedOvUseAgentNameAsUser);
  const [ovCustomUrl, setOvCustomUrl] = useState<string>(persistedOvCustomUrl ?? '');
  // We never receive the actual API key from the server, only a "configured"
  // boolean. Empty input + dirty=false = "leave saved value alone". User
  // typing into the field flips dirty=true and we send the new value on save.
  const [ovCustomApiKey, setOvCustomApiKey] = useState<string>('');
  const [ovCustomApiKeyDirty, setOvCustomApiKeyDirty] = useState(false);
  const persistedCustomLauncher = savedConfig?.customLauncher ?? '';
  const [customLauncher, setCustomLauncher] = useState<string>(persistedCustomLauncher);
  const pictureInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (agent.channels != null) {
      setVisibleChannels(agent.channels);
      return;
    }
    let cancelled = false;
    fetchAgentChannels(agent.id)
      .then((chs) => { if (!cancelled) setVisibleChannels(chs); })
      .catch(() => { if (!cancelled) setVisibleChannels([]); });
    return () => { cancelled = true; };
  }, [agent.id, agent.channels]);

  const refreshModels = useCallback(() => {
    if (!agent.machineId || !agent.runtime) return;
    let cancelled = false;
    setModelsLoading(true);
    fetchRuntimeModels(agent.machineId, agent.runtime)
      .then((result) => { if (!cancelled) setModelOptions(result.models); })
      .catch(() => { if (!cancelled) setModelOptions([]); })
      .finally(() => { if (!cancelled) setModelsLoading(false); });
    return () => { cancelled = true; };
  }, [agent.machineId, agent.runtime]);

  useEffect(() => refreshModels(), [refreshModels]);

  // Custom launcher overrides the runtime binary, so the daemon's static
  // model alias list almost certainly doesn't apply — force the free-form
  // input so the user types the exact ID their launcher expects.
  const launcherActive = customLauncher.trim().length > 0;
  useEffect(() => {
    if (launcherActive) setCustomModel(true);
  }, [launcherActive]);

  useEffect(() => {
    if (modelOptions.length === 0) return;
    const persistedMatches = !persistedModel || modelOptions.some((m) => m.id === persistedModel);
    setCustomModel(!persistedMatches);
  }, [modelOptions, persistedModel]);

  const handleCopyId = useCallback(() => {
    navigator.clipboard.writeText(agent.id).catch(() => {});
    setIdCopied(true);
    setTimeout(() => setIdCopied(false), 1500);
  }, [agent.id]);

  const handlePictureUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const dataUrl = await resizeAndEncode(file, 128);
      setPicture(dataUrl);
      await updateAgentConfig(agent.id, { picture: dataUrl });
    } catch {
      // silently fail
    }
  }, [agent.id, updateAgentConfig]);

  const handlePresetSelect = useCallback((image: string) => {
    setPicture(image);
    updateAgentConfig(agent.id, { picture: image });
  }, [agent.id, updateAgentConfig]);

  const envVarsDirty = JSON.stringify(envVars) !== JSON.stringify(persistedEnvVars);
  // ovEnabledDirty: toggle moved off either the persisted explicit value or
  // the resolved default (when nothing was persisted yet).
  const ovEnabledDirty = typeof persistedOvEnabledRaw === 'boolean'
    ? ovEnabled !== persistedOvEnabledRaw
    : ovEnabled !== persistedOvDefault;
  const ovMcpEnabledDirty = typeof persistedOvMcpEnabledRaw === 'boolean'
    ? ovMcpEnabled !== persistedOvMcpEnabledRaw
    : ovMcpEnabled !== persistedOvMcpDefault;
  const ovDirty =
    ovEnabledDirty ||
    ovMcpEnabledDirty ||
    ovUseAgentNameAsUser !== persistedOvUseAgentNameAsUser ||
    ovMode !== persistedOvMode ||
    (ovMode === 'custom' && (ovCustomUrl !== (persistedOvCustomUrl ?? '') || ovCustomApiKeyDirty));
  // Custom mode requires url + (existing configured key OR a freshly typed one)
  // — but only matters when OV is actually enabled. Disabled = inert fields.
  const ovCustomValid =
    !ovEnabled ||
    ovMode !== 'custom' ||
    (ovCustomUrl.trim().length > 0 && (persistedOvCustomConfigured || ovCustomApiKey.length > 0));
  const customLauncherDirty = customLauncher.trim() !== (persistedCustomLauncher ?? '').trim();
  const isDirty =
    displayName !== persistedDisplayName ||
    description !== persistedDescription ||
    lifecycle !== persistedLifecycle ||
    model !== persistedModel ||
    envVarsDirty ||
    ovDirty ||
    customLauncherDirty;

  const handleSave = () => {
    if (!ovCustomValid) return;
    const payload: Record<string, unknown> = {
      displayName,
      description,
      visibility: 'workspace',
      lifecycle,
      model,
      autoStart: true,
      picture,
      envVars: envVars,
    };
    if (customLauncherDirty) {
      payload.customLauncher = customLauncher.trim() || null;
    }
    if (ovDirty) {
      if (ovEnabledDirty) {
        payload.openvikingEnabled = ovEnabled;
      }
      if (ovMcpEnabledDirty) {
        payload.ovMcpEnabled = ovMcpEnabled;
      }
      payload.openvikingUseAgentNameAsUser = ovUseAgentNameAsUser;
      payload.openvikingMode = ovMode;
      // Only include url when in custom mode (so toggling back to provisioned
      // doesn't overwrite stored values unintentionally).
      if (ovMode === 'custom') {
        payload.openvikingCustomUrl = ovCustomUrl.trim();
        // Empty / not-dirty = server keeps old value; only send a fresh value
        // when the user actually typed in the password field.
        if (ovCustomApiKeyDirty && ovCustomApiKey.length > 0) {
          payload.openvikingCustomApiKey = ovCustomApiKey;
        }
      }
    }
    updateAgentConfig(agent.id, payload);
    if (ovCustomApiKeyDirty) {
      // Reset the input so the placeholder reappears and we don't re-send on next save.
      setOvCustomApiKey('');
      setOvCustomApiKeyDirty(false);
    }
  };

  const p = compact ? 'p-4' : 'p-5';
  const space = compact ? 'space-y-4' : 'space-y-5';
  const avatarSize = compact ? 'w-14 h-14' : 'w-16 h-16';
  const avatarFontSize = compact ? 'text-lg' : 'text-xl';
  const presetSize = compact ? 'w-9 h-9' : 'w-10 h-10';
  const btnPx = compact ? 'px-3 py-1.5' : 'px-4 py-2';
  const btnText = compact ? 'text-xs' : 'text-sm';

  return (
    <div className={`flex-1 flex flex-col ${p} overflow-y-auto scrollbar-thin safe-bottom-fill`}>
      <div className={`max-w-lg ${space}`}>
        {/* PROFILE_PICTURE */}
        <div>
          <label className="block text-xs font-bold text-nc-muted mb-1.5 font-mono tracking-wider">PROFILE_PICTURE</label>
          <div className="flex items-center gap-4">
            <div
              className={`relative ${avatarSize} border border-nc-cyan/30 bg-nc-cyan/10 flex items-center justify-center cursor-pointer group overflow-hidden font-display font-bold ${avatarFontSize} text-nc-cyan`}
              onClick={() => pictureInputRef.current?.click()}
            >
              {picture ? (
                <img src={picture} alt="" className="w-full h-full object-cover" />
              ) : (
                (agent.displayName || agent.name).charAt(0).toUpperCase()
              )}
              <div className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                <Camera size={compact ? 16 : 18} className="text-white" />
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
                {profilePresets.map((pres) => {
                  const active = picture === pres.image;
                  return (
                    <button
                      key={pres.id}
                      type="button"
                      onClick={() => handlePresetSelect(pres.image)}
                      className={`${presetSize} border overflow-hidden transition-all ${
                        active
                          ? 'border-nc-cyan shadow-nc-cyan'
                          : 'border-nc-border hover:border-nc-cyan/60'
                      }`}
                      title="Apply preset"
                    >
                      <img src={pres.image} alt="" className="w-full h-full object-cover" />
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {/* DISPLAY_NAME */}
          <div className="min-w-0">
            <label className="block text-xs font-bold text-nc-muted mb-1.5 font-mono tracking-wider">DISPLAY_NAME</label>
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="w-full px-3 py-2 border border-nc-border bg-nc-panel text-sm text-nc-text-bright font-mono focus:outline-none focus:border-nc-cyan focus:shadow-nc-cyan transition-all"
            />
            {agent.status === 'active' && displayName !== persistedDisplayName && (
              <p className="text-2xs text-nc-yellow mt-1 font-mono">
                Renaming a running agent updates the UI immediately, but the agent
                process keeps its old self-name until you stop and restart it.
              </p>
            )}
          </div>

          {/* AGENT_ID */}
          <div className="min-w-0">
            <label className="block text-xs font-bold text-nc-muted mb-1.5 font-mono tracking-wider">AGENT_ID</label>
            <button
              type="button"
              onClick={handleCopyId}
              className="w-full flex items-center justify-between gap-2 px-3 py-2 border border-nc-border bg-nc-elevated hover:bg-nc-panel transition-colors group"
            >
              <span className="text-xs font-mono text-nc-muted truncate">{agent.id}</span>
              <span className="shrink-0 text-nc-muted group-hover:text-nc-cyan transition-colors">
                {idCopied ? <Check size={12} className="text-nc-green" /> : <Copy size={12} />}
              </span>
            </button>
          </div>
        </div>

        {/* DESCRIPTION */}
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

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {/* RUNTIME */}
          <div className="min-w-0">
            <label className="block text-xs font-bold text-nc-muted mb-1.5 font-mono tracking-wider">RUNTIME</label>
            <div className="flex items-center gap-2 p-3 border border-nc-border bg-nc-elevated min-h-[42px]">
              <span className="font-bold text-sm text-nc-text-bright font-mono truncate">
                {formatRuntime(agent.runtime) || 'Unknown'}
              </span>
            </div>
          </div>

          {/* MACHINE */}
          {agent.machineId && (
            <div className="min-w-0">
              <label className="flex items-center gap-1.5 text-xs font-bold text-nc-muted mb-1.5 font-mono tracking-wider">
                <Server size={12} className="text-nc-green" /> MACHINE
              </label>
              <div className="flex items-center gap-2 p-3 border border-nc-border bg-nc-elevated min-h-[42px]">
                <span className="w-2 h-2 bg-nc-green shrink-0" />
                <span className="font-bold text-sm text-nc-text-bright font-mono truncate">
                  {machineLabel}
                </span>
                {machine?.hostname && machine.alias && (
                  <span className="text-xs text-nc-muted font-mono truncate">
                    {machine.hostname}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>

        <AgentSettingsFields
          mode="config"
          runtime={agent.runtime || ''}
          lifecycle={lifecycle}
          onLifecycleChange={setLifecycle}
          model={model}
          onModelChange={setModel}
          modelOptions={modelOptions}
          modelsLoading={modelsLoading}
          customModel={customModel}
          onCustomModelChange={setCustomModel}
          customLauncher={customLauncher}
          onCustomLauncherChange={setCustomLauncher}
          onCustomLauncherBlur={refreshModels}
          envVars={envVars}
          onEnvVarsChange={setEnvVars}
          ov={{
            mode: 'config',
            runtime: agent.runtime || '',
            ovDefaultForRuntime: persistedOvDefault,
            ovMcpDefaultForRuntime: persistedOvMcpDefault,
            ovEnabled,
            onOvEnabledChange: setOvEnabled,
            isOvDefault: persistedOvIsDefault && ovEnabled === persistedOvDefault,
            ovMcpEnabled,
            onOvMcpEnabledChange: setOvMcpEnabled,
            isOvMcpDefault: persistedOvMcpIsDefault && ovMcpEnabled === persistedOvMcpDefault,
            ovUseAgentNameAsUser,
            onOvUseAgentNameAsUserChange: setOvUseAgentNameAsUser,
            isProvisioned: !!savedConfig?.openvikingProvisioned,
            ovMode,
            onOvModeChange: setOvMode,
            ovCustomUrl,
            onOvCustomUrlChange: setOvCustomUrl,
            ovCustomApiKey,
            onOvCustomApiKeyChange: (v) => { setOvCustomApiKey(v); setOvCustomApiKeyDirty(true); },
            ovCustomConfigured: persistedOvCustomConfigured,
            ovUserId: savedConfig?.openvikingUserId,
            ovCustomValid,
          }}
        />

        {/* CHANNEL_ACCESS */}
        <div>
          <label className="block text-xs font-bold text-nc-muted mb-1.5 font-mono tracking-wider">CHANNEL_ACCESS</label>
          {visibleChannels === null ? (
            <div className="p-3 border border-nc-border bg-nc-elevated text-xs text-nc-muted font-mono">
              LOADING…
            </div>
          ) : visibleChannels.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {visibleChannels.map((ch) => (
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
              NO_CHANNELS
            </div>
          )}
        </div>

        {/* Action buttons */}
        {!isGuest && (
          <div className="flex items-center gap-3 pt-3 border-t border-nc-border flex-wrap">
            {isDirty && (
              <ScanlineTear config={{ trigger: 'hover', minInterval: 200, maxInterval: 600, minSeverity: 0.3, maxSeverity: 0.8 }}>
                <button
                  onClick={handleSave}
                  className={`cyber-btn flex items-center gap-1 ${btnPx} border border-nc-cyan bg-nc-cyan/10 ${btnText} font-bold text-nc-cyan hover:bg-nc-cyan/20 hover:shadow-nc-cyan font-mono`}
                >
                  <Save size={12} /> SAVE
                </button>
              </ScanlineTear>
            )}
            <ScanlineTear config={{ trigger: 'hover', minInterval: 200, maxInterval: 600, minSeverity: 0.3, maxSeverity: 0.8 }}>
              <button
                onClick={onDelete}
                className={`cyber-btn flex items-center gap-1 ${btnPx} border border-nc-red bg-nc-red/10 ${btnText} font-bold text-nc-red hover:bg-nc-red/20 hover:shadow-nc-red font-mono`}
              >
                <Trash2 size={12} /> DELETE_AGENT
              </button>
            </ScanlineTear>
            {agent.status === 'active' ? (
              <ScanlineTear className="ml-auto" config={{ trigger: 'hover', minInterval: 200, maxInterval: 600, minSeverity: 0.3, maxSeverity: 0.8 }}>
                <button
                  onClick={onStop}
                  className={`cyber-btn flex items-center gap-1 ${btnPx} border border-nc-red bg-nc-red/10 ${btnText} font-bold text-nc-red hover:bg-nc-red/20 hover:shadow-nc-red font-mono`}
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
                  className={`cyber-btn flex items-center gap-1 ${btnPx} border border-nc-green bg-nc-green/10 ${btnText} font-bold text-nc-green hover:bg-nc-green/20 hover:shadow-nc-green font-mono`}
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
