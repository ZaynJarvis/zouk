import type { ComponentType } from 'react';
import { nightCity } from './night-city';
import { brutalist } from './brutalist';
import { washingtonPost } from './washington-post';
import { carbon } from './carbon';
import { graphite } from './graphite';
import NightCityThemeSelectButton from './night-city/ThemeSelectButton';
import BrutalistThemeSelectButton from './brutalist/ThemeSelectButton';
import WashingtonPostThemeSelectButton from './washington-post/ThemeSelectButton';
import CarbonThemeSelectButton from './carbon/ThemeSelectButton';
import GraphiteThemeSelectButton from './graphite/ThemeSelectButton';

export type ThemeId = 'night-city' | 'brutalist' | 'washington-post' | 'carbon' | 'graphite';

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
  { ...washingtonPost, ThemeSelectButton: WashingtonPostThemeSelectButton },
  { ...carbon, ThemeSelectButton: CarbonThemeSelectButton },
  { ...graphite, ThemeSelectButton: GraphiteThemeSelectButton },
];

export const DEFAULT_THEME: ThemeId = 'washington-post';

export function applyTheme(id: ThemeId) {
  document.documentElement.setAttribute('data-theme', id);
  const themeMeta = document.querySelector("meta[name='theme-color']") as HTMLMetaElement | null;
  const theme = getTheme(id);
  if (themeMeta && theme) {
    themeMeta.content = theme.preview.bg;
  }
}

export function getTheme(id: ThemeId): ThemeDefinition | undefined {
  return themes.find((t) => t.id === id);
}
