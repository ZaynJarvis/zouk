import { useState, useEffect, useCallback } from 'react';
import { Plus, Copy, Check, Trash2, Key, Server, Terminal, X } from 'lucide-react';
import type { MachineApiKey, ServerMachine } from '../types';
import * as api from '../lib/api';
import ScanlineTear from './glitch/ScanlineTear';
import { ncStyle } from '../lib/themeUtils';

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <ScanlineTear config={{ trigger: 'hover', minInterval: 200, maxInterval: 600, minSeverity: 0.3, maxSeverity: 0.8 }}>
      <button
        onClick={handleCopy}
        className="cyber-btn w-7 h-7 flex items-center justify-center border border-nc-border bg-nc-panel hover:bg-nc-elevated hover:border-nc-cyan shrink-0 text-nc-muted hover:text-nc-cyan"
        title="Copy"
      >
        {copied ? <Check size={12} className="text-nc-green" /> : <Copy size={12} />}
      </button>
    </ScanlineTear>
  );
}

export default function MachineSetupDialog({
  machines,
  onClose,
}: {
  machines: ServerMachine[];
  onClose: () => void;
}) {
  const [keys, setKeys] = useState<MachineApiKey[]>([]);
  const [newKeyName, setNewKeyName] = useState('');
  const [generatedKey, setGeneratedKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const serverUrl = import.meta.env.VITE_SLOCK_SERVER_URL || window.location.origin;

  const loadKeys = useCallback(async () => {
    try {
      const fetchedKeys = await api.listMachineKeys();
      setKeys(fetchedKeys);
    } catch {
      setKeys([]);
    }
  }, []);

  useEffect(() => {
    loadKeys();
  }, [loadKeys]);

  const handleGenerate = async () => {
    if (!newKeyName.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const result = await api.generateMachineKey(newKeyName.trim());
      setGeneratedKey(result.rawKey);
      setKeys(prev => [...prev, result.key]);
      setNewKeyName('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to generate key');
    } finally {
      setLoading(false);
    }
  };

  const handleRevoke = async (keyId: string) => {
    if (!confirm('Revoke this API key? Connected daemons using it will be disconnected.')) return;
    try {
      await api.revokeMachineKey(keyId);
      setKeys(prev => prev.filter(k => k.id !== keyId));
    } catch {
      setError('Failed to revoke key');
    }
  };

  const daemonCommand = generatedKey
    ? `# clone zouk-daemon first\nnpx tsx src/index.ts --server-url ${serverUrl} --api-key ${generatedKey}`
    : `# clone zouk-daemon first\nnpx tsx src/index.ts --server-url ${serverUrl} --api-key <api_key>`;

  return (
    <div
      className="fixed inset-0 bg-nc-black/80 backdrop-blur-sm flex items-center justify-center z-50 animate-fade-in p-4 safe-top safe-bottom"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-nc-surface border border-nc-border shadow-nc-panel w-full max-w-[640px] max-h-[90vh] flex flex-col cyber-bevel animate-bounce-in">
        <div className="flex justify-between items-center px-6 pt-5 pb-3 border-b border-nc-border shrink-0">
          <div className="min-w-0">
            <h2 className="font-display font-black text-xl text-nc-text-bright tracking-wider truncate">MACHINE_SETUP</h2>
            <p className="text-xs text-nc-muted mt-0.5 font-mono truncate">Connect machines by running the daemon with an API key.</p>
          </div>
          <ScanlineTear config={{ trigger: 'hover', minInterval: 200, maxInterval: 600, minSeverity: 0.3, maxSeverity: 0.8 }}>
            <button
              onClick={onClose}
              className="cyber-btn w-8 h-8 flex items-center justify-center border border-nc-border hover:border-nc-red hover:text-nc-red hover:bg-nc-red/10 text-nc-muted"
              title="Close"
            >
              <X size={16} />
            </button>
          </ScanlineTear>
        </div>

        <div className="flex-1 overflow-y-auto scrollbar-thin px-6 py-5 space-y-5">
          <div>
            <label className="flex items-center gap-1.5 text-xs font-bold text-nc-muted mb-2 font-mono tracking-wider">
              <Terminal size={12} className="text-nc-green" /> DAEMON_COMMAND
            </label>
            <div className="flex gap-2">
              <code className="flex-1 px-3 py-2.5 border border-nc-border bg-nc-black text-xs font-mono text-nc-green break-all select-all whitespace-pre-line" style={ncStyle({ textShadow: '0 0 4px rgb(var(--nc-green) / 0.3)' })}>
                {daemonCommand}
              </code>
              <CopyButton text={daemonCommand} />
            </div>
            <p className="text-2xs text-nc-muted mt-1.5 font-mono">
              Run this on any machine to connect it as a daemon.
            </p>
          </div>

          <div>
            <label className="flex items-center gap-1.5 text-xs font-bold text-nc-muted mb-2 font-mono tracking-wider">
              <Key size={12} className="text-nc-yellow" /> GENERATE_API_KEY
            </label>
            <div className="flex gap-2">
              <input
                value={newKeyName}
                onChange={(e) => setNewKeyName(e.target.value)}
                placeholder="Key name (e.g. lululiang-imac)"
                className="flex-1 px-3 py-2 border border-nc-border bg-nc-panel text-sm text-nc-text-bright placeholder:text-nc-muted font-mono focus:outline-none focus:border-nc-cyan focus:shadow-nc-cyan transition-all"
                onKeyDown={(e) => e.key === 'Enter' && handleGenerate()}
              />
              <ScanlineTear config={{ trigger: 'hover', minInterval: 200, maxInterval: 600, minSeverity: 0.3, maxSeverity: 0.8 }}>
                <button
                  onClick={handleGenerate}
                  disabled={!newKeyName.trim() || loading}
                  className="cyber-btn flex items-center gap-1 px-3 py-2 border border-nc-green bg-nc-green/10 text-sm font-bold text-nc-green hover:bg-nc-green/20 hover:shadow-nc-green disabled:opacity-50 disabled:cursor-not-allowed font-mono"
                >
                  <Plus size={12} /> GENERATE
                </button>
              </ScanlineTear>
            </div>
          </div>

          {generatedKey && (
            <div className="border border-nc-yellow/50 bg-nc-yellow/5 p-4">
              <div className="flex items-start gap-2 mb-2">
                <Key size={14} className="text-nc-yellow shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold text-sm text-nc-yellow">API_KEY_GENERATED</p>
                  <p className="text-xs text-nc-muted font-mono">Copy this key now -- it won't be shown again.</p>
                </div>
              </div>
              <div className="flex gap-2 mt-2">
                <code className="flex-1 px-3 py-2 border border-nc-border bg-nc-black text-xs font-mono text-nc-cyan break-all select-all" style={ncStyle({ textShadow: '0 0 4px rgb(var(--nc-cyan) / 0.3)' })}>
                  {generatedKey}
                </code>
                <CopyButton text={generatedKey} />
              </div>
            </div>
          )}

          {error && (
            <div className="border border-nc-red/50 bg-nc-red/5 px-3 py-2 text-xs font-bold text-nc-red font-mono">
              {error}
            </div>
          )}

          <div>
            <label className="flex items-center gap-1.5 text-xs font-bold text-nc-muted mb-2 font-mono tracking-wider">
              <Key size={12} className="text-nc-yellow" /> API_KEYS ({keys.length})
            </label>
            {keys.length > 0 ? (
              <div className="space-y-1.5">
                {keys.map((key) => (
                  <div key={key.id} className="flex items-center gap-3 px-3 py-2 border border-nc-border bg-nc-panel">
                    <Key size={12} className="text-nc-yellow shrink-0" />
                    <div className="flex-1 min-w-0">
                      <span className="font-bold text-sm text-nc-text-bright font-mono">{key.name}</span>
                      <span className="text-2xs text-nc-muted ml-2 font-mono">{key.keyPrefix}...</span>
                    </div>
                    <span className="text-2xs text-nc-muted shrink-0 font-mono">
                      {key.lastUsedAt ? `Used ${new Date(key.lastUsedAt).toLocaleDateString()}` : 'Never used'}
                    </span>
                    <ScanlineTear config={{ trigger: 'hover', minInterval: 200, maxInterval: 600, minSeverity: 0.3, maxSeverity: 0.8 }}>
                      <button
                        onClick={() => handleRevoke(key.id)}
                        className="cyber-btn w-7 h-7 flex items-center justify-center border border-nc-border hover:border-nc-red hover:text-nc-red hover:bg-nc-red/10 shrink-0 text-nc-muted"
                        title="Revoke key"
                      >
                        <Trash2 size={12} />
                      </button>
                    </ScanlineTear>
                  </div>
                ))}
              </div>
            ) : (
              <div className="border border-dashed border-nc-border px-4 py-3 text-xs text-nc-muted text-center font-mono">
                No API keys generated yet. Create one to connect a daemon.
              </div>
            )}
          </div>

          <div>
            <label className="flex items-center gap-1.5 text-xs font-bold text-nc-muted mb-2 font-mono tracking-wider">
              <Server size={12} className="text-nc-green" /> CONNECTED_MACHINES ({machines.length})
            </label>
            {machines.length > 0 ? (
              <div className="space-y-1.5">
                {machines.map((m) => (
                  <div key={m.id} className="flex items-center gap-3 px-3 py-2.5 border border-nc-border bg-nc-panel">
                    <Server size={14} className="text-nc-green shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm text-nc-text-bright font-mono">{m.alias || m.hostname}</span>
                        {m.alias && <span className="text-2xs text-nc-muted font-mono">{m.hostname}</span>}
                        <span className="w-2 h-2 bg-nc-green" />
                      </div>
                      <div className="text-2xs text-nc-muted font-mono">
                        {m.os} · Runtimes: {(m.runtimes || []).join(', ') || 'none'}
                      </div>
                    </div>
                    {m.agentIds && m.agentIds.length > 0 && (
                      <span className="text-2xs font-bold text-nc-cyan border border-nc-cyan/30 bg-nc-cyan/10 px-1.5 py-0.5 font-mono">
                        {m.agentIds.length} agent{m.agentIds.length > 1 ? 's' : ''}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="border border-dashed border-nc-border px-4 py-6 text-center">
                <Server size={20} className="text-nc-muted mx-auto mb-2" />
                <p className="text-xs text-nc-muted font-mono">No machines connected. Run the daemon command above to connect.</p>
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}
