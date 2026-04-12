import { useRef, useCallback } from 'react';

const STYLE_ID = 'hm-theme-btn-style';

const css = `
.hm-theme-btn {
  all: initial;
  box-sizing: border-box;
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 88px;
  width: 100%;
  padding: 16px;
  cursor: pointer;
  overflow: hidden;
  font-family: 'Cormorant Garamond', Georgia, serif;
  font-size: 18px;
  font-weight: 600;
  letter-spacing: 0.12em;
  color: #2C1810;
  background: linear-gradient(168deg, #FAF7F2 0%, #F5F1EA 100%);
  border: 1px solid #E2D9CF;
  border-radius: 2px;
  box-shadow: 0 1px 3px rgba(44,24,16,0.06);
  transition: border-color 0.3s ease, box-shadow 0.3s ease, background 0.3s ease;
}
.hm-theme-btn:hover {
  border-color: #F37022;
  box-shadow: 0 2px 12px rgba(243,112,34,0.12);
  background: linear-gradient(168deg, #FFF9F5 0%, #FAF7F2 100%);
}
.hm-theme-btn:active {
  box-shadow: 0 1px 4px rgba(243,112,34,0.10);
}
.hm-theme-btn__accent {
  width: 28px;
  height: 3px;
  background: #F37022;
  border-radius: 1px;
  margin-bottom: 10px;
}
.hm-theme-btn__label {
  position: relative;
  z-index: 1;
}
.hm-theme-btn__sub {
  font-family: 'Inter', system-ui, sans-serif;
  font-size: 9px;
  font-weight: 400;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: #9C8B7A;
  margin-top: 4px;
}
`;

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const el = document.createElement('style');
  el.id = STYLE_ID;
  el.textContent = css;
  document.head.appendChild(el);
}

interface Props {
  selected: boolean;
  onClick: () => void;
}

export default function HermesThemeSelectButton({ selected, onClick }: Props) {
  const injected = useRef(false);
  if (!injected.current) {
    ensureStyles();
    injected.current = true;
  }

  const handleClick = useCallback(() => onClick(), [onClick]);

  return (
    <button
      className="hm-theme-btn"
      onClick={handleClick}
      aria-pressed={selected}
      style={selected ? { borderColor: '#F37022', boxShadow: '0 2px 12px rgba(243,112,34,0.15)' } : undefined}
    >
      <div className="hm-theme-btn__accent" />
      <span className="hm-theme-btn__label">Hermès</span>
      <span className="hm-theme-btn__sub">Luxury</span>
    </button>
  );
}
