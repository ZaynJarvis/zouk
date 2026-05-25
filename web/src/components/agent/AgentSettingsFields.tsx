import { useState } from 'react';
import { ChevronDown, Plus, Minus, Loader2 } from 'lucide-react';
import ScanlineTear from '../glitch/ScanlineTear';
import type { RuntimeModel } from '../../lib/api';
import { OvBasicToggle, OvAdvancedSection, type OvSectionProps } from './OvSection';

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

  ov: OvSectionProps;
}

export default function AgentSettingsFields(props: AgentSettingsFieldsProps) {
  const {
    mode, runtime,
    lifecycle, onLifecycleChange,
    model, onModelChange, modelOptions, modelsLoading, customModel, onCustomModelChange,
    customLauncher, onCustomLauncherChange, onCustomLauncherBlur,
    envVars, onEnvVarsChange,
    ov,
  } = props;

  const [advancedOpen, setAdvancedOpen] = useState(mode === 'config');
  const launcherActive = customLauncher.trim().length > 0;
  const isVikingbot = runtime === 'vikingbot';

  return (
    <>
      {/* LIFECYCLE */}
      <div>
        <label className="block text-xs font-bold text-nc-muted mb-1.5 font-mono tracking-wider">LIFECYCLE</label>
        <div className="grid grid-cols-2 gap-3">
          <ScanlineTear config={{ trigger: 'hover', minInterval: 200, maxInterval: 600, minSeverity: 0.3, maxSeverity: 0.8 }}>
            <button
              type="button"
              onClick={() => onLifecycleChange('persistent')}
              className={`cyber-btn w-full flex items-center gap-2 border px-3 py-2.5 text-left ${
                lifecycle === 'persistent'
                  ? 'border-nc-cyan bg-nc-cyan/10 shadow-nc-cyan'
                  : 'border-nc-border hover:bg-nc-elevated'
              }`}
            >
              <div className="min-w-0 flex-1">
                <div className="font-bold text-sm text-nc-text-bright">PERSISTENT</div>
                <div className="text-xs text-nc-muted font-mono">Keeps session across idle</div>
              </div>
            </button>
          </ScanlineTear>
          <ScanlineTear config={{ trigger: 'hover', minInterval: 200, maxInterval: 600, minSeverity: 0.3, maxSeverity: 0.8 }}>
            <button
              type="button"
              onClick={() => onLifecycleChange('ephemeral')}
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
      </div>

      {/* MODEL */}
      {runtime && (
        <div>
          <label className="flex items-center gap-2 text-xs font-bold text-nc-muted mb-1.5 font-mono tracking-wider">
            <span>MODEL</span>
            {modelsLoading && <Loader2 size={10} className="animate-spin text-nc-cyan" />}
          </label>
          {launcherActive && (
            <p className="text-2xs text-nc-yellow mb-1.5 font-mono">
              Custom launcher is set — the suggested model list may not apply.
            </p>
          )}
          {!launcherActive && modelOptions.length > 0 && !customModel ? (
            <>
              <div className="flex gap-2 flex-wrap">
                {modelOptions.map((m) => (
                  <ScanlineTear key={m.id} config={{ trigger: 'hover', minInterval: 200, maxInterval: 600, minSeverity: 0.3, maxSeverity: 0.8 }}>
                    <button
                      type="button"
                      onClick={() => onModelChange(m.id)}
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
                onClick={() => { onCustomModelChange(true); onModelChange(''); }}
                className="mt-2 text-2xs font-mono text-nc-muted hover:text-nc-cyan underline underline-offset-2"
              >
                Use custom model ID
              </button>
            </>
          ) : (
            <>
              <input
                value={model}
                onChange={(e) => onModelChange(e.target.value)}
                placeholder="Model identifier (leave blank for runtime default)"
                className="w-full px-3 py-2 border border-nc-border bg-nc-panel text-sm text-nc-text-bright placeholder:text-nc-muted font-mono focus:outline-none focus:border-nc-cyan focus:shadow-nc-cyan transition-all"
              />
              {modelOptions.length > 0 && customModel && (
                <button
                  type="button"
                  onClick={() => { onCustomModelChange(false); onModelChange(modelOptions[0].id); }}
                  className="mt-2 text-2xs font-mono text-nc-muted hover:text-nc-cyan underline underline-offset-2"
                >
                  Back to suggested models
                </button>
              )}
            </>
          )}
        </div>
      )}

      {/* OV Basic: ENABLED / DISABLED */}
      {runtime && (
        <OvBasicToggle
          runtime={runtime}
          ovEnabled={ov.ovEnabled}
          onOvEnabledChange={ov.onOvEnabledChange}
          isOvDefault={ov.isOvDefault}
        />
      )}

      {/* ADVANCED — collapsed by default in create mode */}
      {runtime && (
        <div>
          <button
            type="button"
            onClick={() => setAdvancedOpen(!advancedOpen)}
            className="flex items-center gap-1.5 text-xs font-bold text-nc-muted font-mono tracking-wider hover:text-nc-text-bright transition-colors"
          >
            <ChevronDown className={`w-3.5 h-3.5 transition-transform ${advancedOpen ? '' : '-rotate-90'}`} />
            ADVANCED
          </button>

          {advancedOpen && (
            <div className="mt-2 space-y-4 pl-2 border-l-2 border-nc-border/50 ml-1">
              {/* OV Advanced (MCP, mode, namespace) */}
              {ov.ovEnabled && <OvAdvancedSection {...ov} />}

              {/* CUSTOM_LAUNCHER */}
              {!isVikingbot && (
                <div>
                  <label className="block text-2xs font-bold text-nc-muted mb-1 font-mono tracking-wider">CUSTOM_LAUNCHER</label>
                  <input
                    value={customLauncher}
                    onChange={(e) => onCustomLauncherChange(e.target.value)}
                    onBlur={onCustomLauncherBlur}
                    placeholder={`e.g. /path/to/${runtime} or env LANG=C ${runtime}`}
                    className="w-full px-2 py-1.5 border border-nc-border bg-nc-panel text-sm text-nc-text-bright placeholder:text-nc-muted font-mono focus:outline-none focus:border-nc-cyan transition-all"
                  />
                  <p className="text-2xs text-nc-muted mt-1 font-mono">
                    Override the default <span className="text-nc-cyan">{runtime}</span> binary. Leave blank for default.
                  </p>
                </div>
              )}

              {/* ENV_VARS */}
              <div>
                <label className="block text-2xs font-bold text-nc-muted mb-1 font-mono tracking-wider">ENV_VARS</label>
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
                        onChange={(e) => onEnvVarsChange({ ...envVars, [key]: e.target.value })}
                        className="flex-1 px-2 py-1.5 border border-nc-border bg-nc-panel text-xs text-nc-text-bright font-mono focus:outline-none focus:border-nc-cyan transition-all truncate"
                        title={value}
                      />
                      <button
                        type="button"
                        onClick={() => { const next = { ...envVars }; delete next[key]; onEnvVarsChange(next); }}
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
                      onEnvVarsChange({ ...envVars, [key.trim()]: '' });
                    }
                  }}
                  className="mt-2 flex items-center gap-1 text-2xs font-mono text-nc-muted hover:text-nc-cyan transition-colors"
                >
                  <Plus size={10} /> ADD_VARIABLE
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}
