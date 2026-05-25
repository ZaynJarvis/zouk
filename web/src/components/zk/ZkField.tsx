import type { ReactNode } from 'react';

const labelStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  fontFamily: 'var(--zk-font-mono)',
  letterSpacing: '0.02em',
  color: 'var(--zk-ink-dim)',
};

const hintStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--zk-ink-mute)',
  fontFamily: 'var(--zk-font-sans)',
  lineHeight: 1.4,
  fontWeight: 400,
};

export default function ZkField({
  label,
  hint,
  children,
  className,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={labelStyle}>{label}</span>
        {hint && <span style={hintStyle}>{hint}</span>}
      </div>
      {children}
    </div>
  );
}
