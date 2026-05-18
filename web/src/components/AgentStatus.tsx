/* AgentStatus — persistent right-side panel showing live agent activity.
   320px wide, hidden on mobile, hides whenever any other right panel
   (thread / details / etc.) is open. */

import { useMemo, useState } from 'react';
import { ChevronRight, ChevronLeft } from 'lucide-react';
import { useApp } from '../store/AppContext';
import type { ServerAgent } from '../types';
import { AgentAvatar, Eyebrow } from './zk/primitives';
import {
  contextUsageTextTone,
  formatContextUsageCompact,
  formatContextUsageTitle,
  pickDisplayContextUsage,
} from '../lib/contextUsage';
import { agentIsLive, agentIsOnline } from '../lib/avatarStatus';

type Filter = 'live' | 'online' | 'all';

function NowCard({
  agent, machineName, onSelect,
}: {
  agent: ServerAgent;
  machineName?: string;
  onSelect: (id: string) => void;
}) {
  const live = agentIsLive(agent);
  const online = agentIsOnline(agent);
  const usage = pickDisplayContextUsage(agent.contextUsage, agent.model);
  const pct = usage?.percent;
  const usageLabel = formatContextUsageCompact(usage);
  const usageTitle = formatContextUsageTitle(agent.contextUsage, agent.model);

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
            : (online ? agent.activity : 'offline')}
        </div>
        <div className="zk-row" style={{ gap: 8, marginTop: 4 }}>
          {usageLabel && (
            <span
              className="zk-tabular"
              style={{
                fontSize: 9,
                fontFamily: 'var(--zk-font-mono)',
                letterSpacing: '0.04em',
                color: 'var(--zk-ink-mute)',
              }}
              title={usageTitle}
            >
              <span className={contextUsageTextTone(pct)}>{usageLabel}</span>
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

export default function AgentStatus() {
  const { agents, machines, openAgentProfile, setNowRailHidden } = useApp();
  const [filter, setFilter] = useState<Filter>('live');

  const counts = useMemo(() => ({
    live: agents.filter(agentIsLive).length,
    online: agents.filter(agentIsOnline).length,
    all: agents.length,
  }), [agents]);

  const filtered = useMemo(() => {
    const base =
      filter === 'live' ? agents.filter(agentIsLive)
      : filter === 'online' ? agents.filter(agentIsOnline)
      : agents;
    const rank = (a: ServerAgent) =>
      !agentIsOnline(a) ? 4
      : a.activity === 'working' ? 0
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
        <div className="zk-row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <button
            type="button"
            onClick={() => setNowRailHidden(true)}
            className="zk-btn zk-btn--ghost zk-btn--icon"
            title="Collapse panel"
            aria-label="Collapse live agents panel"
            style={{ padding: 2 }}
          >
            <ChevronRight size={13} />
          </button>
          <Eyebrow>NOW · LIVE AGENTS</Eyebrow>
          <span className="zk-grow" />
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
                  height: 35,
                  padding: '0 12px',
                  fontSize: 11,
                  boxSizing: 'border-box',
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

/* Thin vertical strip on the right edge — shown in place of the full AgentStatus panel
   when the user has collapsed it. Click expands the rail back. */
export function AgentStatusPeek() {
  const { setNowRailHidden, agents } = useApp();
  const liveCount = agents.filter(agentIsLive).length;

  return (
    <button
      type="button"
      onClick={() => setNowRailHidden(false)}
      className="safe-top group"
      title="Show live agents"
      aria-label="Show live agents panel"
      style={{
        width: 24,
        height: '100%',
        flexShrink: 0,
        background: 'var(--zk-bg-1)',
        borderLeft: '1px solid var(--zk-line)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        padding: '12px 0',
        cursor: 'pointer',
        color: 'var(--zk-ink-mute)',
        transition: 'background 140ms var(--zk-ease-out), color 140ms var(--zk-ease-out)',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'var(--zk-bg-2)';
        e.currentTarget.style.color = 'var(--zk-ink)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'var(--zk-bg-1)';
        e.currentTarget.style.color = 'var(--zk-ink-mute)';
      }}
    >
      <ChevronLeft size={14} />
      {liveCount > 0 && (
        <span className="zk-row" style={{ flexDirection: 'column', gap: 4, alignItems: 'center' }}>
          <span className="zk-dot zk-dot--working" style={{ animation: 'zkBlink 1.5s infinite' }} />
          <span
            style={{
              fontSize: 9,
              fontFamily: 'var(--zk-font-mono)',
              color: 'var(--zk-ink-mute)',
            }}
            className="zk-tabular"
          >
            {liveCount}
          </span>
        </span>
      )}
    </button>
  );
}
