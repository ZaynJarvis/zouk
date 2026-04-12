import type { CSSProperties } from 'react';

const styles: Record<string, CSSProperties> = {
  button: {
    all: 'unset',
    boxSizing: 'border-box',
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '16px',
    width: '100%',
    cursor: 'pointer',
    fontFamily: "'Rajdhani', system-ui, sans-serif",
    background: 'linear-gradient(180deg, #12121a 0%, #0f0f17 100%)',
    border: '1px solid #2a2a3a',
    color: '#c8d6e5',
    transition: 'border-color 0.2s, box-shadow 0.2s',
    clipPath: 'polygon(0 0, calc(100% - 8px) 0, 100% 8px, 100% 100%, 8px 100%, 0 calc(100% - 8px))',
  },
  buttonActive: {
    borderColor: '#5EF6FF',
    boxShadow: '0 0 8px rgba(94, 246, 255, 0.3), 0 0 20px rgba(94, 246, 255, 0.1)',
    background: 'linear-gradient(180deg, #12121a 0%, #0f0f17 100%)',
  },
  preview: {
    width: '40px',
    height: '40px',
    background: '#0a0a0f',
    border: '1px solid #2a2a3a',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    position: 'relative' as const,
    overflow: 'hidden',
  },
  previewLabel: {
    fontFamily: "'Orbitron', system-ui, sans-serif",
    fontSize: '10px',
    fontWeight: 700,
    color: '#5EF6FF',
    textShadow: '0 0 7px rgba(94, 246, 255, 0.6)',
    letterSpacing: '0.05em',
    zIndex: 1,
  },
  scanline: {
    position: 'absolute' as const,
    inset: 0,
    background: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(94, 246, 255, 0.04) 2px, rgba(94, 246, 255, 0.04) 4px)',
    pointerEvents: 'none' as const,
  },
  title: {
    fontFamily: "'Orbitron', system-ui, sans-serif",
    fontWeight: 700,
    fontSize: '13px',
    color: '#e8f0f8',
    letterSpacing: '0.05em',
  },
  subtitle: {
    fontSize: '11px',
    color: '#5a6478',
    marginTop: '2px',
    letterSpacing: '0.03em',
  },
  topEdge: {
    position: 'absolute' as const,
    top: 0,
    left: 0,
    right: 0,
    height: '1px',
    background: 'linear-gradient(90deg, transparent, rgba(94, 246, 255, 0.3), transparent)',
  },
};

interface Props {
  selected: boolean;
  onClick: () => void;
}

export default function ThemeSelectButton({ selected, onClick }: Props) {
  return (
    <button
      onClick={onClick}
      style={{
        ...styles.button,
        ...(selected ? styles.buttonActive : {}),
        position: 'relative',
      }}
      onMouseEnter={e => {
        if (!selected) {
          (e.currentTarget as HTMLElement).style.borderColor = 'rgba(94, 246, 255, 0.5)';
        }
      }}
      onMouseLeave={e => {
        if (!selected) {
          (e.currentTarget as HTMLElement).style.borderColor = '#2a2a3a';
        }
      }}
    >
      <div style={styles.topEdge} />
      <div style={styles.preview}>
        <div style={styles.scanline} />
        <span style={styles.previewLabel}>NC</span>
      </div>
      <div>
        <div style={styles.title}>Night City</div>
        <div style={styles.subtitle}>Dark cyberpunk</div>
      </div>
    </button>
  );
}
