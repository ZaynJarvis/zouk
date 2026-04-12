import type { ComponentType } from 'react';
import { nightCity } from './night-city';
import { brutalist } from './brutalist';
import { daylight } from './daylight';
import NightCityThemeSelectButton from './night-city/ThemeSelectButton';
import BrutalistThemeSelectButton from './brutalist/ThemeSelectButton';
import DaylightThemeSelectButton from './daylight/ThemeSelectButton';

export type ThemeId = 'night-city' | 'brutalist' | 'daylight';

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
  { ...nightCity, ThemeSelectButton: NightCityThemeSelectButton },
  { ...brutalist, ThemeSelectButton: BrutalistThemeSelectButton },
  { ...daylight, ThemeSelectButton: DaylightThemeSelectButton },
];

export const DEFAULT_THEME: ThemeId = 'night-city';

export function applyTheme(id: ThemeId) {
  document.documentElement.setAttribute('data-theme', id);
  const favicon = document.querySelector("link[rel='icon']") as HTMLLinkElement | null;
  if (favicon) {
    favicon.href = id === 'night-city' ? '/zouk-night-city.svg' : '/zouk.svg';
  }
}

export function getTheme(id: ThemeId): ThemeDefinition | undefined {
  return themes.find((t) => t.id === id);
}
