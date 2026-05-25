export interface OvSectionProps {
  runtime: string;
  ovDefaultForRuntime: boolean;
  ovMcpDefaultForRuntime: boolean;

  ovEnabled: boolean;
  onOvEnabledChange: (v: boolean) => void;
  isOvDefault?: boolean;

  ovMcpEnabled: boolean;
  onOvMcpEnabledChange: (v: boolean) => void;
  isOvMcpDefault?: boolean;

  ovUseAgentNameAsUser: boolean;
  onOvUseAgentNameAsUserChange: (v: boolean) => void;
  isProvisioned?: boolean;

  ovMode?: 'provisioned' | 'custom';
  onOvModeChange?: (v: 'provisioned' | 'custom') => void;
  ovCustomUrl?: string;
  onOvCustomUrlChange?: (v: string) => void;
  ovCustomApiKey?: string;
  onOvCustomApiKeyChange?: (v: string) => void;
  ovCustomConfigured?: boolean;
  ovUserId?: string | null;
  ovCustomValid?: boolean;

  mode: 'create' | 'config';
}

function ToggleRow({ label, hint, value, onChange, trueLabel, falseLabel, small }: {
  label: string;
  hint?: string;
  value: boolean;
  onChange: (v: boolean) => void;
  trueLabel: string;
  falseLabel: string;
  small?: boolean;
}) {
  const py = small ? 'py-1.5' : 'py-2';
  return (
    <div>
      <label className="flex items-center gap-2 text-2xs font-bold text-nc-muted mb-1 font-mono tracking-wider">
        <span>{label}</span>
        {hint && <span className="text-2xs text-nc-muted/70 normal-case tracking-normal">{hint}</span>}
      </label>
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => onChange(true)}
          className={`px-2.5 ${py} border font-bold text-xs font-mono ${
            value
              ? 'border-nc-cyan bg-nc-cyan/10 text-nc-cyan'
              : 'border-nc-border text-nc-muted hover:bg-nc-elevated'
          }`}
        >
          {trueLabel}
        </button>
        <button
          type="button"
          onClick={() => onChange(false)}
          className={`px-2.5 ${py} border font-bold text-xs font-mono ${
            !value
              ? 'border-nc-cyan bg-nc-cyan/10 text-nc-cyan'
              : 'border-nc-border text-nc-muted hover:bg-nc-elevated'
          }`}
        >
          {falseLabel}
        </button>
      </div>
    </div>
  );
}

export function OvBasicToggle(props: Pick<OvSectionProps, 'ovEnabled' | 'onOvEnabledChange' | 'isOvDefault' | 'runtime'>) {
  const hint = props.isOvDefault ? `(default for ${props.runtime})` : undefined;
  return (
    <div>
      <ToggleRow
        label="OPENVIKING"
        hint={hint}
        value={props.ovEnabled}
        onChange={props.onOvEnabledChange}
        trueLabel="ENABLED"
        falseLabel="DISABLED"
      />
      {!props.ovEnabled && (
        <p className="text-2xs text-nc-muted mt-1.5 font-mono">
          OV creds are not delivered to the daemon. Toggle ENABLED to turn on.
        </p>
      )}
    </div>
  );
}

export function OvAdvancedSection(props: OvSectionProps) {
  const {
    runtime, ovEnabled,
    ovMcpEnabled, onOvMcpEnabledChange, isOvMcpDefault,
    ovUseAgentNameAsUser, onOvUseAgentNameAsUserChange, isProvisioned,
    ovMode, onOvModeChange,
    ovCustomUrl, onOvCustomUrlChange,
    ovCustomApiKey, onOvCustomApiKeyChange,
    ovCustomConfigured, ovUserId, ovCustomValid,
    mode,
  } = props;

  if (!ovEnabled) return null;

  const mcpHint = isOvMcpDefault ? `(default for ${runtime})` : undefined;

  return (
    <div className="space-y-3">
      <ToggleRow
        label="OV_MCP"
        hint={mcpHint}
        value={ovMcpEnabled}
        onChange={onOvMcpEnabledChange}
        trueLabel="INJECT"
        falseLabel="SKIP"
        small
      />

      {mode === 'config' && onOvModeChange && (
        <>
          <ToggleRow
            label="OV_MODE"
            value={ovMode === 'provisioned'}
            onChange={(v) => onOvModeChange(v ? 'provisioned' : 'custom')}
            trueLabel="PROVISIONED"
            falseLabel="CUSTOM"
            small
          />
          {ovMode === 'provisioned' ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2 p-2.5 border border-nc-border bg-nc-elevated">
                <span className={`w-2 h-2 shrink-0 ${isProvisioned ? 'bg-nc-green' : 'bg-nc-muted'}`} />
                <span className="font-bold text-xs text-nc-text-bright font-mono">
                  {isProvisioned ? 'PROVISIONED' : 'NOT_PROVISIONED'}
                </span>
                {ovUserId && (
                  <span className="text-2xs text-nc-muted font-mono ml-auto truncate">{ovUserId}</span>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <div>
                <label className="block text-2xs font-bold text-nc-muted mb-1 font-mono tracking-wider">URL</label>
                <input
                  type="text"
                  value={ovCustomUrl || ''}
                  onChange={(e) => onOvCustomUrlChange?.(e.target.value)}
                  placeholder="https://your-openviking.example.com"
                  className="w-full px-2 py-1.5 border border-nc-border bg-nc-elevated text-sm font-mono text-nc-text-bright focus:outline-none focus:border-nc-cyan"
                />
              </div>
              <div>
                <label className="block text-2xs font-bold text-nc-muted mb-1 font-mono tracking-wider">API_KEY</label>
                <input
                  type="password"
                  value={ovCustomApiKey || ''}
                  onChange={(e) => onOvCustomApiKeyChange?.(e.target.value)}
                  placeholder={ovCustomConfigured ? '•••••••••• (configured — leave blank to keep)' : 'paste new-format key'}
                  className="w-full px-2 py-1.5 border border-nc-border bg-nc-elevated text-sm font-mono text-nc-text-bright focus:outline-none focus:border-nc-cyan"
                />
              </div>
              {ovCustomValid === false && (
                <p className="text-2xs text-nc-red font-mono">URL and API key are required for custom mode.</p>
              )}
            </div>
          )}
        </>
      )}

      <label className={`flex items-center gap-2 text-xs font-mono ${isProvisioned ? 'text-nc-muted/50' : 'text-nc-muted'}`}>
        <input
          type="checkbox"
          checked={ovUseAgentNameAsUser}
          onChange={(e) => onOvUseAgentNameAsUserChange(e.target.checked)}
          disabled={!!isProvisioned}
          className="accent-nc-cyan"
        />
        <span>Share OV namespace by agent name</span>
        {isProvisioned && (
          <span className="ml-auto text-2xs text-nc-muted/50">locked after provision</span>
        )}
      </label>
    </div>
  );
}
