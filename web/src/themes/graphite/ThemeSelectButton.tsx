import { useRef, useCallback } from 'react';

const STYLE_ID = 'gp-theme-btn-style';

/* Visual sibling of CarbonThemeSelectButton — same 88px min-height,
   centered single-line label, 1px hairline rule across the top edge,
   subtle bottom baseline rule. Swapped to Inter sans (Carbon is Newsreader
   serif) so Graphite reads as the modern minimal twin to Carbon's
   editorial twin. Selected state brightens the border to rgba(255,255,255,.35)
   and adds a faint inner highlight — no colored glow. */
const css = `
.gp-theme-btn {
  all: initial;
  box-sizing: border-box;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 88px;
  width: 100%;
  padding: 16px;
  cursor: pointer;
  overflow: hidden;
  font-family: -apple-system, BlinkMacSystemFont, 'Inter', system-ui, sans-serif;
  font-size: 22px;
  font-weight: 500;
  letter-spacing: -0.02em;
  color: #f2f3f6;
  background: #0a0a0c;
  border: 1px solid rgba(255, 255, 255, 0.08);
  transition: border-color 180ms ease, color 180ms ease;
}
.gp-theme-btn::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.35), transparent);
  opacity: 0.35;
  pointer-events: none;
}
.gp-theme-btn:hover {
  border-color: rgba(255, 255, 255, 0.2);
  color: #ffffff;
}
.gp-theme-btn[data-selected='true'] {
  border-color: rgba(255, 255, 255, 0.35);
  border-width: 2px;
  color: #ffffff;
}
.gp-theme-btn[data-selected='true']::before {
  opacity: 0.65;
}
.gp-theme-btn__label {
  position: relative;
  z-index: 1;
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

export default function GraphiteThemeSelectButton({ selected, onClick }: Props) {
  const injected = useRef(false);
  if (!injected.current) {
    ensureStyles();
    injected.current = true;
  }

  const handleClick = useCallback(() => onClick(), [onClick]);

  return (
    <button
      className="gp-theme-btn"
      data-selected={selected ? 'true' : 'false'}
      onClick={handleClick}
      aria-pressed={selected}
    >
      <span className="gp-theme-btn__label">Graphite</span>
    </button>
  );
}
