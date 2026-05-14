/* WorkspaceRail — left icon nav.
   Direct port of Rail() in tmp/.../zouk-rethink/merged-app.jsx, wired to our
   real viewMode + rightPanel state and the actual user / live agent counts. */

import { Check, Cpu, Home, KanbanSquare, Brain, Plus, Settings } from 'lucide-react';
import { useApp } from '../store/AppContext';
import { Avatar } from './zk/primitives';

interface RailItem {
  id: 'home' | 'agents' | 'tasks' | 'memory';
  icon: React.ReactNode;
  label: string;
  sub: string;
}

// Files are now a "source" toggle inside the Memory view (Memory · Files);
// they share the Miller Columns / Tree UI, so we don't carry a separate
// rail entry for them.
const ITEMS: RailItem[] = [
  { id: 'home',    icon: <Home size={16} />,         label: 'Home',    sub: 'Channels' },
  { id: 'agents',  icon: <Cpu size={16} />,          label: 'Agents',  sub: 'Operators' },
  { id: 'tasks',   icon: <KanbanSquare size={16} />, label: 'Tasks',   sub: 'Kanban' },
  { id: 'memory',  icon: <Brain size={16} />,        label: 'Memory',  sub: 'OV · Files' },
];

export default function WorkspaceRail() {
  const {
    viewMode, navigateToView, setSettingsOpen,
    agents, currentUser, authUser, isGuest,
    workspaces, activeWorkspaceId, setActiveWorkspaceId, createWorkspace,
    workspaceMenuOpen, setWorkspaceMenuOpen,
  } = useApp();
  const activeWorkspace = workspaces.find(w => w.id === activeWorkspaceId) || workspaces[0] || { id: 'default', name: 'Default', icon: 'z' };

  const isActive = (id: RailItem['id']): boolean => {
    switch (id) {
      case 'home': return viewMode === 'channel' || viewMode === 'dm';
      case 'agents': return viewMode === 'agents';
      case 'tasks': return viewMode === 'tasks';
      case 'memory': return viewMode === 'memory';
    }
  };

  const handleClick = (id: RailItem['id']) => {
    switch (id) {
      case 'home': navigateToView('channel'); break;
      case 'agents': navigateToView('agents'); break;
      case 'tasks': navigateToView('tasks'); break;
      case 'memory': navigateToView('memory'); break;
    }
  };

  const liveCount = agents.filter(
    (a) => a.activity === 'working' || a.activity === 'thinking',
  ).length;

  const handleCreateWorkspace = async () => {
    const name = window.prompt('Server name');
    if (!name?.trim()) return;
    const icon = window.prompt('Icon', name.trim().slice(0, 1).toUpperCase()) || undefined;
    try {
      await createWorkspace({ name: name.trim(), icon: icon?.trim() || undefined });
      setWorkspaceMenuOpen(false);
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <nav
      aria-label="Workspace"
      className="safe-top"
      style={{
        width: 56,
        height: '100%',
        background: 'var(--zk-bg-0)',
        borderRight: '1px solid var(--zk-line)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '14px 0 12px',
        gap: 4,
        position: 'relative',
        flexShrink: 0,
      }}
    >
      <div style={{ position: 'relative', marginBottom: 14 }}>
        <button
          type="button"
          onClick={() => setWorkspaceMenuOpen(v => !v)}
          aria-label="Switch server"
          title={activeWorkspace.name}
          style={{
            width: 32,
            height: 32,
            background: 'linear-gradient(135deg, var(--zk-ember) 0%, #c4623d 100%)',
            borderRadius: 8,
            border: '1px solid rgba(255,255,255,0.14)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: 'var(--zk-font-display)',
            fontWeight: 600,
            color: '#fff',
            fontSize: 15,
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.18), 0 1px 2px rgba(0,0,0,0.3)',
            cursor: 'pointer',
          }}
        >
          {activeWorkspace.icon || activeWorkspace.name.slice(0, 1).toUpperCase()}
        </button>
        {workspaceMenuOpen && (
          <div
            style={{
              position: 'absolute',
              left: 42,
              top: 0,
              width: 224,
              background: 'var(--zk-bg-1)',
              border: '1px solid var(--zk-line)',
              boxShadow: '0 16px 36px rgba(0,0,0,0.26)',
              borderRadius: 8,
              padding: 6,
              zIndex: 40,
            }}
          >
            {workspaces.map((workspace) => (
              <button
                key={workspace.id}
                type="button"
                onClick={() => {
                  setActiveWorkspaceId(workspace.id);
                  setWorkspaceMenuOpen(false);
                }}
                style={{
                  width: '100%',
                  height: 34,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '0 8px',
                  border: 0,
                  borderRadius: 6,
                  background: workspace.id === activeWorkspaceId ? 'var(--zk-bg-2)' : 'transparent',
                  color: 'var(--zk-ink)',
                  cursor: 'pointer',
                  textAlign: 'left',
                  font: 'inherit',
                }}
              >
                <span style={{
                  width: 22,
                  height: 22,
                  borderRadius: 6,
                  display: 'grid',
                  placeItems: 'center',
                  background: 'var(--zk-bg-0)',
                  border: '1px solid var(--zk-line)',
                  fontSize: 12,
                  fontWeight: 600,
                }}>{workspace.icon || workspace.name.slice(0, 1).toUpperCase()}</span>
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{workspace.name}</span>
                {workspace.id === activeWorkspaceId && <Check size={14} />}
              </button>
            ))}
            <button
              type="button"
              onClick={handleCreateWorkspace}
              style={{
                width: '100%',
                height: 34,
                marginTop: 4,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '0 8px',
                border: 0,
                borderTop: '1px solid var(--zk-line)',
                background: 'transparent',
                color: 'var(--zk-ink)',
                cursor: 'pointer',
                font: 'inherit',
              }}
            >
              <Plus size={14} />
              <span>New server</span>
            </button>
          </div>
        )}
      </div>

      {ITEMS.map((it) => {
        const active = isActive(it.id);
        return (
          <button
            key={it.id}
            type="button"
            onClick={() => handleClick(it.id)}
            aria-label={it.label}
            title={`${it.label} · ${it.sub}`}
            className={`zk-rail-btn ${active ? 'zk-rail-btn--active' : ''}`}
          >
            {it.icon}
          </button>
        );
      })}

      <span style={{ flex: 1 }} />

      {/* Live indicator (visible when at least one agent is active) */}
      {liveCount > 0 && (
        <div
          title={`${liveCount} agent${liveCount > 1 ? 's' : ''} live`}
          style={{
            width: 38,
            height: 24,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 3,
            color: 'var(--zk-ink-mute)',
            fontFamily: 'var(--zk-font-mono)',
            fontSize: 9,
            letterSpacing: '0.06em',
          }}
        >
          <span className="zk-dot zk-dot--working" style={{ animation: 'zkBlink 1.5s infinite' }} />
          <span className="zk-tabular">{liveCount}</span>
        </div>
      )}

      {/* Settings */}
      <button
        type="button"
        onClick={() => setSettingsOpen(true)}
        aria-label="Settings"
        title="Settings"
        className="zk-rail-btn"
      >
        <Settings size={16} />
      </button>

      {/* User avatar */}
      <button
        type="button"
        className="zk-rail-btn"
        style={{ marginTop: 2 }}
        aria-label="Profile"
        title={isGuest ? `${currentUser} (guest)` : currentUser}
      >
        <Avatar
          src={authUser?.picture}
          name={currentUser}
          size="sm"
          kind="human"
          online
        />
      </button>
    </nav>
  );
}
