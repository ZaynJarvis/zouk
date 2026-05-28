import { useState } from 'react';
import { ChevronDown, Plus, Minus, Loader2 } from 'lucide-react';
import type { RuntimeModel } from '../../lib/api';
import { OvBasicToggle, OvAdvancedSection, type OvSectionProps } from './OvSection';
import ZkField from '../zk/ZkField';
import ZkSegmentedControl from '../zk/ZkSegmentedControl';

export interface AgentSettingsFieldsProps {
  mode: 'create' | 'config';
  runtime: string;

  lifecycle: 'persistent' | 'ephemeral';
  onLifecycleChange: (v: 'persistent' | 'ephemeral') => void;

  model: string;
  onModelChange: (v: string) => void;
  modelOptions: RuntimeModel[];
  modelsLoading?: boolean;
  customModel: boolean;
  onCustomModelChange: (v: boolean) => void;

  customLauncher: string;
  onCustomLauncherChange: (v: string) => void;
  onCustomLauncherBlur?: () => void;

  envVars: Record<string, string>;
  onEnvVarsChange: (v: Record<string, string>) => void;

  disableLocalOvPlugin: boolean;
  onDisableLocalOvPluginChange: (v: boolean) => void;

  ov: OvSectionProps;
}

export default function AgentSettingsFields(props: AgentSettingsFieldsProps) {
  const {
    mode, runtime,
    lifecycle, onLifecycleChange,
    model, onModelChange, modelOptions, modelsLoading, customModel, onCustomModelChange,
    customLauncher, onCustomLauncherChange, onCustomLauncherBlur,
    envVars, onEnvVarsChange,
    disableLocalOvPlugin, onDisableLocalOvPluginChange,
    ov,
  } = props;

  const [advancedOpen, setAdvancedOpen] = useState(mode === 'config');
  const launcherActive = customLauncher.trim().length > 0;
  const isVikingbot = runtime === 'vikingbot';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Lifecycle */}
      <ZkField
        label="Lifecycle"
        hint="Persistent keeps context between idle periods. Ephemeral starts fresh after idle."
      >
        <ZkSegmentedControl
          value={lifecycle}
          onChange={onLifecycleChange}
          options={[
            { value: 'persistent', label: 'Persistent' },
            { value: 'ephemeral', label: 'Ephemeral' }
          ]}
        />
      </ZkField>

      {/* Model */}
      {runtime && (
        <ZkField
          label="Model"
          hint="Pick from suggested models, or type a custom model ID. Leave blank for runtime default."
        >
          {modelsLoading && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <Loader2 size={12} style={{ color: 'var(--zk-ember)', animation: 'spin 1s linear infinite' }} />
              <span style={{ fontSize: 11, color: 'var(--zk-ink-mute)', fontFamily: 'var(--zk-font-sans)' }}>
                Loading models...
              </span>
            </div>
          )}
          {launcherActive && (
            <p style={{
              fontSize: 11,
              color: 'var(--zk-warn)',
              fontFamily: 'var(--zk-font-sans)',
              margin: '0 0 4px',
            }}>
              Custom launcher is set — the suggested model list may not apply.
            </p>
          )}
          {!launcherActive && modelOptions.length > 0 && !customModel ? (
            <>
              <ZkSegmentedControl
                value={model}
                onChange={onModelChange}
                style={{ flexWrap: 'wrap' }}
                options={modelOptions.map(m => ({ value: m.id, label: m.label }))}
              />
              <button
                type="button"
                onClick={() => { onCustomModelChange(true); onModelChange(''); }}
                className="zk-link zk-link--underline"
                style={{ marginTop: 4, width: 'fit-content' }}
              >
                Use custom model ID
              </button>
            </>
          ) : (
            <>
              <input
                className="zk-input"
                value={model}
                onChange={(e) => onModelChange(e.target.value)}
                placeholder="Model identifier (leave blank for runtime default)"
              />
              {modelOptions.length > 0 && customModel && (
                <button
                  type="button"
                  onClick={() => { onCustomModelChange(false); onModelChange(modelOptions[0].id); }}
                  className="zk-link zk-link--underline"
                  style={{ marginTop: 4, width: 'fit-content' }}
                >
                  Back to suggested models
                </button>
              )}
            </>
          )}
        </ZkField>
      )}

      {/* OV Basic */}
      {runtime && (
        <OvBasicToggle
          runtime={runtime}
          ovEnabled={ov.ovEnabled}
          onOvEnabledChange={ov.onOvEnabledChange}
          isOvDefault={ov.isOvDefault}
        />
      )}

      {/* Advanced */}
      {runtime && (
        <div>
          <button
            type="button"
            onClick={() => setAdvancedOpen(!advancedOpen)}
            className="zk-link"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 11,
              fontWeight: 600,
              fontFamily: 'var(--zk-font-mono)',
              letterSpacing: '0.02em',
              color: advancedOpen ? 'var(--zk-ink)' : 'var(--zk-ink-dim)',
            }}
          >
            <ChevronDown
              size={14}
              style={{
                transition: 'transform 160ms var(--zk-ease-out)',
                transform: advancedOpen ? 'none' : 'rotate(-90deg)',
              }}
            />
            Advanced
          </button>

          {advancedOpen && (
            <div
              style={{
                marginTop: 8,
                paddingLeft: 12,
                borderLeft: '1px solid var(--zk-line)',
                marginLeft: 2,
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
              }}
            >
              {/* OV Advanced */}
              {ov.ovEnabled && <OvAdvancedSection {...ov} />}

              {/* Custom launcher */}
              {!isVikingbot && (
                <ZkField
                  label="Custom launcher"
                  hint="Override the default CLI binary. Useful for wrappers or custom builds."
                >
                  <input
                    className="zk-input"
                    value={customLauncher}
                    onChange={(e) => onCustomLauncherChange(e.target.value)}
                    onBlur={onCustomLauncherBlur}
                    placeholder={`e.g. /path/to/${runtime} or env LANG=C ${runtime}`}
                  />
                </ZkField>
              )}

              {/* Local OV plugin */}
              <ZkField
                label="Host OV plugin"
                hint="The agent's host machine may have a personal OpenViking plugin installed. Disable keeps server-managed OV the single source of truth; allow lets the local plugin run alongside it."
              >
                <ZkSegmentedControl
                  value={disableLocalOvPlugin ? 'disable' : 'allow'}
                  onChange={(v) => onDisableLocalOvPluginChange(v === 'disable')}
                  options={[
                    { value: 'disable', label: 'Disable (default)' },
                    { value: 'allow', label: 'Allow' }
                  ]}
                />
              </ZkField>

              {/* Environment variables */}
              <ZkField
                label="Environment variables"
                hint="Extra env vars passed to the agent process at startup."
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {Object.entries(envVars).map(([key, value]) => (
                    <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <input
                        className="zk-input"
                        style={{ width: '40%', flex: 'none', background: 'var(--zk-bg-3)' }}
                        value={key}
                        readOnly
                        title={key}
                      />
                      <input
                        className="zk-input"
                        style={{ flex: 1 }}
                        value={value}
                        onChange={(e) => onEnvVarsChange({ ...envVars, [key]: e.target.value })}
                        title={value}
                      />
                      <button
                        type="button"
                        className="zk-btn zk-btn--ghost zk-btn--icon"
                        onClick={() => { const next = { ...envVars }; delete next[key]; onEnvVarsChange(next); }}
                        style={{ flexShrink: 0 }}
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
                      onEnvVarsChange({ ...envVars, [key.trim()]: '' });
                    }
                  }}
                  className="zk-link"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    fontSize: 11,
                    marginTop: 4,
                    width: 'fit-content'
                  }}
                >
                  <Plus size={10} /> Add variable
                </button>
              </ZkField>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
