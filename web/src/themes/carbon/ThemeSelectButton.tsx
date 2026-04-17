import { useRef, useCallback } from 'react';

const STYLE_ID = 'cb-theme-btn-style';

const css = `
.cb-theme-btn {
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
  font-family: 'Newsreader', Georgia, serif;
  font-size: 22px;
  font-weight: 600;
  letter-spacing: -0.02em;
  color: #abb1b8;
  background: #151515;
  border: 1px solid #373c41;
  transition: border-color 160ms ease, color 160ms ease;
}
.cb-theme-btn::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 1px;
  background: linear-gradient(90deg, transparent, #88b5c4, transparent);
  opacity: 0.4;
  pointer-events: none;
}
.cb-theme-btn:hover {
  border-color: #676a69;
  color: #f4f5f5;
}
.cb-theme-btn[data-selected='true'] {
  border-color: #88b5c4;
  border-width: 2px;
  color: #f4f5f5;
}
.cb-theme-btn[data-selected='true']::before {
  opacity: 0.7;
}
.cb-theme-btn__label {
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

export default function CarbonThemeSelectButton({ selected, onClick }: Props) {
  const injected = useRef(false);
  if (!injected.current) {
    ensureStyles();
    injected.current = true;
  }

  const handleClick = useCallback(() => onClick(), [onClick]);

  return (
    <button
      className="cb-theme-btn"
      data-selected={selected ? 'true' : 'false'}
      onClick={handleClick}
      aria-pressed={selected}
    >
      <span className="cb-theme-btn__label">Carbon</span>
    </button>
  );
}
