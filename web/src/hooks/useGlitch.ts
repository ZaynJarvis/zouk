import { useEffect, useRef, useCallback } from 'react';

export interface GlitchConfig {
  minInterval?: number;
  maxInterval?: number;
  minDuration?: number;
  maxDuration?: number;
  minSeverity?: number;
  maxSeverity?: number;
  trigger?: 'auto' | 'hover';
}

const defaults: Required<GlitchConfig> = {
  minInterval: 2000,
  maxInterval: 6000,
  minDuration: 100,
  maxDuration: 400,
  minSeverity: 0.2,
  maxSeverity: 1.0,
  trigger: 'hover',
};

function rand(min: number, max: number) {
  return Math.random() * (max - min) + min;
}

export function useGlitch<T extends HTMLElement>(config?: GlitchConfig) {
  const ref = useRef<T>(null);
  const cfg = { ...defaults, ...config };
  const timerRef = useRef<number>(0);
  const burstTimerRef = useRef<number>(0);

  const setProps = useCallback((el: T, severity: number, active: boolean) => {
    const s = el.style;
    s.setProperty('--glitch-severity', severity.toFixed(3));
    s.setProperty('--glitch-offset-x', `${rand(-severity * 15, severity * 15).toFixed(1)}px`);
    s.setProperty('--glitch-offset-y', `${rand(-severity * 4, severity * 4).toFixed(1)}px`);
    s.setProperty('--glitch-clip-top', `${rand(0, 90).toFixed(0)}%`);
    s.setProperty('--glitch-clip-bottom', `${rand(0, 90).toFixed(0)}%`);
    s.setProperty('--glitch-hue', `${rand(-180, 180).toFixed(0)}deg`);
    s.setProperty('--glitch-active', active ? '1' : '0');
    s.setProperty('--glitch-visibility', active ? 'visible' : 'hidden');
  }, []);

  const triggerBurst = useCallback(() => {
    const el = ref.current;
    if (!el) return;

    const severity = rand(cfg.minSeverity, cfg.maxSeverity);
    const duration = rand(cfg.minDuration, cfg.maxDuration);

    let elapsed = 0;
    const step = 50;
    const tick = () => {
      if (elapsed >= duration) {
        setProps(el, 0, false);
        return;
      }
      setProps(el, severity * rand(0.3, 1), true);
      elapsed += step;
      burstTimerRef.current = window.setTimeout(tick, step);
    };
    tick();
  }, [cfg, setProps]);

  const scheduleNext = useCallback(() => {
    const interval = rand(cfg.minInterval, cfg.maxInterval);
    timerRef.current = window.setTimeout(() => {
      triggerBurst();
      scheduleNext();
    }, interval);
  }, [cfg, triggerBurst]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let hovering = false;
    let loopTimer: number;

    setProps(el, 0, false);

    if (cfg.trigger === 'auto') {
      scheduleNext();
    } else {
      const loop = () => {
        if (!hovering) return;
        triggerBurst();
        const next = rand(cfg.minInterval * 0.3, cfg.maxInterval * 0.4);
        loopTimer = window.setTimeout(loop, next);
      };
      const onEnter = () => { hovering = true; triggerBurst(); loop(); };
      const onLeave = () => { hovering = false; setProps(el, 0, false); clearTimeout(loopTimer); clearTimeout(burstTimerRef.current); };
      el.addEventListener('mouseenter', onEnter);
      el.addEventListener('mouseleave', onLeave);
      return () => {
        el.removeEventListener('mouseenter', onEnter);
        el.removeEventListener('mouseleave', onLeave);
        clearTimeout(timerRef.current);
        clearTimeout(burstTimerRef.current);
        clearTimeout(loopTimer);
      };
    }

    return () => {
      clearTimeout(timerRef.current);
      clearTimeout(burstTimerRef.current);
    };
  }, [cfg.trigger, scheduleNext, triggerBurst, setProps, cfg.minInterval, cfg.maxInterval]);

  return ref;
}
