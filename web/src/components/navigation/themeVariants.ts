import type { Theme } from '../../types';
import { cx } from '../../lib/classNames';

export type NavigationThemeVariant = 'night-city' | 'carbon' | 'washington-post' | 'brutalist' | 'graphite';
type TopBarAccent = 'cyan' | 'green' | 'yellow' | 'indigo';
type RailButtonKey = 'home' | 'agents' | 'tasks' | 'workspace' | 'memory' | 'settings';
type RailActionKey = Exclude<RailButtonKey, 'settings'>;

export function resolveNavigationTheme(theme: Theme, nightCityEnabled: boolean): NavigationThemeVariant {
  if (nightCityEnabled) return 'night-city';
  if (theme === 'carbon' || theme === 'washington-post') return theme;
  if (theme === 'graphite') return 'graphite';
  return 'brutalist';
}

const topBarMobileBaseByTheme: Record<NavigationThemeVariant, Record<TopBarAccent, string>> = {
  'night-city': {
    cyan: 'cyber-btn border-nc-border text-nc-muted hover:bg-nc-elevated hover:text-nc-cyan',
    green: 'cyber-btn border-nc-border text-nc-muted hover:bg-nc-elevated hover:text-nc-green',
    yellow: 'cyber-btn border-nc-border text-nc-muted hover:bg-nc-elevated hover:text-nc-yellow',
    indigo: 'cyber-btn border-nc-border text-nc-muted hover:bg-nc-elevated hover:text-nc-indigo',
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
  brutalist: {
    cyan: 'border-2 border-nc-border text-nc-muted hover:bg-nc-elevated hover:text-nc-text-bright',
    green: 'border-2 border-nc-border text-nc-muted hover:bg-nc-elevated hover:text-nc-text-bright',
    yellow: 'border-2 border-nc-border text-nc-muted hover:bg-nc-elevated hover:text-nc-text-bright',
    indigo: 'border-2 border-nc-border text-nc-muted hover:bg-nc-elevated hover:text-nc-text-bright',
  },
  graphite: {
    cyan: 'border-transparent text-nc-muted hover:bg-white/[0.04] hover:text-nc-text-bright rounded-full',
    green: 'border-transparent text-nc-muted hover:bg-white/[0.04] hover:text-nc-text-bright rounded-full',
    yellow: 'border-transparent text-nc-muted hover:bg-white/[0.04] hover:text-nc-text-bright rounded-full',
    indigo: 'border-transparent text-nc-muted hover:bg-white/[0.04] hover:text-nc-text-bright rounded-full',
  },
};

const topBarMobileActiveByTheme: Record<NavigationThemeVariant, Record<TopBarAccent, string>> = {
  'night-city': {
    cyan: 'border-nc-cyan text-nc-cyan',
    green: 'border-nc-green text-nc-green',
    yellow: '',
    indigo: 'border-nc-indigo text-nc-indigo',
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
  brutalist: {
    cyan: 'bg-nc-yellow text-nc-text-bright border-nc-border-bright',
    green: 'bg-nc-green text-nc-text-bright border-nc-border-bright',
    yellow: '',
    indigo: 'bg-nc-indigo text-nc-text-bright border-nc-border-bright',
  },
  graphite: {
    cyan: 'bg-nc-cyan/[0.14] text-nc-cyan border-transparent',
    green: 'bg-nc-green/[0.14] text-nc-green border-transparent',
    yellow: '',
    indigo: 'bg-nc-indigo/[0.14] text-nc-indigo border-transparent',
  },
};

export function getTopBarShellClass(themeVariant: NavigationThemeVariant): string {
  return cx(
    'safe-top bg-nc-surface scanline-overlay flex-shrink-0',
    themeVariant === 'brutalist' ? 'border-b-[3px] border-nc-border-bright' : 'border-b border-nc-border',
    themeVariant === 'graphite' && 'border-white/[0.04]',
  );
}

export function getTopBarMobileIconButtonClass(
  themeVariant: NavigationThemeVariant,
  accent: TopBarAccent,
  active = false,
): string {
  return cx(
    'w-8 h-8 border flex items-center justify-center',
    topBarMobileBaseByTheme[themeVariant][accent],
    active && topBarMobileActiveByTheme[themeVariant][accent],
  );
}

export function getTopBarRightPanelButtonClass(themeVariant: NavigationThemeVariant, active: boolean): string {
  if (themeVariant === 'night-city') {
    return cx(
      'cyber-btn w-8 h-8 border flex items-center justify-center',
      active
        ? 'border-nc-yellow bg-nc-yellow/15 text-nc-yellow shadow-nc-yellow'
        : 'border-nc-border text-nc-muted hover:border-nc-yellow/50 hover:text-nc-yellow',
    );
  }

  if (themeVariant === 'graphite') {
    return cx(
      'w-8 h-8 rounded-full border-transparent flex items-center justify-center transition-colors duration-150',
      active
        ? 'bg-nc-yellow/[0.14] text-nc-yellow'
        : 'text-nc-muted hover:bg-white/[0.04] hover:text-nc-text-bright',
    );
  }

  return cx(
    'w-8 h-8 border-2 flex items-center justify-center transition-all',
    active
      ? 'border-nc-border-bright bg-[#FF6B00] text-nc-text-bright shadow-[2px_2px_0px_0px_#1A1A1A]'
      : 'border-nc-border text-nc-muted hover:border-nc-border-bright hover:text-nc-text-bright',
  );
}

export const workspaceRailThemeConfig: Record<
  NavigationThemeVariant,
  { shell: string; logo: string; divider: string; homeLabel: string; homeButtonTitle: string }
> = {
  'night-city': {
    shell: 'w-[72px] h-full bg-nc-deep border-r border-nc-border flex flex-col items-center py-4 gap-3',
    logo: 'w-10 h-10 border border-nc-cyan bg-nc-cyan/10 font-display font-black text-lg flex items-center justify-center text-nc-cyan',
    divider: 'w-8 cyber-divider my-1',
    homeLabel: 'Chat',
    homeButtonTitle: 'Chat',
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
  brutalist: {
    shell: 'w-[72px] h-full flex flex-col items-center py-4 gap-3 bg-nc-deep border-r-[3px] border-nc-border-bright',
    logo: 'w-10 h-10 border-2 border-nc-border-bright bg-nc-yellow font-display font-black text-lg flex items-center justify-center text-nc-text-bright',
    divider: 'w-8 my-1 border-t-2 border-nc-border',
    homeLabel: 'Home',
    homeButtonTitle: 'Home',
  },
  graphite: {
    shell: 'w-[72px] h-full flex flex-col items-center py-4 gap-3 bg-nc-deep border-r border-white/[0.04]',
    logo: 'w-10 h-10 rounded-full bg-white/[0.08] font-display font-semibold text-lg flex items-center justify-center text-nc-text-bright',
    divider: 'w-8 my-1 border-t border-white/[0.04]',
    homeLabel: 'Home',
    homeButtonTitle: 'Home',
  },
};

const workspaceRailActiveByTheme: Record<Exclude<NavigationThemeVariant, 'night-city'>, Record<Exclude<RailButtonKey, 'settings'>, string>> = {
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
  brutalist: {
    home: 'bg-nc-yellow text-nc-text-bright border-nc-border-bright shadow-[2px_2px_0px_0px_rgb(var(--nc-border-bright))]',
    agents: 'bg-nc-green text-nc-text-bright border-nc-border-bright shadow-[2px_2px_0px_0px_rgb(var(--nc-border-bright))]',
    tasks: 'bg-nc-indigo text-nc-text-bright border-nc-border-bright shadow-[2px_2px_0px_0px_rgb(var(--nc-border-bright))]',
    workspace: 'bg-nc-cyan text-nc-text-bright border-nc-border-bright shadow-[2px_2px_0px_0px_rgb(var(--nc-border-bright))]',
    memory: 'bg-[#CC6600] text-nc-text-bright border-nc-border-bright shadow-[2px_2px_0px_0px_rgb(var(--nc-border-bright))]',
  },
  graphite: {
    home: 'bg-nc-cyan/[0.14] text-nc-cyan border-transparent',
    agents: 'bg-nc-green/[0.14] text-nc-green border-transparent',
    tasks: 'bg-nc-indigo/[0.14] text-nc-indigo border-transparent',
    workspace: 'bg-nc-magenta/[0.14] text-nc-magenta border-transparent',
    memory: 'bg-nc-yellow/[0.14] text-nc-yellow border-transparent',
  },
};

const workspaceRailNightCityInactiveByKey: Record<RailButtonKey, string> = {
  home: 'text-nc-muted border-nc-border hover:text-nc-cyan hover:border-nc-cyan/50',
  agents: 'text-nc-muted border-nc-border hover:text-nc-green hover:border-nc-green/50',
  tasks: 'text-nc-muted border-nc-border hover:text-nc-indigo hover:border-nc-indigo/50',
  workspace: 'text-nc-muted border-nc-border hover:text-nc-magenta hover:border-nc-magenta/50',
  memory: 'text-nc-muted border-nc-border hover:text-nc-yellow hover:border-nc-yellow/50',
  settings: 'text-nc-muted border-nc-border hover:text-nc-yellow hover:border-nc-yellow/50',
};

const workspaceRailNightCityActiveByKey: Record<RailActionKey, string> = {
  home: 'bg-nc-cyan/15 text-nc-cyan border-nc-cyan shadow-nc-cyan',
  agents: 'bg-nc-green/15 text-nc-green border-nc-green shadow-nc-green',
  tasks: 'bg-nc-indigo/15 text-nc-indigo border-nc-indigo',
  workspace: 'bg-nc-magenta/15 text-nc-magenta border-nc-magenta shadow-nc-magenta',
  memory: 'bg-nc-yellow/15 text-nc-yellow border-nc-yellow shadow-nc-yellow',
};

export function getWorkspaceRailButtonClass(
  themeVariant: NavigationThemeVariant,
  key: RailButtonKey,
  active: boolean,
): string {
  if (themeVariant === 'night-city') {
    if (key !== 'settings' && active) {
      return cx(
        'cyber-btn w-10 h-10 border flex items-center justify-center',
        workspaceRailNightCityActiveByKey[key],
      );
    }

    return cx(
      'cyber-btn w-10 h-10 border flex items-center justify-center',
      workspaceRailNightCityInactiveByKey[key],
    );
  }

  if (themeVariant === 'graphite') {
    const common = 'w-10 h-10 rounded-full flex items-center justify-center transition-colors duration-150';
    if (key !== 'settings' && active) {
      return cx(common, workspaceRailActiveByTheme.graphite[key]);
    }
    return cx(common, 'text-nc-muted hover:bg-white/[0.04] hover:text-nc-text-bright');
  }

  const common = themeVariant === 'brutalist'
    ? 'w-10 h-10 border-2 flex items-center justify-center transition-all duration-100'
    : 'w-10 h-10 border flex items-center justify-center transition-all duration-100';
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
    unreadBadge: string;
    scrollerPadding: string;
  }
> = {
  'night-city': {
    shell: 'w-[260px] h-full flex flex-col overflow-hidden bg-nc-surface border-r border-nc-border',
    header: 'safe-top flex-shrink-0 border-b border-nc-border',
    titleClass: 'font-display font-black text-lg text-nc-cyan neon-cyan truncate tracking-wider',
    titleStyle: 'glitch',
    unreadBadge: 'text-2xs font-black px-1.5 py-0.5 border bg-nc-red/20 text-nc-red border-nc-red/40',
    scrollerPadding: '',
  },
  carbon: {
    shell: 'w-[260px] h-full flex flex-col overflow-hidden bg-nc-surface border-r border-nc-border',
    header: 'safe-top flex-shrink-0 border-b border-nc-border',
    titleClass: 'font-display font-semibold text-[1.15rem] leading-none text-nc-text-bright truncate',
    titleStyle: 'plain',
    unreadBadge: 'text-2xs font-black px-1.5 py-0.5 border bg-nc-red/20 text-nc-red border-nc-red/40 rounded-full',
    scrollerPadding: '',
  },
  'washington-post': {
    shell: 'w-[260px] h-full flex flex-col overflow-hidden bg-nc-surface border-r border-nc-border',
    header: 'safe-top flex-shrink-0 bg-[#f7f0e6] border-b border-nc-border',
    titleClass: 'font-display font-bold text-[1.15rem] leading-none text-nc-text-bright truncate',
    titleStyle: 'plain',
    unreadBadge: 'text-2xs font-black px-1.5 py-0.5 border bg-nc-red/20 text-nc-red border-nc-red/40 rounded-full',
    scrollerPadding: '',
  },
  brutalist: {
    shell: 'w-[260px] h-full flex flex-col overflow-hidden bg-nc-panel border-r-[3px] border-nc-border-bright',
    header: 'safe-top flex-shrink-0 border-b-[3px] border-nc-border-bright',
    titleClass: 'font-display font-black text-lg text-nc-text-bright truncate',
    titleStyle: 'plain',
    unreadBadge: 'text-2xs font-black px-1.5 py-0.5 border bg-nc-red text-white border-2 border-nc-border-bright shadow-[2px_2px_0px_0px_#1A1A1A]',
    scrollerPadding: 'px-2',
  },
  graphite: {
    shell: 'w-[260px] h-full flex flex-col overflow-hidden bg-nc-surface border-r border-white/[0.04]',
    header: 'safe-top flex-shrink-0 border-b border-white/[0.04]',
    titleClass: 'font-display font-semibold text-[1.1rem] leading-none text-nc-text-bright truncate tracking-tight',
    titleStyle: 'plain',
    unreadBadge: 'text-2xs font-semibold px-1.5 py-0.5 bg-white/[0.1] text-nc-text-bright rounded-full',
    scrollerPadding: 'px-2',
  },
};

const channelSidebarChannelActiveByTheme: Record<NavigationThemeVariant, string> = {
  'night-city': 'bg-nc-cyan/10 border-l-2 border-nc-cyan text-nc-cyan font-bold',
  carbon: 'bg-nc-cyan/10 border-l-2 border-nc-cyan text-nc-text-bright font-semibold',
  'washington-post': 'bg-[#f7f0e6] text-[#7c2430] font-semibold border-l-2 border-[#7c2430]',
  brutalist: 'bg-nc-yellow text-nc-text-bright font-bold border-2 border-nc-border-bright shadow-[2px_2px_0px_0px_#1A1A1A] mx-1',
  graphite: 'bg-nc-cyan/[0.12] text-nc-cyan font-medium rounded-md mx-1',
};

const channelSidebarChannelUnreadByTheme: Record<NavigationThemeVariant, string> = {
  'night-city': 'font-semibold text-nc-text-bright hover:bg-nc-elevated',
  carbon: 'font-semibold text-nc-text-bright hover:bg-nc-elevated',
  'washington-post': 'font-semibold text-nc-text-bright hover:bg-[#f7f0e6]',
  brutalist: 'font-semibold text-nc-text-bright hover:bg-nc-elevated',
  graphite: 'font-semibold text-nc-text-bright hover:bg-white/[0.04] rounded-md mx-1',
};

const channelSidebarChannelIdleByTheme: Record<NavigationThemeVariant, string> = {
  'night-city': 'text-nc-muted hover:bg-nc-elevated hover:text-nc-text',
  carbon: 'text-nc-muted hover:bg-nc-elevated hover:text-nc-text',
  'washington-post': 'text-nc-muted hover:bg-[#f7f0e6] hover:text-nc-text-bright',
  brutalist: 'text-nc-muted hover:bg-nc-elevated hover:text-nc-text-bright',
  graphite: 'text-nc-muted hover:bg-white/[0.03] hover:text-nc-text-bright rounded-md mx-1',
};

const channelSidebarAgentActiveByTheme: Record<NavigationThemeVariant, string> = {
  'night-city': 'bg-nc-green/10 border-l-2 border-nc-green text-nc-green font-bold',
  carbon: 'bg-nc-green/10 border-l-2 border-nc-green text-nc-text-bright font-semibold',
  'washington-post': 'bg-[#f7f0e6] text-[#7c2430] font-semibold border-l-2 border-[#7c2430]',
  brutalist: 'bg-nc-yellow text-nc-text-bright font-bold border-2 border-nc-border-bright shadow-[2px_2px_0px_0px_#1A1A1A] mx-1',
  graphite: 'bg-nc-green/[0.12] text-nc-green font-medium rounded-md mx-1',
};

const channelSidebarAgentUnreadByTheme: Record<NavigationThemeVariant, string> = {
  'night-city': 'font-semibold text-nc-text-bright hover:bg-nc-elevated',
  carbon: 'font-semibold text-nc-text-bright hover:bg-nc-elevated',
  'washington-post': 'font-semibold text-nc-text-bright hover:bg-[#f7f0e6]',
  brutalist: 'font-semibold text-nc-text-bright hover:bg-nc-elevated',
  graphite: 'font-semibold text-nc-text-bright hover:bg-white/[0.04] rounded-md mx-1',
};

const channelSidebarAgentIdleByTheme: Record<NavigationThemeVariant, string> = {
  'night-city': 'text-nc-muted hover:bg-nc-elevated hover:text-nc-text',
  carbon: 'text-nc-muted hover:bg-nc-elevated hover:text-nc-text',
  'washington-post': 'text-nc-muted hover:bg-[#f7f0e6] hover:text-nc-text-bright',
  brutalist: 'text-nc-muted hover:bg-nc-elevated hover:text-nc-text',
  graphite: 'text-nc-muted hover:bg-white/[0.03] hover:text-nc-text-bright rounded-md mx-1',
};

export function getChannelSidebarChannelItemClass(
  themeVariant: NavigationThemeVariant,
  active: boolean,
  unread: number,
): string {
  return cx(
    'w-full flex items-center gap-2 px-3 py-1.5 text-left transition-all duration-75 group mb-1',
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
    'w-full flex items-center gap-2 px-3 py-1.5 text-left transition-all duration-75 group mb-1',
    active
      ? channelSidebarAgentActiveByTheme[themeVariant]
      : unread > 0
        ? channelSidebarAgentUnreadByTheme[themeVariant]
        : channelSidebarAgentIdleByTheme[themeVariant],
  );
}

