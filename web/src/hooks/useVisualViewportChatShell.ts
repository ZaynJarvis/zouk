import { useEffect } from 'react';

interface VisualViewportChatShellOptions {
  enabled: boolean;
}

export function useVisualViewportChatShell({ enabled }: VisualViewportChatShellOptions) {
  useEffect(() => {
    if (!enabled) return;

    const root = document.documentElement;
    const cleanups: Array<() => void> = [];
    let scroller: HTMLElement | null = null;
    let composer: HTMLElement | null = null;
    let input: HTMLTextAreaElement | null = null;
    let keyboardActive = false;
    let viewportRaf = 0;
    let settleTimer = 0;
    let settleGeneration = 0;
    let anchorBottomOffset = 0;

    const addListener = (target: EventTarget, type: string, listener: EventListener, options?: AddEventListenerOptions) => {
      target.addEventListener(type, listener, options);
      cleanups.push(() => target.removeEventListener(type, listener, options));
    };

    const px = (value: number) => `${Math.max(0, Math.round(value))}px`;

    const readViewport = () => {
      const viewport = window.visualViewport;
      return {
        top: viewport?.offsetTop ?? 0,
        height: viewport?.height ?? window.innerHeight,
      };
    };

    const syncViewport = () => {
      viewportRaf = 0;
      const viewport = readViewport();
      root.style.setProperty('--zouk-vv-top', px(viewport.top));
      root.style.setProperty('--zouk-vv-height', px(viewport.height));

      if (keyboardActive && window.scrollY !== 0) {
        window.scrollTo(0, 0);
      }
    };

    const scheduleViewportSync = () => {
      if (viewportRaf) return;
      viewportRaf = requestAnimationFrame(syncViewport);
    };

    const captureAnchor = () => {
      if (!scroller) return;
      anchorBottomOffset = Math.max(0, scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight);
    };

    const preserveAnchor = () => {
      if (!scroller) return;
      scroller.scrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight - anchorBottomOffset);
    };

    const settleViewport = (ms: number, preserve: boolean) => {
      clearTimeout(settleTimer);
      const generation = ++settleGeneration;
      const end = performance.now() + ms;

      const tick = () => {
        if (generation !== settleGeneration) return;
        syncViewport();
        if (preserve) preserveAnchor();
        if (performance.now() < end) requestAnimationFrame(tick);
      };

      requestAnimationFrame(tick);
      settleTimer = window.setTimeout(() => {
        if (generation !== settleGeneration) return;
        syncViewport();
        if (preserve) preserveAnchor();
      }, ms + 80);
    };

    const focusWithoutPageScroll = (event: Event) => {
      if (!input || document.activeElement === input) return;
      captureAnchor();
      event.preventDefault();
      try {
        input.focus({ preventScroll: true });
      } catch {
        input.focus();
      }
      const end = input.value.length;
      input.setSelectionRange(end, end);
    };

    const blurIfOutsideComposer = (event: Event) => {
      if (!input || !composer || document.activeElement !== input) return;
      const target = event.target;
      if (target instanceof Node && composer.contains(target)) return;
      captureAnchor();
      input.blur();
    };

    const preserveAfterInputResize = () => {
      if (!keyboardActive) return;
      requestAnimationFrame(preserveAnchor);
    };

    const attach = () => {
      scroller = document.querySelector<HTMLElement>('.zouk-vv-chat-scroller');
      composer = document.querySelector<HTMLElement>('.zouk-vv-chat-composer');
      input = composer?.querySelector<HTMLTextAreaElement>('textarea') ?? null;
      if (!scroller || !composer || !input) return;

      root.classList.add('visual-viewport-active');
      syncViewport();
      captureAnchor();

      addListener(window, 'resize', scheduleViewportSync, { passive: true });
      addListener(window, 'scroll', scheduleViewportSync, { passive: true });
      if (window.visualViewport) {
        addListener(window.visualViewport, 'resize', scheduleViewportSync, { passive: true });
        addListener(window.visualViewport, 'scroll', scheduleViewportSync, { passive: true });
        addListener(window.visualViewport, 'scrollend', syncViewport, { passive: true });
      }
      addListener(input, 'touchstart', focusWithoutPageScroll, { passive: false });
      addListener(input, 'mousedown', focusWithoutPageScroll);
      addListener(input, 'focus', () => {
        captureAnchor();
        keyboardActive = true;
        window.scrollTo(0, 0);
        settleViewport(900, true);
      });
      addListener(input, 'blur', () => {
        captureAnchor();
        keyboardActive = false;
        settleViewport(420, false);
      });
      addListener(input, 'input', preserveAfterInputResize);
      addListener(scroller, 'scroll', () => {
        if (keyboardActive) captureAnchor();
      }, { passive: true });
      addListener(document, 'pointerdown', blurIfOutsideComposer, { capture: true });
      addListener(document, 'touchstart', blurIfOutsideComposer, { capture: true, passive: true });
    };

    const observer = new MutationObserver(() => {
      if (scroller?.isConnected && composer?.isConnected && input?.isConnected) return;
      cleanups.splice(0).forEach((cleanup) => cleanup());
      attach();
    });

    attach();
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      clearTimeout(settleTimer);
      settleGeneration += 1;
      if (viewportRaf) cancelAnimationFrame(viewportRaf);
      cleanups.splice(0).forEach((cleanup) => cleanup());
      root.classList.remove('visual-viewport-active');
      root.style.removeProperty('--zouk-vv-top');
      root.style.removeProperty('--zouk-vv-height');
    };
  }, [enabled]);
}
