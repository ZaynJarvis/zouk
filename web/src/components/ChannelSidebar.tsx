import { useState } from 'react';
import { Hash, ChevronDown, ChevronRight, Plus, Bot, User, RotateCcw } from 'lucide-react';
import { useApp } from '../store/AppContext';
import GlitchText from './glitch/GlitchText';
import { isNightCity } from '../lib/themeUtils';

function SectionHeader({ title, count, collapsed, onToggle, onAdd }: {
  title: string; count?: number; collapsed: boolean; onToggle: () => void; onAdd?: () => void;
}) {
  const nc = isNightCity();
  return (
    <div className="flex items-center justify-between px-3 py-1.5 group">
      <button onClick={onToggle} className={`flex items-center gap-1 text-xs font-bold uppercase tracking-wider transition-colors ${nc ? 'text-nc-muted hover:text-nc-cyan' : 'text-nc-muted hover:text-nc-text-bright'}`}>
        {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
        <span>{title}</span>
        {count !== undefined && count > 0 && (
          <span className={`ml-1 text-2xs font-black px-1 border ${nc ? 'bg-nc-cyan/20 text-nc-cyan border-nc-cyan/30' : 'bg-nc-yellow text-nc-text-bright border-nc-border-bright'}`}>{count}</span>
        )}
      </button>
      {onAdd && (
        <button onClick={onAdd} className={`opacity-0 group-hover:opacity-100 transition-all ${nc ? 'text-nc-muted hover:text-nc-cyan' : 'text-nc-muted hover:text-nc-text-bright'}`}>
          <Plus size={14} />
        </button>
      )}
    </div>
  );
}

export default function ChannelSidebar() {
  const {
    channels, agents, humans, activeChannelName, selectChannel, viewMode,
    createChannel, currentUser, unreadCounts, wsConnected, wsSend, addToast, isGuest, theme,
  } = useApp();

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
    thinking: 'bg-nc-yellow animate-pulse',
    working: 'bg-nc-red animate-pulse',
    online: 'bg-nc-green',
    offline: 'bg-nc-muted/30',
    error: 'bg-nc-red',
  };

  const nc = isNightCity();
  const wapo = theme === 'washington-post';

  return (
    <div className={`w-[260px] h-full flex flex-col overflow-hidden ${nc ? 'bg-nc-surface border-r border-nc-border' : wapo ? 'bg-nc-surface border-r border-nc-border' : 'bg-nc-panel border-r-[3px] border-nc-border-bright'}`}>
      <div className={`px-3 py-3 ${nc ? 'border-b border-nc-border' : wapo ? 'bg-[#f7f0e6] border-b border-nc-border' : 'border-b-[3px] border-nc-border-bright'}`}>
        <div className="flex items-center justify-between">
          {nc
            ? <GlitchText as="h2" className="font-display font-black text-lg text-nc-cyan neon-cyan truncate tracking-wider" intensity="low">ZOUK</GlitchText>
            : wapo
              ? <div className="truncate">
                  <div className="text-[10px] uppercase tracking-[0.22em] text-[#7c2430] font-semibold">Editorial Desk</div>
                  <h2 className="font-display font-bold text-[1.15rem] leading-none text-nc-text-bright truncate">Zouk Post</h2>
                </div>
              : <h2 className="font-display font-black text-lg text-nc-text-bright truncate">Zouk</h2>
          }
          {totalUnread > 0 && (
            <span className={`text-2xs font-black px-1.5 py-0.5 border ${nc ? 'bg-nc-red/20 text-nc-red border-nc-red/40' : wapo ? 'bg-[#7c2430] text-[#fffaf2] border-[#7c2430] rounded-full' : 'bg-nc-red text-white border-2 border-nc-border-bright shadow-[2px_2px_0px_0px_#1A1A1A]'}`}>
              {totalUnread}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 mt-1">
          <span className={`w-2 h-2 ${nc ? '' : 'border border-nc-border-bright'} ${wsConnected ? (nc ? 'bg-nc-green shadow-nc-green' : 'bg-nc-green') : (nc ? 'bg-nc-red shadow-nc-red' : 'bg-nc-red')}`} />
          <span className="text-xs text-nc-muted truncate">{currentUser}</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto py-2 space-y-1 scrollbar-thin">
        <div>
          <SectionHeader
            title="Channels"
            count={channels.reduce((sum, c) => sum + (unreadCounts[c.name] || 0), 0)}
            collapsed={channelsCollapsed}
            onToggle={() => setChannelsCollapsed(!channelsCollapsed)}
            onAdd={isGuest ? undefined : () => setShowCreateChannel(!showCreateChannel)}
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

          {!channelsCollapsed && channels.map(ch => {
            const unread = unreadCounts[ch.name] || 0;
            const isActive = activeChannelName === ch.name;
            return (
              <button
                key={ch.id}
                onClick={() => selectChannel(ch.name)}
                className={`
                  w-full flex items-center gap-2 px-3 py-1.5 text-left transition-all duration-75 group
                  ${isActive
                    ? (nc
                        ? 'bg-nc-cyan/10 border-l-2 border-nc-cyan text-nc-cyan font-bold'
                        : wapo
                          ? 'bg-[#f7f0e6] text-[#7c2430] font-semibold border-l-2 border-[#7c2430]'
                          : 'bg-nc-yellow text-nc-text-bright font-bold border-2 border-nc-border-bright shadow-[2px_2px_0px_0px_#1A1A1A] mx-1')
                    : unread > 0
                      ? (nc ? 'font-semibold text-nc-text-bright hover:bg-nc-elevated' : wapo ? 'font-semibold text-nc-text-bright hover:bg-[#f7f0e6]' : 'font-semibold text-nc-text-bright hover:bg-nc-elevated')
                      : (nc ? 'text-nc-muted hover:bg-nc-elevated hover:text-nc-text' : wapo ? 'text-nc-muted hover:bg-[#f7f0e6] hover:text-nc-text-bright' : 'text-nc-muted hover:bg-nc-elevated hover:text-nc-text-bright')
                  }
                `}
              >
                <Hash size={14} className="flex-shrink-0" />
                <span className="truncate text-sm">{ch.name}</span>
                {unread > 0 && !isActive && (
                  <span className="ml-auto bg-nc-red/20 text-nc-red text-2xs font-black px-1.5 py-0.5 border border-nc-red/40 min-w-[20px] text-center">
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
                onClick={() => selectChannel(agent.name, true)}
                className={`
                  w-full flex items-center gap-2 px-3 py-1.5 text-left transition-all duration-75 group
                  ${isActive
                    ? (nc
                        ? 'bg-nc-green/10 border-l-2 border-nc-green text-nc-green font-bold'
                        : wapo
                          ? 'bg-[#f7f0e6] text-[#7c2430] font-semibold border-l-2 border-[#7c2430]'
                          : 'bg-nc-yellow text-nc-text-bright font-bold border-2 border-nc-border-bright shadow-[2px_2px_0px_0px_#1A1A1A] mx-1')
                    : unread > 0
                      ? (wapo ? 'font-semibold text-nc-text-bright hover:bg-[#f7f0e6]' : 'font-semibold text-nc-text-bright hover:bg-nc-elevated')
                      : (wapo ? 'text-nc-muted hover:bg-[#f7f0e6] hover:text-nc-text-bright' : 'text-nc-muted hover:bg-nc-elevated hover:text-nc-text')
                  }
                `}
              >
                <Bot size={14} className="flex-shrink-0" />
                <span className="truncate text-sm">{agent.displayName || agent.name}</span>
                <div className="ml-auto flex items-center gap-1.5">
                  {agent.status === 'active' && !isGuest && (
                    <span
                      role="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        wsSend({ type: 'agent:reset-workspace', agentId: agent.id });
                        addToast(`Resetting ${agent.name}...`, 'info');
                      }}
                      className="opacity-0 group-hover:opacity-100 w-5 h-5 flex items-center justify-center text-nc-muted hover:text-nc-yellow transition-all"
                      title="Reset context"
                    >
                      <RotateCcw size={12} />
                    </span>
                  )}
                  <span className={`w-2 h-2 flex-shrink-0 ${activityColors[agent.activity || 'offline']}`} />
                  {unread > 0 && !isActive && (
                    <span className="bg-nc-red/20 text-nc-red text-2xs font-black px-1.5 py-0.5 border border-nc-red/40 min-w-[20px] text-center">
                      {unread}
                    </span>
                  )}
                </div>
              </button>
            );
          })}
          {!agentsCollapsed && agents.length === 0 && (
            <div className="px-3 py-1.5 text-xs text-nc-muted italic font-mono">No agents</div>
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
              onClick={() => selectChannel(h.name, true)}
              className={`
                w-full flex items-center gap-2 px-3 py-1.5 text-left transition-all duration-100
                ${activeChannelName === h.name
                  ? 'bg-nc-magenta/10 border-l-2 border-nc-magenta text-nc-magenta font-bold'
                  : 'text-nc-muted hover:bg-nc-elevated hover:text-nc-text'
                }
              `}
            >
              <User size={14} className="flex-shrink-0" />
              <span className="truncate text-sm">{h.name}</span>
              {(unreadCounts[h.name] || 0) > 0 && activeChannelName !== h.name && (
                <span className="ml-auto bg-nc-red/20 text-nc-red text-2xs font-black px-1.5 py-0.5 border border-nc-red/40 min-w-[20px] text-center">
                  {unreadCounts[h.name]}
                </span>
              )}
            </button>
          ))}
          {!dmsCollapsed && humans.length === 0 && (
            <div className="px-3 py-1.5 text-xs text-nc-muted italic font-mono">No people online</div>
          )}
        </div>
      </div>
    </div>
  );
}
