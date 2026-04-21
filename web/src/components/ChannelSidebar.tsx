import { useState, useMemo } from 'react';
import { Hash, ChevronDown, ChevronRight, Plus, Bot, User, RotateCcw, Settings, Trash2 } from 'lucide-react';
import { useApp } from '../store/AppContext';
import { agentStatus, humanStatus } from '../lib/avatarStatus';
import StatusDot from './StatusDot';
import { isMobileViewport, isStandalonePWA } from '../lib/layout';
import GlitchText from './glitch/GlitchText';
import { isNightCity } from '../lib/themeUtils';
import { contextUsageTextTone, formatContextUsageCompact, formatContextUsageTitle, pickDisplayContextUsage } from '../lib/contextUsage';
import {
  channelSidebarThemeConfig,
  getChannelSidebarAgentItemClass,
  getChannelSidebarChannelItemClass,
  resolveNavigationTheme,
} from './navigation/themeVariants';

function SectionHeader({ title, count, collapsed, onToggle, onAdd, forceShowButtons }: {
  title: string; count?: number; collapsed: boolean; onToggle: () => void; onAdd?: () => void; forceShowButtons?: boolean;
}) {
  const nc = isNightCity();
  return (
    <div className="flex items-center justify-between px-3 py-1.5 group">
      <button onClick={onToggle} className={`flex items-center gap-1 text-xs font-bold uppercase tracking-wider transition-colors ${nc ? 'text-nc-muted hover:text-nc-cyan' : 'text-nc-muted hover:text-nc-text-bright'}`}>
        {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
        <span>{title}</span>
        {count !== undefined && count > 0 && (
          <span className="ml-1 text-2xs font-black px-1 border bg-nc-cyan/20 text-nc-cyan border-nc-cyan/30">{count}</span>
        )}
      </button>
      {onAdd && (
        <button onClick={onAdd} className={`${forceShowButtons ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} transition-all ${nc ? 'text-nc-muted hover:text-nc-cyan' : 'text-nc-muted hover:text-nc-text-bright'}`}>
          <Plus size={14} />
        </button>
      )}
    </div>
  );
}

export default function ChannelSidebar() {
  const {
    channels, agents, humans, activeChannelName, selectChannel, viewMode,
    createChannel, deleteChannel, currentUser, unreadCounts, isGuest, theme,
    authUser, setSidebarOpen, openAgentProfile, openAgentSettings, resetAgentContext,
    openChannelSettings,
  } = useApp();

  const pick = (name: string, isDm?: boolean) => {
    selectChannel(name, isDm);
    if (isMobileViewport()) setSidebarOpen(false);
  };

  const [channelsCollapsed, setChannelsCollapsed] = useState(false);
  const [dmsCollapsed, setDmsCollapsed] = useState(false);
  const [agentsCollapsed, setAgentsCollapsed] = useState(false);
  const [showCreateChannel, setShowCreateChannel] = useState(false);
  const [newChannelName, setNewChannelName] = useState('');

  const totalUnread = Object.values(unreadCounts).reduce((a, b) => a + b, 0);

  const filteredChannels = useMemo(() => channels, [channels]);
  const filteredAgents = useMemo(() => agents, [agents]);
  const filteredHumans = useMemo(() => {
    const list = humans.slice();
    if (currentUser && !list.some(h => h.name === currentUser)) {
      list.push({
        id: `self:${currentUser}`,
        name: currentUser,
        picture: authUser?.picture || undefined,
        gravatarUrl: authUser?.gravatarUrl || undefined,
        guest: isGuest,
      });
    }
    list.sort((a, b) => {
      if (a.name === currentUser) return -1;
      if (b.name === currentUser) return 1;
      return a.name.localeCompare(b.name);
    });
    return list;
  }, [humans, currentUser, authUser, isGuest]);

  const handleCreateChannel = () => {
    const name = newChannelName.trim().replace(/[^a-z0-9-_]/gi, '-').toLowerCase();
    if (!name) return;
    createChannel(name);
    setNewChannelName('');
    setShowCreateChannel(false);
  };

  const themeVariant = resolveNavigationTheme(theme, isNightCity());
  const channelSidebarTheme = channelSidebarThemeConfig[themeVariant];

  const forceShowButtons = isMobileViewport() || isStandalonePWA();

  return (
    <div className={channelSidebarTheme.shell}>
      <div className={channelSidebarTheme.header}>
        <div className="px-3 h-14 flex items-center justify-between">
          {channelSidebarTheme.titleStyle === 'glitch'
            ? <GlitchText as="h2" className={channelSidebarTheme.titleClass} intensity="low">ZOUK</GlitchText>
            : <h2 className={channelSidebarTheme.titleClass}>Zouk</h2>}
          {totalUnread > 0 && (
            <span className={channelSidebarTheme.unreadBadge}>
              {totalUnread}
            </span>
          )}
        </div>
      </div>

      <div className={`flex-1 overflow-y-auto overflow-x-hidden py-2 space-y-1 scrollbar-thin ${channelSidebarTheme.scrollerPadding}`}>
        <div>
          <SectionHeader
            title="Channels"
            count={filteredChannels.reduce((sum, c) => sum + (unreadCounts[c.name] || 0), 0)}
            collapsed={channelsCollapsed}
            onToggle={() => setChannelsCollapsed(!channelsCollapsed)}
            onAdd={isGuest ? undefined : () => setShowCreateChannel(!showCreateChannel)}
            forceShowButtons={forceShowButtons}
          />

          {showCreateChannel && (
            <div className="px-3 pb-2">
              <div className="flex items-center border border-nc-cyan/50 bg-nc-panel">
                <Hash size={14} className="ml-2 text-nc-cyan/50 flex-shrink-0" />
                <input
                  type="text"
                  value={newChannelName}
                  onChange={e => setNewChannelName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleCreateChannel(); if (e.key === 'Escape') setShowCreateChannel(false); }}
                  placeholder="new-channel"
                  className="w-full px-1.5 py-1 bg-transparent text-sm text-nc-text placeholder:text-nc-muted focus:outline-none font-mono"
                  autoFocus
                />
              </div>
            </div>
          )}

          {!channelsCollapsed && filteredChannels.map(ch => {
            const unread = unreadCounts[ch.name] || 0;
            const isActive = activeChannelName === ch.name;
            return (
              <button
                key={ch.id}
                onClick={() => pick(ch.name)}
                className={getChannelSidebarChannelItemClass(themeVariant, isActive, unread)}
              >
                <Hash size={14} className="flex-shrink-0" />
                <span className="truncate text-sm">{ch.name}</span>
                {!isGuest && (
                  <span
                    role="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      openChannelSettings(ch.id);
                    }}
                    className={`ml-auto ${forceShowButtons ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} w-5 h-5 flex items-center justify-center text-nc-muted hover:text-nc-cyan transition-all`}
                    title={`Configure #${ch.name}`}
                  >
                    <Settings size={12} />
                  </span>
                )}
                {!isGuest && ch.name !== 'all' && (
                  <span
                    role="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!window.confirm(`Delete channel #${ch.name}? This removes the channel from the workspace but keeps its messages in the database.`)) return;
                      deleteChannel(ch.id, ch.name);
                    }}
                    className={`${forceShowButtons ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} w-5 h-5 flex items-center justify-center text-nc-muted hover:text-nc-red transition-all`}
                    title="Delete channel"
                  >
                    <Trash2 size={12} />
                  </span>
                )}
                {unread > 0 && !isActive && (
                  <span className={`${!isGuest ? '' : 'ml-auto '}bg-nc-red/20 text-nc-red text-2xs font-black px-1.5 py-0.5 border border-nc-red/40 min-w-[20px] text-center`}>
                    {unread}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div>
          <SectionHeader
            title="Agents"
            count={filteredAgents.filter(a => a.status === 'active').length}
            collapsed={agentsCollapsed}
            onToggle={() => setAgentsCollapsed(!agentsCollapsed)}
          />
          {!agentsCollapsed && filteredAgents.map(agent => {
            const isActive = activeChannelName === agent.name && viewMode === 'dm';
            const unread = unreadCounts[agent.name] || 0;
            const status = agentStatus(agent);
            const isOffline = status === 'offline';
            const usageDisplay = pickDisplayContextUsage(agent.contextUsage, agent.model);
            const usageLabel = formatContextUsageCompact(usageDisplay);
            const usageTitle = formatContextUsageTitle(agent.contextUsage, agent.model);
            const usageTone = contextUsageTextTone(usageDisplay?.percent);
            return (
              <button
                key={agent.id}
                onClick={() => pick(agent.name, true)}
                className={getChannelSidebarAgentItemClass(themeVariant, isActive, unread)}
              >
                <span className="relative w-5 h-5 flex-shrink-0">
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                      e.stopPropagation();
                      openAgentProfile(agent.id);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        e.stopPropagation();
                        openAgentProfile(agent.id);
                      }
                    }}
                    title={`View @${agent.displayName || agent.name} profile`}
                    className={`w-full h-full border border-nc-cyan/30 bg-nc-cyan/10 flex items-center justify-center overflow-hidden font-display font-bold text-2xs text-nc-cyan hover:ring-1 hover:ring-nc-cyan cursor-pointer ${isOffline ? 'grayscale opacity-70' : ''}`}
                  >
                    {agent.picture ? (
                      <img src={agent.picture} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <Bot size={12} />
                    )}
                  </span>
                  <StatusDot status={status} size="sm" ringClass="border-nc-surface" />
                </span>
                <span className="truncate text-sm">{agent.displayName || agent.name}</span>
                <div className="ml-auto flex items-center gap-1.5">
                  {agent.status === 'active' && !isGuest && (
                    <span
                      role="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        resetAgentContext(agent.id);
                      }}
                      className={`${forceShowButtons ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} w-5 h-5 flex items-center justify-center text-nc-muted hover:text-nc-yellow transition-all`}
                      title="Reset context"
                    >
                      <RotateCcw size={12} />
                    </span>
                  )}
                  {!isGuest && (
                    <span
                      role="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        openAgentSettings(agent.id);
                      }}
                      className={`${forceShowButtons ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} w-5 h-5 flex items-center justify-center text-nc-muted hover:text-nc-cyan transition-all`}
                      title={`Configure ${agent.displayName || agent.name}`}
                    >
                      <Settings size={12} />
                    </span>
                  )}
                  {unread > 0 && !isActive && (
                    <span className="bg-nc-red/20 text-nc-red text-2xs font-black px-1.5 py-0.5 border border-nc-red/40 min-w-[20px] text-center">
                      {unread}
                    </span>
                  )}
                  {usageLabel && (
                    <span
                      className={`shrink-0 text-[10px] font-mono leading-none ${usageTone}`}
                      title={usageTitle}
                    >
                      {usageLabel}
                    </span>
                  )}
                </div>
              </button>
            );
          })}
          {!agentsCollapsed && filteredAgents.length === 0 && (
            <div className="px-3 py-1.5 text-xs text-nc-muted italic font-mono">No agents</div>
          )}
        </div>

        <div>
          <SectionHeader
            title="People"
            collapsed={dmsCollapsed}
            onToggle={() => setDmsCollapsed(!dmsCollapsed)}
          />
          {!dmsCollapsed && filteredHumans.map(h => {
            const isSelf = h.name === currentUser;
            const isActive = activeChannelName === h.name;
            const commonRow = 'w-full flex items-center gap-2 px-3 py-1.5 text-left transition-all duration-100 mb-1';
            const activeClass = 'bg-nc-magenta/10 border-l-2 border-nc-magenta text-nc-magenta font-bold';
            const idleClass = 'text-nc-muted hover:bg-nc-elevated hover:text-nc-text';
            const status = isSelf ? humanStatus({ online: true }) : humanStatus(h);
            const isOffline = status === 'offline';
            const content = (
              <>
                <div className="relative w-5 h-5 shrink-0">
                  <div className={`w-full h-full border border-nc-cyan/30 bg-nc-cyan/10 flex items-center justify-center overflow-hidden ${isOffline ? 'grayscale opacity-70' : ''}`}>
                    {h.picture || h.gravatarUrl ? (
                      <img src={h.picture || h.gravatarUrl} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <User size={12} className="flex-shrink-0" />
                    )}
                  </div>
                  <StatusDot status={status} size="sm" ringClass="border-nc-surface" />
                </div>
                <span className="truncate text-sm">{h.name}</span>
                {isSelf && (
                  <span className="text-2xs text-nc-muted font-mono">(you)</span>
                )}
                {!isSelf && (unreadCounts[h.name] || 0) > 0 && !isActive && (
                  <span className="ml-auto bg-nc-red/20 text-nc-red text-2xs font-black px-1.5 py-0.5 border border-nc-red/40 min-w-[20px] text-center">
                    {unreadCounts[h.name]}
                  </span>
                )}
              </>
            );
            if (isSelf) {
              return (
                <div key={h.id} className={`${commonRow} text-nc-muted cursor-default`}>
                  {content}
                </div>
              );
            }
            return (
              <button
                key={h.id}
                onClick={() => pick(h.name, true)}
                className={`${commonRow} ${isActive ? activeClass : idleClass}`}
              >
                {content}
              </button>
            );
          })}
          {!dmsCollapsed && filteredHumans.length === 0 && (
            <div className="px-3 py-1.5 text-xs text-nc-muted italic font-mono">No people online</div>
          )}
        </div>
      </div>
    </div>
  );
}
