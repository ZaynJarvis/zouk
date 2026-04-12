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
  const microRef = useRef<ReturnType<typeof setInterval>>();
  const isHovering = useRef(false);

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

    const severity = rand(minSeverity, maxSeverity);
    const duration = rand(minDuration, maxDuration);

    setVars(el, severity, true);

    microRef.current = setInterval(() => {
      if (!ref.current) return;
      setVars(ref.current, rand(minSeverity, maxSeverity), true);
    }, 50);

    burstRef.current = setTimeout(() => {
      if (microRef.current) clearInterval(microRef.current);
      if (ref.current) clearVars(ref.current);
    }, duration);
  }, [minSeverity, maxSeverity, minDuration, maxDuration, setVars, clearVars]);

  const scheduleNext = useCallback(() => {
    const baseMin = trigger === 'hover' ? minInterval * 0.3 : minInterval;
    const baseMax = trigger === 'hover' ? maxInterval * 0.4 : maxInterval;
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
        isHovering.current = true;
        scheduleNext();
      };
      const onLeave = () => {
        isHovering.current = false;
        if (intervalRef.current) clearTimeout(intervalRef.current);
        if (burstRef.current) clearTimeout(burstRef.current);
        if (microRef.current) clearInterval(microRef.current);
        clearVars(el);
      };
      el.addEventListener('mouseenter', onEnter);
      el.addEventListener('mouseleave', onLeave);
      return () => {
        el.removeEventListener('mouseenter', onEnter);
        el.removeEventListener('mouseleave', onLeave);
        if (intervalRef.current) clearTimeout(intervalRef.current);
        if (burstRef.current) clearTimeout(burstRef.current);
        if (microRef.current) clearInterval(microRef.current);
      };
    }

    return () => {
      if (intervalRef.current) clearTimeout(intervalRef.current);
      if (burstRef.current) clearTimeout(burstRef.current);
      if (microRef.current) clearInterval(microRef.current);
    };
  }, [trigger, scheduleNext, clearVars]);

  return ref;
}
