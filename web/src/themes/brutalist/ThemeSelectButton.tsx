import { useRef, useCallback } from 'react';

const STYLE_ID = 'br-theme-btn-style';

const css = `
.br-theme-btn {
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
  font-family: 'Space Grotesk', system-ui, sans-serif;
  font-size: 14px;
  font-weight: 900;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: #171717;
  background: #facc15;
  border: 3px solid #171717;
  box-shadow: 3px 3px 0 #171717;
  transition: background 150ms ease, box-shadow 150ms ease, border-color 150ms ease, transform 150ms ease;
}
.br-theme-btn:hover {
  background: #fbbf24;
  border-color: #000000;
  box-shadow: 4px 4px 0 #171717;
  transform: translate(-1px, -1px);
}
.br-theme-btn:active {
  transform: translate(2px, 2px);
  box-shadow: 1px 1px 0 #171717;
}
.br-theme-btn__label {
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

export default function BrutalistThemeSelectButton({ selected, onClick }: Props) {
  const injected = useRef(false);
  if (!injected.current) {
    ensureStyles();
    injected.current = true;
  }

  const handleClick = useCallback(() => onClick(), [onClick]);

  return (
    <button
      className="br-theme-btn"
      onClick={handleClick}
      aria-pressed={selected}
    >
      <span className="br-theme-btn__label">Neo Brutalism</span>
    </button>
  );
}
