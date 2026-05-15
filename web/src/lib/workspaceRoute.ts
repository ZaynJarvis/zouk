import { getStoredActiveWorkspaceIdOrNull } from '../store/storage';

const DEFAULT_WORKSPACE_ID = 'default';
const WORKSPACE_ROUTE_PREFIX = '/z';

function hasBrowserLocation() {
  return typeof window !== 'undefined' && !!window.location;
}

export function normalizeWorkspaceId(raw: string | null | undefined): string {
  if (typeof raw !== 'string') return DEFAULT_WORKSPACE_ID;
  const trimmed = raw.normalize('NFKC').trim().toLowerCase();
  if (!trimmed) return DEFAULT_WORKSPACE_ID;
  return trimmed.replace(/[^\p{L}\p{M}\p{N}_-]+/gu, '-').replace(/^-+|-+$/g, '') || DEFAULT_WORKSPACE_ID;
}

export function getWorkspaceIdFromPath(pathname = hasBrowserLocation() ? window.location.pathname : ''): string | null {
  const parts = pathname.split('/').filter(Boolean);
  if (parts[0] !== WORKSPACE_ROUTE_PREFIX.slice(1)) return null;
  if (!parts[1]) return null;
  try {
    return normalizeWorkspaceId(decodeURIComponent(parts[1]));
  } catch {
    return normalizeWorkspaceId(parts[1]);
  }
}

export function buildWorkspacePath(workspaceId: string): string {
  return `${WORKSPACE_ROUTE_PREFIX}/${encodeURIComponent(normalizeWorkspaceId(workspaceId))}`;
}

function setWorkspaceHistory(workspaceId: string, mode: 'push' | 'replace') {
  if (!hasBrowserLocation()) return;
  const path = buildWorkspacePath(workspaceId);
  if (window.location.pathname === path) return;
  if (mode === 'push') window.history.pushState({}, '', path);
  else window.history.replaceState({}, '', path);
}

export function pushWorkspaceRoute(workspaceId: string) {
  setWorkspaceHistory(workspaceId, 'push');
}

export function replaceWorkspaceRoute(workspaceId: string) {
  setWorkspaceHistory(workspaceId, 'replace');
}

function getInitialWorkspaceId(): string {
  return getWorkspaceIdFromPath() || getStoredActiveWorkspaceIdOrNull() || DEFAULT_WORKSPACE_ID;
}

let activeWorkspaceId = getInitialWorkspaceId();

export function getActiveWorkspaceId(): string {
  return activeWorkspaceId || DEFAULT_WORKSPACE_ID;
}

export function setActiveWorkspaceId(workspaceId: string) {
  activeWorkspaceId = normalizeWorkspaceId(workspaceId);
}

export function getInitialActiveWorkspaceId(): string {
  const initial = getInitialWorkspaceId();
  setActiveWorkspaceId(initial);
  return initial;
}
