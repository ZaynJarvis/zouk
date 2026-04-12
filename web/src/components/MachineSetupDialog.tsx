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
      className="w-7 h-7 flex items-center justify-center border-2 border-nb-black dark:border-dark-border bg-nb-white dark:bg-dark-surface hover:bg-nb-gray-50 dark:hover:bg-dark-elevated transition-colors shrink-0"
      title="Copy"
    >
      {copied ? <Check size={12} className="text-nb-green" /> : <Copy size={12} />}
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
      // API may not exist yet — show empty state
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
      className="fixed inset-0 bg-nb-black/40 flex items-center justify-center z-50 animate-fade-in"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-nb-white dark:bg-dark-surface border-3 border-nb-black dark:border-dark-border shadow-nb-lg w-[600px] max-h-[90vh] overflow-y-auto animate-bounce-in">
        {/* Header */}
        <div className="flex justify-between items-center px-6 pt-5 pb-3 border-b-2 border-nb-gray-200 dark:border-dark-border">
          <div>
            <h2 className="font-display font-black text-xl text-nb-black dark:text-dark-text">Machine Setup</h2>
            <p className="text-xs text-nb-gray-500 dark:text-dark-muted mt-0.5">Connect machines by running the daemon with an API key.</p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center border-2 border-nb-black dark:border-dark-border bg-nb-white dark:bg-dark-surface hover:bg-nb-red hover:text-nb-white transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        <div className="px-6 pb-5 space-y-5 pt-4">
          {/* Connection Command */}
          <div>
            <label className="flex items-center gap-1.5 text-xs font-bold text-nb-gray-600 dark:text-dark-muted mb-2">
              <Terminal size={12} /> Daemon Connection Command
            </label>
            <div className="flex gap-2">
              <code className="flex-1 px-3 py-2.5 border-2 border-nb-black dark:border-dark-border bg-nb-gray-50 dark:bg-dark-elevated text-xs font-mono text-nb-black dark:text-dark-text break-all select-all">
                {daemonCommand}
              </code>
              <CopyButton text={daemonCommand} />
            </div>
            <p className="text-2xs text-nb-gray-400 dark:text-dark-muted mt-1.5">
              Run this on any machine to connect it as a daemon. The daemon will register its available runtimes automatically.
            </p>
          </div>

          {/* Generate API Key */}
          <div>
            <label className="flex items-center gap-1.5 text-xs font-bold text-nb-gray-600 dark:text-dark-muted mb-2">
              <Key size={12} /> Generate Machine API Key
            </label>
            <div className="flex gap-2">
              <input
                value={newKeyName}
                onChange={(e) => setNewKeyName(e.target.value)}
                placeholder="Key name (e.g. lululiang-imac, bytedance-mbp)"
                className="flex-1 px-3 py-2 border-2 border-nb-black dark:border-dark-border bg-nb-white dark:bg-dark-surface text-sm text-nb-black dark:text-dark-text placeholder:text-nb-gray-400"
                onKeyDown={(e) => e.key === 'Enter' && handleGenerate()}
              />
              <button
                onClick={handleGenerate}
                disabled={!newKeyName.trim() || loading}
                className="flex items-center gap-1 px-3 py-2 border-2 border-nb-black text-sm font-bold bg-nb-green text-nb-black shadow-nb-sm hover:shadow-nb active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none"
              >
                <Plus size={12} /> Generate
              </button>
            </div>
          </div>

          {/* Generated Key Alert */}
          {generatedKey && (
            <div className="border-3 border-nb-orange bg-nb-orange-light dark:bg-nb-orange/10 p-4">
              <div className="flex items-start gap-2 mb-2">
                <Key size={14} className="text-nb-orange shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold text-sm text-nb-black dark:text-dark-text">API Key Generated</p>
                  <p className="text-xs text-nb-gray-600 dark:text-dark-muted">Copy this key now — it won't be shown again.</p>
                </div>
              </div>
              <div className="flex gap-2 mt-2">
                <code className="flex-1 px-3 py-2 border-2 border-nb-black dark:border-dark-border bg-nb-white dark:bg-dark-surface text-xs font-mono text-nb-black dark:text-dark-text break-all select-all">
                  {generatedKey}
                </code>
                <CopyButton text={generatedKey} />
              </div>
            </div>
          )}

          {error && (
            <div className="border-2 border-nb-red bg-nb-red-light dark:bg-nb-red/10 px-3 py-2 text-xs font-bold text-nb-red">
              {error}
            </div>
          )}

          {/* Existing API Keys */}
          <div>
            <label className="flex items-center gap-1.5 text-xs font-bold text-nb-gray-600 dark:text-dark-muted mb-2">
              <Key size={12} /> API Keys ({keys.length})
            </label>
            {keys.length > 0 ? (
              <div className="space-y-1.5">
                {keys.map((key) => (
                  <div key={key.id} className="flex items-center gap-3 px-3 py-2 border-2 border-nb-gray-200 dark:border-dark-border bg-nb-white dark:bg-dark-surface">
                    <Key size={12} className="text-nb-gray-400 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <span className="font-bold text-sm text-nb-black dark:text-dark-text">{key.name}</span>
                      <span className="text-2xs text-nb-gray-400 dark:text-dark-muted ml-2 font-mono">{key.keyPrefix}...</span>
                    </div>
                    <span className="text-2xs text-nb-gray-400 dark:text-dark-muted shrink-0">
                      {key.lastUsedAt ? `Used ${new Date(key.lastUsedAt).toLocaleDateString()}` : 'Never used'}
                    </span>
                    <button
                      onClick={() => handleRevoke(key.id)}
                      className="w-7 h-7 flex items-center justify-center border-2 border-nb-black dark:border-dark-border bg-nb-white dark:bg-dark-surface hover:bg-nb-red hover:text-nb-white transition-colors shrink-0"
                      title="Revoke key"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="border-2 border-dashed border-nb-gray-300 dark:border-dark-border px-4 py-3 text-xs text-nb-gray-400 dark:text-dark-muted text-center">
                No API keys generated yet. Create one to connect a daemon.
              </div>
            )}
          </div>

          {/* Connected Machines */}
          <div>
            <label className="flex items-center gap-1.5 text-xs font-bold text-nb-gray-600 dark:text-dark-muted mb-2">
              <Server size={12} /> Connected Machines ({machines.length})
            </label>
            {machines.length > 0 ? (
              <div className="space-y-1.5">
                {machines.map((m) => (
                  <div key={m.id} className="flex items-center gap-3 px-3 py-2.5 border-2 border-nb-gray-200 dark:border-dark-border bg-nb-white dark:bg-dark-surface">
                    <Server size={14} className="text-nb-gray-400 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm text-nb-black dark:text-dark-text">{m.alias || m.hostname}</span>
                        {m.alias && <span className="text-2xs text-nb-gray-400 dark:text-dark-muted">{m.hostname}</span>}
                        <span className="w-2 h-2 border border-nb-black dark:border-dark-border bg-nb-green" />
                      </div>
                      <div className="text-2xs text-nb-gray-500 dark:text-dark-muted">
                        {m.os} · Runtimes: {(m.runtimes || []).join(', ') || 'none'}
                      </div>
                    </div>
                    {m.agentIds && m.agentIds.length > 0 && (
                      <span className="text-2xs font-bold text-nb-gray-500 dark:text-dark-muted border border-nb-gray-200 dark:border-dark-border px-1.5 py-0.5">
                        {m.agentIds.length} agent{m.agentIds.length > 1 ? 's' : ''}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="border-2 border-dashed border-nb-gray-300 dark:border-dark-border px-4 py-6 text-center">
                <Server size={20} className="text-nb-gray-300 mx-auto mb-2" />
                <p className="text-xs text-nb-gray-400 dark:text-dark-muted">No machines connected. Run the daemon command above to connect.</p>
              </div>
            )}
          </div>

          {/* Close */}
          <div className="pt-3 border-t-2 border-nb-gray-200 dark:border-dark-border">
            <button
              onClick={onClose}
              className="w-full py-2.5 border-2 border-nb-black dark:border-dark-border text-sm font-bold bg-nb-white dark:bg-dark-surface hover:bg-nb-gray-50 dark:hover:bg-dark-elevated transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
