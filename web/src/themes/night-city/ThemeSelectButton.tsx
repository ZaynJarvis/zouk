import { useRef, useCallback } from 'react';
import { useGlitch } from '../../hooks/useGlitch';

const STYLE_ID = 'nc-theme-btn-style';

const css = `
.nc-theme-btn-wrap {
  all: initial;
  box-sizing: border-box;
  position: relative;
  display: block;
  width: 100%;
}
.nc-theme-btn {
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
  isolation: isolate;
  font-family: 'Orbitron', system-ui, sans-serif;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: #c8d6e5;
  background: #0f2a2e;
  border: 1px solid #5EF6FF;
  clip-path: polygon(0 0, calc(100% - 8px) 0, 100% 8px, 100% 100%, 8px 100%, 0 calc(100% - 8px));
  box-shadow: 0 0 18px rgba(94,246,255,0.26), inset 0 0 24px rgba(94,246,255,0.06);
  transition: border-color 0.2s, box-shadow 0.2s, background 0.2s;
}
.nc-theme-btn:hover,
.nc-theme-btn:focus-visible {
  animation: cp-glitch-jump 360ms steps(2, jump-none) 1;
}
/* top accent line */
.nc-theme-btn__top {
  position: absolute;
  left: 0; right: 0; top: 0;
  height: 2px;
  background: #5EF6FF;
  opacity: 0.9;
  pointer-events: none;
}
/* scanlines overlay */
.nc-theme-btn__scan {
  position: absolute;
  inset: 0;
  opacity: 0.10;
  background-image: repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(94,246,255,0.12) 2px, rgba(94,246,255,0.12) 4px);
  pointer-events: none;
  z-index: 0;
}
/* match normal button glitch blocks */
.nc-theme-btn::after {
  content: '';
  position: absolute;
  inset: 0;
  opacity: 0;
  pointer-events: none;
  z-index: 0;
  background:
    rgba(247,80,73,0.88) left 0 top 16% / 18% 0.35rem no-repeat,
    rgba(94,246,255,0.84) right 0 top 38% / 22% 0.5rem no-repeat,
    rgba(115,248,85,0.82) left 0 bottom 14% / 16% 0.4rem no-repeat;
  mix-blend-mode: screen;
}
.nc-theme-btn:hover::after,
.nc-theme-btn:focus-visible::after {
  animation: cp-edge-blocks 480ms steps(8, jump-none) 1 30ms;
}
.nc-theme-btn__label {
  position: relative;
  z-index: 1;
  text-shadow: 0 0 7px rgba(94,246,255,0.6), 0 0 20px rgba(94,246,255,0.2);
}
/* ScanlineTear-style overlay */
.nc-theme-btn__tear {
  position: absolute;
  inset: 0;
  pointer-events: none;
  overflow: hidden;
  z-index: 2;
  mix-blend-mode: screen;
  border-left: 1px solid rgba(247,80,73,0.6);
  border-right: 1px solid rgba(94,246,255,0.6);
  filter: saturate(1.4) brightness(1.15);
  clip-path: inset(var(--glitch-clip-top, 100%) 0 var(--glitch-clip-bottom, 100%) 0);
  transform: translateX(var(--glitch-offset-x, 0px));
  visibility: var(--glitch-visibility, hidden);
}
.nc-theme-btn__tear::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(90deg, rgba(247,80,73,0.25), transparent 40%, rgba(94,246,255,0.25));
  pointer-events: none;
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

export default function NightCityThemeSelectButton({ selected, onClick }: Props) {
  const injected = useRef(false);
  if (!injected.current) {
    ensureStyles();
    injected.current = true;
  }

  const glitchRef = useGlitch<HTMLDivElement>({
    trigger: 'hover',
    minInterval: 200,
    maxInterval: 600,
    minSeverity: 0.3,
    maxSeverity: 0.8,
  });

  const handleClick = useCallback(() => onClick(), [onClick]);

  return (
    <div ref={glitchRef} className="nc-theme-btn-wrap">
      <button
        className="nc-theme-btn"
        onClick={handleClick}
        aria-pressed={selected}
      >
        <div className="nc-theme-btn__top" />
        <div className="nc-theme-btn__scan" />
        <span className="nc-theme-btn__label">
          Night City
        </span>
      </button>
      <div className="nc-theme-btn__tear" />
    </div>
  );
}
