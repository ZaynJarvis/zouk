/* Compatibility shim for legacy night-city helpers.

   Night-city theme has been removed; the helpers below always behave as if
   the theme is *not* Night City. They remain exported so existing callers
   compile without sweeping every import — those calls produce no effect
   and can be cleaned up incrementally.

   New code should not depend on these. Use `useColorMode` (below) for
   light/dark-aware behavior. */

import { useEffect, useState } from 'react';

export function useNightCityEnabled(): boolean {
  return false;
}

export function isNightCity(): boolean {
  return false;
}

/** No-op style passthrough. Returns an empty style object. */
export function ncStyle(_styles?: React.CSSProperties): React.CSSProperties {
  void _styles;
  return {};
}

/* ------------------------------------------------------------------ */
/* Color mode helpers — atlas-aware                                    */
/* ------------------------------------------------------------------ */

function readMode(): 'light' | 'dark' {
  const m = document.documentElement.getAttribute('data-mode');
  return m === 'dark' ? 'dark' : 'light';
}

/** Reactive read of the resolved (light/dark) color mode for the active theme. */
export function useColorMode(): 'light' | 'dark' {
  const [mode, setMode] = useState<'light' | 'dark'>(readMode);
  useEffect(() => {
    const sync = () => setMode(readMode());
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-mode'] });
    return () => observer.disconnect();
  }, []);
  return mode;
}
