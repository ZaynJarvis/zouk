import { useState } from 'react';
import { Hash, ChevronDown, ChevronRight, Plus, Bot, User, RotateCcw } from 'lucide-react';
import { useApp } from '../store/AppContext';

function SectionHeader({ title, count, collapsed, onToggle, onAdd }: {
  title: string; count?: number; collapsed: boolean; onToggle: () => void; onAdd?: () => void;
}) {
  return (
    <div className="flex items-center justify-between px-3 py-1.5 group">
      <button onClick={onToggle} className="flex items-center gap-1 text-2xs font-display font-bold uppercase tracking-widest text-cyber-chrome-400 hover:text-cyber-cyan transition-colors">
        {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
        <span>{title}</span>
        {count !== undefined && count > 0 && (
          <span className="ml-1 bg-cyber-magenta/15 text-cyber-magenta text-2xs font-bold px-1 border border-cyber-magenta/30">{count}</span>
        )}
      </button>
      {onAdd && (
        <button onClick={onAdd} className="opacity-0 group-hover:opacity-100 text-cyber-chrome-500 hover:text-cyber-cyan transition-all">
          <Plus size={14} />
        </button>
      )}
    </div>
  );
}

export default function ChannelSidebar() {
  const {
    channels, agents, humans, activeChannelName, selectChannel, viewMode,
    createChannel, currentUser, unreadCounts, wsConnected, wsSend, addToast,
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
    thinking: 'bg-cyber-yellow animate-pulse shadow-neon-yellow',
    working: 'bg-cyber-orange animate-pulse',
    online: 'bg-cyber-green shadow-neon-green',
    offline: 'bg-cyber-chrome-600',
    error: 'bg-cyber-red shadow-neon-red',
  };

  return (
    <div className="w-[260px] h-full bg-cyber-surface border-r border-cyber-border flex flex-col overflow-hidden">
      <div className="px-3 py-3 border-b border-cyber-border">
        <div className="flex items-center justify-between">
          <h2 className="font-display font-bold text-lg text-cyber-cyan tracking-wider">ZOUK</h2>
          {totalUnread > 0 && (
            <span className="bg-cyber-magenta/15 text-cyber-magenta text-2xs font-bold px-1.5 py-0.5 border border-cyber-magenta/40 shadow-neon-magenta">
              {totalUnread}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 mt-1">
          <span className={`w-2 h-2 rounded-full ${wsConnected ? 'bg-cyber-green shadow-neon-green' : 'bg-cyber-red'}`} />
          <span className="text-xs text-cyber-chrome-300 font-mono truncate">{currentUser}</span>
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
              <div className="flex items-center border border-cyber-border bg-cyber-void-mid">
                <Hash size={14} className="ml-2 text-cyber-chrome-500 flex-shrink-0" />
                <input
                  type="text"
                  value={newChannelName}
                  onChange={e => setNewChannelName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleCreateChannel(); if (e.key === 'Escape') setShowCreateChannel(false); }}
                  placeholder="new-channel"
                  className="w-full px-1.5 py-1 bg-transparent text-sm text-cyber-chrome-100 placeholder:text-cyber-chrome-500 focus:outline-none font-mono"
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
                  w-full flex items-center gap-2 px-3 py-1.5 text-left transition-all duration-150 group
                  ${isActive
                    ? 'bg-cyber-cyan/10 border-l-2 border-cyber-cyan text-cyber-cyan shadow-cyber-sm'
                    : unread > 0
                      ? 'font-semibold text-cyber-chrome-100 hover:bg-cyber-elevated border-l-2 border-transparent'
                      : 'text-cyber-chrome-400 hover:bg-cyber-elevated hover:text-cyber-chrome-200 border-l-2 border-transparent'
                  }
                `}
              >
                <Hash size={14} className="flex-shrink-0" />
                <span className="truncate text-sm">{ch.name}</span>
                {unread > 0 && !isActive && (
                  <span className="ml-auto bg-cyber-magenta/15 text-cyber-magenta text-2xs font-bold px-1.5 py-0.5 border border-cyber-magenta/30 min-w-[20px] text-center">
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
                  w-full flex items-center gap-2 px-3 py-1.5 text-left transition-all duration-150 group
                  ${isActive
                    ? 'bg-cyber-green/10 border-l-2 border-cyber-green text-cyber-green'
                    : unread > 0
                      ? 'font-semibold text-cyber-chrome-100 hover:bg-cyber-elevated border-l-2 border-transparent'
                      : 'text-cyber-chrome-400 hover:bg-cyber-elevated hover:text-cyber-chrome-200 border-l-2 border-transparent'
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
                      className="opacity-0 group-hover:opacity-100 w-5 h-5 flex items-center justify-center text-cyber-chrome-500 hover:text-cyber-orange transition-all"
                      title="Reset context"
                    >
                      <RotateCcw size={12} />
                    </span>
                  )}
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${activityColors[agent.activity || 'offline']}`} />
                  {unread > 0 && !isActive && (
                    <span className="bg-cyber-magenta/15 text-cyber-magenta text-2xs font-bold px-1.5 py-0.5 border border-cyber-magenta/30 min-w-[20px] text-center">
                      {unread}
                    </span>
                  )}
                </div>
              </button>
            );
          })}
          {!agentsCollapsed && agents.length === 0 && (
            <div className="px-3 py-1.5 text-xs text-cyber-chrome-500 italic font-mono">No agents</div>
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
                w-full flex items-center gap-2 px-3 py-1.5 text-left transition-all duration-150
                ${activeChannelName === h.name
                  ? 'bg-cyber-magenta/10 border-l-2 border-cyber-magenta text-cyber-magenta'
                  : 'text-cyber-chrome-400 hover:bg-cyber-elevated hover:text-cyber-chrome-200 border-l-2 border-transparent'
                }
              `}
            >
              <User size={14} className="flex-shrink-0" />
              <span className="truncate text-sm">{h.name}</span>
              {(unreadCounts[h.name] || 0) > 0 && activeChannelName !== h.name && (
                <span className="ml-auto bg-cyber-magenta/15 text-cyber-magenta text-2xs font-bold px-1.5 py-0.5 border border-cyber-magenta/30 min-w-[20px] text-center">
                  {unreadCounts[h.name]}
                </span>
              )}
            </button>
          ))}
          {!dmsCollapsed && humans.length === 0 && (
            <div className="px-3 py-1.5 text-xs text-cyber-chrome-500 italic font-mono">No people online</div>
          )}
        </div>
      </div>
    </div>
  );
}
