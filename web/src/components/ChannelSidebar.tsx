/* ChannelSidebar — direct port of V1Sidebar from
   tmp/.../zouk-rethink/v1-conservative.jsx, wired to real workspace data.

   - Header: WORKSPACE eyebrow + Zouk display + N humans · N agents.
   - Search button (placeholder; ⌘K palette is a follow-up).
   - Sections: WORKSPACE (Home/Inbox/Tasks/Agents) / CHANNELS / DIRECT MESSAGES.
   - Channel rows show inline live-agent dots + ember unread pill.
   - Bottom: user card (avatar + name + online + settings). */

import { useMemo, useState } from 'react';
import {
  Plus, Hash, ChevronDown, ChevronRight,
  Settings, Trash2, RotateCcw, SlidersHorizontal,
  Home, Cpu, KanbanSquare, Brain,
} from 'lucide-react';
import { useApp } from '../store/AppContext';
import { isMobileViewport, isStandalonePWA } from '../lib/layout';
import { AgentAvatar, HumanAvatar } from './zk/primitives';
import type { ServerAgent, ServerChannel, ServerHuman } from '../types';
import {
  contextUsageTextTone,
  formatContextUsageCompact,
  formatContextUsageTitle,
  pickDisplayContextUsage,
} from '../lib/contextUsage';

/* ───── Section header ───── */

function SectionHeader({
  title, action, collapsed, onToggle,
}: {
  title: string;
  action?: React.ReactNode;
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="zk-row" style={{ padding: '6px 14px', justifyContent: 'space-between' }}>
      <button
        type="button"
        onClick={onToggle}
        className="zk-row"
        style={{
          background: 'none', border: 0, cursor: 'pointer',
          color: 'var(--zk-ink-mute)', fontFamily: 'var(--zk-font-mono)',
          fontSize: 10, letterSpacing: '0.18em', fontWeight: 500,
          padding: 0, gap: 4,
        }}
      >
        {collapsed ? <ChevronRight size={10} /> : <ChevronDown size={10} />}
        <span>{title}</span>
      </button>
      {action}
    </div>
  );
}

/* ───── Generic row ───── */

const rowStyle = (active: boolean): React.CSSProperties => ({
  position: 'relative',
  padding: '6px 14px',
  cursor: 'pointer',
  background: active ? 'var(--zk-bg-3)' : 'transparent',
  color: active ? 'var(--zk-ink)' : 'var(--zk-ink-dim)',
  fontSize: 13,
  lineHeight: 1.4,
  transition: 'background 140ms var(--zk-ease-out), color 140ms var(--zk-ease-out)',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  textAlign: 'left',
  width: '100%',
  border: 0,
  font: 'inherit',
  fontWeight: active ? 500 : 400,
});

function ActiveStripe() {
  return (
    <span
      aria-hidden="true"
      style={{
        position: 'absolute', left: 0, top: 6, bottom: 6,
        width: 2, background: 'var(--zk-ember)', borderRadius: '0 2px 2px 0',
      }}
    />
  );
}

/* ───── Channel row ───── */

function ChannelRow({
  channel, agents, active, unread, isGuest, forceShowActions,
  onClick, onConfigure, onDelete,
}: {
  channel: ServerChannel;
  agents: ServerAgent[];
  active: boolean;
  unread: number;
  isGuest: boolean;
  forceShowActions: boolean;
  onClick: () => void;
  onConfigure: () => void;
  onDelete?: () => void;
}) {
  const liveAgents = useMemo(
    () =>
      agents.filter(
        (a) =>
          (a.activity === 'working' || a.activity === 'thinking') &&
          (a.channels || []).includes(channel.name),
      ),
    [agents, channel.name],
  );

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
      style={{
        ...rowStyle(active),
        cursor: 'pointer',
      }}
      className="group"
      onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = 'var(--zk-bg-2)'; }}
      onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent'; }}
    >
      {active && <ActiveStripe />}
      <span
        aria-hidden="true"
        style={{
          color: 'var(--zk-ink-low)', fontFamily: 'var(--zk-font-mono)',
          width: 12, textAlign: 'center', flexShrink: 0,
        }}
      >
        #
      </span>
      <span className="zk-truncate" style={{ flex: 1, color: active ? 'var(--zk-ink)' : 'inherit' }}>
        {channel.name}
      </span>

      {/* Live agent activity dots — explicit inline-flex with line-height:0
          to defeat any baseline shift from `display: inline-block` on .zk-dot. */}
      {!active && liveAgents.length > 0 && (
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            marginRight: 6,
            lineHeight: 0,
            flexShrink: 0,
          }}
        >
          {liveAgents.slice(0, 3).map((a) => (
            <span
              key={a.id}
              className={`zk-dot zk-dot--${a.activity}`}
              style={{ display: 'block', width: 6, height: 6 }}
              title={`@${a.displayName || a.name} ${a.activity}`}
            />
          ))}
        </span>
      )}

      {/* Unread pill */}
      {unread > 0 && (
        <span
          style={{
            fontSize: 10, fontFamily: 'var(--zk-font-mono)',
            background: 'var(--zk-ember)', color: '#fff',
            padding: '1px 6px', borderRadius: 999, fontWeight: 600,
            boxShadow: '0 1px 2px rgba(0,0,0,0.25)',
          }}
        >
          {unread > 9 ? '9+' : unread}
        </span>
      )}

      {/* Hover actions (config / delete). The right-side area always reserves
          space for both buttons so the activity dots above stay horizontally
          aligned across rows — even on `all` (which has no delete). */}
      {!isGuest && (
        <span
          className={`zk-row ${forceShowActions ? '' : 'opacity-0 group-hover:opacity-100'}`}
          style={{ gap: 2, transition: 'opacity 140ms var(--zk-ease-out)' }}
        >
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onConfigure(); }}
            className="zk-btn zk-btn--ghost zk-btn--icon"
            title={`Configure #${channel.name}`}
            style={{ padding: 2 }}
          >
            <Settings size={11} />
          </button>
          {onDelete ? (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onDelete(); }}
              className="zk-btn zk-btn--ghost zk-btn--icon"
              title="Delete channel"
              style={{ padding: 2 }}
            >
              <Trash2 size={11} />
            </button>
          ) : (
            // Visibility-hidden clone of the trash button — guarantees the
            // actions area is the same width as channels that *do* have a
            // delete button, so the activity dots stay horizontally aligned.
            <span
              aria-hidden="true"
              className="zk-btn zk-btn--ghost zk-btn--icon"
              style={{ padding: 2, visibility: 'hidden', pointerEvents: 'none' }}
            >
              <Trash2 size={11} />
            </span>
          )}
        </span>
      )}
    </div>
  );
}

/* ───── Agent row (DM target) ───── */

function AgentRow({
  agent, active, unread, isGuest, forceShowActions,
  onClick, onResetContext, onConfigure, onProfile,
}: {
  agent: ServerAgent;
  active: boolean;
  unread: number;
  isGuest: boolean;
  forceShowActions: boolean;
  onClick: () => void;
  onResetContext: () => void;
  onConfigure: () => void;
  onProfile: () => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
      style={rowStyle(active)}
      className="group"
      onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = 'var(--zk-bg-2)'; }}
      onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent'; }}
    >
      {active && <ActiveStripe />}
      <span
        role="button"
        tabIndex={0}
        onClick={(e) => { e.stopPropagation(); onProfile(); }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onProfile(); }
        }}
        title={`View @${agent.displayName || agent.name} profile`}
        style={{ cursor: 'pointer' }}
      >
        <AgentAvatar agent={agent} size="sm" hideDotWhen={['online']} />
      </span>
      <span className="zk-truncate" style={{ flex: 1 }}>
        {agent.displayName || agent.name}
      </span>

      {unread > 0 && (
        <span
          style={{
            fontSize: 10, fontFamily: 'var(--zk-font-mono)',
            background: 'var(--zk-ember)', color: '#fff',
            padding: '1px 6px', borderRadius: 999, fontWeight: 600,
          }}
        >
          {unread > 9 ? '9+' : unread}
        </span>
      )}

      {/* Context usage pill — phone view doesn't see NowRail, so the sidebar
          is now the only surface that signals "agent is close to reset". */}
      {(() => {
        const usage = pickDisplayContextUsage(agent.contextUsage, agent.model);
        const label = formatContextUsageCompact(usage);
        if (!label) return null;
        return (
          <span
            className="zk-tabular"
            title={formatContextUsageTitle(agent.contextUsage, agent.model)}
            style={{
              fontSize: 9,
              fontFamily: 'var(--zk-font-mono)',
              letterSpacing: '0.04em',
              color: 'var(--zk-ink-mute)',
              flexShrink: 0,
            }}
          >
            <span className={contextUsageTextTone(usage?.percent)}>{label}</span>
          </span>
        );
      })()}

      {!isGuest && agent.status === 'active' && (
        <span
          className={`zk-row ${forceShowActions ? '' : 'opacity-0 group-hover:opacity-100'}`}
          style={{ gap: 2, transition: 'opacity 140ms var(--zk-ease-out)' }}
        >
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onResetContext(); }}
            className="zk-btn zk-btn--ghost zk-btn--icon"
            title="Reset context"
            style={{ padding: 2 }}
          >
            <RotateCcw size={11} />
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onConfigure(); }}
            className="zk-btn zk-btn--ghost zk-btn--icon"
            title="Configure agent"
            style={{ padding: 2 }}
          >
            <SlidersHorizontal size={11} />
          </button>
        </span>
      )}
    </div>
  );
}

/* ───── Human (DM) row ───── */

function HumanRow({
  human, active, unread, isSelf, onClick,
}: {
  human: ServerHuman;
  active: boolean;
  unread: number;
  isSelf: boolean;
  onClick?: () => void;
}) {
  const Tag = isSelf ? 'div' : 'button';
  return (
    <Tag
      type={isSelf ? undefined : 'button'}
      onClick={isSelf ? undefined : onClick}
      style={{ ...rowStyle(active), cursor: isSelf ? 'default' : 'pointer' }}
      onMouseEnter={(e) => { if (!active && !isSelf) e.currentTarget.style.background = 'var(--zk-bg-2)'; }}
      onMouseLeave={(e) => { if (!active && !isSelf) e.currentTarget.style.background = 'transparent'; }}
    >
      {active && <ActiveStripe />}
      <HumanAvatar human={human} size="sm" />
      <span className="zk-truncate" style={{ flex: 1 }}>{human.name}</span>
      {isSelf && (
        <span style={{ fontSize: 10, color: 'var(--zk-ink-mute)', fontFamily: 'var(--zk-font-mono)' }}>
          (you)
        </span>
      )}
      {!isSelf && unread > 0 && (
        <span
          style={{
            fontSize: 10, fontFamily: 'var(--zk-font-mono)',
            background: 'var(--zk-ember)', color: '#fff',
            padding: '1px 6px', borderRadius: 999, fontWeight: 600,
          }}
        >
          {unread > 9 ? '9+' : unread}
        </span>
      )}
    </Tag>
  );
}

/* ───── Top-level component ───── */

export default function ChannelSidebar({ phoneModal = false }: { phoneModal?: boolean }) {
  const {
    channels, agents, humans, activeChannelName, selectChannel, viewMode,
    createChannel, deleteChannel, currentUser, unreadCounts, isGuest,
    authUser, setSidebarOpen,
    openAgentProfile, openAgentSettings, resetAgentContext,
    openChannelSettings, navigateToView, setSettingsOpen,
  } = useApp();

  const [channelsCollapsed, setChannelsCollapsed] = useState(false);
  const [dmsCollapsed, setDmsCollapsed] = useState(false);
  const [agentsCollapsed, setAgentsCollapsed] = useState(false);
  const [showCreateChannel, setShowCreateChannel] = useState(false);
  const [newChannelName, setNewChannelName] = useState('');

  const pick = (name: string, isDm?: boolean) => {
    selectChannel(name, isDm);
    if (isMobileViewport()) setSidebarOpen(false);
  };

  const peopleList = useMemo(() => {
    const list = humans.slice();
    if (currentUser && !list.some((h) => h.name === currentUser)) {
      list.push({
        id: `self:${currentUser}`,
        name: currentUser,
        picture: authUser?.picture ?? undefined,
        gravatarUrl: authUser?.gravatarUrl ?? undefined,
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

  const forceShowActions = isMobileViewport() || isStandalonePWA();
  const liveCount = agents.filter((a) => a.activity === 'working' || a.activity === 'thinking').length;
  const totalHumans = humans.length;

  // phoneModal mode: use flex:1 + min-h:0 (instead of height:100%) so the
  // shell sits as a flex child of the modal and the inner overflow:auto body
  // actually picks up touch scroll on iOS PWA. The previous height:100% +
  // flexShrink:0 collapsed the body's effective height so the channel list
  // appeared "un-scrollable".
  const shellStyle: React.CSSProperties = phoneModal
    ? { width: '100%', flex: '1 1 auto', minHeight: 0, display: 'flex', flexDirection: 'column' }
    : {
        width: 248, background: 'var(--zk-bg-1)',
        borderRight: '1px solid var(--zk-line)',
        display: 'flex', flexDirection: 'column', flexShrink: 0,
        height: '100%',
      };

  // Phone-modal workspace nav: single row of icon buttons that mirrors the
  // desktop WorkspaceRail (which is hidden on lg-). Keeps Agents / Tasks /
  // Memory reachable from the channel modal without exposing a
  // separate rail on mobile.
  const phoneNavItems: Array<{
    key: 'home' | 'agents' | 'tasks' | 'memory' | 'settings';
    label: string;
    icon: React.ReactNode;
    active: boolean;
  }> = [
    { key: 'home',   label: 'Home',   icon: <Home size={16} />,         active: viewMode === 'channel' || viewMode === 'dm' },
    { key: 'agents', label: 'Agents', icon: <Cpu size={16} />,          active: viewMode === 'agents' },
    { key: 'tasks',  label: 'Tasks',  icon: <KanbanSquare size={16} />, active: viewMode === 'tasks' },
    { key: 'memory', label: 'Memory', icon: <Brain size={16} />,        active: viewMode === 'memory' },
    { key: 'settings', label: 'Settings', icon: <Settings size={16} />, active: false },
  ];

  const handlePhoneNav = (key: 'home' | 'agents' | 'tasks' | 'memory' | 'settings') => {
    if (key === 'settings') {
      setSidebarOpen(false);
      setSettingsOpen(true);
      return;
    }
    if (key === 'home') navigateToView('channel');
    else navigateToView(key);
    setSidebarOpen(false);
  };

  return (
    // safe-top adds env(safe-area-inset-top) padding — useful for the desktop
    // sidebar (which extends to the device top edge) but wrong on the phone
    // modal which is centered in the viewport with its own padding. Skipping
    // safe-top on phoneModal removes the ~47px notch padding that was making
    // the modal top look way too tall.
    <aside style={shellStyle} className={phoneModal ? '' : 'safe-top'}>
      {/* Phone-modal workspace nav: row of view-switcher icons (Home/Agents/
          Tasks/Memory). Mirrors the desktop WorkspaceRail so a
          mobile user can leave Channels and reach the other top-level views
          without an external rail. */}
      {phoneModal && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            padding: '10px 12px',
            borderBottom: '1px solid var(--zk-line)',
            flexShrink: 0,
          }}
        >
          {phoneNavItems.map((it) => (
            <button
              key={it.key}
              type="button"
              onClick={() => handlePhoneNav(it.key)}
              aria-label={it.label}
              title={it.label}
              className={`zk-btn ${it.active ? 'zk-btn--primary' : 'zk-btn--ghost'} zk-btn--icon`}
              style={{ width: 32, height: 32 }}
            >
              {it.icon}
            </button>
          ))}
        </div>
      )}

      {/* Header */}
      {!phoneModal && (
        <div style={{ padding: '16px 16px 12px' }}>
          <div className="zk-eyebrow" style={{ fontSize: 9 }}>WORKSPACE</div>
          <div
            className="zk-display"
            style={{ fontWeight: 600, fontSize: 17, marginTop: 2, color: 'var(--zk-ink)' }}
          >
            Zouk
          </div>
          <div
            className="zk-row"
            style={{ gap: 6, marginTop: 4, fontSize: 10, color: 'var(--zk-ink-mute)', fontFamily: 'var(--zk-font-mono)' }}
          >
            <span
              className={`zk-dot ${liveCount > 0 ? 'zk-dot--working' : 'zk-dot--offline'}`}
              style={{ width: 5, height: 5 }}
            />
            <span>{totalHumans} humans · {agents.length} agents</span>
          </div>
        </div>
      )}

      {/* Body */}
      <div className="zk-scroll zk-grow" style={{ overflow: 'auto', padding: '4px 0' }}>
        {/* WORKSPACE nav was here — Home/Tasks/Agents/Memory all duplicate the
            WorkspaceRail icons on the left, so we keep the rail as the single
            source of truth and start the sidebar with the channel list. */}

        {/* CHANNELS */}
        <div style={{ marginTop: 10 }}>
          <SectionHeader
            title="CHANNELS"
            collapsed={channelsCollapsed}
            onToggle={() => setChannelsCollapsed(!channelsCollapsed)}
            action={
              isGuest ? null : (
                <button
                  type="button"
                  onClick={() => setShowCreateChannel((v) => !v)}
                  className="zk-btn zk-btn--ghost zk-btn--icon"
                  style={{ padding: 2 }}
                  title="Create channel"
                >
                  <Plus size={11} />
                </button>
              )
            }
          />

          {showCreateChannel && (
            <div style={{ padding: '4px 14px 6px' }}>
              <div
                className="zk-row"
                style={{
                  background: 'var(--zk-bg-2)',
                  border: '1px solid var(--zk-ember-line)',
                  borderRadius: 6,
                  padding: '4px 8px', gap: 6,
                }}
              >
                <Hash size={12} style={{ color: 'var(--zk-ember)' }} />
                <input
                  type="text"
                  autoFocus
                  value={newChannelName}
                  onChange={(e) => setNewChannelName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleCreateChannel();
                    if (e.key === 'Escape') setShowCreateChannel(false);
                  }}
                  placeholder="new-channel"
                  style={{
                    flex: 1, background: 'transparent', border: 0, outline: 'none',
                    color: 'var(--zk-ink)', fontSize: 12,
                    fontFamily: 'var(--zk-font-mono)',
                  }}
                />
              </div>
            </div>
          )}

          {!channelsCollapsed && channels.map((ch) => (
            <ChannelRow
              key={ch.id}
              channel={ch}
              agents={agents}
              active={activeChannelName === ch.name && (viewMode === 'channel' || viewMode === 'dm')}
              unread={unreadCounts[ch.name] || 0}
              isGuest={isGuest}
              forceShowActions={forceShowActions}
              onClick={() => pick(ch.name)}
              onConfigure={() => openChannelSettings(ch.id)}
              onDelete={ch.name !== 'all' ? () => {
                if (window.confirm(`Delete channel #${ch.name}?`)) deleteChannel(ch.id, ch.name);
              } : undefined}
            />
          ))}
        </div>

        {/* AGENTS as DM targets */}
        <div style={{ marginTop: 10 }}>
          <SectionHeader
            title="AGENTS"
            collapsed={agentsCollapsed}
            onToggle={() => setAgentsCollapsed(!agentsCollapsed)}
          />
          {!agentsCollapsed && agents.length === 0 && (
            <div
              style={{
                padding: '6px 14px', fontSize: 11,
                color: 'var(--zk-ink-low)', fontFamily: 'var(--zk-font-mono)',
                fontStyle: 'italic',
              }}
            >
              No agents
            </div>
          )}
          {!agentsCollapsed && agents.map((a) => (
            <AgentRow
              key={a.id}
              agent={a}
              active={activeChannelName === a.name && viewMode === 'dm'}
              unread={unreadCounts[a.name] || 0}
              isGuest={isGuest}
              forceShowActions={forceShowActions}
              onClick={() => pick(a.name, true)}
              onResetContext={() => resetAgentContext(a.id)}
              onConfigure={() => openAgentSettings(a.id)}
              onProfile={() => openAgentProfile(a.id)}
            />
          ))}
        </div>

        {/* PEOPLE / DMs */}
        <div style={{ marginTop: 10 }}>
          <SectionHeader
            title="DIRECT MESSAGES"
            collapsed={dmsCollapsed}
            onToggle={() => setDmsCollapsed(!dmsCollapsed)}
          />
          {!dmsCollapsed && peopleList.map((h) => {
            const isSelf = h.name === currentUser;
            return (
              <HumanRow
                key={h.id}
                human={h}
                active={!isSelf && activeChannelName === h.name && viewMode === 'dm'}
                unread={unreadCounts[h.name] || 0}
                isSelf={isSelf}
                onClick={() => pick(h.name, true)}
              />
            );
          })}
          {!dmsCollapsed && peopleList.length === 0 && (
            <div
              style={{
                padding: '6px 14px', fontSize: 11,
                color: 'var(--zk-ink-low)', fontFamily: 'var(--zk-font-mono)',
                fontStyle: 'italic',
              }}
            >
              No people online
            </div>
          )}
        </div>
      </div>

    </aside>
  );
}
