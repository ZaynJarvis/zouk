import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Save, Square, Play, Trash2, Camera, Server,
  Copy, Check, Plus, Minus, Loader2,
} from 'lucide-react';
import type { ServerAgent, ServerMachine } from '../../types';
import { useApp } from '../../store/AppContext';
import ScanlineTear from '../glitch/ScanlineTear';
import { formatRuntime } from '../../lib/runtimeLabels';
import { resizeAndEncode } from '../../lib/imageEncode';
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
  const ovDirty =
    ovEnabledDirty ||
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

        {/* LIFECYCLE */}
        <div>
          <label className="block text-xs font-bold text-nc-muted mb-1.5 font-mono tracking-wider">LIFECYCLE</label>
          <div className="grid grid-cols-2 gap-3">
            <ScanlineTear config={{ trigger: 'hover', minInterval: 200, maxInterval: 600, minSeverity: 0.3, maxSeverity: 0.8 }}>
              <button
                type="button"
                onClick={() => setLifecycle('persistent')}
                className={`cyber-btn w-full flex items-center gap-2 border px-3 py-2.5 text-left ${
                  lifecycle === 'persistent'
                    ? 'border-nc-cyan bg-nc-cyan/10 shadow-nc-cyan'
                    : 'border-nc-border hover:bg-nc-elevated'
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="font-bold text-sm text-nc-text-bright">PERSISTENT</div>
                  <div className="text-xs text-nc-muted font-mono">Keeps CLI session across idle</div>
                </div>
              </button>
            </ScanlineTear>
            <ScanlineTear config={{ trigger: 'hover', minInterval: 200, maxInterval: 600, minSeverity: 0.3, maxSeverity: 0.8 }}>
              <button
                type="button"
                onClick={() => setLifecycle('ephemeral')}
                className={`cyber-btn w-full flex items-center gap-2 border px-3 py-2.5 text-left ${
                  lifecycle === 'ephemeral'
                    ? 'border-nc-cyan bg-nc-cyan/10 shadow-nc-cyan'
                    : 'border-nc-border hover:bg-nc-elevated'
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="font-bold text-sm text-nc-text-bright">EPHEMERAL</div>
                  <div className="text-xs text-nc-muted font-mono">Fresh session after idle</div>
                </div>
              </button>
            </ScanlineTear>
          </div>
          <div className="mt-1.5 text-xs text-nc-muted font-mono">
            Takes effect on next agent restart.
          </div>
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

        {/* MODEL */}
        <div>
          <label className="flex items-center gap-2 text-xs font-bold text-nc-muted mb-1.5 font-mono tracking-wider">
            <span>MODEL</span>
            {modelsLoading && <Loader2 size={10} className="animate-spin text-nc-cyan" />}
          </label>
          {launcherActive && (
            <p className="text-2xs text-nc-yellow mb-1.5 font-mono">
              Custom launcher is set — the suggested model list may not apply. Type the exact model identifier your launcher expects.
            </p>
          )}
          {!launcherActive && modelOptions.length > 0 && !customModel ? (
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
                onClick={() => setCustomModel(true)}
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

        {/* CUSTOM_LAUNCHER */}
        {agent.runtime !== 'vikingbot' && (
          <div>
            <label className="block text-xs font-bold text-nc-muted mb-1.5 font-mono tracking-wider">CUSTOM_LAUNCHER</label>
            <input
              value={customLauncher}
              onChange={(e) => setCustomLauncher(e.target.value)}
              onBlur={refreshModels}
              placeholder={`e.g. /path/to/${agent.runtime || 'binary'} or env LANG=C ${agent.runtime || 'binary'}`}
              className="w-full px-3 py-2 border border-nc-border bg-nc-panel text-sm text-nc-text-bright placeholder:text-nc-muted font-mono focus:outline-none focus:border-nc-cyan focus:shadow-nc-cyan transition-all"
            />
            <p className="text-2xs text-nc-muted mt-1 font-mono">
              Override the default <span className="text-nc-cyan">{agent.runtime || ''}</span> binary. Leave blank for the runtime default. Split on whitespace into argv.
            </p>
            {agent.status === 'active' && customLauncherDirty && (
              <p className="text-2xs text-nc-yellow mt-1 font-mono">
                Saving applies on next agent start — restart the agent to use the new launcher.
              </p>
            )}
          </div>
        )}

        {/* OPENVIKING */}
        <div>
          <label className="flex items-center gap-2 text-xs font-bold text-nc-muted mb-1.5 font-mono tracking-wider">
            <span>OPENVIKING</span>
            {persistedOvIsDefault && ovEnabled === persistedOvDefault && (
              <span className="text-2xs text-nc-muted/70 normal-case tracking-normal">(default for {agent.runtime || 'this runtime'})</span>
            )}
          </label>
          <div className="grid grid-cols-2 gap-2 mb-2">
            <button
              type="button"
              onClick={() => setOvEnabled(true)}
              className={`px-2.5 py-2 border font-bold text-xs font-mono ${
                ovEnabled
                  ? 'border-nc-cyan bg-nc-cyan/10 text-nc-cyan'
                  : 'border-nc-border text-nc-muted hover:bg-nc-elevated'
              }`}
            >
              ENABLED
            </button>
            <button
              type="button"
              onClick={() => setOvEnabled(false)}
              className={`px-2.5 py-2 border font-bold text-xs font-mono ${
                !ovEnabled
                  ? 'border-nc-cyan bg-nc-cyan/10 text-nc-cyan'
                  : 'border-nc-border text-nc-muted hover:bg-nc-elevated'
              }`}
            >
              DISABLED
            </button>
          </div>
          {!ovEnabled ? (
            <div className="p-3 border border-nc-border bg-nc-elevated text-xs text-nc-muted font-mono">
              OV creds are not delivered to the daemon and Memory browsing is disabled for this agent. Toggle ENABLED above to turn on.
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2 mb-2">
                <button
                  type="button"
                  onClick={() => setOvMode('provisioned')}
                  className={`px-2.5 py-2 border font-bold text-xs font-mono ${
                    ovMode === 'provisioned'
                      ? 'border-nc-cyan bg-nc-cyan/10 text-nc-cyan'
                      : 'border-nc-border text-nc-muted hover:bg-nc-elevated'
                  }`}
                >
                  PROVISIONED
                </button>
                <button
                  type="button"
                  onClick={() => setOvMode('custom')}
                  className={`px-2.5 py-2 border font-bold text-xs font-mono ${
                    ovMode === 'custom'
                      ? 'border-nc-cyan bg-nc-cyan/10 text-nc-cyan'
                      : 'border-nc-border text-nc-muted hover:bg-nc-elevated'
                  }`}
                >
                  CUSTOM
                </button>
              </div>
              {ovMode === 'provisioned' ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 p-3 border border-nc-border bg-nc-elevated">
                    <span className={`w-2 h-2 shrink-0 ${savedConfig?.openvikingProvisioned ? 'bg-nc-green' : 'bg-nc-muted'}`} />
                    <span className="font-bold text-sm text-nc-text-bright font-mono">
                      {savedConfig?.openvikingProvisioned ? 'PROVISIONED' : 'NOT_PROVISIONED'}
                    </span>
                    {savedConfig?.openvikingUserId && (
                      <span className="text-xs text-nc-muted font-mono ml-auto truncate">{savedConfig.openvikingUserId}</span>
                    )}
                  </div>
                  <label className="flex items-center gap-2 text-xs text-nc-muted font-mono">
                    <input
                      type="checkbox"
                      checked={ovUseAgentNameAsUser}
                      onChange={(e) => setOvUseAgentNameAsUser(e.target.checked)}
                      disabled={!!savedConfig?.openvikingProvisioned}
                      className="accent-nc-cyan"
                    />
                    <span>USE_AGENT_NAME_AS_OV_USER</span>
                    {savedConfig?.openvikingProvisioned && (
                      <span className="ml-auto text-2xs text-nc-muted/70">LOCKED_AFTER_PROVISION</span>
                    )}
                  </label>
                </div>
              ) : (
                <div className="space-y-2">
                  <div>
                    <label className="block text-2xs font-bold text-nc-muted mb-1 font-mono tracking-wider">URL</label>
                    <input
                      type="text"
                      value={ovCustomUrl}
                      onChange={(e) => setOvCustomUrl(e.target.value)}
                      placeholder="https://your-openviking.example.com"
                      className="w-full px-2 py-1.5 border border-nc-border bg-nc-elevated text-sm font-mono text-nc-text-bright focus:outline-none focus:border-nc-cyan"
                    />
                  </div>
                  <div>
                    <label className="block text-2xs font-bold text-nc-muted mb-1 font-mono tracking-wider">API_KEY</label>
                    <input
                      type="password"
                      value={ovCustomApiKey}
                      onChange={(e) => { setOvCustomApiKey(e.target.value); setOvCustomApiKeyDirty(true); }}
                      placeholder={persistedOvCustomConfigured ? '•••••••••• (configured — leave blank to keep)' : 'paste new-format key'}
                      className="w-full px-2 py-1.5 border border-nc-border bg-nc-elevated text-sm font-mono text-nc-text-bright focus:outline-none focus:border-nc-cyan"
                    />
                  </div>
                  {!ovCustomValid && (
                    <p className="text-2xs text-nc-red font-mono">URL and API key are required for custom mode.</p>
                  )}
                </div>
              )}
            </>
          )}
        </div>

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

        {/* WORK_DIR */}
        {agent.workDir && (
          <div>
            <label className="block text-xs font-bold text-nc-muted mb-1.5 font-mono tracking-wider">WORK_DIR</label>
            <div
              className="p-3 border border-nc-border bg-nc-elevated text-xs font-mono text-nc-green"
              style={ncStyle({ textShadow: '0 0 4px rgb(var(--nc-green) / 0.3)' })}
            >
              {agent.workDir}
            </div>
          </div>
        )}

        {/* ENV_VARS */}
        <div>
          <label className="block text-xs font-bold text-nc-muted mb-1.5 font-mono tracking-wider">ENV_VARS</label>
          <div className="space-y-1.5">
            {Object.entries(envVars).map(([key, value]) => (
              <div key={key} className="flex items-center gap-1.5">
                <input
                  value={key}
                  readOnly
                  className="w-[40%] px-2 py-1.5 border border-nc-border bg-nc-elevated text-xs text-nc-text-bright font-mono focus:outline-none truncate"
                  title={key}
                />
                <input
                  value={value}
                  onChange={(e) => setEnvVars((prev) => ({ ...prev, [key]: e.target.value }))}
                  className="flex-1 px-2 py-1.5 border border-nc-border bg-nc-panel text-xs text-nc-text-bright font-mono focus:outline-none focus:border-nc-cyan transition-all truncate"
                  title={value}
                />
                <button
                  type="button"
                  onClick={() => setEnvVars((prev) => { const next = { ...prev }; delete next[key]; return next; })}
                  className="shrink-0 p-1 border border-nc-border text-nc-muted hover:text-nc-red hover:border-nc-red transition-colors"
                >
                  <Minus size={12} />
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => {
              const key = prompt('Variable name:');
              if (key && key.trim() && !(key.trim() in envVars)) {
                setEnvVars((prev) => ({ ...prev, [key.trim()]: '' }));
              }
            }}
            className="mt-2 flex items-center gap-1 text-2xs font-mono text-nc-muted hover:text-nc-cyan transition-colors"
          >
            <Plus size={10} /> ADD_VARIABLE
          </button>
          {envVarsDirty && (
            <p className="text-2xs text-nc-yellow mt-1 font-mono">
              Env var changes take effect on next agent start.
            </p>
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
