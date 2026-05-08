import { useRef, useCallback } from 'react';

const STYLE_ID = 'atlas-theme-btn-style';

const css = `
.atlas-theme-btn {
  all: initial;
  box-sizing: border-box;
  position: relative;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: stretch;
  gap: 8px;
  min-height: 88px;
  width: 100%;
  padding: 14px 18px;
  cursor: pointer;
  overflow: hidden;
  border: 1px solid #e7e5e4;
  border-radius: 12px;
  background: #ffffff;
  color: #1c1917;
  transition: border-color 160ms ease, box-shadow 160ms ease, transform 160ms ease;
}
.atlas-theme-btn:hover {
  border-color: #d6d3d1;
  box-shadow: 0 1px 2px rgb(28 25 23 / 0.04);
}
.atlas-theme-btn[data-selected='true'] {
  border-color: #a05a44;
  box-shadow: 0 0 0 1px #a05a44;
}
.atlas-theme-btn__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.atlas-theme-btn__title {
  font-family: 'Inter', system-ui, sans-serif;
  font-size: 15px;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: #1c1917;
}
.atlas-theme-btn__swatches {
  display: inline-flex;
  gap: 4px;
}
.atlas-theme-btn__swatch {
  width: 14px;
  height: 14px;
  border-radius: 999px;
  border: 1px solid rgb(0 0 0 / 0.06);
}
.atlas-theme-btn__sub {
  font-family: 'Inter', system-ui, sans-serif;
  font-size: 12px;
  font-weight: 400;
  letter-spacing: 0;
  color: #57534e;
}
@media (prefers-color-scheme: dark) {
  .atlas-theme-btn--auto {
    background: #141416;
    border-color: #28282c;
    color: #ededed;
  }
  .atlas-theme-btn--auto:hover {
    border-color: #3a3a40;
  }
  .atlas-theme-btn--auto .atlas-theme-btn__title {
    color: #fafafa;
  }
  .atlas-theme-btn--auto .atlas-theme-btn__sub {
    color: #a8a29e;
  }
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

export default function AtlasThemeSelectButton({ selected, onClick }: Props) {
  const injected = useRef(false);
  if (!injected.current) {
    ensureStyles();
    injected.current = true;
  }

  const handleClick = useCallback(() => onClick(), [onClick]);

  return (
    <button
      className="atlas-theme-btn atlas-theme-btn--auto"
      data-selected={selected ? 'true' : 'false'}
      onClick={handleClick}
      aria-pressed={selected}
    >
      <span className="atlas-theme-btn__row">
        <span className="atlas-theme-btn__title">Atlas</span>
        <span className="atlas-theme-btn__swatches" aria-hidden="true">
          <span className="atlas-theme-btn__swatch" style={{ background: '#fafaf9' }} />
          <span className="atlas-theme-btn__swatch" style={{ background: '#a05a44' }} />
          <span className="atlas-theme-btn__swatch" style={{ background: '#0c0b0d' }} />
        </span>
      </span>
      <span className="atlas-theme-btn__sub">Warm neutrals · auto light / dark</span>
    </button>
  );
}
