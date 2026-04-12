import { useRef } from 'react';

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
  padding: 16px 16px 14px;
  cursor: pointer;
  overflow: hidden;
  font-family: 'Cormorant Garamond', Georgia, serif;
  font-size: 20px;
  font-weight: 600;
  letter-spacing: 0.14em;
  color: #261610;
  background: #F7F3EC;
  border: 1px solid #D6C8B6;
  border-top: 2px solid #F37022;
  border-radius: 2px;
  transition: border-color 0.3s ease, box-shadow 0.3s ease, transform 0.3s ease;
}
.hm-theme-btn::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 2px;
  background: linear-gradient(90deg, #B7986A 0%, #F37022 40%, #F37022 60%, #B7986A 100%);
}
.hm-theme-btn:hover {
  border-color: #F37022;
  transform: translateY(-1px);
  box-shadow: 0 3px 12px rgba(243,112,34,0.1);
}
.hm-theme-btn:active {
  transform: translateY(0px);
  box-shadow: 0 1px 4px rgba(243,112,34,0.08);
}
.hm-theme-btn--selected {
  border-color: #F37022;
  box-shadow: 0 2px 8px rgba(243,112,34,0.12);
}
.hm-theme-btn--selected::after {
  content: '';
  position: absolute;
  bottom: 8px;
  left: 50%;
  transform: translateX(-50%);
  width: 20px;
  height: 2px;
  background: #F37022;
  border-radius: 1px;
}
.hm-theme-btn__name {
  position: relative;
  z-index: 1;
}
.hm-theme-btn__sub {
  font-family: 'Space Grotesk', 'Inter', system-ui, sans-serif;
  font-size: 8px;
  font-weight: 500;
  letter-spacing: 0.25em;
  text-transform: uppercase;
  color: #948270;
  margin-top: 6px;
}
.hm-theme-btn__bar {
  display: flex;
  gap: 3px;
  margin-bottom: 8px;
}
.hm-theme-btn__swatch {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  border: 1px solid rgba(183,152,106,0.3);
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

  return (
    <button
      className={`hm-theme-btn${selected ? ' hm-theme-btn--selected' : ''}`}
      onClick={onClick}
      aria-pressed={selected}
    >
      <div className="hm-theme-btn__bar">
        <span className="hm-theme-btn__swatch" style={{ background: '#F37022' }} />
        <span className="hm-theme-btn__swatch" style={{ background: '#B7986A' }} />
        <span className="hm-theme-btn__swatch" style={{ background: '#F7F3EC' }} />
      </div>
      <span className="hm-theme-btn__name">Herm&egrave;s</span>
      <span className="hm-theme-btn__sub">Maison</span>
    </button>
  );
}
