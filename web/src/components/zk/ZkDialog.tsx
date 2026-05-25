import type { ReactNode } from 'react';
import { X } from 'lucide-react';

export default function ZkDialog({
  title,
  subtitle,
  width = 520,
  onClose,
  children,
}: {
  title: string;
  subtitle?: string;
  width?: number;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(10,11,13,0.82)',
        backdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 50,
        padding: 16,
      }}
      className="zk-fade-in"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="zk-panel zk-scroll"
        style={{
          width,
          maxWidth: '100%',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: 'var(--zk-shadow-2)',
          borderRadius: 'var(--zk-r-xl)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '20px 24px 12px',
            borderBottom: '1px solid var(--zk-line)',
            flexShrink: 0,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <h2
              className="zk-display"
              style={{ fontSize: 19, color: 'var(--zk-ink)', margin: 0 }}
            >
              {title}
            </h2>
            {subtitle && (
              <p
                style={{
                  fontSize: 12,
                  color: 'var(--zk-ink-mute)',
                  fontFamily: 'var(--zk-font-sans)',
                  margin: '2px 0 0',
                }}
              >
                {subtitle}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="zk-btn zk-btn--ghost zk-btn--icon"
            style={{ flexShrink: 0 }}
          >
            <X size={16} />
          </button>
        </div>

        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '16px 24px 20px',
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
