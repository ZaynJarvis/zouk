import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Save, Square, Play, Trash2, Camera,
  Copy, Check, Cpu, Zap, GitBranch,
} from 'lucide-react';
import type { ServerAgent, ServerMachine } from '../../types';
import { useApp } from '../../store/AppContext';
import { formatRuntime } from '../../lib/runtimeLabels';
import { resizeAndEncode } from '../../lib/imageEncode';
import AgentSettingsFields from './AgentSettingsFields';
import { fetchRuntimeModels, fetchAgentChannels, ovProxyUrl, type RuntimeModel } from '../../lib/api';
import ZkField from '../zk/ZkField';
import ZkCallout from '../zk/ZkCallout';

export default function AgentConfigForm({
  agent,
  machines,
  onStop,
  onDelete,
  onClone,
  compact = false,
}: {
  agent: ServerAgent;
  machines?: ServerMachine[];
  onStop: () => void;
  onDelete: () => void;
  onClone?: () => void;
  compact?: boolean;
}) {
  const { configs, profilePresets, isGuest, startAgent, updateAgentConfig, canAdminWorkspace } = useApp();

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
  const persistedOvCustomUrl = savedConfig?.openvikingCustomUrl ?? '';
  const persistedOvCustomConfigured = !!savedConfig?.openvikingCustomConfigured;
  const persistedOvEnabledRaw = savedConfig?.openvikingEnabled;
  const persistedOvEnabledResolved = typeof agent.ovEnabled === 'boolean' ? agent.ovEnabled : false;
  const persistedOvIsDefault = agent.ovEnabledIsDefault !== false;
  const persistedOvDefault = !!agent.ovDefault;
  const persistedOvMcpEnabledRaw = savedConfig?.ovMcpEnabled;
  const persistedOvMcpEnabledResolved = typeof agent.ovMcpEnabled === 'boolean' ? agent.ovMcpEnabled : false;
  const persistedOvMcpIsDefault = agent.ovMcpEnabledIsDefault !== false;
  const persistedOvMcpDefault = !!agent.ovMcpDefault;
  // Default true (the column default). Only an explicit false counts as opt-out.
  const persistedDisableLocalOvPlugin = savedConfig?.disableLocalOvPlugin !== false;
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
  const [ovCustomUrl, setOvCustomUrl] = useState<string>(persistedOvCustomUrl ?? '');
  const [ovCustomApiKey, setOvCustomApiKey] = useState<string>('');
  const [ovCustomApiKeyDirty, setOvCustomApiKeyDirty] = useState(false);
  const persistedCustomLauncher = savedConfig?.customLauncher ?? '';
  const [customLauncher, setCustomLauncher] = useState<string>(persistedCustomLauncher);
  const [disableLocalOvPlugin, setDisableLocalOvPlugin] = useState<boolean>(persistedDisableLocalOvPlugin);
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
  const ovEnabledDirty = typeof persistedOvEnabledRaw === 'boolean'
    ? ovEnabled !== persistedOvEnabledRaw
    : ovEnabled !== persistedOvDefault;
  const ovMcpEnabledDirty = typeof persistedOvMcpEnabledRaw === 'boolean'
    ? ovMcpEnabled !== persistedOvMcpEnabledRaw
    : ovMcpEnabled !== persistedOvMcpDefault;
  const ovDirty =
    ovEnabledDirty ||
    ovMcpEnabledDirty ||
    ovMode !== persistedOvMode ||
    (ovMode === 'custom' && (ovCustomUrl !== (persistedOvCustomUrl ?? '') || ovCustomApiKeyDirty));
  const ovCustomValid =
    !ovEnabled ||
    ovMode !== 'custom' ||
    (ovCustomUrl.trim().length > 0 && (persistedOvCustomConfigured || ovCustomApiKey.length > 0));
  const customLauncherDirty = customLauncher.trim() !== (persistedCustomLauncher ?? '').trim();
  const disableLocalOvPluginDirty = disableLocalOvPlugin !== persistedDisableLocalOvPlugin;
  const isDirty =
    displayName !== persistedDisplayName ||
    description !== persistedDescription ||
    lifecycle !== persistedLifecycle ||
    model !== persistedModel ||
    envVarsDirty ||
    ovDirty ||
    customLauncherDirty ||
    disableLocalOvPluginDirty;

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
    if (disableLocalOvPluginDirty) {
      payload.disableLocalOvPlugin = disableLocalOvPlugin;
    }
    if (ovDirty) {
      if (ovEnabledDirty) {
        payload.openvikingEnabled = ovEnabled;
      }
      if (ovMcpEnabledDirty) {
        payload.ovMcpEnabled = ovMcpEnabled;
      }
      payload.openvikingMode = ovMode;
      if (ovMode === 'custom') {
        payload.openvikingCustomUrl = ovCustomUrl.trim();
        if (ovCustomApiKeyDirty && ovCustomApiKey.length > 0) {
          payload.openvikingCustomApiKey = ovCustomApiKey;
        }
      }
    }
    updateAgentConfig(agent.id, payload);
    if (ovCustomApiKeyDirty) {
      setOvCustomApiKey('');
      setOvCustomApiKeyDirty(false);
    }
  };

  const avatarSize = compact ? 56 : 64;
  const avatarFont = compact ? 18 : 20;
  const presetSize = compact ? 36 : 40;

  const card: React.CSSProperties = {
    padding: '12px 14px',
    background: 'var(--zk-bg-2)',
    border: '1px solid var(--zk-line)',
    borderRadius: 'var(--zk-r-lg)',
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  };
  const secTitle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 6,
    fontSize: 12, fontWeight: 600, fontFamily: 'var(--zk-font-sans)',
    textTransform: 'uppercase',
    letterSpacing: '0.04em', color: 'var(--zk-ink-dim)',
    borderBottom: '1px solid var(--zk-line)', paddingBottom: 8, marginBottom: 2,
  };

  return (
    <div
      style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: compact ? 16 : 20, overflowY: 'auto' }}
      className="zk-scroll"
    >
      <div style={{ maxWidth: 520, display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* ── Identity ── */}
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
          {/* Avatar */}
          <div
            style={{
              position: 'relative', width: avatarSize, height: avatarSize, flexShrink: 0,
              borderRadius: 'var(--zk-r-lg)', border: '1px solid var(--zk-ember-line)',
              background: 'var(--zk-ember-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', overflow: 'hidden', fontFamily: 'var(--zk-font-display)',
              fontWeight: 600, fontSize: avatarFont, color: 'var(--zk-ember)',
            }}
            onClick={() => pictureInputRef.current?.click()}
          >
            {picture ? (
              <img src={picture} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              (agent.displayName || agent.name).charAt(0).toUpperCase()
            )}
            <div
              style={{
                position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                opacity: 0, transition: 'opacity 160ms',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.opacity = '1')}
              onMouseLeave={(e) => (e.currentTarget.style.opacity = '0')}
            >
              <Camera size={compact ? 16 : 18} color="white" />
            </div>
            <input ref={pictureInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handlePictureUpload} />
          </div>

          {/* Name + ID column */}
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <ZkField label="Display name">
              <input className="zk-input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
            </ZkField>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontFamily: 'var(--zk-font-mono)', color: 'var(--zk-ink-mute)' }}>
              <span title="Permanent @mention handle — can't be changed">@{agent.name}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontFamily: 'var(--zk-font-mono)', color: 'var(--zk-ink-mute)' }}>
              <span>ID: {agent.id}</span>
              <button
                type="button" onClick={handleCopyId}
                className="zk-link"
                title="Copy ID"
              >
                {idCopied ? <Check size={12} style={{ color: 'var(--zk-ok)' }} /> : <Copy size={12} />}
              </button>
            </div>
          </div>
        </div>
        {agent.status === 'active' && displayName !== persistedDisplayName && (
          <ZkCallout type="warn">
            Name updates the UI immediately, but the agent process keeps its old self-name until restarted.
          </ZkCallout>
        )}

        {/* Presets */}
        {profilePresets.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {profilePresets.map((pres) => {
              const active = picture === pres.image;
              return (
                <button key={pres.id} type="button" onClick={() => handlePresetSelect(pres.image)}
                  style={{
                    width: presetSize, height: presetSize, borderRadius: 'var(--zk-r-md)',
                    border: `1px solid ${active ? 'var(--zk-ember)' : 'var(--zk-line)'}`,
                    overflow: 'hidden', cursor: 'pointer', padding: 0, background: 'transparent',
                    boxShadow: active ? 'var(--zk-shadow-glow)' : 'none', transition: 'border-color 160ms, box-shadow 160ms',
                  }}
                  onMouseEnter={(e) => { if (!active) e.currentTarget.style.borderColor = 'var(--zk-ember-line)'; }}
                  onMouseLeave={(e) => { if (!active) e.currentTarget.style.borderColor = 'var(--zk-line)'; }}
                >
                  <img src={pres.image} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                </button>
              );
            })}
          </div>
        )}

        {/* Description */}
        <ZkField label="Description">
          <textarea className="zk-input zk-input--textarea" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="What does this agent do?" />
        </ZkField>

        {/* ── Infrastructure ── */}
        <div style={card}>
          <div style={secTitle}>
            <Cpu size={12} style={{ color: 'var(--zk-ember)' }} />
            Infrastructure
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: agent.machineId ? '1fr 1fr' : '1fr', gap: 10, alignItems: 'end' }}>
            <ZkField label="Runtime">
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px',
                background: 'var(--zk-bg-3)', border: '1px solid var(--zk-line)', borderRadius: 'var(--zk-r-md)', minHeight: 34,
              }}>
                <span className="zk-mono" style={{ fontWeight: 600, fontSize: 12, color: 'var(--zk-ink)' }}>
                  {formatRuntime(agent.runtime) || 'Unknown'}
                </span>
              </div>
            </ZkField>
            {agent.machineId && (
              <ZkField label="Machine">
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px',
                  background: 'var(--zk-bg-3)', border: '1px solid var(--zk-line)', borderRadius: 'var(--zk-r-md)', minHeight: 34,
                }}>
                  <span className="zk-dot zk-dot--online" />
                  <span className="zk-mono" style={{ fontWeight: 600, fontSize: 12, color: 'var(--zk-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {machineLabel}
                  </span>
                  {machine?.hostname && machine.alias && (
                    <span className="zk-mono" style={{ fontSize: 10, color: 'var(--zk-ink-mute)' }}>{machine.hostname}</span>
                  )}
                </div>
              </ZkField>
            )}
          </div>
        </div>

        {/* ── Settings ── */}
        <div style={card}>
          <div style={secTitle}>
            <Zap size={12} style={{ color: 'var(--zk-ember)' }} />
            Settings
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
            disableLocalOvPlugin={disableLocalOvPlugin}
            onDisableLocalOvPluginChange={setDisableLocalOvPlugin}
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
              agentId: agent.id,
              // Copyable creds route through the server /ov proxy, not the real
              // OV endpoint — the URL is the proxy, the key (admin-only) is the
              // agent token.
              provisionedUrl: savedConfig?.openvikingProvisioned ? ovProxyUrl() : null,
              canRevealKey: !!canAdminWorkspace,
            }}
          />
        </div>

        {/* Channel access */}
        <ZkField label="Channel access">
          {visibleChannels === null ? (
            <div style={{ padding: '6px 10px', fontSize: 12, color: 'var(--zk-ink-mute)', fontFamily: 'var(--zk-font-sans)' }}>
              Loading...
            </div>
          ) : visibleChannels.length > 0 ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {visibleChannels.map((ch) => (
                <span key={ch} className="zk-pill zk-pill--ember">#{ch}</span>
              ))}
            </div>
          ) : (
            <div style={{ padding: '6px 10px', fontSize: 12, color: 'var(--zk-ink-mute)', fontFamily: 'var(--zk-font-sans)' }}>
              No channels
            </div>
          )}
        </ZkField>

        {/* Action buttons */}
        {!isGuest && (
          <>
            <hr className="zk-hr" style={{ margin: '8px 0' }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              {isDirty && (
                <button onClick={handleSave} className="zk-btn zk-btn--primary">
                  <Save size={12} /> Save
                </button>
              )}
              {!agent.cloneOf && onClone && (
                <button onClick={onClone} className="zk-btn" title="Create a helper clone sharing this agent's workspace and memory">
                  <GitBranch size={12} /> Clone
                </button>
              )}
              <button onClick={onDelete} className="zk-btn zk-btn--danger">
                <Trash2 size={12} /> Delete agent
              </button>
              {agent.status === 'active' ? (
                <button onClick={onStop} className="zk-btn zk-btn--danger" style={{ marginLeft: 'auto' }}>
                  <Square size={12} /> Stop
                </button>
              ) : (
                <button onClick={() => startAgent({
                    id: agent.id, name: agent.name, displayName: agent.displayName,
                    description: agent.description, runtime: agent.runtime ?? 'claude', model: agent.model,
                  })} className="zk-btn"
                  style={{ marginLeft: 'auto', color: 'var(--zk-ok)', borderColor: 'rgba(111,182,151,0.25)' }}
                >
                  <Play size={12} /> Start
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
