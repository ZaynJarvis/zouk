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
  fontFamily: "'Space Grotesk', system-ui, sans-serif",
  fontSize: '14px',
  fontWeight: 900,
  letterSpacing: '0.14em',
  textTransform: 'uppercase' as const,
  color: '#171717',
  background: '#fffaf0',
  border: '3px solid #171717',
  boxShadow: '3px 3px 0 #171717',
  transition: 'background 0.15s, box-shadow 0.15s, transform 0.15s',
};

const active: CSSProperties = {
  background: '#facc15',
  boxShadow: '5px 5px 0 #171717',
};

interface Props {
  selected: boolean;
  onClick: () => void;
}

export default function BrutalistThemeSelectButton({ selected, onClick }: Props) {
  return (
    <button
      onClick={onClick}
      aria-pressed={selected}
      style={{ ...base, ...(selected ? active : {}) }}
      onMouseEnter={e => {
        if (!selected) {
          e.currentTarget.style.boxShadow = '4px 4px 0 #171717';
          e.currentTarget.style.background = '#fef9c3';
        }
      }}
      onMouseLeave={e => {
        if (!selected) {
          e.currentTarget.style.boxShadow = '3px 3px 0 #171717';
          e.currentTarget.style.background = '#fffaf0';
        }
      }}
    >
      <span>Brutalist</span>
    </button>
  );
}
