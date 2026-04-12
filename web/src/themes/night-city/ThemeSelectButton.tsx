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
  letterSpacing: '0.18em',
  textTransform: 'uppercase' as const,
  color: '#c8d6e5',
  background: 'rgba(10, 10, 15, 0.96)',
  border: '1px solid rgba(94, 246, 255, 0.53)',
  clipPath: 'polygon(0 0, calc(100% - 8px) 0, 100% 8px, 100% 100%, 8px 100%, 0 calc(100% - 8px))',
  transition: 'border-color 0.2s, box-shadow 0.2s, background 0.2s',
};

const active: CSSProperties = {
  background: 'rgba(94, 246, 255, 0.18)',
  borderColor: '#5EF6FF',
  boxShadow: '0 0 18px rgba(94,246,255,0.26), inset 0 0 24px rgba(94,246,255,0.06)',
};

const inactive: CSSProperties = {
  boxShadow: 'inset 0 1px 0 rgba(94,246,255,0.10)',
};

const topLine: CSSProperties = {
  position: 'absolute',
  left: 0,
  right: 0,
  top: 0,
  height: '2px',
  background: '#5EF6FF',
  opacity: 0.9,
};

const scanlines: CSSProperties = {
  position: 'absolute',
  inset: 0,
  opacity: 0.10,
  backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(94,246,255,0.12) 2px, rgba(94,246,255,0.12) 4px)',
  pointerEvents: 'none',
};

const labelStyle: CSSProperties = {
  position: 'relative',
  zIndex: 1,
  textShadow: '0 0 7px rgba(94, 246, 255, 0.6), 0 0 20px rgba(94, 246, 255, 0.2)',
};

interface Props {
  selected: boolean;
  onClick: () => void;
}

export default function NightCityThemeSelectButton({ selected, onClick }: Props) {
  return (
    <button
      onClick={onClick}
      aria-pressed={selected}
      style={{ ...base, ...(selected ? active : inactive) }}
      onMouseEnter={e => {
        if (!selected) (e.currentTarget.style.borderColor = '#5EF6FF');
      }}
      onMouseLeave={e => {
        if (!selected) (e.currentTarget.style.borderColor = 'rgba(94, 246, 255, 0.53)');
      }}
    >
      <div style={topLine} />
      <div style={scanlines} />
      <span style={labelStyle}>Night City</span>
    </button>
  );
}
