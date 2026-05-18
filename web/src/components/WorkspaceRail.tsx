/* WorkspaceRail — left icon nav.
   Direct port of Rail() in tmp/.../zouk-rethink/merged-app.jsx, wired to our
   real viewMode + rightPanel state and the actual user / live agent counts. */

import { useEffect, useRef, useState } from 'react';
import { Check, Cpu, Home, KanbanSquare, Brain, ImagePlus, Plus, Settings, Trash2 } from 'lucide-react';
import { useApp } from '../store/AppContext';
import { Avatar } from './zk/primitives';
import { resizeAndEncode } from '../lib/imageEncode';
import type { Workspace } from '../types';
import { agentIsLive } from '../lib/avatarStatus';

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

function isImageIcon(icon?: string | null): icon is string {
  return !!icon && icon.startsWith('data:image/');
}

function WorkspaceIcon({
  workspace, size,
}: {
  workspace: Pick<Workspace, 'name' | 'icon'>;
  size: number;
}) {
  const icon = workspace.icon || workspace.name.slice(0, 1).toUpperCase();
  if (isImageIcon(icon)) {
    return <img src={icon} alt="" style={{ width: size, height: size, objectFit: 'cover', display: 'block' }} />;
  }
  return <>{icon || workspace.name.slice(0, 1).toUpperCase()}</>;
}

export default function WorkspaceRail() {
  const {
    viewMode, navigateToView, setSettingsOpen, addToast,
    agents, currentUser, authUser, isGuest,
    workspaces, activeWorkspaceId, setActiveWorkspaceId, createWorkspace, updateWorkspace, deleteWorkspace,
    canRootWorkspace,
    workspaceMenuOpen, setWorkspaceMenuOpen,
  } = useApp();
  const [avatarBusy, setAvatarBusy] = useState(false);
  const workspaceMenuRef = useRef<HTMLDivElement>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const activeWorkspace = workspaces.find(w => w.id === activeWorkspaceId) || workspaces[0] || { id: 'default', name: 'Default', icon: 'z' };
  const activeWorkspaceIconIsImage = isImageIcon(activeWorkspace.icon);

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

  const liveCount = agents.filter(agentIsLive).length;

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

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      addToast('Choose an image file', 'error');
      return;
    }
    setAvatarBusy(true);
    try {
      const icon = await resizeAndEncode(file, 64, 9000);
      await updateWorkspace(activeWorkspace.id, { icon });
      addToast('Server avatar updated', 'success');
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to update server avatar', 'error');
    } finally {
      setAvatarBusy(false);
    }
  };

  const handleDeleteWorkspace = async () => {
    if (activeWorkspace.id === 'default') return;
    const confirmed = window.confirm(`Delete server "${activeWorkspace.name}"? This removes its channels, tasks, agents, machines, and access list.`);
    if (!confirmed) return;
    try {
      await deleteWorkspace(activeWorkspace.id);
      setWorkspaceMenuOpen(false);
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to delete server', 'error');
    }
  };

  useEffect(() => {
    if (!workspaceMenuOpen) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && workspaceMenuRef.current?.contains(target)) return;
      setWorkspaceMenuOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer);
  }, [setWorkspaceMenuOpen, workspaceMenuOpen]);

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
      <div ref={workspaceMenuRef} style={{ position: 'relative', marginBottom: 14 }}>
        <button
          type="button"
          onClick={() => setWorkspaceMenuOpen(v => !v)}
          aria-label="Switch server"
          title={activeWorkspace.name}
          style={{
            width: 32,
            height: 32,
            background: activeWorkspaceIconIsImage ? 'transparent' : 'linear-gradient(135deg, var(--zk-ember) 0%, #c4623d 100%)',
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
            overflow: 'hidden',
          }}
        >
          <WorkspaceIcon workspace={activeWorkspace} size={32} />
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
            <div
              style={{
                padding: '2px 2px 6px',
                marginBottom: 4,
                borderBottom: '1px solid var(--zk-line)',
              }}
            >
              <button
                type="button"
                onClick={() => avatarInputRef.current?.click()}
                disabled={avatarBusy}
                title="Upload server avatar"
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '4px 6px',
                  border: 0,
                  borderRadius: 6,
                  background: 'transparent',
                  color: 'var(--zk-ink)',
                  cursor: avatarBusy ? 'wait' : 'pointer',
                  font: 'inherit',
                  textAlign: 'left',
                }}
              >
                <span
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 8,
                    overflow: 'hidden',
                    display: 'grid',
                    placeItems: 'center',
                    background: 'var(--zk-bg-0)',
                    border: '1px solid var(--zk-line)',
                    fontSize: 13,
                    fontWeight: 600,
                  }}
                >
                  <WorkspaceIcon workspace={activeWorkspace} size={34} />
                </span>
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {activeWorkspace.name}
                </span>
                <ImagePlus size={14} />
              </button>
              <input
                ref={avatarInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleAvatarUpload}
              />
            </div>
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
                  overflow: 'hidden',
                  display: 'grid',
                  placeItems: 'center',
                  background: 'var(--zk-bg-0)',
                  border: '1px solid var(--zk-line)',
                  fontSize: 12,
                  fontWeight: 600,
                }}><WorkspaceIcon workspace={workspace} size={22} /></span>
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
            {canRootWorkspace && activeWorkspace.id !== 'default' && (
              <button
                type="button"
                onClick={handleDeleteWorkspace}
                title="Delete server"
                style={{
                  width: '100%',
                  height: 34,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '0 8px',
                  border: 0,
                  background: 'transparent',
                  color: 'rgb(var(--nc-red))',
                  cursor: 'pointer',
                  font: 'inherit',
                }}
              >
                <Trash2 size={14} />
                <span>Delete server</span>
              </button>
            )}
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
