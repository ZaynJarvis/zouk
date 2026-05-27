import type { ReactNode } from 'react';
import { CheckCircle2, Info, AlertTriangle, XCircle } from 'lucide-react';

export interface ZkCalloutProps {
  type: 'info' | 'ok' | 'warn' | 'err';
  title?: string;
  children: ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

const icons = {
  info: Info,
  ok: CheckCircle2,
  warn: AlertTriangle,
  err: XCircle,
};

export default function ZkCallout({ type, title, children, className = '', style }: ZkCalloutProps) {
  const Icon = icons[type];
  
  return (
    <div className={`zk-callout zk-callout--${type} ${className}`} style={style}>
      <Icon size={14} style={{ flexShrink: 0, marginTop: title ? 1 : 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        {title && (
          <p style={{ fontWeight: 600, fontSize: 13, margin: '0 0 2px' }}>
            {title}
          </p>
        )}
        <div style={{ color: title ? 'var(--zk-ink-mute)' : 'inherit' }}>
          {children}
        </div>
      </div>
    </div>
  );
}
