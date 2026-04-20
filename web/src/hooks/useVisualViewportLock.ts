import { useEffect } from 'react';

// Pin the app chrome to the top of the visual viewport when the on-screen
// keyboard opens on mobile Safari / Android. Exposes --vv-height and
// --vv-offset-top on <html> so layout CSS can size against the visible area
// instead of the stale layout viewport, and resets window scroll to 0 so
// iOS cannot translate the document upward to reveal a focused input.
export function useVisualViewportLock() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const root = document.documentElement;

    const apply = () => {
      root.style.setProperty('--vv-height', `${vv.height}px`);
      root.style.setProperty('--vv-offset-top', `${vv.offsetTop}px`);
      if (window.scrollY !== 0 || root.scrollTop !== 0) {
        window.scrollTo(0, 0);
      }
    };

    apply();
    vv.addEventListener('resize', apply);
    vv.addEventListener('scroll', apply);
    return () => {
      vv.removeEventListener('resize', apply);
      vv.removeEventListener('scroll', apply);
      root.style.removeProperty('--vv-height');
      root.style.removeProperty('--vv-offset-top');
    };
  }, []);
}
