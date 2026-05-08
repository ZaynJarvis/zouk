import type { ComponentType } from 'react';
import { washingtonPost } from './washington-post';
import { carbon } from './carbon';
import WashingtonPostThemeSelectButton from './washington-post/ThemeSelectButton';
import CarbonThemeSelectButton from './carbon/ThemeSelectButton';

export type ThemeId = 'washington-post' | 'carbon';

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
  { ...washingtonPost, ThemeSelectButton: WashingtonPostThemeSelectButton },
  { ...carbon, ThemeSelectButton: CarbonThemeSelectButton },
];

export const DEFAULT_THEME: ThemeId = 'washington-post';

const LIGHT_THEMES = new Set<ThemeId>(['washington-post']);

export function applyTheme(id: ThemeId) {
  const cs = LIGHT_THEMES.has(id) ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', id);
  document.documentElement.style.colorScheme = cs;
  const csMeta = document.querySelector("meta[name='color-scheme']") as HTMLMetaElement | null;
  if (csMeta) csMeta.content = cs;
  const themeMeta = document.querySelector("meta[name='theme-color']") as HTMLMetaElement | null;
  const theme = getTheme(id);
  if (themeMeta && theme) {
    themeMeta.content = theme.preview.bg;
  }
}

export function getTheme(id: ThemeId): ThemeDefinition | undefined {
  return themes.find((t) => t.id === id);
}
