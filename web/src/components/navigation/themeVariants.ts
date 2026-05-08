import type { Theme } from '../../types';
import { cx } from '../../lib/classNames';

export type NavigationThemeVariant = 'atlas' | 'carbon' | 'washington-post';
type TopBarAccent = 'cyan' | 'green' | 'yellow' | 'indigo';
type RailButtonKey = 'home' | 'agents' | 'tasks' | 'workspace' | 'memory' | 'settings';

export function resolveNavigationTheme(theme: Theme, nightCityEnabled?: boolean): NavigationThemeVariant {
  void nightCityEnabled; // legacy param — kept for callsite compat; night-city removed
  if (theme === 'atlas') return 'atlas';
  if (theme === 'carbon' || theme === 'washington-post') return theme;
  return 'atlas';
}

const topBarMobileBaseByTheme: Record<NavigationThemeVariant, Record<TopBarAccent, string>> = {
  atlas: {
    cyan: 'border-transparent text-nc-muted hover:bg-nc-elevated hover:text-nc-text-bright rounded-lg',
    green: 'border-transparent text-nc-muted hover:bg-nc-elevated hover:text-nc-text-bright rounded-lg',
    yellow: 'border-transparent text-nc-muted hover:bg-nc-elevated hover:text-nc-text-bright rounded-lg',
    indigo: 'border-transparent text-nc-muted hover:bg-nc-elevated hover:text-nc-text-bright rounded-lg',
  },
  carbon: {
    cyan: 'border-nc-border text-nc-muted hover:bg-nc-elevated hover:text-nc-text-bright',
    green: 'border-nc-border text-nc-muted hover:bg-nc-elevated hover:text-nc-text-bright',
    yellow: 'border-nc-border text-nc-muted hover:bg-nc-elevated hover:text-nc-text-bright',
    indigo: 'border-nc-border text-nc-muted hover:bg-nc-elevated hover:text-nc-text-bright',
  },
  'washington-post': {
    cyan: 'border-nc-border text-nc-red hover:bg-nc-elevated',
    green: 'border-nc-border text-nc-red hover:bg-nc-elevated',
    yellow: 'border-nc-border text-nc-red hover:bg-nc-elevated',
    indigo: 'border-nc-border text-nc-red hover:bg-nc-elevated',
  },
};

const topBarMobileActiveByTheme: Record<NavigationThemeVariant, Record<TopBarAccent, string>> = {
  atlas: {
    cyan: 'bg-nc-cyan/[0.1] text-nc-cyan',
    green: 'bg-nc-green/[0.12] text-nc-green',
    yellow: 'bg-nc-cyan/[0.1] text-nc-cyan',
    indigo: 'bg-nc-indigo/[0.1] text-nc-indigo',
  },
  carbon: {
    cyan: 'bg-nc-cyan/15 text-nc-cyan border-nc-cyan',
    green: 'bg-nc-green/15 text-nc-green border-nc-green',
    yellow: '',
    indigo: 'bg-nc-indigo/15 text-nc-indigo border-nc-indigo',
  },
  'washington-post': {
    cyan: 'bg-nc-red text-nc-surface',
    green: 'bg-nc-indigo text-nc-surface',
    yellow: '',
    indigo: 'bg-[#405268] text-nc-surface',
  },
};

export function getTopBarShellClass(themeVariant: NavigationThemeVariant): string {
  return cx(
    'safe-top bg-nc-surface scanline-overlay flex-shrink-0',
    'border-b border-nc-border',
    themeVariant === 'atlas' && 'backdrop-blur-md bg-nc-surface/95',
  );
}

export function getTopBarMobileIconButtonClass(
  themeVariant: NavigationThemeVariant,
  accent: TopBarAccent,
  active = false,
): string {
  const sizing = themeVariant === 'atlas'
    ? 'w-9 h-9 sm:w-8 sm:h-8 flex items-center justify-center transition-colors'
    : 'w-8 h-8 border flex items-center justify-center';
  return cx(
    sizing,
    topBarMobileBaseByTheme[themeVariant][accent],
    active && topBarMobileActiveByTheme[themeVariant][accent],
  );
}

export function getTopBarRightPanelButtonClass(themeVariant: NavigationThemeVariant, active: boolean): string {
  if (themeVariant === 'atlas') {
    return cx(
      'w-9 h-9 rounded-lg flex items-center justify-center transition-colors',
      active
        ? 'bg-nc-cyan/[0.12] text-nc-cyan'
        : 'text-nc-muted hover:bg-nc-elevated hover:text-nc-text-bright',
    );
  }

  return cx(
    'w-8 h-8 border-2 flex items-center justify-center transition-all',
    active
      ? 'border-nc-border-bright bg-[#FF6B00] text-nc-text-bright'
      : 'border-nc-border text-nc-muted hover:border-nc-border-bright hover:text-nc-text-bright',
  );
}

export const workspaceRailThemeConfig: Record<
  NavigationThemeVariant,
  { shell: string; logo: string; divider: string; homeLabel: string; homeButtonTitle: string }
> = {
  atlas: {
    shell: 'w-[64px] h-full flex flex-col items-center py-3 gap-2 bg-nc-deep border-r border-nc-border',
    logo: 'w-9 h-9 rounded-lg bg-nc-cyan/[0.1] font-display font-semibold text-base flex items-center justify-center text-nc-cyan tracking-tight',
    divider: 'w-7 my-1 border-t border-nc-border',
    homeLabel: 'Home',
    homeButtonTitle: 'Home',
  },
  carbon: {
    shell: 'w-[72px] h-full flex flex-col items-center py-4 gap-3 bg-nc-deep border-r border-nc-border',
    logo: 'w-10 h-10 border border-nc-border bg-nc-cyan/10 font-display font-semibold text-lg flex items-center justify-center text-nc-text-bright',
    divider: 'w-8 my-1 border-t border-nc-border',
    homeLabel: 'Home',
    homeButtonTitle: 'Home',
  },
  'washington-post': {
    shell: 'w-[72px] h-full flex flex-col items-center py-4 gap-3 bg-nc-deep border-r border-nc-border',
    logo: 'w-10 h-10 border border-nc-red bg-nc-surface font-display font-bold text-lg flex items-center justify-center text-nc-red',
    divider: 'w-8 my-1 border-t border-nc-border',
    homeLabel: 'Home',
    homeButtonTitle: 'Home',
  },
};

const workspaceRailActiveByTheme: Record<NavigationThemeVariant, Record<Exclude<RailButtonKey, 'settings'>, string>> = {
  atlas: {
    home: 'bg-nc-cyan/[0.12] text-nc-cyan',
    agents: 'bg-nc-cyan/[0.12] text-nc-cyan',
    tasks: 'bg-nc-cyan/[0.12] text-nc-cyan',
    workspace: 'bg-nc-cyan/[0.12] text-nc-cyan',
    memory: 'bg-nc-cyan/[0.12] text-nc-cyan',
  },
  carbon: {
    home: 'bg-nc-cyan/15 text-nc-cyan border-nc-cyan',
    agents: 'bg-nc-green/15 text-nc-green border-nc-green',
    tasks: 'bg-nc-indigo/15 text-nc-indigo border-nc-indigo',
    workspace: 'bg-nc-magenta/15 text-nc-magenta border-nc-magenta',
    memory: 'bg-nc-yellow/15 text-nc-yellow border-nc-yellow',
  },
  'washington-post': {
    home: 'bg-nc-red text-nc-surface border-nc-red',
    agents: 'bg-nc-indigo text-nc-surface border-nc-indigo',
    tasks: 'bg-[#405268] text-nc-surface border-[#405268]',
    workspace: 'bg-nc-yellow text-nc-surface border-nc-yellow',
    memory: 'bg-[#405268] text-nc-surface border-[#405268]',
  },
};

export function getWorkspaceRailButtonClass(
  themeVariant: NavigationThemeVariant,
  key: RailButtonKey,
  active: boolean,
): string {
  if (themeVariant === 'atlas') {
    const common = 'w-10 h-10 rounded-lg flex items-center justify-center transition-colors';
    if (key !== 'settings' && active) {
      return cx(common, workspaceRailActiveByTheme.atlas[key]);
    }
    return cx(common, 'text-nc-muted hover:bg-nc-elevated hover:text-nc-text-bright');
  }

  const common = 'w-10 h-10 border flex items-center justify-center transition-all duration-100';
  const inactive = themeVariant === 'washington-post'
    ? 'text-nc-red border-nc-border hover:bg-nc-elevated'
    : 'text-nc-muted border-nc-border hover:bg-nc-elevated hover:text-nc-text-bright';

  if (key !== 'settings' && active) {
    return cx(common, workspaceRailActiveByTheme[themeVariant][key]);
  }
  return cx(common, inactive);
}

export const channelSidebarThemeConfig: Record<
  NavigationThemeVariant,
  {
    shell: string;
    header: string;
    titleClass: string;
    titleStyle: 'glitch' | 'plain';
    scrollerPadding: string;
  }
> = {
  atlas: {
    shell: 'w-[260px] h-full flex flex-col overflow-hidden bg-nc-surface border-r border-nc-border',
    header: 'safe-top flex-shrink-0 border-b border-nc-border',
    titleClass: 'font-display font-semibold text-[1.0625rem] leading-tight text-nc-text-bright truncate tracking-tight',
    titleStyle: 'plain',
    scrollerPadding: 'px-2',
  },
  carbon: {
    shell: 'w-[260px] h-full flex flex-col overflow-hidden bg-nc-surface border-r border-nc-border',
    header: 'safe-top flex-shrink-0 border-b border-nc-border',
    titleClass: 'font-display font-semibold text-[1.15rem] leading-none text-nc-text-bright truncate',
    titleStyle: 'plain',
    scrollerPadding: '',
  },
  'washington-post': {
    shell: 'w-[260px] h-full flex flex-col overflow-hidden bg-nc-surface border-r border-nc-border',
    header: 'safe-top flex-shrink-0 bg-[#f7f0e6] border-b border-nc-border',
    titleClass: 'font-display font-bold text-[1.15rem] leading-none text-nc-text-bright truncate',
    titleStyle: 'plain',
    scrollerPadding: '',
  },
};

const channelSidebarChannelActiveByTheme: Record<NavigationThemeVariant, string> = {
  atlas: 'bg-nc-cyan/[0.1] text-nc-cyan font-medium rounded-md mx-1',
  carbon: 'bg-nc-cyan/10 border-l-2 border-nc-cyan text-nc-text-bright font-semibold',
  'washington-post': 'bg-[#f7f0e6] text-[#7c2430] font-semibold border-l-2 border-[#7c2430]',
};

const channelSidebarChannelUnreadByTheme: Record<NavigationThemeVariant, string> = {
  atlas: 'font-semibold text-nc-text-bright hover:bg-nc-elevated rounded-md mx-1',
  carbon: 'font-semibold text-nc-text-bright hover:bg-nc-elevated',
  'washington-post': 'font-semibold text-nc-text-bright hover:bg-[#f7f0e6]',
};

const channelSidebarChannelIdleByTheme: Record<NavigationThemeVariant, string> = {
  atlas: 'text-nc-muted hover:bg-nc-elevated hover:text-nc-text-bright rounded-md mx-1',
  carbon: 'text-nc-muted hover:bg-nc-elevated hover:text-nc-text',
  'washington-post': 'text-nc-muted hover:bg-[#f7f0e6] hover:text-nc-text-bright',
};

const channelSidebarAgentActiveByTheme: Record<NavigationThemeVariant, string> = {
  atlas: 'bg-nc-green/[0.1] text-nc-green font-medium rounded-md mx-1',
  carbon: 'bg-nc-green/10 border-l-2 border-nc-green text-nc-text-bright font-semibold',
  'washington-post': 'bg-[#f7f0e6] text-[#7c2430] font-semibold border-l-2 border-[#7c2430]',
};

const channelSidebarAgentUnreadByTheme: Record<NavigationThemeVariant, string> = {
  atlas: 'font-semibold text-nc-text-bright hover:bg-nc-elevated rounded-md mx-1',
  carbon: 'font-semibold text-nc-text-bright hover:bg-nc-elevated',
  'washington-post': 'font-semibold text-nc-text-bright hover:bg-[#f7f0e6]',
};

const channelSidebarAgentIdleByTheme: Record<NavigationThemeVariant, string> = {
  atlas: 'text-nc-muted hover:bg-nc-elevated hover:text-nc-text-bright rounded-md mx-1',
  carbon: 'text-nc-muted hover:bg-nc-elevated hover:text-nc-text',
  'washington-post': 'text-nc-muted hover:bg-[#f7f0e6] hover:text-nc-text-bright',
};

export function getChannelSidebarChannelItemClass(
  themeVariant: NavigationThemeVariant,
  active: boolean,
  unread: number,
): string {
  return cx(
    'w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors duration-150 group mb-0.5',
    active
      ? channelSidebarChannelActiveByTheme[themeVariant]
      : unread > 0
        ? channelSidebarChannelUnreadByTheme[themeVariant]
        : channelSidebarChannelIdleByTheme[themeVariant],
  );
}

export function getChannelSidebarAgentItemClass(
  themeVariant: NavigationThemeVariant,
  active: boolean,
  unread: number,
): string {
  return cx(
    'w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors duration-150 group mb-0.5',
    active
      ? channelSidebarAgentActiveByTheme[themeVariant]
      : unread > 0
        ? channelSidebarAgentUnreadByTheme[themeVariant]
        : channelSidebarAgentIdleByTheme[themeVariant],
  );
}
