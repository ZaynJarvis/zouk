import type { ComponentType } from 'react';
import type { Theme } from '../types';
import NightCityThemeSelectButton from './night-city/ThemeSelectButton';
import DaylightThemeSelectButton from './daylight/ThemeSelectButton';

export interface ThemeSelectButtonProps {
  selected: boolean;
  onClick: () => void;
}

interface ThemeEntry {
  ThemeSelectButton: ComponentType<ThemeSelectButtonProps>;
}

const themeRegistry: Record<Theme, ThemeEntry> = {
  dark: {
    ThemeSelectButton: NightCityThemeSelectButton,
  },
  light: {
    ThemeSelectButton: DaylightThemeSelectButton,
  },
};

export function getThemeEntry(theme: Theme): ThemeEntry {
  return themeRegistry[theme];
}

export function getAllThemes(): { id: Theme; entry: ThemeEntry }[] {
  return (Object.keys(themeRegistry) as Theme[]).map(id => ({
    id,
    entry: themeRegistry[id],
  }));
}
