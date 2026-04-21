import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bot, Eye, EyeOff, Hash, Loader2 } from 'lucide-react';
import { useApp } from '../store/AppContext';
import PanelShell from './panel/PanelShell';
import PanelHeader from './panel/PanelHeader';
import {
  fetchChannelAgents,
  setChannelAgentMembership,
  removeChannelAgentMembership,
  type ChannelAgentMembership,
} from '../lib/api';

const panelWidthClassName = 'w-screen lg:w-[30vw] lg:min-w-[340px] lg:max-w-[520px]';

export default function ChannelSettingsPanel() {
  const {
    channels, agents, configs, channelSettingsId, closeRightPanel, addToast,
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
    // Optimistic update.
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
      // Revert to previous state.
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

  if (!channel) {
    return (
      <PanelShell widthClassName={panelWidthClassName} centered>
        <p className="text-sm text-nc-muted font-mono">CHANNEL_NOT_FOUND</p>
      </PanelShell>
    );
  }

  const isDm = (channel.type || 'channel') === 'dm';
  const visibleCount = Object.values(memberships).filter((m) => m.canRead).length;

  return (
    <PanelShell widthClassName={panelWidthClassName} animated>
      <PanelHeader onClose={closeRightPanel}>
        <div className="flex items-center gap-2 min-w-0">
          <Hash size={16} className="text-nc-cyan flex-shrink-0" />
          <h3 className="font-display font-extrabold text-base text-nc-text-bright tracking-wider truncate">
            CHANNEL · {channel.name.toUpperCase()}
          </h3>
        </div>
      </PanelHeader>

      <div className="flex-1 overflow-y-auto scrollbar-thin">
        <div className="p-4 border-b border-nc-border">
          <h4 className="text-xs font-bold uppercase tracking-wider text-nc-muted mb-1 font-mono">
            Agent Visibility
          </h4>
          <p className="text-xs text-nc-muted font-mono leading-relaxed">
            {isDm
              ? 'DMs are scoped to the two parties — membership cannot be edited here.'
              : 'Toggle which agents receive messages and can read this channel.'}
          </p>
        </div>

        <div className="p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-bold uppercase tracking-wider text-nc-muted font-mono">
              {visibleCount} / {knownAgents.length} visible
            </span>
            {loading && <Loader2 size={14} className="text-nc-muted animate-spin" />}
          </div>

          {knownAgents.length === 0 && (
            <p className="text-xs text-nc-muted italic font-mono">No agents configured</p>
          )}

          <ul className="space-y-1">
            {knownAgents.map((a) => {
              const m = memberships[a.id];
              const visible = !!m?.canRead;
              const isPending = !!pending[a.id];
              const disabled = isDm || isPending;
              return (
                <li key={a.id} className="flex items-center gap-2 px-2 py-2 border border-transparent hover:border-nc-border hover:bg-nc-elevated transition-colors">
                  <div className="w-7 h-7 border border-nc-green/30 bg-nc-green/10 font-display font-bold text-2xs flex items-center justify-center text-nc-green overflow-hidden flex-shrink-0">
                    {a.picture ? (
                      <img src={a.picture} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <Bot size={12} />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-nc-text-bright truncate">
                      {a.displayName || a.name}
                    </div>
                    <div className="text-2xs text-nc-muted font-mono truncate">@{a.name}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => toggleAgent(a.id, !visible)}
                    disabled={disabled}
                    title={visible ? 'Hide from channel' : 'Add to channel'}
                    aria-pressed={visible}
                    className={`w-8 h-8 border flex items-center justify-center transition-all flex-shrink-0 ${
                      visible
                        ? 'border-nc-green/40 bg-nc-green/10 text-nc-green hover:bg-nc-green/20'
                        : 'border-nc-border text-nc-muted hover:border-nc-cyan/40 hover:text-nc-cyan'
                    } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    {isPending ? <Loader2 size={14} className="animate-spin" /> : visible ? <Eye size={14} /> : <EyeOff size={14} />}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </PanelShell>
  );
}
