import { useState, useEffect, useCallback } from 'react';
import { X, Plus, Copy, Check, Trash2, Key, Server, Terminal } from 'lucide-react';
import type { MachineApiKey, ServerMachine } from '../types';
import * as api from '../lib/api';

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
      className="w-7 h-7 flex items-center justify-center border border-cyber-border bg-cyber-surface hover:bg-cyber-elevated hover:text-cyber-cyan transition-colors shrink-0"
      title="Copy"
    >
      {copied ? <Check size={12} className="text-cyber-green" /> : <Copy size={12} />}
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
    ? `npx @slock-ai/daemon@latest --server-url ${serverUrl} --api-key ${generatedKey}`
    : `npx @slock-ai/daemon@latest --server-url ${serverUrl} --api-key 1007`;

  return (
    <div
      className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 animate-fade-in"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-cyber-surface border border-cyber-border shadow-neon-cyan-lg w-[600px] max-h-[90vh] overflow-y-auto animate-bounce-in relative">
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-cyber-cyan to-transparent" />

        <div className="flex justify-between items-center px-6 pt-5 pb-3 border-b border-cyber-border">
          <div>
            <h2 className="font-display font-bold text-xl text-cyber-cyan tracking-wider">MACHINE SETUP</h2>
            <p className="text-xs text-cyber-chrome-400 mt-0.5 font-mono">Connect machines via daemon with API keys.</p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center border border-cyber-border bg-cyber-surface hover:bg-cyber-red/10 hover:border-cyber-red/40 hover:text-cyber-red transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        <div className="px-6 pb-5 space-y-5 pt-4">
          <div>
            <label className="flex items-center gap-1.5 text-xs font-display font-bold text-cyber-chrome-400 mb-2 tracking-wider">
              <Terminal size={12} /> DAEMON COMMAND
            </label>
            <div className="flex gap-2">
              <code className="flex-1 px-3 py-2.5 border border-cyber-border bg-cyber-void text-xs font-mono text-cyber-green break-all select-all shadow-cyber-sm">
                {daemonCommand}
              </code>
              <CopyButton text={daemonCommand} />
            </div>
            <p className="text-2xs text-cyber-chrome-500 mt-1.5 font-mono">
              Run on any machine to connect as daemon. Runtimes auto-register.
            </p>
          </div>

          <div>
            <label className="flex items-center gap-1.5 text-xs font-display font-bold text-cyber-chrome-400 mb-2 tracking-wider">
              <Key size={12} /> GENERATE API KEY
            </label>
            <div className="flex gap-2">
              <input
                value={newKeyName}
                onChange={(e) => setNewKeyName(e.target.value)}
                placeholder="Key name (e.g. workstation-alpha)"
                className="flex-1 px-3 py-2 cyber-input text-sm font-mono"
                onKeyDown={(e) => e.key === 'Enter' && handleGenerate()}
              />
              <button
                onClick={handleGenerate}
                disabled={!newKeyName.trim() || loading}
                className="flex items-center gap-1 px-3 py-2 cyber-btn-green text-sm font-display font-bold tracking-wider disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Plus size={12} /> GENERATE
              </button>
            </div>
          </div>

          {generatedKey && (
            <div className="border border-cyber-orange/40 bg-cyber-orange/5 p-4">
              <div className="flex items-start gap-2 mb-2">
                <Key size={14} className="text-cyber-orange shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold text-sm text-cyber-chrome-100">API Key Generated</p>
                  <p className="text-xs text-cyber-chrome-400 font-mono">Copy now -- will not be shown again.</p>
                </div>
              </div>
              <div className="flex gap-2 mt-2">
                <code className="flex-1 px-3 py-2 border border-cyber-border bg-cyber-void text-xs font-mono text-cyber-cyan break-all select-all">
                  {generatedKey}
                </code>
                <CopyButton text={generatedKey} />
              </div>
            </div>
          )}

          {error && (
            <div className="border border-cyber-red/40 bg-cyber-red/5 px-3 py-2 text-xs font-mono font-bold text-cyber-red">
              {error}
            </div>
          )}

          <div>
            <label className="flex items-center gap-1.5 text-xs font-display font-bold text-cyber-chrome-400 mb-2 tracking-wider">
              <Key size={12} /> API KEYS ({keys.length})
            </label>
            {keys.length > 0 ? (
              <div className="space-y-1.5">
                {keys.map((key) => (
                  <div key={key.id} className="flex items-center gap-3 px-3 py-2 border border-cyber-border bg-cyber-surface">
                    <Key size={12} className="text-cyber-chrome-500 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <span className="font-bold text-sm text-cyber-chrome-100">{key.name}</span>
                      <span className="text-2xs text-cyber-chrome-500 ml-2 font-mono">{key.keyPrefix}...</span>
                    </div>
                    <span className="text-2xs text-cyber-chrome-500 shrink-0 font-mono">
                      {key.lastUsedAt ? `Used ${new Date(key.lastUsedAt).toLocaleDateString()}` : 'Never used'}
                    </span>
                    <button
                      onClick={() => handleRevoke(key.id)}
                      className="w-7 h-7 flex items-center justify-center border border-cyber-border bg-cyber-surface hover:bg-cyber-red/10 hover:border-cyber-red/40 hover:text-cyber-red transition-colors shrink-0"
                      title="Revoke key"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="border border-dashed border-cyber-border px-4 py-3 text-xs text-cyber-chrome-500 text-center font-mono">
                No API keys generated yet. Create one to connect a daemon.
              </div>
            )}
          </div>

          <div>
            <label className="flex items-center gap-1.5 text-xs font-display font-bold text-cyber-chrome-400 mb-2 tracking-wider">
              <Server size={12} /> CONNECTED MACHINES ({machines.length})
            </label>
            {machines.length > 0 ? (
              <div className="space-y-1.5">
                {machines.map((m) => (
                  <div key={m.id} className="flex items-center gap-3 px-3 py-2.5 border border-cyber-border bg-cyber-surface">
                    <Server size={14} className="text-cyber-chrome-500 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm text-cyber-chrome-100 font-mono">{m.alias || m.hostname}</span>
                        {m.alias && <span className="text-2xs text-cyber-chrome-500 font-mono">{m.hostname}</span>}
                        <span className="w-2 h-2 rounded-full bg-cyber-green shadow-neon-green" />
                      </div>
                      <div className="text-2xs text-cyber-chrome-500 font-mono">
                        {m.os} / Runtimes: {(m.runtimes || []).join(', ') || 'none'}
                      </div>
                    </div>
                    {m.agentIds && m.agentIds.length > 0 && (
                      <span className="text-2xs font-mono font-bold text-cyber-chrome-400 border border-cyber-border px-1.5 py-0.5">
                        {m.agentIds.length} agent{m.agentIds.length > 1 ? 's' : ''}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="border border-dashed border-cyber-border px-4 py-6 text-center">
                <Server size={20} className="text-cyber-chrome-600 mx-auto mb-2" />
                <p className="text-xs text-cyber-chrome-500 font-mono">No machines connected. Run the daemon command above.</p>
              </div>
            )}
          </div>

          <div className="pt-3 border-t border-cyber-border">
            <button
              onClick={onClose}
              className="w-full py-2.5 border border-cyber-border text-sm font-display font-bold text-cyber-chrome-300 hover:bg-cyber-elevated transition-colors tracking-wider"
            >
              CLOSE
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
