import type { AuthUser } from '../lib/api';
import type { ColorMode, Theme, ViewMode } from '../types';

const CURRENT_USER_KEY = 'zouk_current_user';
const AUTH_TOKEN_KEY = 'zouk_auth_token';
const AUTH_USER_KEY = 'zouk_auth_user';
const THEME_STORAGE_KEY = 'zouk_theme';
const COLOR_MODE_STORAGE_KEY = 'zouk_color_mode';
const NOW_RAIL_HIDDEN_KEY = 'zouk_now_rail_hidden';
const LAST_VIEW_STORAGE_KEY = 'zouk_last_view';
export const ACTIVE_WORKSPACE_KEY = 'zouk_active_workspace_id';
const LINK_TRANSFORMS_KEY = 'zouk_link_transforms';
// Set once this browser has been offered (confirmed or skipped) the one-time
// guest username picker, so we don't prompt again on every guest login.
const GUEST_NAMED_KEY = 'zouk_guest_named';
// Transient handoff: boot-time email logins (Feishu redirect, cross-browser
// magic link) detect `firstLogin` before the store mounts. They stash the
// default name here; the store consumes it on mount to open the picker.
const USERNAME_SETUP_PENDING_KEY = 'zouk_username_setup_pending';

type StoredAuth = { token: string; user: AuthUser };
type StoredLastView = { name: string; mode: Extract<ViewMode, 'channel' | 'dm'> };

export type LinkTransformRule = { id: string; pattern: string; replacement: string };

// Preloaded on first load so pasted zouk PR URLs render as `#NNN` out of the
// box. Scoped to ZaynJarvis/zouk only — other GitHub PR URLs stay as plain
// autolinks unless the user adds their own rule. Users can delete/edit this
// rule in Settings → Link Transforms.
const DEFAULT_LINK_TRANSFORMS: LinkTransformRule[] = [
  {
    id: 'default-zouk-pr',
    pattern: '^https://github\\.com/ZaynJarvis/zouk/pull/(\\d+)(?:/[^?#]*)?(?:[?#].*)?$',
    replacement: '#$1',
  },
];

function readJson<T>(key: string): T | null {
  const value = localStorage.getItem(key);
  if (!value) return null;

  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown) {
  localStorage.setItem(key, JSON.stringify(value));
}

export function createGuestUserName() {
  return 'guest-' + Math.random().toString(36).slice(2, 6);
}

export function getGuestNamed(): boolean {
  return localStorage.getItem(GUEST_NAMED_KEY) === '1';
}

export function setGuestNamed() {
  localStorage.setItem(GUEST_NAMED_KEY, '1');
}

export function setPendingUsernameSetup(defaultName: string) {
  localStorage.setItem(USERNAME_SETUP_PENDING_KEY, defaultName);
}

// Read-and-clear: returns the stashed default name (once), or null.
export function takePendingUsernameSetup(): string | null {
  const value = localStorage.getItem(USERNAME_SETUP_PENDING_KEY);
  if (value === null) return null;
  localStorage.removeItem(USERNAME_SETUP_PENDING_KEY);
  return value;
}

export function getStoredTheme(): Theme {
  // Atlas is the only shipped theme. Legacy values (night-city / brutalist /
  // graphite / washington-post / carbon) all migrate to atlas.
  return 'atlas';
}

export function setStoredTheme(theme: Theme) {
  localStorage.setItem(THEME_STORAGE_KEY, theme);
}

export function getStoredColorMode(): ColorMode {
  const stored = localStorage.getItem(COLOR_MODE_STORAGE_KEY);
  if (stored === 'light' || stored === 'dark' || stored === 'system') {
    return stored;
  }
  return 'system';
}

export function setStoredColorMode(mode: ColorMode) {
  localStorage.setItem(COLOR_MODE_STORAGE_KEY, mode);
}

export function getStoredNowRailHidden(): boolean {
  return localStorage.getItem(NOW_RAIL_HIDDEN_KEY) === '1';
}

export function setStoredNowRailHidden(hidden: boolean) {
  if (hidden) localStorage.setItem(NOW_RAIL_HIDDEN_KEY, '1');
  else localStorage.removeItem(NOW_RAIL_HIDDEN_KEY);
}

export function getStoredLastView(): StoredLastView | null {
  const stored = readJson<StoredLastView>(LAST_VIEW_STORAGE_KEY);
  if (!stored?.name) return null;
  if (stored.mode !== 'channel' && stored.mode !== 'dm') return null;
  return stored;
}

export function setStoredLastView(view: StoredLastView) {
  writeJson(LAST_VIEW_STORAGE_KEY, view);
}

export function clearStoredLastView() {
  localStorage.removeItem(LAST_VIEW_STORAGE_KEY);
}

export function getStoredActiveWorkspaceId(): string {
  return getStoredActiveWorkspaceIdOrNull() || 'default';
}

export function getStoredActiveWorkspaceIdOrNull(): string | null {
  const stored = localStorage.getItem(ACTIVE_WORKSPACE_KEY);
  const trimmed = stored?.trim();
  return trimmed || null;
}

export function setStoredActiveWorkspaceId(workspaceId: string) {
  localStorage.setItem(ACTIVE_WORKSPACE_KEY, workspaceId || 'default');
}

export function getStoredCurrentUser(): string {
  const authUser = readJson<AuthUser>(AUTH_USER_KEY);
  if (authUser?.name) return authUser.name;

  const stored = localStorage.getItem(CURRENT_USER_KEY);
  if (stored) return stored;

  const name = createGuestUserName();
  localStorage.setItem(CURRENT_USER_KEY, name);
  return name;
}

export function setStoredCurrentUser(name: string) {
  localStorage.setItem(CURRENT_USER_KEY, name);
}

export function clearStoredCurrentUser() {
  localStorage.removeItem(CURRENT_USER_KEY);
}

export function getStoredAuth(): StoredAuth | null {
  const token = localStorage.getItem(AUTH_TOKEN_KEY);
  const user = readJson<AuthUser>(AUTH_USER_KEY);
  if (!token || !user) return null;

  return { token, user };
}

export function getStoredAuthToken() {
  return localStorage.getItem(AUTH_TOKEN_KEY);
}

export function setStoredAuthToken(token: string) {
  localStorage.setItem(AUTH_TOKEN_KEY, token);
}

export function setStoredAuth(token: string, user: AuthUser) {
  setStoredAuthToken(token);
  writeJson(AUTH_USER_KEY, user);
}

export function clearStoredAuth() {
  localStorage.removeItem(AUTH_TOKEN_KEY);
  localStorage.removeItem(AUTH_USER_KEY);
}

export function setStoredAuthUser(user: AuthUser) {
  writeJson(AUTH_USER_KEY, user);
}

export function clearStoredAuthUser() {
  localStorage.removeItem(AUTH_USER_KEY);
}

let cachedLinkTransforms: LinkTransformRule[] | null = null;
const linkTransformListeners = new Set<() => void>();

export function getStoredLinkTransforms(): LinkTransformRule[] {
  if (cachedLinkTransforms) return cachedLinkTransforms;
  const stored = readJson<LinkTransformRule[]>(LINK_TRANSFORMS_KEY);
  if (stored) {
    cachedLinkTransforms = stored.filter((r) => r && typeof r.pattern === 'string' && typeof r.replacement === 'string');
    return cachedLinkTransforms;
  }
  // Seed defaults on first read, so the persisted store immediately reflects
  // the preloaded rules (user can then edit/delete them).
  writeJson(LINK_TRANSFORMS_KEY, DEFAULT_LINK_TRANSFORMS);
  cachedLinkTransforms = DEFAULT_LINK_TRANSFORMS;
  return cachedLinkTransforms;
}

export function setStoredLinkTransforms(rules: LinkTransformRule[]) {
  cachedLinkTransforms = rules;
  writeJson(LINK_TRANSFORMS_KEY, rules);
  linkTransformListeners.forEach((l) => l());
}

export function subscribeLinkTransforms(listener: () => void): () => void {
  linkTransformListeners.add(listener);
  return () => linkTransformListeners.delete(listener);
}
