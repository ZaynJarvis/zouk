import ZkField from '../zk/ZkField';
import ZkSegmentedControl from '../zk/ZkSegmentedControl';

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



export function OvBasicToggle(props: Pick<OvSectionProps, 'ovEnabled' | 'onOvEnabledChange' | 'isOvDefault' | 'runtime'>) {
  const defaultHint = props.isOvDefault ? ` (default for ${props.runtime})` : '';
  return (
    <ZkField
      label="OpenViking"
      hint={`Memory integration. Provisions dedicated OV credentials for this agent.${defaultHint}`}
    >
      <ZkSegmentedControl
        value={props.ovEnabled ? 'enabled' : 'disabled'}
        onChange={(v) => props.onOvEnabledChange(v === 'enabled')}
        options={[
          { value: 'enabled', label: 'Enabled' },
          { value: 'disabled', label: 'Disabled' }
        ]}
      />
      {!props.ovEnabled && (
        <p style={{
          fontSize: 11,
          color: 'var(--zk-ink-low)',
          fontFamily: 'var(--zk-font-sans)',
          margin: '4px 0 0',
        }}>
          OV credentials are not delivered to the daemon when disabled.
        </p>
      )}
    </ZkField>
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

  const mcpDefaultHint = isOvMcpDefault ? ` (default for ${runtime})` : '';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <ZkField
        label="OV MCP"
        hint={`Injects OpenViking as an MCP server so the agent can call memory tools directly.${mcpDefaultHint}`}
      >
        <ZkSegmentedControl
          value={ovMcpEnabled ? 'inject' : 'skip'}
          onChange={(v) => onOvMcpEnabledChange(v === 'inject')}
          options={[
            { value: 'inject', label: 'Inject' },
            { value: 'skip', label: 'Skip' }
          ]}
        />
      </ZkField>

      {mode === 'config' && onOvModeChange && (
        <>
          <ZkField
            label="OV mode"
            hint="Provisioned uses server-managed credentials. Custom lets you specify your own endpoint."
          >
            <ZkSegmentedControl
              value={ovMode === 'provisioned' ? 'provisioned' : 'custom'}
              onChange={(v) => onOvModeChange(v as 'provisioned' | 'custom')}
              options={[
                { value: 'provisioned', label: 'Provisioned' },
                { value: 'custom', label: 'Custom' }
              ]}
            />
          </ZkField>

          {ovMode === 'provisioned' ? (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 10px',
                background: 'var(--zk-bg-2)',
                border: '1px solid var(--zk-line)',
                borderRadius: 'var(--zk-r-md)',
              }}
            >
              <span
                className={`zk-dot ${isProvisioned ? 'zk-dot--online' : 'zk-dot--offline'}`}
              />
              <span className="zk-mono" style={{ fontSize: 12, fontWeight: 600, color: 'var(--zk-ink)' }}>
                {isProvisioned ? 'Provisioned' : 'Not provisioned'}
              </span>
              {ovUserId && (
                <span
                  className="zk-mono"
                  style={{
                    fontSize: 11,
                    color: 'var(--zk-ink-mute)',
                    marginLeft: 'auto',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {ovUserId}
                </span>
              )}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <ZkField label="URL">
                <input
                  type="text"
                  className="zk-input"
                  value={ovCustomUrl || ''}
                  onChange={(e) => onOvCustomUrlChange?.(e.target.value)}
                  placeholder="https://your-openviking.example.com"
                />
              </ZkField>
              <ZkField label="API key">
                <input
                  type="password"
                  className="zk-input"
                  value={ovCustomApiKey || ''}
                  onChange={(e) => onOvCustomApiKeyChange?.(e.target.value)}
                  placeholder={ovCustomConfigured ? '•••••••••• (configured — leave blank to keep)' : 'Paste API key'}
                />
              </ZkField>
              {ovCustomValid === false && (
                <p style={{ fontSize: 11, color: 'var(--zk-err)', fontFamily: 'var(--zk-font-sans)' }}>
                  URL and API key are required for custom mode.
                </p>
              )}
            </div>
          )}
        </>
      )}

      {(() => {
        const locked = mode === 'config';
        return (
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 12,
              fontFamily: 'var(--zk-font-sans)',
              color: locked ? 'var(--zk-ink-low)' : 'var(--zk-ink-mute)',
              cursor: locked ? 'not-allowed' : 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={ovUseAgentNameAsUser}
              onChange={(e) => onOvUseAgentNameAsUserChange(e.target.checked)}
              disabled={locked}
              style={{ accentColor: 'var(--zk-ember)' }}
            />
            <span>Share OV namespace by agent name</span>
            {locked && (
              <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--zk-ink-low)', fontFamily: 'var(--zk-font-mono)' }}>
                set at creation
              </span>
            )}
          </label>
        );
      })()}
    </div>
  );
}
