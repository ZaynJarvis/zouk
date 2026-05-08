/* NowRail — persistent right-side panel showing live agent activity.
   Direct port of NowRail/NowCard from
   tmp/.../zouk-rethink/v1-conservative.jsx, wired to real agent + machine
   state. 320px wide, hidden on mobile, hides whenever any other right panel
   (thread / details / etc.) is open. */

import { useMemo, useState } from 'react';
import { useApp } from '../store/AppContext';
import type { ServerAgent } from '../types';
import { AgentAvatar, Eyebrow } from './zk/primitives';
import { contextUsageTextTone, formatContextPercent, pickDisplayContextUsage } from '../lib/contextUsage';

type Filter = 'live' | 'online' | 'all';

function isLive(a: ServerAgent) {
  return a.activity === 'working' || a.activity === 'thinking';
}

function NowCard({
  agent, machineName, onSelect,
}: {
  agent: ServerAgent;
  machineName?: string;
  onSelect: (id: string) => void;
}) {
  const live = isLive(agent);
  const usage = pickDisplayContextUsage(agent.contextUsage, agent.model);
  const pct = usage?.percent;

  return (
    <button
      type="button"
      onClick={() => onSelect(agent.id)}
      style={{
        width: '100%',
        padding: '12px 14px',
        background: 'transparent',
        border: 0,
        borderBottom: '1px solid var(--zk-line)',
        textAlign: 'left',
        cursor: 'pointer',
        color: 'inherit',
        display: 'flex',
        gap: 10,
        alignItems: 'flex-start',
        transition: 'background 140ms var(--zk-ease-out)',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--zk-bg-2)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
    >
      <AgentAvatar agent={agent} size="md" />
      <div className="zk-grow zk-col" style={{ minWidth: 0, gap: 2 }}>
        <div className="zk-row" style={{ gap: 6, alignItems: 'baseline' }}>
          <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--zk-ink)' }}>
            {agent.displayName || agent.name}
          </span>
          {machineName && (
            <span style={{ fontSize: 10, color: 'var(--zk-ink-mute)', fontFamily: 'var(--zk-font-mono)' }}>
              {machineName}
            </span>
          )}
        </div>
        <div
          className="zk-truncate"
          style={{
            fontSize: 11,
            color: live ? 'var(--zk-ink-dim)' : 'var(--zk-ink-mute)',
            fontStyle: live ? 'normal' : 'italic',
          }}
        >
          {live
            ? (agent.activityDetail || `${agent.activity}…`)
            : (agent.activity || 'offline')}
        </div>
        <div className="zk-row" style={{ gap: 8, marginTop: 4 }}>
          {pct !== undefined && (
            <span
              className="zk-tabular"
              style={{ fontSize: 9, fontFamily: 'var(--zk-font-mono)', letterSpacing: '0.04em', color: 'var(--zk-ink-mute)' }}
            >
              ctx <span className={contextUsageTextTone(pct)}>{formatContextPercent(pct)}</span>
            </span>
          )}
          {agent.runtime && (
            <span style={{ fontSize: 9, fontFamily: 'var(--zk-font-mono)', color: 'var(--zk-ink-mute)' }}>
              {agent.runtime}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

export default function NowRail() {
  const { agents, machines, openAgentProfile } = useApp();
  const [filter, setFilter] = useState<Filter>('live');

  const counts = useMemo(() => ({
    live: agents.filter(isLive).length,
    online: agents.filter((a) => a.activity && a.activity !== 'offline').length,
    all: agents.length,
  }), [agents]);

  const filtered = useMemo(() => {
    const base =
      filter === 'live' ? agents.filter(isLive)
      : filter === 'online' ? agents.filter((a) => a.activity && a.activity !== 'offline')
      : agents;
    const rank = (a: ServerAgent) =>
      a.activity === 'working' ? 0
      : a.activity === 'thinking' ? 1
      : a.activity === 'online' ? 2
      : a.activity === 'error' ? 3
      : 4;
    return [...base].sort(
      (a, b) => rank(a) - rank(b) || (a.displayName || a.name).localeCompare(b.displayName || b.name),
    );
  }, [agents, filter]);

  const machineLookup = useMemo(() => {
    const m = new Map<string, string>();
    machines.forEach((mach) => m.set(mach.id, mach.alias || mach.hostname));
    return m;
  }, [machines]);

  return (
    <aside
      className="safe-top"
      style={{
        width: 320,
        background: 'var(--zk-bg-1)',
        borderLeft: '1px solid var(--zk-line)',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
        height: '100%',
      }}
    >
      <header style={{ padding: '12px 14px', borderBottom: '1px solid var(--zk-line)' }}>
        <div className="zk-row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <Eyebrow>NOW · LIVE AGENTS</Eyebrow>
          {counts.live > 0 && (
            <span className="zk-row" style={{ gap: 4 }}>
              <span
                className="zk-dot zk-dot--working"
                style={{ animation: 'zkBlink 1.5s infinite' }}
              />
              <span style={{ fontSize: 10, color: 'var(--zk-ink-mute)', fontFamily: 'var(--zk-font-mono)' }}>
                STREAMING
              </span>
            </span>
          )}
        </div>

        <div className="zk-row" style={{ gap: 4, marginTop: 8 }}>
          {(['live', 'online', 'all'] as const).map((f) => {
            const active = filter === f;
            return (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className="zk-btn"
                style={{
                  padding: '3px 8px',
                  fontSize: 11,
                  background: active ? 'var(--zk-bg-3)' : 'transparent',
                  borderColor: active ? 'var(--zk-line-bright)' : 'var(--zk-line)',
                  color: active ? 'var(--zk-ink)' : 'var(--zk-ink-mute)',
                  textTransform: 'capitalize',
                  fontFamily: 'var(--zk-font-mono)',
                  letterSpacing: '0.04em',
                }}
              >
                {f}{' '}
                <span style={{ color: 'var(--zk-ink-low)' }}>{counts[f]}</span>
              </button>
            );
          })}
        </div>
      </header>

      <div className="zk-grow zk-scroll" style={{ overflow: 'auto' }}>
        {filtered.length === 0 ? (
          <div
            style={{
              padding: '40px 16px',
              textAlign: 'center',
              fontSize: 11,
              color: 'var(--zk-ink-mute)',
              fontFamily: 'var(--zk-font-mono)',
            }}
          >
            {filter === 'live' ? 'No agents currently working.' : 'No agents.'}
          </div>
        ) : (
          filtered.map((a) => (
            <NowCard
              key={a.id}
              agent={a}
              machineName={a.machineId ? machineLookup.get(a.machineId) : undefined}
              onSelect={openAgentProfile}
            />
          ))
        )}
      </div>

      <div
        style={{
          padding: '10px 14px',
          borderTop: '1px solid var(--zk-line)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontSize: 10,
          color: 'var(--zk-ink-mute)',
          fontFamily: 'var(--zk-font-mono)',
        }}
      >
        <span>{counts.live > 0 ? 'live · ws push' : 'idle'}</span>
        <span style={{ color: 'var(--zk-ink-low)' }}>
          {counts.online} of {counts.all} online
        </span>
      </div>
    </aside>
  );
}
