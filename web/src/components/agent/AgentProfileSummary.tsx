import type { CSSProperties } from 'react';
import { useApp } from '../../store/AppContext';
import type { ServerAgent } from '../../types';
import { activityLabels } from '../../lib/activityStatus';
import { formatRuntime } from '../../lib/runtimeLabels';
import {
  agentAvatarStatus,
  agentLifecycle,
  avatarPaletteClass,
  avatarRadiusClass,
} from '../../lib/avatarStatus';

export default function AgentProfileSummary({
  agent,
  compact = false,
  showStatusDot = true,
  className,
  style,
}: {
  agent: ServerAgent;
  compact?: boolean;
  showStatusDot?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  const { machines, selectChannel, theme } = useApp();
  const machine = agent.machineId ? machines.find((m) => m.id === agent.machineId) : null;
  const activity = agent.activity || 'offline';
  const avatarStatus = agentAvatarStatus(agent);
  const isActive = agent.status === 'active';
  const runtimeLabel = formatRuntime(agent.runtime) || 'Unknown';
  const machineLabel = machine?.alias || machine?.hostname;
  const avatarSizeClass = compact ? 'w-9 h-9 text-sm' : 'w-12 h-12 text-base';
  const titleSize = compact ? 14 : 15;

  return (
    <div className={className} style={style}>
      <div className="flex items-start gap-3">
        <button
          type="button"
          onClick={() => selectChannel(agent.name, true)}
          title={`Message @${agent.displayName || agent.name}`}
          className={`relative ${avatarSizeClass} shrink-0 p-0 border-0 bg-transparent cursor-pointer text-inherit`}
        >
          <div className={`w-full h-full border flex items-center justify-center overflow-hidden font-display font-bold ${avatarPaletteClass(avatarStatus, 'cyan', agentLifecycle(agent))} ${avatarRadiusClass(theme)}`}>
            {agent.picture ? (
              <img src={agent.picture} alt="" className="w-full h-full object-cover" />
            ) : (
              (agent.displayName || agent.name).charAt(0).toUpperCase()
            )}
          </div>
          {showStatusDot && (
            <span
              style={{
                position: 'absolute', right: -1, bottom: -1,
                width: 8, height: 8,
                border: '2px solid var(--zk-bg-1)',
                borderRadius: '50%',
                boxSizing: 'content-box',
              }}
              className={`zk-dot zk-dot--${avatarStatus}`}
            />
          )}
        </button>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <div className="zk-display" style={{ fontSize: titleSize, color: 'var(--zk-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              @{agent.displayName || agent.name}
            </div>
            <span className="zk-pill zk-pill--ok" style={{ flexShrink: 0 }}>Agent</span>
          </div>
          <div className="zk-mono" style={{ fontSize: 10, color: 'var(--zk-ink-mute)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {isActive ? activityLabels[activity] : 'Inactive'}
            {agent.activityDetail && isActive ? ` · ${agent.activityDetail}` : ''}
          </div>
        </div>
      </div>

      {agent.description && (
        <p style={{ fontSize: 12, color: 'var(--zk-ink-dim)', fontFamily: 'var(--zk-font-sans)', lineHeight: 1.5, margin: compact ? '8px 0 0' : '12px 0 0' }}>{agent.description}</p>
      )}

      <div className="zk-mono" style={{ fontSize: 10, color: 'var(--zk-ink-mute)', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0 6px', marginTop: compact ? 6 : 12 }}>
        <span style={{ color: 'var(--zk-ink)' }}>{runtimeLabel}</span>
        {agent.model && (
          <>
            <span>·</span>
            <span style={{ color: 'var(--zk-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{agent.model}</span>
          </>
        )}
        {machineLabel && (
          <>
            <span>·</span>
            <span style={{ color: 'var(--zk-ok)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>@{machineLabel}</span>
          </>
        )}
      </div>

      {((agent.channels && agent.channels.length > 0) || (agent.skills && agent.skills.length > 0)) && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: compact ? 8 : 12 }}>
          {agent.channels?.map((ch) => (
            <span key={`c-${ch}`} className="zk-pill zk-pill--ember">#{ch}</span>
          ))}
          {agent.skills?.map((s) => (
            <span key={`s-${s.id}`} className="zk-pill zk-pill--warn" title={s.description || s.name}>{s.name}</span>
          ))}
        </div>
      )}

      {agent.workDir && (
        <div className="zk-mono" style={{ fontSize: 10, color: 'var(--zk-ok)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: compact ? 6 : 12 }} title={agent.workDir}>
          {agent.workDir}
        </div>
      )}
    </div>
  );
}
