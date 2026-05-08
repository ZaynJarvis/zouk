import type { ComponentType } from 'react';
import { atlas } from './atlas';
import { washingtonPost } from './washington-post';
import { carbon } from './carbon';
import AtlasThemeSelectButton from './atlas/ThemeSelectButton';
import WashingtonPostThemeSelectButton from './washington-post/ThemeSelectButton';
import CarbonThemeSelectButton from './carbon/ThemeSelectButton';

export type ThemeId = 'atlas' | 'washington-post' | 'carbon';

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
  { ...washingtonPost, ThemeSelectButton: WashingtonPostThemeSelectButton },
  { ...carbon, ThemeSelectButton: CarbonThemeSelectButton },
];

export const DEFAULT_THEME: ThemeId = 'atlas';
export const DEFAULT_COLOR_MODE: ColorMode = 'system';

/* Themes that have a fixed appearance (color-mode is ignored).
   Atlas is omitted — it adapts to data-mode. */
const FIXED_LIGHT_THEMES = new Set<ThemeId>(['washington-post']);
const FIXED_DARK_THEMES = new Set<ThemeId>(['carbon']);

/** Resolve effective light/dark for a given theme + saved mode preference. */
export function resolveColorMode(theme: ThemeId, pref: ColorMode): 'light' | 'dark' {
  if (FIXED_LIGHT_THEMES.has(theme)) return 'light';
  if (FIXED_DARK_THEMES.has(theme)) return 'dark';
  if (pref === 'system') {
    return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light';
  }
  return pref;
}

/** Whether a theme exposes a Light/Dark/System toggle. */
export function themeSupportsColorMode(theme: ThemeId): boolean {
  return !FIXED_LIGHT_THEMES.has(theme) && !FIXED_DARK_THEMES.has(theme);
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

/** The chrome/tab color for a given theme + effective mode (matches token bg). */
export function themeColorFor(id: ThemeId, mode: 'light' | 'dark'): string {
  if (id === 'atlas') return mode === 'dark' ? '#0c0b0d' : '#fafaf9';
  const theme = getTheme(id);
  return theme?.preview.bg ?? '#fafaf9';
}

export function getTheme(id: ThemeId): ThemeDefinition | undefined {
  return themes.find((t) => t.id === id);
}
