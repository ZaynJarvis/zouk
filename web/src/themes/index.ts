import type { ComponentType } from 'react';
import { atlas } from './atlas';
import AtlasThemeSelectButton from './atlas/ThemeSelectButton';

// Atlas is the only shipped theme. The legacy `washington-post` and `carbon`
// theme tokens still live under web/src/themes/* but are no longer exposed
// here; the boot script in index.html migrates any saved value to atlas.
export type ThemeId = 'atlas';

export type ColorMode = 'light' | 'dark' | 'system';

export interface ThemeSelectButtonProps {
  selected: boolean;
  onClick: () => void;
}

export interface ThemeDefinition {
  id: ThemeId;
  name: string;
  description: string;
  preview: {
    bg: string;
    surface: string;
    accent: string;
    text: string;
  };
  ThemeSelectButton: ComponentType<ThemeSelectButtonProps>;
}

export const themes: ThemeDefinition[] = [
  { ...atlas, ThemeSelectButton: AtlasThemeSelectButton },
];

export const DEFAULT_THEME: ThemeId = 'atlas';
export const DEFAULT_COLOR_MODE: ColorMode = 'system';

/** Resolve effective light/dark for atlas + saved mode preference. */
export function resolveColorMode(theme: ThemeId, pref: ColorMode): 'light' | 'dark' {
  void theme;
  if (pref === 'system') {
    return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light';
  }
  return pref;
}

/** Whether a theme exposes a Light/Dark/System toggle. (Atlas always does.) */
export function themeSupportsColorMode(theme: ThemeId): boolean {
  void theme;
  return true;
}

export function applyTheme(id: ThemeId, mode: ColorMode = 'system') {
  document.documentElement.setAttribute('data-theme', id);
  const effective = resolveColorMode(id, mode);
  document.documentElement.setAttribute('data-mode', effective);
  document.documentElement.style.colorScheme = effective;

  const csMeta = document.querySelector("meta[name='color-scheme']") as HTMLMetaElement | null;
  if (csMeta) csMeta.content = effective;

  const themeMeta = document.querySelector("meta[name='theme-color']") as HTMLMetaElement | null;
  if (themeMeta) {
    themeMeta.content = themeColorFor(id, effective);
  }
}

/** The chrome/tab color for the active theme + effective mode (matches token bg). */
export function themeColorFor(id: ThemeId, mode: 'light' | 'dark'): string {
  void id;
  return mode === 'dark' ? '#0c0b0d' : '#fafaf9';
}

export function getTheme(id: ThemeId): ThemeDefinition | undefined {
  return themes.find((t) => t.id === id);
}
