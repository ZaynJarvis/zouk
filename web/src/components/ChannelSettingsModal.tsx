import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bot, Hash, Loader2, X } from 'lucide-react';
import { useApp } from '../store/AppContext';
import ScanlineTear from './glitch/ScanlineTear';
import {
  fetchChannelAgents,
  setChannelAgentMembership,
  removeChannelAgentMembership,
  type ChannelAgentMembership,
} from '../lib/api';

export default function ChannelSettingsModal() {
  const {
    channels, agents, configs, channelSettingsId, closeChannelSettings, addToast,
  } = useApp();

  const channel = useMemo(
    () => channels.find((c) => c.id === channelSettingsId) ?? null,
    [channels, channelSettingsId],
  );

  const [memberships, setMemberships] = useState<Record<string, ChannelAgentMembership>>({});
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    if (!channel) return;
    setLoading(true);
    try {
      const rows = await fetchChannelAgents(channel.id);
      const map: Record<string, ChannelAgentMembership> = {};
      for (const row of rows) map[row.agentId] = row;
      setMemberships(map);
    } catch {
      addToast('Failed to load channel agents', 'error');
    } finally {
      setLoading(false);
    }
  }, [channel, addToast]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!channelSettingsId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      closeChannelSettings();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [channelSettingsId, closeChannelSettings]);

  // Union of all known agents (configured + live) keyed by id, so ops can
  // subscribe an agent that currently has no membership row.
  const knownAgents = useMemo(() => {
    const map = new Map<string, { id: string; name: string; displayName?: string; picture?: string }>();
    for (const cfg of configs) {
      if (!cfg.id) continue;
      map.set(cfg.id, { id: cfg.id, name: cfg.name, displayName: cfg.displayName, picture: cfg.picture });
    }
    for (const a of agents) {
      map.set(a.id, { id: a.id, name: a.name, displayName: a.displayName, picture: a.picture });
    }
    return Array.from(map.values()).sort((a, b) =>
      (a.displayName || a.name).localeCompare(b.displayName || b.name),
    );
  }, [agents, configs]);

  const toggleAgent = useCallback(async (agentId: string, visible: boolean) => {
    if (!channel) return;
    setPending((p) => ({ ...p, [agentId]: true }));
    const prev = memberships[agentId] ?? null;
    setMemberships((cur) => {
      const next = { ...cur };
      if (visible) {
        next[agentId] = { agentId, agentName: prev?.agentName ?? agentId, canRead: true, subscribed: true };
      } else {
        delete next[agentId];
      }
      return next;
    });
    try {
      if (visible) {
        const saved = await setChannelAgentMembership(channel.id, agentId, { canRead: true, subscribed: true });
        if (saved) setMemberships((cur) => ({ ...cur, [agentId]: saved }));
      } else {
        await removeChannelAgentMembership(channel.id, agentId);
      }
    } catch {
      addToast('Failed to update agent visibility', 'error');
      setMemberships((cur) => {
        const next = { ...cur };
        if (prev) next[agentId] = prev;
        else delete next[agentId];
        return next;
      });
    } finally {
      setPending((p) => {
        const next = { ...p };
        delete next[agentId];
        return next;
      });
    }
  }, [channel, memberships, addToast]);

  if (!channelSettingsId) return null;

  const isDm = !!channel && (channel.type || 'channel') === 'dm';
  const visibleCount = Object.values(memberships).filter((m) => m.canRead).length;

  return (
    <div
      className="fixed inset-0 bg-nc-black/70 flex items-center justify-center z-50 animate-fade-in p-4 safe-top safe-bottom"
      onClick={(e) => e.target === e.currentTarget && closeChannelSettings()}
    >
      <div className="cyber-panel w-full max-w-2xl max-h-[80vh] flex flex-col overflow-hidden animate-bounce-in">
        <div className="h-14 flex items-center justify-between px-5 border-b border-nc-border flex-shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <Hash size={16} className="text-nc-cyan flex-shrink-0" />
            <h3 className="font-display font-extrabold text-base text-nc-text-bright tracking-wider truncate">
              {channel ? `CHANNEL · ${channel.name.toUpperCase()}` : 'CHANNEL_NOT_FOUND'}
            </h3>
          </div>
          <ScanlineTear config={{ trigger: 'hover', minInterval: 200, maxInterval: 600, minSeverity: 0.3, maxSeverity: 0.8 }}>
            <button
              onClick={closeChannelSettings}
              className="cyber-btn w-8 h-8 border border-nc-border flex items-center justify-center text-nc-muted hover:border-nc-red hover:text-nc-red hover:bg-nc-red/10"
              aria-label="Close"
            >
              <X size={16} />
            </button>
          </ScanlineTear>
        </div>

        {!channel ? (
          <div className="p-6 text-sm text-nc-muted font-mono">CHANNEL_NOT_FOUND</div>
        ) : (
          <div className="flex-1 overflow-y-auto scrollbar-thin">
            <div className="px-5 py-4 border-b border-nc-border">
              <h4 className="text-xs font-bold uppercase tracking-wider text-nc-muted mb-1 font-mono">
                Agent Visibility
              </h4>
              <p className="text-xs text-nc-muted font-mono leading-relaxed">
                {isDm
                  ? 'DMs are scoped to the two parties — membership cannot be edited here.'
                  : 'Click an agent to toggle whether it can read this channel.'}
              </p>
            </div>

            <div className="p-5">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-bold uppercase tracking-wider text-nc-muted font-mono">
                  {visibleCount} / {knownAgents.length} visible
                </span>
                {loading && <Loader2 size={14} className="text-nc-muted animate-spin" />}
              </div>

              {knownAgents.length === 0 ? (
                <p className="text-xs text-nc-muted italic font-mono">No agents configured</p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {knownAgents.map((a) => {
                    const m = memberships[a.id];
                    const visible = !!m?.canRead;
                    const isPending = !!pending[a.id];
                    const disabled = isDm || isPending;
                    return (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => !disabled && toggleAgent(a.id, !visible)}
                        disabled={disabled}
                        aria-pressed={visible}
                        title={isDm ? 'DM channels cannot be edited' : visible ? 'Click to hide' : 'Click to show'}
                        className={`relative flex items-center gap-3 px-3 py-2.5 border text-left transition-colors ${
                          visible
                            ? 'border-nc-green/30 bg-nc-green/5 hover:bg-nc-green/10 text-nc-text-bright'
                            : 'border-nc-border/40 bg-nc-deep/40 hover:bg-nc-deep/60 text-nc-muted'
                        } ${disabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}
                      >
                        <div className={`relative w-9 h-9 border flex-shrink-0 font-display font-bold text-xs flex items-center justify-center overflow-hidden ${
                          visible
                            ? 'border-nc-green/40 bg-nc-green/10 text-nc-green'
                            : 'border-nc-border/40 bg-nc-elevated text-nc-muted grayscale'
                        }`}>
                          {a.picture ? (
                            <img src={a.picture} alt="" className="w-full h-full object-cover" />
                          ) : (
                            <Bot size={14} />
                          )}
                          {!visible && (
                            <span
                              aria-hidden="true"
                              className="pointer-events-none absolute left-[-10%] right-[-10%] top-1/2 -translate-y-1/2 h-[2px] bg-nc-red rotate-[-18deg] shadow-[0_0_4px_rgba(255,0,64,0.6)]"
                            />
                          )}
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className={`text-sm font-medium truncate ${
                            !visible ? 'line-through decoration-nc-red decoration-2' : ''
                          }`}>
                            {a.displayName || a.name}
                          </div>
                          <div className="text-2xs text-nc-muted font-mono truncate">@{a.name}</div>
                        </div>

                        {isPending && (
                          <Loader2 size={14} className="animate-spin text-nc-muted flex-shrink-0" />
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
