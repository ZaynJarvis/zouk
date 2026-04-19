export const MOBILE_BREAKPOINT = 1024;

export function isMobileViewport(): boolean {
  return window.innerWidth < MOBILE_BREAKPOINT;
}
