import { useEffect, useRef } from 'react';
import { MOBILE_BREAKPOINT } from '../lib/layout';

export interface EdgeSwipeOptions {
  edgeZonePx?: number;
  thresholdPx?: number;
  maxVerticalRatio?: number;
  enabled?: boolean;
}

export function useEdgeSwipeRight(onOpen: () => void, options: EdgeSwipeOptions = {}) {
  const {
    edgeZonePx = 24,
    thresholdPx = 60,
    maxVerticalRatio = 0.7,
    enabled = true,
  } = options;

  const onOpenRef = useRef(onOpen);
  useEffect(() => {
    onOpenRef.current = onOpen;
  }, [onOpen]);

  useEffect(() => {
    if (!enabled) return;

    let startX = 0;
    let startY = 0;
    let tracking = false;
    let fired = false;

    const reset = () => {
      tracking = false;
      fired = false;
    };

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return reset();
      if (window.innerWidth >= MOBILE_BREAKPOINT) return;
      const t = e.touches[0];
      if (t.clientX > edgeZonePx) return;
      startX = t.clientX;
      startY = t.clientY;
      tracking = true;
      fired = false;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!tracking || fired) return;
      const t = e.touches[0];
      if (!t) return;
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;
      if (Math.abs(dy) > Math.abs(dx) * maxVerticalRatio && Math.abs(dy) > 12) {
        tracking = false;
        return;
      }
      if (dx >= thresholdPx) {
        fired = true;
        onOpenRef.current();
      }
    };

    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: true });
    window.addEventListener('touchend', reset, { passive: true });
    window.addEventListener('touchcancel', reset, { passive: true });

    return () => {
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', reset);
      window.removeEventListener('touchcancel', reset);
    };
  }, [enabled, edgeZonePx, thresholdPx, maxVerticalRatio]);
}
