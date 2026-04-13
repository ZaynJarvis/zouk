import { useRef, useEffect, useCallback } from 'react';

export interface GlitchConfig {
  minInterval?: number;
  maxInterval?: number;
  minDuration?: number;
  maxDuration?: number;
  minSeverity?: number;
  maxSeverity?: number;
  trigger?: 'hover' | 'auto';
}

const rand = (min: number, max: number) => Math.random() * (max - min) + min;

export function useGlitch<T extends HTMLElement>(config: GlitchConfig = {}) {
  const ref = useRef<T>(null);
  const intervalRef = useRef<ReturnType<typeof setTimeout>>();
  const burstRef = useRef<ReturnType<typeof setTimeout>>();
  const hoverStartTimeRef = useRef<number | null>(null);

  const {
    minInterval = 2000,
    maxInterval = 6000,
    minDuration = 100,
    maxDuration = 400,
    minSeverity = 0.2,
    maxSeverity = 1.0,
    trigger = 'auto',
  } = config;

  const setVars = useCallback((el: T, severity: number, active: boolean) => {
    const offsetX = (Math.random() - 0.5) * 2 * severity * 15;
    const offsetY = (Math.random() - 0.5) * 2 * severity * 4;
    const clipTop = Math.random() * 90;
    const clipBottom = Math.random() * 90;
    const hue = (Math.random() - 0.5) * 360;
    el.style.setProperty('--glitch-severity', severity.toString());
    el.style.setProperty('--glitch-offset-x', `${offsetX}px`);
    el.style.setProperty('--glitch-offset-y', `${offsetY}px`);
    el.style.setProperty('--glitch-clip-top', `${clipTop}%`);
    el.style.setProperty('--glitch-clip-bottom', `${clipBottom}%`);
    el.style.setProperty('--glitch-hue', `${hue}deg`);
    el.style.setProperty('--glitch-active', active ? '1' : '0');
    el.style.setProperty('--glitch-visibility', active ? 'visible' : 'hidden');
  }, []);

  const clearVars = useCallback((el: T) => {
    el.style.setProperty('--glitch-active', '0');
    el.style.setProperty('--glitch-visibility', 'hidden');
    el.style.setProperty('--glitch-severity', '0');
    el.style.setProperty('--glitch-offset-x', '0px');
    el.style.setProperty('--glitch-offset-y', '0px');
  }, []);

  const startBurst = useCallback(() => {
    const el = ref.current;
    if (!el) return;

    // Clear any in-flight burst to prevent orphaned timers
    if (burstRef.current) clearTimeout(burstRef.current);

    let severityMultiplier = 1;
    if (trigger === 'hover' && hoverStartTimeRef.current !== null) {
      const elapsedHoverTime = Date.now() - hoverStartTimeRef.current;
      // Almost disappear after 2 seconds
      severityMultiplier = Math.max(0.05, 1 - (elapsedHoverTime / 2000));
    }

    const severity = rand(minSeverity, maxSeverity) * severityMultiplier;
    const duration = rand(minDuration, maxDuration) * severityMultiplier;
    let elapsed = 0;
    const step = 50;

    const tick = () => {
      if (elapsed >= duration) {
        if (ref.current) clearVars(ref.current);
        return;
      }
      if (ref.current) setVars(ref.current, severity * rand(0.3, 1), true);
      elapsed += step;
      burstRef.current = setTimeout(tick, step);
    };
    tick();
  }, [minSeverity, maxSeverity, minDuration, maxDuration, setVars, clearVars, trigger]);

  const scheduleNext = useCallback(() => {
    let baseMin = trigger === 'hover' ? minInterval * 0.3 : minInterval;
    let baseMax = trigger === 'hover' ? maxInterval * 0.4 : maxInterval;
    
    if (trigger === 'hover' && hoverStartTimeRef.current !== null) {
      const elapsedHoverTime = Date.now() - hoverStartTimeRef.current;
      // Scale interval up very quickly after 2 seconds
      const intervalMultiplier = Math.min(10, 1 + (elapsedHoverTime / 500));
      baseMin *= intervalMultiplier;
      baseMax *= intervalMultiplier;
    }

    intervalRef.current = setTimeout(() => {
      startBurst();
      scheduleNext();
    }, rand(baseMin, baseMax));
  }, [trigger, minInterval, maxInterval, startBurst]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    if (trigger === 'auto') {
      scheduleNext();
    } else {
      const onEnter = () => {
        hoverStartTimeRef.current = Date.now();
        startBurst();
        scheduleNext();
      };
      const onLeave = () => {
        hoverStartTimeRef.current = null;
        if (intervalRef.current) clearTimeout(intervalRef.current);
        if (burstRef.current) clearTimeout(burstRef.current);
        clearVars(el);
      };
      el.addEventListener('mouseenter', onEnter);
      el.addEventListener('mouseleave', onLeave);
      return () => {
        el.removeEventListener('mouseenter', onEnter);
        el.removeEventListener('mouseleave', onLeave);
        if (intervalRef.current) clearTimeout(intervalRef.current);
        if (burstRef.current) clearTimeout(burstRef.current);
      };
    }

    return () => {
      if (intervalRef.current) clearTimeout(intervalRef.current);
      if (burstRef.current) clearTimeout(burstRef.current);
    };
  }, [trigger, scheduleNext, clearVars, startBurst]);

  return ref;
}
