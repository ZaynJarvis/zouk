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
    fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
    background: 'linear-gradient(180deg, #ffffff 0%, #f8f9fb 100%)',
    border: '1px solid #e2e5ea',
    borderRadius: '10px',
    color: '#1a1d23',
    transition: 'border-color 0.2s, box-shadow 0.2s',
  },
  buttonActive: {
    borderColor: '#3b82f6',
    boxShadow: '0 0 0 3px rgba(59, 130, 246, 0.15), 0 2px 8px rgba(59, 130, 246, 0.1)',
    background: 'linear-gradient(180deg, #f0f6ff 0%, #e8f0fe 100%)',
  },
  preview: {
    width: '40px',
    height: '40px',
    background: 'linear-gradient(135deg, #f0f6ff 0%, #dbeafe 100%)',
    border: '1px solid #bfdbfe',
    borderRadius: '8px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  previewLabel: {
    fontFamily: "'Inter', system-ui, sans-serif",
    fontSize: '11px',
    fontWeight: 700,
    color: '#3b82f6',
    letterSpacing: '0.02em',
  },
  title: {
    fontWeight: 600,
    fontSize: '13px',
    color: '#1a1d23',
    letterSpacing: '0.01em',
  },
  subtitle: {
    fontSize: '11px',
    color: '#8b919a',
    marginTop: '2px',
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
      }}
      onMouseEnter={e => {
        if (!selected) {
          (e.currentTarget as HTMLElement).style.borderColor = 'rgba(59, 130, 246, 0.5)';
        }
      }}
      onMouseLeave={e => {
        if (!selected) {
          (e.currentTarget as HTMLElement).style.borderColor = '#e2e5ea';
        }
      }}
    >
      <div style={styles.preview}>
        <span style={styles.previewLabel}>DY</span>
      </div>
      <div>
        <div style={styles.title}>Daylight</div>
        <div style={styles.subtitle}>Bright variant</div>
      </div>
    </button>
  );
}
