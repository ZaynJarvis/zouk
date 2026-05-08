/* WorkspaceRail — left icon nav.
   Direct port of Rail() in tmp/.../zouk-rethink/merged-app.jsx, wired to our
   real viewMode + rightPanel state and the actual user / live agent counts. */

import { Home, Cpu, KanbanSquare, Brain, Settings } from 'lucide-react';
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
  } = useApp();

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
      {/* Logo — ember gradient square */}
      <div
        aria-hidden="true"
        style={{
          width: 32,
          height: 32,
          background: 'linear-gradient(135deg, var(--zk-ember) 0%, #c4623d 100%)',
          borderRadius: 8,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'var(--zk-font-display)',
          fontWeight: 600,
          color: '#fff',
          fontSize: 15,
          marginBottom: 14,
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.18), 0 1px 2px rgba(0,0,0,0.3)',
        }}
      >
        z
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
