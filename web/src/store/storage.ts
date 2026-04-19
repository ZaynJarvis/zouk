import type { AuthUser } from '../lib/api';
import type { Theme } from '../types';

const CURRENT_USER_KEY = 'zouk_current_user';
const AUTH_TOKEN_KEY = 'zouk_auth_token';
const AUTH_USER_KEY = 'zouk_auth_user';
const THEME_STORAGE_KEY = 'zouk_theme';

type StoredAuth = { token: string; user: AuthUser };

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
  return 'user-' + Math.random().toString(36).slice(2, 6);
}

export function getStoredTheme(): Theme {
  const stored = localStorage.getItem(THEME_STORAGE_KEY);
  if (stored === 'night-city' || stored === 'brutalist' || stored === 'washington-post' || stored === 'carbon') {
    return stored;
  }
  return 'washington-post';
}

export function setStoredTheme(theme: Theme) {
  localStorage.setItem(THEME_STORAGE_KEY, theme);
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
