import type { CSSProperties } from 'react';

const base: CSSProperties = {
  all: 'unset',
  boxSizing: 'border-box',
  position: 'relative',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: '88px',
  width: '100%',
  padding: '16px',
  cursor: 'pointer',
  overflow: 'hidden',
  fontFamily: "'Orbitron', system-ui, sans-serif",
  fontSize: '13px',
  fontWeight: 700,
  letterSpacing: '0.15em',
  textTransform: 'uppercase' as const,
  color: '#1f2937',
  background: 'linear-gradient(180deg, #ffffff 0%, #f3f4f6 100%)',
  border: '1px solid #d1d5db',
  borderRadius: '8px',
  transition: 'border-color 0.2s, box-shadow 0.2s, background 0.2s',
};

const active: CSSProperties = {
  borderColor: '#0891b2',
  boxShadow: '0 0 0 3px rgba(8, 145, 178, 0.15), 0 2px 8px rgba(8, 145, 178, 0.1)',
  background: 'linear-gradient(180deg, #ecfeff 0%, #e0f7fa 100%)',
};

const labelStyle: CSSProperties = {
  color: '#0891b2',
  fontWeight: 700,
};

interface Props {
  selected: boolean;
  onClick: () => void;
}

export default function DaylightThemeSelectButton({ selected, onClick }: Props) {
  return (
    <button
      onClick={onClick}
      aria-pressed={selected}
      style={{ ...base, ...(selected ? active : {}) }}
      onMouseEnter={e => {
        if (!selected) (e.currentTarget.style.borderColor = 'rgba(8, 145, 178, 0.5)');
      }}
      onMouseLeave={e => {
        if (!selected) (e.currentTarget.style.borderColor = '#d1d5db');
      }}
    >
      <span style={selected ? labelStyle : { color: '#6b7280' }}>Daylight</span>
    </button>
  );
}
