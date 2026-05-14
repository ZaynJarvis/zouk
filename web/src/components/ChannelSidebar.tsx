/* ChannelSidebar — direct port of V1Sidebar from
   tmp/.../zouk-rethink/v1-conservative.jsx, wired to real workspace data.

   - Header: WORKSPACE eyebrow + Zouk display + N humans · N agents.
   - Search button (placeholder; ⌘K palette is a follow-up).
   - Sections: WORKSPACE (Home/Inbox/Tasks/Agents) / CHANNELS / PEOPLE.
   - Channel rows show inline live-agent dots + ember unread pill.
   - PEOPLE lists workspace_members (admins flagged) + online guests; admins
     can invite by email or change/remove roles inline.
   - Bottom: user card (avatar + name + online + settings). */

import { useMemo, useState } from 'react';
import {
  Plus, Hash, ChevronDown, ChevronRight,
  Settings, Trash2, RotateCcw, SlidersHorizontal,
  Home, Cpu, KanbanSquare, Brain, UserPlus, MoreHorizontal,
} from 'lucide-react';
import { useApp } from '../store/AppContext';
import { isMobileViewport, isStandalonePWA } from '../lib/layout';
import { AgentAvatar, HumanAvatar } from './zk/primitives';
import ViewHeader from './ViewHeader';
import type { ServerAgent, ServerChannel, ServerHuman, WorkspaceRole } from '../types';
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
  channel, agents, agentLastChannel, active, unread, isGuest, forceShowActions,
  onClick, onConfigure, onDelete,
}: {
  channel: ServerChannel;
  agents: ServerAgent[];
  agentLastChannel: Record<string, { channel: string; ts: string }>;
  active: boolean;
  unread: number;
  isGuest: boolean;
  forceShowActions: boolean;
  onClick: () => void;
  onConfigure: () => void;
  onDelete?: () => void;
}) {
  // Status dots only follow the channel where the agent most recently
  // participated, instead of every channel they have membership in. An agent
  // working in multiple channels at once is the documented edge case we skip
  // for now.
  const liveAgents = useMemo(
    () =>
      agents.filter(
        (a) =>
          (a.activity === 'working' || a.activity === 'thinking') &&
          agentLastChannel[a.name]?.channel === channel.name,
      ),
    [agents, agentLastChannel, channel.name],
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

/* ───── Person row ─────
   Backs the PEOPLE section. Renders both workspace_members (with a role)
   and online presences that aren't members yet (guests on the default
   workspace, freshly-connected accounts). Admins see a tiny action menu
   on hover; root members are protected from accidental removal. */

type PersonRow = {
  key: string;
  email: string | null;
  name: string;
  role: WorkspaceRole | null;
  online: boolean;
  guest: boolean;
  picture?: string;
  gravatarUrl?: string;
};

const ELEVATED_ROLES: WorkspaceRole[] = ['root', 'owner', 'admin'];
function roleBadgeLabel(role: WorkspaceRole | null): string | null {
  if (!role) return null;
  if (!ELEVATED_ROLES.includes(role)) return null;
  if (role === 'admin') return 'ADMIN';
  if (role === 'owner') return 'OWNER';
  return 'ROOT';
}

function HumanRow({
  person, active, unread, isSelf, canAdmin, forceShowActions,
  onClick, onChangeRole, onRemove,
}: {
  person: PersonRow;
  active: boolean;
  unread: number;
  isSelf: boolean;
  canAdmin: boolean;
  forceShowActions: boolean;
  onClick?: () => void;
  onChangeRole?: (role: WorkspaceRole) => void;
  onRemove?: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const Tag = isSelf ? 'div' : 'button';
  const badge = roleBadgeLabel(person.role);
  // Adapt the row into the ServerHuman shape HumanAvatar already understands.
  const avatarHuman: ServerHuman = {
    id: person.key,
    name: person.name,
    picture: person.picture,
    gravatarUrl: person.gravatarUrl,
    guest: person.guest,
    online: person.online,
  };
  // Only admins can manage *other* members. Root is protected: visible but
  // shown without a destructive action so the workspace can't be left rootless
  // from this surface. Removing root goes through Workspace Settings (future).
  const showActions = canAdmin && !isSelf && person.role !== 'root' && person.email;

  return (
    <Tag
      type={isSelf ? undefined : 'button'}
      onClick={isSelf ? undefined : onClick}
      style={{ ...rowStyle(active), cursor: isSelf ? 'default' : 'pointer' }}
      className="group"
      onMouseEnter={(e) => { if (!active && !isSelf) e.currentTarget.style.background = 'var(--zk-bg-2)'; }}
      onMouseLeave={(e) => { if (!active && !isSelf) e.currentTarget.style.background = 'transparent'; }}
    >
      {active && <ActiveStripe />}
      <HumanAvatar human={avatarHuman} size="sm" />
      <span className="zk-truncate" style={{ flex: 1 }}>{person.name}</span>

      {badge && (
        <span
          title={person.role || ''}
          style={{
            fontSize: 9, fontFamily: 'var(--zk-font-mono)',
            letterSpacing: '0.08em', color: 'var(--zk-ink-mute)',
            border: '1px solid var(--zk-line)', borderRadius: 4,
            padding: '0 4px', lineHeight: '14px', flexShrink: 0,
          }}
        >
          {badge}
        </span>
      )}

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

      {showActions && (
        <span
          className={`zk-row ${forceShowActions || menuOpen ? '' : 'opacity-0 group-hover:opacity-100'}`}
          style={{ gap: 2, transition: 'opacity 140ms var(--zk-ease-out)', position: 'relative' }}
        >
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v); }}
            className="zk-btn zk-btn--ghost zk-btn--icon"
            title="Manage member"
            style={{ padding: 2 }}
          >
            <MoreHorizontal size={11} />
          </button>
          {menuOpen && (
            <div
              role="menu"
              onClick={(e) => e.stopPropagation()}
              style={{
                position: 'absolute', right: 0, top: 22, zIndex: 5,
                background: 'var(--zk-bg-1)', border: '1px solid var(--zk-line)',
                borderRadius: 6, padding: 4, minWidth: 140,
                boxShadow: '0 4px 16px rgba(0,0,0,0.25)',
                display: 'flex', flexDirection: 'column', gap: 2,
              }}
            >
              {(['admin', 'member'] as WorkspaceRole[]).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => { setMenuOpen(false); onChangeRole?.(r); }}
                  disabled={person.role === r}
                  style={{
                    textAlign: 'left', padding: '4px 8px', borderRadius: 4,
                    border: 0, background: 'transparent', cursor: person.role === r ? 'default' : 'pointer',
                    color: person.role === r ? 'var(--zk-ink-low)' : 'var(--zk-ink)',
                    fontSize: 12, fontFamily: 'var(--zk-font-mono)',
                  }}
                  onMouseEnter={(e) => { if (person.role !== r) e.currentTarget.style.background = 'var(--zk-bg-2)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                >
                  {person.role === r ? '✓ ' : '  '}set as {r}
                </button>
              ))}
              <div style={{ height: 1, background: 'var(--zk-line)', margin: '2px 0' }} />
              <button
                type="button"
                onClick={() => { setMenuOpen(false); onRemove?.(); }}
                style={{
                  textAlign: 'left', padding: '4px 8px', borderRadius: 4,
                  border: 0, background: 'transparent', cursor: 'pointer',
                  color: 'var(--zk-ember)', fontSize: 12, fontFamily: 'var(--zk-font-mono)',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--zk-bg-2)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
              >
                Remove from workspace
              </button>
            </div>
          )}
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
    authUser, setSidebarOpen, agentLastChannel,
    openAgentProfile, openAgentSettings, resetAgentContext,
    openChannelSettings, navigateToView, setSettingsOpen,
    workspaceMembers, canAdminWorkspace,
    inviteWorkspaceMember, updateWorkspaceMemberRole, removeWorkspaceMember,
  } = useApp();

  const [channelsCollapsed, setChannelsCollapsed] = useState(false);
  const [dmsCollapsed, setDmsCollapsed] = useState(false);
  const [agentsCollapsed, setAgentsCollapsed] = useState(false);
  const [showCreateChannel, setShowCreateChannel] = useState(false);
  const [newChannelName, setNewChannelName] = useState('');
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'admin' | 'member'>('member');
  const [inviteSubmitting, setInviteSubmitting] = useState(false);

  const pick = (name: string, isDm?: boolean) => {
    selectChannel(name, isDm);
    if (isMobileViewport()) setSidebarOpen(false);
  };

  // PEOPLE list: workspace_members ∪ online presences not yet captured as
  // members (guests on default; freshly-connected accounts). Members give us
  // role + email (canonical identity); humans give us live picture / online
  // signal keyed by display name.
  const peopleList = useMemo<PersonRow[]>(() => {
    const byName = new Map<string, PersonRow>();

    for (const m of workspaceMembers) {
      const displayName = (m.name && m.name.trim()) || m.email.split('@')[0];
      const presence = humans.find((h) => h.name === displayName);
      byName.set(displayName, {
        key: `member:${m.email}`,
        email: m.email,
        name: displayName,
        role: m.role,
        online: !!presence?.online,
        guest: false,
        picture: presence?.picture,
        gravatarUrl: presence?.gravatarUrl,
      });
    }

    for (const h of humans) {
      if (byName.has(h.name)) continue;
      // Skip currentUser; we re-add below with authUser context.
      if (h.name === currentUser) continue;
      byName.set(h.name, {
        key: `human:${h.id}`,
        email: null,
        name: h.name,
        role: null,
        online: !!h.online,
        guest: !!h.guest,
        picture: h.picture,
        gravatarUrl: h.gravatarUrl,
      });
    }

    if (currentUser && !byName.has(currentUser)) {
      byName.set(currentUser, {
        key: 'self',
        email: authUser?.email ?? null,
        name: currentUser,
        role: null,
        online: true,
        guest: isGuest,
        picture: authUser?.picture ?? undefined,
        gravatarUrl: authUser?.gravatarUrl ?? undefined,
      });
    }

    const list = [...byName.values()];
    list.sort((a, b) => {
      if (a.name === currentUser) return -1;
      if (b.name === currentUser) return 1;
      if (a.online !== b.online) return a.online ? -1 : 1;
      const rankA = a.role && ELEVATED_ROLES.includes(a.role) ? 0 : 1;
      const rankB = b.role && ELEVATED_ROLES.includes(b.role) ? 0 : 1;
      if (rankA !== rankB) return rankA - rankB;
      return a.name.localeCompare(b.name);
    });
    return list;
  }, [workspaceMembers, humans, currentUser, authUser, isGuest]);

  const handleCreateChannel = () => {
    const name = newChannelName.trim().replace(/[^a-z0-9-_]/gi, '-').toLowerCase();
    if (!name) return;
    createChannel(name);
    setNewChannelName('');
    setShowCreateChannel(false);
  };

  const handleInviteSubmit = async () => {
    const email = inviteEmail.trim().toLowerCase();
    if (!email || inviteSubmitting) return;
    setInviteSubmitting(true);
    try {
      await inviteWorkspaceMember({ email, role: inviteRole });
      setInviteEmail('');
      setShowInvite(false);
    } catch {
      // Toast already surfaced by store; keep form open so user can adjust.
    } finally {
      setInviteSubmitting(false);
    }
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
        <ViewHeader
          variant="sidebar"
          title="Zouk"
          meta={
            <span className="zk-row" style={{ gap: 6, alignItems: 'center' }}>
              <span
                className={`zk-dot ${liveCount > 0 ? 'zk-dot--working' : 'zk-dot--offline'}`}
                style={{ width: 5, height: 5 }}
              />
              <span>{totalHumans} humans · {agents.length} agents</span>
            </span>
          }
        />
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
              agentLastChannel={agentLastChannel}
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

        {/* PEOPLE */}
        <div style={{ marginTop: 10 }}>
          <SectionHeader
            title="PEOPLE"
            collapsed={dmsCollapsed}
            onToggle={() => setDmsCollapsed(!dmsCollapsed)}
            action={
              canAdminWorkspace ? (
                <button
                  type="button"
                  onClick={() => setShowInvite((v) => !v)}
                  className="zk-btn zk-btn--ghost zk-btn--icon"
                  style={{ padding: 2 }}
                  title="Invite member by email"
                >
                  <UserPlus size={11} />
                </button>
              ) : null
            }
          />

          {showInvite && canAdminWorkspace && (
            <div style={{ padding: '4px 14px 6px', display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div
                className="zk-row"
                style={{
                  background: 'var(--zk-bg-2)',
                  border: '1px solid var(--zk-ember-line)',
                  borderRadius: 6,
                  padding: '4px 8px', gap: 6,
                }}
              >
                <UserPlus size={12} style={{ color: 'var(--zk-ember)' }} />
                <input
                  type="email"
                  autoFocus
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleInviteSubmit();
                    if (e.key === 'Escape') { setShowInvite(false); setInviteEmail(''); }
                  }}
                  placeholder="user@example.com"
                  disabled={inviteSubmitting}
                  style={{
                    flex: 1, background: 'transparent', border: 0, outline: 'none',
                    color: 'var(--zk-ink)', fontSize: 12,
                    fontFamily: 'var(--zk-font-mono)',
                  }}
                />
              </div>
              <div className="zk-row" style={{ gap: 4, padding: '0 2px' }}>
                {(['member', 'admin'] as const).map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setInviteRole(r)}
                    disabled={inviteSubmitting}
                    style={{
                      flex: 1, padding: '3px 6px', border: '1px solid var(--zk-line)',
                      borderRadius: 4,
                      background: inviteRole === r ? 'var(--zk-bg-3)' : 'transparent',
                      color: inviteRole === r ? 'var(--zk-ink)' : 'var(--zk-ink-mute)',
                      fontSize: 10, fontFamily: 'var(--zk-font-mono)',
                      letterSpacing: '0.08em', cursor: 'pointer',
                    }}
                  >
                    {r.toUpperCase()}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={handleInviteSubmit}
                  disabled={inviteSubmitting || !inviteEmail.trim()}
                  className="zk-btn zk-btn--primary"
                  style={{ padding: '3px 10px', fontSize: 10, fontFamily: 'var(--zk-font-mono)', letterSpacing: '0.08em' }}
                >
                  {inviteSubmitting ? '...' : 'INVITE'}
                </button>
              </div>
            </div>
          )}

          {!dmsCollapsed && peopleList.map((p) => {
            const isSelf = p.name === currentUser;
            return (
              <HumanRow
                key={p.key}
                person={p}
                active={!isSelf && activeChannelName === p.name && viewMode === 'dm'}
                unread={unreadCounts[p.name] || 0}
                isSelf={isSelf}
                canAdmin={!!canAdminWorkspace}
                forceShowActions={forceShowActions}
                onClick={() => pick(p.name, true)}
                onChangeRole={p.email ? (role) => updateWorkspaceMemberRole(p.email!, role) : undefined}
                onRemove={p.email ? () => {
                  if (window.confirm(`Remove ${p.email} from this workspace?`)) {
                    removeWorkspaceMember(p.email!);
                  }
                } : undefined}
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
              No people yet
            </div>
          )}
        </div>
      </div>

    </aside>
  );
}
