import { useState, useEffect, useMemo, useCallback } from 'react';
import { Plus, Copy, Check, Star, Cpu, Zap } from 'lucide-react';
import type { ServerMachine } from '../types';
import { formatRuntime, formatRuntimes } from '../lib/runtimeLabels';
import { fetchRuntimeModels, type RuntimeModel } from '../lib/api';
import { useApp } from '../store/AppContext';
import AgentSettingsFields from './agent/AgentSettingsFields';
import ZkDialog from './zk/ZkDialog';
import ZkField from './zk/ZkField';
import ZkCallout from './zk/ZkCallout';
import ZkSegmentedControl from './zk/ZkSegmentedControl';

export interface CreateAgentConfig {
  name: string;
  description: string;
  runtime: string;
  model: string;
  machineId?: string;
  lifecycle: 'persistent' | 'ephemeral';
  openvikingEnabled?: boolean;
  openvikingUseAgentNameAsUser?: boolean;
  ovMcpEnabled?: boolean;
  customLauncher?: string;
  envVars?: Record<string, string>;
}

const sectionCard: React.CSSProperties = {
  padding: '12px 14px',
  background: 'var(--zk-bg-2)',
  border: '1px solid var(--zk-line)',
  borderRadius: 'var(--zk-r-lg)',
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
};

const sectionTitle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 12,
  fontWeight: 600,
  textTransform: 'uppercase',
  fontFamily: 'var(--zk-font-sans)',
  letterSpacing: '0.04em',
  color: 'var(--zk-ink-dim)',
  borderBottom: '1px solid var(--zk-line)',
  paddingBottom: 8,
  marginBottom: 2,
};

export default function CreateAgentDialog({
  machines,
  onClose,
  onCreate,
  onOpenMachineSetup,
}: {
  machines: ServerMachine[];
  onClose: () => void;
  onCreate: (config: CreateAgentConfig) => void;
  onOpenMachineSetup?: () => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selectedMachineId, setSelectedMachineId] = useState<string>(machines[0]?.id ?? '');
  const [runtime, setRuntime] = useState('');
  const [model, setModel] = useState('');
  const [lifecycle, setLifecycle] = useState<'persistent' | 'ephemeral'>('persistent');
  const [machineOpen, setMachineOpen] = useState(false);
  const [modelOptions, setModelOptions] = useState<RuntimeModel[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [customModel, setCustomModel] = useState(false);
  const [ovInstallCopied, setOvInstallCopied] = useState(false);
  const [ovEnabledOverride, setOvEnabledOverride] = useState<boolean | null>(null);
  const [ovMcpEnabledOverride, setOvMcpEnabledOverride] = useState<boolean | null>(null);
  const [ovUseAgentNameAsUser, setOvUseAgentNameAsUser] = useState(false);
  const [customLauncher, setCustomLauncher] = useState('');
  const [envVars, setEnvVars] = useState<Record<string, string>>({});

  const { ovRuntimeWhitelist, ovMcpRuntimeWhitelist } = useApp();
  const OV_INSTALL_COMMANDS: Record<string, string> = {
    claude: 'bash <(curl -fsSL https://raw.githubusercontent.com/volcengine/OpenViking/main/examples/claude-code-memory-plugin/setup-helper/install.sh)',
    codex: 'bash <(curl -fsSL https://raw.githubusercontent.com/volcengine/OpenViking/main/examples/codex-memory-plugin/setup-helper/install.sh)',
  };
  const installCommand = OV_INSTALL_COMMANDS[runtime] || '';

  const selectedMachine = machines.find(m => m.id === selectedMachineId);
  const machineRuntimes = useMemo(() => selectedMachine?.runtimes || [], [selectedMachine]);

  useEffect(() => {
    if (machineRuntimes.length === 0) {
      if (runtime) setRuntime('');
      return;
    }
    if (!machineRuntimes.includes(runtime)) {
      setRuntime(machineRuntimes[0]);
    }
  }, [machineRuntimes, runtime]);

  useEffect(() => { setCustomLauncher(''); }, [runtime]);

  const launcherActive = customLauncher.trim().length > 0;
  useEffect(() => {
    if (launcherActive) { setCustomModel(true); setModel(''); }
  }, [launcherActive]);

  const refreshModels = useCallback(() => {
    if (!runtime || !selectedMachine) { setModelOptions([]); setModel(''); return; }
    let cancelled = false;
    setModelsLoading(true);
    fetchRuntimeModels(selectedMachine.id, runtime)
      .then((result) => {
        if (cancelled) return;
        setModelOptions(result.models);
        if (result.models.length > 0) {
          const preferred = result.default && result.models.some((m) => m.id === result.default)
            ? result.default : result.models[0].id;
          setModel((current) => (current && result.models.some((m) => m.id === current) ? current : preferred));
        }
      })
      .finally(() => { if (!cancelled) setModelsLoading(false); });
    return () => { cancelled = true; };
  }, [runtime, selectedMachine]);

  useEffect(() => { setModel(''); setCustomModel(false); setModelOptions([]); return refreshModels(); }, [refreshModels]);

  const canSubmit = name.trim().length > 0 && runtime.length > 0;
  const ovDefaultForRuntime = !!runtime && ovRuntimeWhitelist.includes(runtime);
  const ovMcpDefaultForRuntime = !!runtime && ovMcpRuntimeWhitelist.includes(runtime);
  const effectiveOvEnabled = ovEnabledOverride === null ? ovDefaultForRuntime : ovEnabledOverride;
  const effectiveOvMcpEnabled = ovMcpEnabledOverride === null ? ovMcpDefaultForRuntime : ovMcpEnabledOverride;

  const handleSubmit = () => {
    if (!canSubmit) return;
    onCreate({
      name: name.trim().toLowerCase(),
      description: description.trim(),
      runtime,
      model: model.trim(),
      machineId: selectedMachine?.id,
      lifecycle,
      ...(ovEnabledOverride === null ? {} : { openvikingEnabled: ovEnabledOverride }),
      ...(ovMcpEnabledOverride === null ? {} : { ovMcpEnabled: ovMcpEnabledOverride }),
      ...(effectiveOvEnabled && ovUseAgentNameAsUser ? { openvikingUseAgentNameAsUser: true } : {}),
      ...(customLauncher.trim() ? { customLauncher: customLauncher.trim() } : {}),
      ...(Object.keys(envVars).length > 0 ? { envVars } : {}),
    });
  };

  return (
    <ZkDialog
      title="Create agent"
      subtitle="Create a new AI agent on a connected machine."
      onClose={onClose}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* No machines warning */}
        {machines.length === 0 && (
          <ZkCallout type="warn" title="No machines connected">
            <p style={{ margin: 0 }}>Connect a daemon to run agents.</p>
            {onOpenMachineSetup && (
              <button
                onClick={() => { onClose(); onOpenMachineSetup(); }}
                className="zk-link zk-link--underline"
                style={{ marginTop: 8, color: 'var(--zk-warn)' }}
              >
                Machine setup
              </button>
            )}
          </ZkCallout>
        )}

        {/* ── Identity ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <ZkField label="Name" hint="Used in @mentions and DM channels. Lowercase only.">
            <input className="zk-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. bob" autoFocus />
          </ZkField>
          <ZkField label="Description">
            <textarea className="zk-input zk-input--textarea" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What does this agent do?" rows={2} />
          </ZkField>
        </div>

        {/* ── Infrastructure ── */}
        {machines.length > 0 && (
          <div style={sectionCard}>
            <div style={sectionTitle}>
              <Cpu size={12} style={{ color: 'var(--zk-ember)' }} />
              Infrastructure
            </div>

            {/* Machine */}
            <ZkField label="Machine">
              <div style={{ position: 'relative' }}>
                <button
                  type="button"
                  onClick={() => setMachineOpen(!machineOpen)}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '7px 10px', background: 'var(--zk-bg-3)', border: '1px solid var(--zk-line)',
                    borderRadius: 'var(--zk-r-md)', cursor: 'pointer', textAlign: 'left', fontSize: 13,
                    transition: 'border-color 160ms',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--zk-line-bright)')}
                  onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--zk-line)')}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
                    <span className="zk-dot zk-dot--online" />
                    <span className="zk-mono" style={{ fontWeight: 600, color: 'var(--zk-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {selectedMachine?.alias || selectedMachine?.hostname || 'Select machine...'}
                    </span>
                    {selectedMachine && (
                      <span style={{ fontSize: 10, color: 'var(--zk-ink-mute)', fontFamily: 'var(--zk-font-mono)' }}>
                        {selectedMachine.os} · {(selectedMachine.runtimes || []).length} runtime{(selectedMachine.runtimes || []).length !== 1 ? 's' : ''}
                      </span>
                    )}
                  </div>
                  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
                    style={{ color: 'var(--zk-ink-mute)', transition: 'transform 160ms', transform: machineOpen ? 'rotate(180deg)' : 'none', flexShrink: 0 }}>
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </button>
                {machineOpen && (
                  <>
                    <div
                      style={{ position: 'fixed', inset: 0, zIndex: 9 }}
                      onClick={() => setMachineOpen(false)}
                    />
                    <div style={{
                      position: 'absolute', zIndex: 10, marginTop: 4, width: '100%',
                    background: 'var(--zk-bg-1)', border: '1px solid var(--zk-line)',
                    borderRadius: 'var(--zk-r-lg)', boxShadow: 'var(--zk-shadow-2)', maxHeight: 192, overflowY: 'auto',
                  }}>
                    {machines.map((m) => (
                      <button key={m.id} onClick={() => { setSelectedMachineId(m.id); setMachineOpen(false); }}
                        style={{
                          width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
                          background: m.id === selectedMachineId ? 'var(--zk-bg-3)' : 'transparent',
                          border: 'none', cursor: 'pointer', textAlign: 'left', fontSize: 13, transition: 'background 120ms',
                        }}
                        onMouseEnter={(e) => { if (m.id !== selectedMachineId) e.currentTarget.style.background = 'var(--zk-bg-2)'; }}
                        onMouseLeave={(e) => { if (m.id !== selectedMachineId) e.currentTarget.style.background = 'transparent'; }}
                      >
                        <span className="zk-dot zk-dot--online" />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <span className="zk-mono" style={{ fontWeight: 600, color: 'var(--zk-ink)', fontSize: 12 }}>
                            {m.alias || m.hostname}
                          </span>
                          {m.alias && <span className="zk-mono" style={{ fontSize: 10, color: 'var(--zk-ink-mute)', marginLeft: 6 }}>{m.hostname}</span>}
                          <div style={{ fontSize: 10, color: 'var(--zk-ink-mute)', fontFamily: 'var(--zk-font-mono)', marginTop: 1 }}>
                            {m.os} · Runtimes: {formatRuntimes(m.runtimes) || 'none'}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                  </>
                )}
              </div>
            </ZkField>

            {/* Runtime */}
            <ZkField label="Runtime">
              {machineRuntimes.length > 0 ? (
                <ZkSegmentedControl
                  value={runtime}
                  onChange={setRuntime}
                  style={{ flexWrap: 'wrap' }}
                  options={machineRuntimes.map(rt => ({
                    value: rt,
                    label: (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        {formatRuntime(rt)}
                        {ovRuntimeWhitelist.includes(rt) && (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, color: 'var(--zk-warn)', fontSize: 9 }}>
                            <Star size={9} fill="currentColor" /> OV
                          </span>
                        )}
                      </div>
                    )
                  }))}
                />
              ) : (
                <div style={{ padding: '6px 10px', background: 'var(--zk-bg-3)', border: '1px solid var(--zk-line)', borderRadius: 'var(--zk-r-md)', fontSize: 12, fontFamily: 'var(--zk-font-sans)', color: 'var(--zk-ink-mute)' }}>
                  {selectedMachine ? 'No runtimes available. Install a supported CLI on the daemon host.' : 'Connect a daemon to see available runtimes.'}
                </div>
              )}
            </ZkField>

            {/* OV install hint */}
            {ovRuntimeWhitelist.includes(runtime) && installCommand && (
              <ZkCallout type="warn">
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
                  <span>{formatRuntime(runtime)} supports OpenViking memory plugin.</span>
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                  <code style={{
                    flex: 1, padding: '5px 8px', background: 'var(--zk-bg-0)', border: '1px solid var(--zk-line)',
                    borderRadius: 'var(--zk-r-sm)', fontSize: 10, fontFamily: 'var(--zk-font-mono)',
                    color: 'var(--zk-ok)', wordBreak: 'break-all', userSelect: 'all',
                  }}>
                    {installCommand}
                  </code>
                  <button type="button" onClick={() => { navigator.clipboard.writeText(installCommand); setOvInstallCopied(true); setTimeout(() => setOvInstallCopied(false), 2000); }}
                    className="zk-btn zk-btn--ghost zk-btn--icon" style={{ flexShrink: 0 }} title="Copy">
                    {ovInstallCopied ? <Check size={12} style={{ color: 'var(--zk-ok)' }} /> : <Copy size={12} />}
                  </button>
                </div>
              </ZkCallout>
            )}

            {/* Runtime availability notice */}
            {runtime && (
              <ZkCallout type="info">
                Runtime CLI must be installed, authenticated, and working on the daemon host. If missing or not logged in, the agent will fail to launch.
              </ZkCallout>
            )}
          </div>
        )}

        {/* ── Settings ── */}
        <div style={sectionCard}>
          <div style={sectionTitle}>
            <Zap size={12} style={{ color: 'var(--zk-ember)' }} />
            Settings
          </div>
          <AgentSettingsFields
            mode="create"
            runtime={runtime}
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
              mode: 'create',
              runtime,
              ovDefaultForRuntime,
              ovMcpDefaultForRuntime,
              ovEnabled: effectiveOvEnabled,
              onOvEnabledChange: (v) => setOvEnabledOverride(v),
              isOvDefault: ovEnabledOverride === null,
              ovMcpEnabled: effectiveOvMcpEnabled,
              onOvMcpEnabledChange: (v) => setOvMcpEnabledOverride(v),
              isOvMcpDefault: ovMcpEnabledOverride === null,
              ovUseAgentNameAsUser,
              onOvUseAgentNameAsUserChange: setOvUseAgentNameAsUser,
            }}
          />
        </div>

        {/* ── Footer ── */}
        <div style={{ display: 'flex', gap: 10, paddingTop: 16, borderTop: '1px solid var(--zk-line)' }}>
          <button onClick={handleSubmit} disabled={!canSubmit} className="zk-btn zk-btn--primary" style={{ flex: 1 }}>
            <Plus size={14} /> Create and start
          </button>
          <button onClick={onClose} className="zk-btn zk-btn--ghost">Cancel</button>
        </div>
      </div>
    </ZkDialog>
  );
}
