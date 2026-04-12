import { nightCity } from './night-city';
import { daylight } from './daylight';
import { brutalist } from './brutalist';

export type ThemeId = 'night-city' | 'daylight' | 'brutalist';

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
}

export const themes: ThemeDefinition[] = [nightCity, daylight, brutalist];

export const DEFAULT_THEME: ThemeId = 'night-city';

export function applyTheme(id: ThemeId) {
  document.documentElement.setAttribute('data-theme', id);
}

export function getTheme(id: ThemeId): ThemeDefinition | undefined {
  return themes.find((t) => t.id === id);
}
