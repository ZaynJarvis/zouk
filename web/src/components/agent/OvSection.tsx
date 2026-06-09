import { useState } from 'react';
import { Eye, EyeOff, Copy, Check } from 'lucide-react';
import ZkField from '../zk/ZkField';
import ZkSegmentedControl from '../zk/ZkSegmentedControl';
import { fetchAgentOvCreds } from '../../lib/api';

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

  // Provisioned-mode display data (read-only). The URL is the server /ov proxy
  // (not secret); the API key is the agent's Zouk token, fetched on demand via
  // the admin-gated reveal endpoint, never broadcast over WS.
  agentId?: string;
  provisionedUrl?: string | null;
  // Whether the current viewer may reveal the provisioned key (workspace admin+).
  // Non-admins see the masked field but cannot reveal or fetch it.
  canRevealKey?: boolean;

  mode: 'create' | 'config';
}



// URL + API key fields shared by provisioned and custom modes.
// - editable=true (custom):     URL/key come from form state; user types over.
// - editable=false (provisioned): URL is the server-minted one (passed in);
//                                 API key is fetched on first reveal click
//                                 via /api/agents/:id/ov/creds.
function CredentialFields({
  agentId, editable,
  url, onUrlChange,
  apiKey, onApiKeyChange,
  apiKeyPlaceholder,
  canReveal = true,
}: {
  agentId?: string;
  editable: boolean;
  url: string;
  onUrlChange?: (v: string) => void;
  apiKey: string;
  onApiKeyChange?: (v: string) => void;
  apiKeyPlaceholder: string;
  // Provisioned mode only: gates the reveal/fetch of the (admin-only) key.
  // Ignored when editable (custom mode shows the user's own typed key).
  canReveal?: boolean;
}) {
  const [revealed, setRevealed] = useState(false);
  const [fetchedKey, setFetchedKey] = useState<string | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [fetching, setFetching] = useState(false);
  const [copied, setCopied] = useState<'url' | 'key' | null>(null);

  // In editable mode the key value flows from form state. In provisioned mode
  // we cache the result of the reveal fetch locally so a re-show doesn't
  // re-hit the server.
  const displayKey = editable ? apiKey : (fetchedKey ?? '');
  // Provisioned key is admin-only: lock the reveal control for non-admins.
  const revealLocked = !editable && !canReveal;

  const handleToggleReveal = async () => {
    if (revealed) { setRevealed(false); return; }
    // Editable mode: just toggle visibility, the value's already in form state.
    if (editable) { setRevealed(true); return; }
    // Provisioned mode: admin-gated. Non-admins can't reveal or fetch the key.
    if (!canReveal) { setFetchError('Admin access required to reveal the key'); return; }
    // Lazy-fetch on first reveal.
    if (fetchedKey != null) { setRevealed(true); return; }
    if (!agentId) { setFetchError('agent id missing'); return; }
    setFetching(true);
    setFetchError(null);
    try {
      const creds = await fetchAgentOvCreds(agentId);
      setFetchedKey(creds.apiKey);
      setRevealed(true);
    } catch (e) {
      setFetchError(e instanceof Error ? e.message : 'fetch failed');
    } finally {
      setFetching(false);
    }
  };

  const handleCopy = (which: 'url' | 'key', value: string) => {
    if (!value) return;
    navigator.clipboard.writeText(value).then(() => {
      setCopied(which);
      setTimeout(() => setCopied(null), 1200);
    }).catch(() => { /* clipboard blocked */ });
  };

  const iconBtnStyle: React.CSSProperties = {
    flexShrink: 0,
    width: 28, height: 28,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    background: 'transparent', border: '1px solid var(--zk-line)',
    borderRadius: 'var(--zk-r-sm)', cursor: 'pointer',
    color: 'var(--zk-ink-mute)',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <ZkField label="URL">
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            type="text"
            className="zk-input"
            value={url}
            onChange={(e) => editable && onUrlChange?.(e.target.value)}
            readOnly={!editable}
            placeholder={editable ? 'https://your-openviking.example.com' : '(no URL)'}
            style={{ flex: 1 }}
          />
          <button
            type="button"
            onClick={() => handleCopy('url', url)}
            disabled={!url}
            title="Copy URL"
            style={{ ...iconBtnStyle, opacity: url ? 1 : 0.4 }}
          >
            {copied === 'url' ? <Check size={13} /> : <Copy size={13} />}
          </button>
        </div>
      </ZkField>

      <ZkField label="API key">
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            type={revealed ? 'text' : 'password'}
            className="zk-input"
            value={displayKey}
            onChange={(e) => editable && onApiKeyChange?.(e.target.value)}
            readOnly={!editable}
            placeholder={apiKeyPlaceholder}
            style={{ flex: 1 }}
          />
          <button
            type="button"
            onClick={handleToggleReveal}
            disabled={fetching || revealLocked}
            title={revealLocked ? 'Admin access required' : revealed ? 'Hide' : 'Show'}
            style={{ ...iconBtnStyle, opacity: revealLocked ? 0.4 : 1 }}
          >
            {revealed ? <EyeOff size={13} /> : <Eye size={13} />}
          </button>
          <button
            type="button"
            onClick={() => handleCopy('key', displayKey)}
            disabled={!displayKey}
            title="Copy API key"
            style={{ ...iconBtnStyle, opacity: displayKey ? 1 : 0.4 }}
          >
            {copied === 'key' ? <Check size={13} /> : <Copy size={13} />}
          </button>
        </div>
        {fetchError && (
          <p style={{ fontSize: 11, color: 'var(--zk-err)', fontFamily: 'var(--zk-font-sans)', margin: '4px 0 0' }}>
            Reveal failed: {fetchError}
          </p>
        )}
      </ZkField>
    </div>
  );
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
          { value: 'enabled', label: 'Enabled', tone: 'ok' },
          { value: 'disabled', label: 'Disabled', tone: 'neutral' }
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
    isProvisioned,
    ovMode, onOvModeChange,
    ovCustomUrl, onOvCustomUrlChange,
    ovCustomApiKey, onOvCustomApiKeyChange,
    ovCustomConfigured, ovUserId, ovCustomValid,
    agentId, provisionedUrl, canRevealKey,
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
            { value: 'inject', label: 'Inject', tone: 'ok' },
            { value: 'skip', label: 'Skip', tone: 'neutral' }
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
                { value: 'provisioned', label: 'Provisioned', tone: 'ok' },
                { value: 'custom', label: 'Custom' }
              ]}
            />
          </ZkField>

          {ovMode === 'provisioned' && (
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
          )}

          {/* URL + API key are shown in both modes. Custom is editable; provisioned
              displays the server /ov proxy URL + the agent's Zouk token (the same
              creds the daemon uses) so the user can copy them into ovcli, plugins,
              or other tools. The provisioned key is admin-only to reveal. */}
          <CredentialFields
            agentId={agentId}
            editable={ovMode === 'custom'}
            canReveal={canRevealKey !== false}
            url={ovMode === 'custom' ? (ovCustomUrl || '') : (provisionedUrl || '')}
            onUrlChange={onOvCustomUrlChange}
            apiKey={ovMode === 'custom' ? (ovCustomApiKey || '') : ''}
            onApiKeyChange={onOvCustomApiKeyChange}
            apiKeyPlaceholder={
              ovMode === 'custom'
                ? (ovCustomConfigured ? '•••••••••• (configured — leave blank to keep)' : 'Paste API key')
                : (isProvisioned
                    ? (canRevealKey === false ? '•••••••••• (admin only)' : '•••••••••• (click eye to reveal)')
                    : '(not yet provisioned)')
            }
          />
          {ovMode === 'custom' && ovCustomValid === false && (
            <p style={{ fontSize: 11, color: 'var(--zk-err)', fontFamily: 'var(--zk-font-sans)' }}>
              URL and API key are required for custom mode.
            </p>
          )}
        </>
      )}
    </div>
  );
}
