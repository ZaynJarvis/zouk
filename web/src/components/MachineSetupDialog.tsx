import { useState, useEffect, useCallback } from 'react';
import { Plus, Copy, Check, Trash2, Key, Server } from 'lucide-react';
import type { MachineApiKey, ServerMachine } from '../types';
import * as api from '../lib/api';
import { useApp } from '../store/AppContext';
import ZkDialog from './zk/ZkDialog';
import ZkField from './zk/ZkField';

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      onClick={handleCopy}
      className="zk-btn zk-btn--ghost zk-btn--icon"
      style={{ flexShrink: 0 }}
      title="Copy"
    >
      {copied ? <Check size={12} style={{ color: 'var(--zk-ok)' }} /> : <Copy size={12} />}
    </button>
  );
}

export default function MachineSetupDialog({
  machines,
  onClose,
}: {
  machines: ServerMachine[];
  onClose: () => void;
}) {
  const { activeWorkspaceId } = useApp();
  const [keys, setKeys] = useState<MachineApiKey[]>([]);
  const [newKeyName, setNewKeyName] = useState('');
  const [generatedKey, setGeneratedKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const serverUrl = import.meta.env.VITE_SLOCK_SERVER_URL || window.location.origin;

  const loadKeys = useCallback(async () => {
    try {
      const fetchedKeys = await api.listMachineKeys();
      if (api.getActiveWorkspaceId() !== activeWorkspaceId) return;
      setKeys(fetchedKeys);
    } catch {
      if (api.getActiveWorkspaceId() !== activeWorkspaceId) return;
      setKeys([]);
    }
  }, [activeWorkspaceId]);

  useEffect(() => {
    loadKeys();
  }, [loadKeys]);

  const handleGenerate = async () => {
    if (!newKeyName.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const result = await api.generateMachineKey(newKeyName.trim());
      if (api.getActiveWorkspaceId() !== activeWorkspaceId) return;
      setGeneratedKey(result.rawKey);
      setKeys(prev => [...prev, result.key]);
      setNewKeyName('');
    } catch (e) {
      if (api.getActiveWorkspaceId() !== activeWorkspaceId) return;
      setError(e instanceof Error ? e.message : 'Failed to generate key');
    } finally {
      if (api.getActiveWorkspaceId() === activeWorkspaceId) setLoading(false);
    }
  };

  const handleRevoke = async (keyId: string) => {
    if (!confirm('Revoke this API key? Connected daemons using it will be disconnected.')) return;
    try {
      await api.revokeMachineKey(keyId);
      if (api.getActiveWorkspaceId() !== activeWorkspaceId) return;
      setKeys(prev => prev.filter(k => k.id !== keyId));
    } catch {
      if (api.getActiveWorkspaceId() !== activeWorkspaceId) return;
      setError('Failed to revoke key');
    }
  };

  const daemonCommand = generatedKey
    ? `npx zouk-daemon@latest --server-url ${serverUrl} --api-key ${generatedKey}`
    : `npx zouk-daemon@latest --server-url ${serverUrl} --api-key <api_key>`;

  return (
    <ZkDialog
      title="Machine setup"
      subtitle="Connect machines by running the daemon with an API key."
      width={640}
      onClose={onClose}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        {/* Daemon command */}
        <ZkField
          label="Daemon command"
          hint="Run this on any machine to connect it as a daemon to this server."
        >
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <code
              style={{
                flex: 1,
                padding: '8px 10px',
                background: 'var(--zk-bg-0)',
                border: '1px solid var(--zk-line)',
                borderRadius: 'var(--zk-r-md)',
                fontSize: 11,
                fontFamily: 'var(--zk-font-mono)',
                color: 'var(--zk-ok)',
                wordBreak: 'break-all',
                userSelect: 'all',
                whiteSpace: 'pre-line',
                lineHeight: 1.5,
              }}
            >
              {daemonCommand}
            </code>
            <CopyButton text={daemonCommand} />
          </div>
        </ZkField>

        {/* Generate API key */}
        <ZkField
          label="Generate API key"
          hint="Auth token for the daemon-server connection. Each machine should use its own key."
        >
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              className="zk-input"
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              placeholder="Key name (e.g. lululiang-imac)"
              onKeyDown={(e) => e.key === 'Enter' && handleGenerate()}
            />
            <button
              onClick={handleGenerate}
              disabled={!newKeyName.trim() || loading}
              className="zk-btn zk-btn--primary"
              style={{ flexShrink: 0 }}
            >
              <Plus size={12} /> Generate
            </button>
          </div>
        </ZkField>

        {/* Generated key alert */}
        {generatedKey && (
          <div
            style={{
              padding: 16,
              background: 'var(--zk-warn-soft)',
              border: '1px solid rgba(210,177,112,0.25)',
              borderRadius: 'var(--zk-r-md)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 8 }}>
              <Key size={14} style={{ color: 'var(--zk-warn)', flexShrink: 0, marginTop: 1 }} />
              <div>
                <p style={{ fontWeight: 600, fontSize: 13, color: 'var(--zk-warn)', margin: 0 }}>
                  API key generated
                </p>
                <p style={{ fontSize: 11, color: 'var(--zk-ink-mute)', fontFamily: 'var(--zk-font-sans)', margin: '2px 0 0' }}>
                  Copy this key now — it won't be shown again.
                </p>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <code
                style={{
                  flex: 1,
                  padding: '6px 10px',
                  background: 'var(--zk-bg-0)',
                  border: '1px solid var(--zk-line)',
                  borderRadius: 'var(--zk-r-md)',
                  fontSize: 11,
                  fontFamily: 'var(--zk-font-mono)',
                  color: 'var(--zk-ember)',
                  wordBreak: 'break-all',
                  userSelect: 'all',
                }}
              >
                {generatedKey}
              </code>
              <CopyButton text={generatedKey} />
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div
            style={{
              padding: '8px 12px',
              background: 'var(--zk-err-soft)',
              border: '1px solid rgba(210,116,116,0.25)',
              borderRadius: 'var(--zk-r-md)',
              fontSize: 12,
              fontWeight: 600,
              color: 'var(--zk-err)',
              fontFamily: 'var(--zk-font-sans)',
            }}
          >
            {error}
          </div>
        )}

        {/* API keys list */}
        <ZkField label={`API keys (${keys.length})`}>
          {keys.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {keys.map((key) => (
                <div
                  key={key.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '8px 12px',
                    background: 'var(--zk-bg-2)',
                    border: '1px solid var(--zk-line)',
                    borderRadius: 'var(--zk-r-md)',
                  }}
                >
                  <Key size={12} style={{ color: 'var(--zk-warn)', flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <span className="zk-mono" style={{ fontWeight: 600, fontSize: 12, color: 'var(--zk-ink)' }}>
                      {key.name}
                    </span>
                    <span className="zk-mono" style={{ fontSize: 10, color: 'var(--zk-ink-mute)', marginLeft: 8 }}>
                      {key.keyPrefix}...
                    </span>
                  </div>
                  <span
                    className="zk-mono"
                    style={{ fontSize: 10, color: 'var(--zk-ink-mute)', flexShrink: 0 }}
                  >
                    {key.lastUsedAt ? `Used ${new Date(key.lastUsedAt).toLocaleDateString()}` : 'Never used'}
                  </span>
                  <button
                    onClick={() => handleRevoke(key.id)}
                    className="zk-btn zk-btn--ghost zk-btn--icon"
                    style={{ flexShrink: 0, color: 'var(--zk-ink-mute)' }}
                    onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--zk-err)')}
                    onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--zk-ink-mute)')}
                    title="Revoke key"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div
              style={{
                padding: '16px 20px',
                border: '1px dashed var(--zk-line-2)',
                borderRadius: 'var(--zk-r-md)',
                textAlign: 'center',
                fontSize: 12,
                color: 'var(--zk-ink-mute)',
                fontFamily: 'var(--zk-font-sans)',
              }}
            >
              No API keys generated yet. Create one to connect a daemon.
            </div>
          )}
        </ZkField>

        {/* Connected machines */}
        <ZkField label={`Connected machines (${machines.length})`}>
          {machines.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {machines.map((m) => (
                <div
                  key={m.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '10px 12px',
                    background: 'var(--zk-bg-2)',
                    border: '1px solid var(--zk-line)',
                    borderRadius: 'var(--zk-r-md)',
                  }}
                >
                  <Server size={14} style={{ color: 'var(--zk-ok)', flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span className="zk-mono" style={{ fontWeight: 600, fontSize: 12, color: 'var(--zk-ink)' }}>
                        {m.alias || m.hostname}
                      </span>
                      {m.alias && (
                        <span className="zk-mono" style={{ fontSize: 10, color: 'var(--zk-ink-mute)' }}>
                          {m.hostname}
                        </span>
                      )}
                      <span className="zk-dot zk-dot--online" />
                    </div>
                    <div className="zk-mono" style={{ fontSize: 10, color: 'var(--zk-ink-mute)', marginTop: 2 }}>
                      {m.os} · Runtimes: {(m.runtimes || []).join(', ') || 'none'}
                    </div>
                  </div>
                  {m.agentIds && m.agentIds.length > 0 && (
                    <span className="zk-pill zk-pill--ember">
                      {m.agentIds.length} agent{m.agentIds.length > 1 ? 's' : ''}
                    </span>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div
              style={{
                padding: '24px 20px',
                border: '1px dashed var(--zk-line-2)',
                borderRadius: 'var(--zk-r-md)',
                textAlign: 'center',
              }}
            >
              <Server size={20} style={{ color: 'var(--zk-ink-low)', margin: '0 auto 8px' }} />
              <p style={{ fontSize: 12, color: 'var(--zk-ink-mute)', fontFamily: 'var(--zk-font-sans)', margin: 0 }}>
                No machines connected. Run the daemon command above to connect.
              </p>
            </div>
          )}
        </ZkField>
      </div>
    </ZkDialog>
  );
}
