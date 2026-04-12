import { useState } from 'react';
import { Hash, ChevronDown, ChevronRight, Plus, Bot, User, RotateCcw } from 'lucide-react';
import { useApp } from '../store/AppContext';

function SectionHeader({ title, count, collapsed, onToggle, onAdd }: {
  title: string; count?: number; collapsed: boolean; onToggle: () => void; onAdd?: () => void;
}) {
  return (
    <div className="flex items-center justify-between px-3 py-1.5 group">
      <button onClick={onToggle} className="flex items-center gap-1 text-xs font-bold uppercase tracking-wider text-nb-gray-500 dark:text-dark-muted hover:text-nb-black dark:hover:text-dark-text transition-colors">
        {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
        <span>{title}</span>
        {count !== undefined && count > 0 && (
          <span className="ml-1 bg-nb-yellow text-nb-black text-2xs font-black px-1 border border-nb-black dark:border-dark-border">{count}</span>
        )}
      </button>
      {onAdd && (
        <button onClick={onAdd} className="opacity-0 group-hover:opacity-100 text-nb-gray-400 hover:text-nb-black dark:hover:text-dark-text transition-all">
          <Plus size={14} />
        </button>
      )}
    </div>
  );
}

export default function ChannelSidebar() {
  const {
    channels, agents, humans, activeChannelName, selectChannel, viewMode,
    createChannel, currentUser, unreadCounts, wsConnected, wsSend, addToast, theme,
    setSidebarOpen,
  } = useApp();

  const isCyber = theme === 'cyberpunk';

  const handleSelect = (name: string, isDm = false) => {
    selectChannel(name, isDm);
    if (window.innerWidth < 1024) setSidebarOpen(false);
  };

  const [channelsCollapsed, setChannelsCollapsed] = useState(false);
  const [dmsCollapsed, setDmsCollapsed] = useState(false);
  const [agentsCollapsed, setAgentsCollapsed] = useState(false);
  const [showCreateChannel, setShowCreateChannel] = useState(false);
  const [newChannelName, setNewChannelName] = useState('');

  const totalUnread = Object.values(unreadCounts).reduce((a, b) => a + b, 0);

  const handleCreateChannel = () => {
    const name = newChannelName.trim().replace(/[^a-z0-9-_]/gi, '-').toLowerCase();
    if (!name) return;
    createChannel(name);
    setNewChannelName('');
    setShowCreateChannel(false);
  };

  const activityColors: Record<string, string> = {
    thinking: 'bg-nb-yellow animate-pulse',
    working: 'bg-nb-orange animate-pulse',
    online: 'bg-nb-green',
    offline: 'bg-nb-gray-400',
    error: 'bg-nb-red',
  };

  return (
    <div data-component="channel-sidebar" className={`w-[260px] h-full border-r-3 flex flex-col overflow-hidden ${
      isCyber
        ? 'bg-[rgba(10,12,19,0.95)] border-[rgba(94,246,255,0.15)]'
        : 'bg-nb-cream dark:bg-dark-surface border-nb-black dark:border-dark-border'
    }`}>
      <div className={`px-3 py-3 border-b-3 ${isCyber ? 'border-[rgba(94,246,255,0.15)]' : 'border-nb-black dark:border-dark-border'}`}>
        <div className="flex items-center justify-between">
          <h2 className={`font-black text-lg truncate ${isCyber ? 'font-cyber-display text-cp-cyan cp-neon-cyan' : 'font-display text-nb-black dark:text-dark-text'}`}>Zouk</h2>
          {totalUnread > 0 && (
            <span className={`text-2xs font-black px-1.5 py-0.5 border-2 ${
              isCyber
                ? 'bg-cp-red/80 text-white border-cp-red/60 shadow-[0_0_8px_rgba(247,80,73,0.3)]'
                : 'bg-nb-pink text-nb-white border-nb-black shadow-nb-sm'
            }`}>
              {totalUnread}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 mt-1">
          <span className={`w-2 h-2 border ${
            isCyber
              ? (wsConnected ? 'bg-cp-green border-cp-green shadow-[0_0_4px_rgba(115,248,85,0.5)]' : 'bg-cp-red border-cp-red')
              : `border-nb-black dark:border-dark-border ${wsConnected ? 'bg-nb-green' : 'bg-nb-red'}`
          }`} />
          <span className={`text-xs truncate ${isCyber ? 'text-white/50 font-cyber-mono' : 'text-nb-gray-500 dark:text-dark-muted'}`}>{currentUser}</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto py-2 space-y-1 scrollbar-thin">
        <div>
          <SectionHeader
            title="Channels"
            count={channels.reduce((sum, c) => sum + (unreadCounts[c.name] || 0), 0)}
            collapsed={channelsCollapsed}
            onToggle={() => setChannelsCollapsed(!channelsCollapsed)}
            onAdd={() => setShowCreateChannel(!showCreateChannel)}
          />

          {showCreateChannel && (
            <div className="px-3 pb-2">
              <div className="flex items-center border-2 border-nb-black dark:border-dark-border bg-nb-white dark:bg-dark-elevated">
                <Hash size={14} className="ml-2 text-nb-gray-400 flex-shrink-0" />
                <input
                  type="text"
                  value={newChannelName}
                  onChange={e => setNewChannelName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleCreateChannel(); if (e.key === 'Escape') setShowCreateChannel(false); }}
                  placeholder="new-channel"
                  className="w-full px-1.5 py-1 bg-transparent text-sm text-nb-black dark:text-dark-text placeholder:text-nb-gray-400 focus:outline-none"
                  autoFocus
                />
              </div>
            </div>
          )}

          {!channelsCollapsed && channels.map(ch => {
            const unread = unreadCounts[ch.name] || 0;
            const isActive = activeChannelName === ch.name;
            return (
              <button
                key={ch.id}
                onClick={() => handleSelect(ch.name)}
                className={`
                  w-full flex items-center gap-2 px-3 py-1.5 text-left transition-all duration-75 group
                  ${isActive
                    ? 'bg-nb-yellow border-2 border-nb-black shadow-nb-sm font-bold text-nb-black mx-1 -ml-0'
                    : unread > 0
                      ? 'font-semibold text-nb-black dark:text-dark-text hover:bg-nb-gray-100 dark:hover:bg-dark-elevated'
                      : 'text-nb-gray-600 dark:text-dark-muted hover:bg-nb-gray-100 dark:hover:bg-dark-elevated hover:text-nb-black dark:hover:text-dark-text'
                  }
                `}
              >
                <Hash size={14} className="flex-shrink-0" />
                <span className="truncate text-sm">{ch.name}</span>
                {unread > 0 && !isActive && (
                  <span className="ml-auto bg-nb-pink text-nb-white text-2xs font-black px-1.5 py-0.5 border-2 border-nb-black shadow-nb-sm min-w-[20px] text-center">
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
            count={agents.filter(a => a.status === 'active').length}
            collapsed={agentsCollapsed}
            onToggle={() => setAgentsCollapsed(!agentsCollapsed)}
          />
          {!agentsCollapsed && agents.map(agent => {
            const isActive = activeChannelName === agent.name && viewMode === 'dm';
            const unread = unreadCounts[agent.name] || 0;
            return (
              <button
                key={agent.id}
                onClick={() => handleSelect(agent.name, true)}
                className={`
                  w-full flex items-center gap-2 px-3 py-1.5 text-left transition-all duration-75 group
                  ${isActive
                    ? 'bg-nb-blue border-2 border-nb-black shadow-nb-sm font-bold text-nb-white mx-1 -ml-0'
                    : unread > 0
                      ? 'font-semibold text-nb-black dark:text-dark-text hover:bg-nb-gray-100 dark:hover:bg-dark-elevated'
                      : 'text-nb-gray-600 dark:text-dark-muted hover:bg-nb-gray-100 dark:hover:bg-dark-elevated hover:text-nb-black dark:hover:text-dark-text'
                  }
                `}
              >
                <Bot size={14} className="flex-shrink-0" />
                <span className="truncate text-sm">{agent.displayName || agent.name}</span>
                <div className="ml-auto flex items-center gap-1.5">
                  {agent.status === 'active' && (
                    <span
                      role="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        wsSend({ type: 'agent:reset-workspace', agentId: agent.id });
                        addToast(`Resetting ${agent.name}...`, 'info');
                      }}
                      className="opacity-0 group-hover:opacity-100 w-5 h-5 flex items-center justify-center text-nb-gray-400 hover:text-nb-orange transition-all"
                      title="Reset context"
                    >
                      <RotateCcw size={12} />
                    </span>
                  )}
                  <span className={`w-2 h-2 border border-nb-black dark:border-dark-border flex-shrink-0 ${activityColors[agent.activity || 'offline']}`} />
                  {unread > 0 && !isActive && (
                    <span className="bg-nb-pink text-nb-white text-2xs font-black px-1.5 py-0.5 border-2 border-nb-black shadow-nb-sm min-w-[20px] text-center">
                      {unread}
                    </span>
                  )}
                </div>
              </button>
            );
          })}
          {!agentsCollapsed && agents.length === 0 && (
            <div className="px-3 py-1.5 text-xs text-nb-gray-400 dark:text-dark-muted italic">No agents</div>
          )}
        </div>

        <div>
          <SectionHeader
            title="People"
            collapsed={dmsCollapsed}
            onToggle={() => setDmsCollapsed(!dmsCollapsed)}
          />
          {!dmsCollapsed && humans.map(h => (
            <button
              key={h.id}
              onClick={() => handleSelect(h.name, true)}
              className={`
                w-full flex items-center gap-2 px-3 py-1.5 text-left transition-all duration-75
                ${activeChannelName === h.name
                  ? 'bg-nb-blue border-2 border-nb-black shadow-nb-sm font-bold text-nb-white mx-1 -ml-0'
                  : 'text-nb-gray-600 dark:text-dark-muted hover:bg-nb-gray-100 dark:hover:bg-dark-elevated hover:text-nb-black dark:hover:text-dark-text'
                }
              `}
            >
              <User size={14} className="flex-shrink-0" />
              <span className="truncate text-sm">{h.name}</span>
              {(unreadCounts[h.name] || 0) > 0 && activeChannelName !== h.name && (
                <span className="ml-auto bg-nb-pink text-nb-white text-2xs font-black px-1.5 py-0.5 border-2 border-nb-black shadow-nb-sm min-w-[20px] text-center">
                  {unreadCounts[h.name]}
                </span>
              )}
            </button>
          ))}
          {!dmsCollapsed && humans.length === 0 && (
            <div className="px-3 py-1.5 text-xs text-nb-gray-400 dark:text-dark-muted italic">No people online</div>
          )}
        </div>
      </div>
    </div>
  );
}
