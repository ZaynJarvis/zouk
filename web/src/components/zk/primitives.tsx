/* zk primitives — direct port of
   tmp/agent-swarm-slack-discord-like-app/project/zouk-rethink/primitives.jsx,
   adapted for our TypeScript / data types. */

import type { ReactNode } from 'react';
import type { ServerAgent, ServerHuman, AgentActivity } from '../../types';

/* ───── Time helpers ───── */

export function relTime(iso?: string | null): string {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return '';
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}

export function clockTime(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/* ───── Avatar ───── */

type AvatarSize = 'sm' | 'md' | 'lg' | 'xl';
type AvatarKind = 'agent' | 'human';

export function Avatar({
  src,
  name,
  size = 'md',
  kind = 'human',
  online,
  activity,
  ring,
  className,
}: {
  src?: string | null;
  name?: string;
  size?: AvatarSize;
  kind?: AvatarKind;
  online?: boolean | null;
  activity?: AgentActivity | null;
  ring?: string;
  className?: string;
}) {
  const initial = (name || '?').slice(0, 1).toUpperCase();
  const sizeCls =
    size === 'sm' ? 'zk-avatar zk-avatar--sm'
    : size === 'lg' ? 'zk-avatar zk-avatar--lg'
    : size === 'xl' ? 'zk-avatar zk-avatar--xl'
    : 'zk-avatar';
  const shapeCls = kind === 'agent' ? 'zk-avatar--square' : '';
  const cls = [sizeCls, shapeCls, className].filter(Boolean).join(' ');

  const showDot = activity || (online === true || online === false);
  const dotKey: AgentActivity | 'online' | 'offline' = activity ?? (online ? 'online' : 'offline');
  const dotSize = size === 'sm' ? 6 : size === 'xl' ? 12 : 8;

  return (
    <span
      className={cls}
      style={ring ? ({ boxShadow: `0 0 0 2px ${ring}, 0 0 0 3px var(--zk-bg-1)` } as React.CSSProperties) : undefined}
    >
      {src ? <img src={src} alt={name ?? ''} /> : <span className="zk-avatar-initial">{initial}</span>}
      {showDot && (
        <span
          className={`zk-dot zk-dot--${dotKey}`}
          style={{
            position: 'absolute',
            right: -1,
            bottom: -1,
            width: dotSize,
            height: dotSize,
            border: '2px solid var(--zk-bg-1)',
            borderRadius: '50%',
            boxSizing: 'content-box',
          }}
        />
      )}
    </span>
  );
}

/* Convenience renderers */

export function AgentAvatar({
  agent, size, className,
}: { agent: ServerAgent; size?: AvatarSize; className?: string }) {
  return (
    <Avatar
      src={agent.picture}
      name={agent.displayName || agent.name}
      kind="agent"
      size={size}
      activity={agent.activity}
      className={className}
    />
  );
}

export function HumanAvatar({
  human, size, className,
}: { human: ServerHuman; size?: AvatarSize; className?: string }) {
  return (
    <Avatar
      src={human.picture || human.gravatarUrl}
      name={human.name}
      kind="human"
      size={size}
      online={human.online ?? true}
      className={className}
    />
  );
}

/* ───── Activity pill ───── */

export function ActivityPill({
  activity,
  detail,
  compact,
}: {
  activity?: AgentActivity | null;
  detail?: string;
  compact?: boolean;
}) {
  const label = activity ? activity.toUpperCase() : 'IDLE';
  const cls =
    activity === 'working' ? 'zk-pill--info'
    : activity === 'thinking' ? 'zk-pill--warn'
    : activity === 'online' ? 'zk-pill--ok'
    : activity === 'error' ? 'zk-pill--err'
    : '';
  return (
    <span className={`zk-pill ${cls}`}>
      <span className={`zk-dot zk-dot--${activity || 'offline'}`} />
      <span>{label}</span>
      {!compact && detail && (
        <span style={{ color: 'var(--zk-ink-dim)', fontWeight: 400, marginLeft: 2 }}>· {detail}</span>
      )}
    </span>
  );
}

/* ───── Hash glyph ───── */

export function Hash({ name, dim }: { name: string; dim?: boolean }) {
  return (
    <span style={{ color: dim ? 'var(--zk-ink-mute)' : 'inherit' }}>
      <span
        style={{
          color: 'var(--zk-ink-low)',
          fontFamily: 'var(--zk-font-mono)',
          fontWeight: 400,
          marginRight: 4,
        }}
      >#</span>
      {name}
    </span>
  );
}

/* ───── Eyebrow ───── */

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={`zk-eyebrow ${className || ''}`}>{children}</span>;
}

/* ───── Kbd badge ───── */

export function Kbd({ children }: { children: ReactNode }) {
  return <span className="zk-kbd">{children}</span>;
}

/* ───── Light-weight pill (manual styling) ───── */

export function Pill({
  tone, children,
}: { tone?: 'ok' | 'info' | 'warn' | 'err' | 'ember'; children: ReactNode }) {
  const cls = tone ? `zk-pill zk-pill--${tone}` : 'zk-pill';
  return <span className={cls}>{children}</span>;
}
