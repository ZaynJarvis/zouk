import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  X, Activity, Settings as SettingsIcon,
  Brain, ChevronRight, File, Folder, FolderOpen as FolderOpenIcon,
  RefreshCw,
} from 'lucide-react';
import { useApp } from '../store/AppContext';
import type { ServerAgent, MemoryEntry } from '../types';
import { activityLabels } from '../lib/activityStatus';
import { ncStyle } from '../lib/themeUtils';
import { formatRuntime } from '../lib/runtimeLabels';
import { agentAvatarStatus, agentLifecycle, avatarPaletteClass, avatarRadiusClass } from '../lib/avatarStatus';
import { fetchAgentOvStatus } from '../lib/api';
import { AgentActivityFeed } from './agent/AgentActivityFeed';
import AgentConfigForm from './agent/AgentConfigForm';
import { SafePreviewContent } from './memory/renderPreviewContent';
import { WorkspaceTree } from './workspace/WorkspaceTree';
import { useWorkspaceTree } from './workspace/useWorkspaceTree';
import '../styles/atlas-renderers.css';

type Tab = 'profile' | 'workspace' | 'config';

const TAB_CONFIG: { key: Tab | 'mem_nav'; label: string; icon: typeof Activity }[] = [
  { key: 'profile', label: 'Activity', icon: Activity },
  { key: 'mem_nav', label: 'Memory', icon: Brain },
  { key: 'config', label: 'Config', icon: SettingsIcon },
];

function ProfileTab({ agent }: { agent: ServerAgent }) {
  const { machines, selectChannel, loadAgentActivities, theme } = useApp();
  const machine = agent.machineId ? machines.find((m) => m.id === agent.machineId) : null;
  const activity = agent.activity || 'offline';
  const avatarStatus = agentAvatarStatus(agent);
  const isActive = agent.status === 'active';
  const entries = agent.entries || [];

  useEffect(() => {
    loadAgentActivities(agent.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent.id]);

  const runtimeLabel = formatRuntime(agent.runtime) || 'Unknown';
  const machineLabel = machine?.alias || machine?.hostname;

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="shrink-0 overflow-y-auto scrollbar-thin px-4 pt-3 pb-2 space-y-3 max-h-[55%]">
        <div className="flex items-start gap-3">
          <button
            type="button"
            onClick={() => selectChannel(agent.name, true)}
            title={`Message @${agent.displayName || agent.name}`}
            className="relative w-12 h-12 shrink-0 p-0 border-0 bg-transparent cursor-pointer text-inherit"
          >
            <div className={`w-full h-full border flex items-center justify-center overflow-hidden font-display font-bold text-base ${avatarPaletteClass(avatarStatus, 'cyan', agentLifecycle(agent))} ${avatarRadiusClass(theme)}`}>
              {agent.picture ? (
                <img src={agent.picture} alt="" className="w-full h-full object-cover" />
              ) : (
                (agent.displayName || agent.name).charAt(0).toUpperCase()
              )}
            </div>
            <span
              style={{
                position: 'absolute', right: -1, bottom: -1,
                width: 8, height: 8,
                border: '2px solid var(--zk-bg-1)',
                borderRadius: '50%',
                boxSizing: 'content-box',
              }}
              className={`zk-dot zk-dot--${avatarStatus}`}
            />
          </button>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
              <div className="zk-display" style={{ fontSize: 15, color: 'var(--zk-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                @{agent.displayName || agent.name}
              </div>
              <span className="zk-pill zk-pill--ok" style={{ flexShrink: 0 }}>Agent</span>
            </div>
            <div className="zk-mono" style={{ fontSize: 10, color: 'var(--zk-ink-mute)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {isActive ? activityLabels[activity] : 'Inactive'}
              {agent.activityDetail && isActive ? ` · ${agent.activityDetail}` : ''}
            </div>
          </div>
        </div>

        {agent.description && (
          <p style={{ fontSize: 12, color: 'var(--zk-ink-dim)', fontFamily: 'var(--zk-font-sans)', lineHeight: 1.5, margin: 0 }}>{agent.description}</p>
        )}

        <div className="zk-mono" style={{ fontSize: 10, color: 'var(--zk-ink-mute)', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0 6px' }}>
          <span style={{ color: 'var(--zk-ink)' }}>{runtimeLabel}</span>
          {agent.model && (
            <>
              <span>·</span>
              <span style={{ color: 'var(--zk-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{agent.model}</span>
            </>
          )}
          {machineLabel && (
            <>
              <span>·</span>
              <span style={{ color: 'var(--zk-ok)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>@{machineLabel}</span>
            </>
          )}
        </div>

        {((agent.channels && agent.channels.length > 0) || (agent.skills && agent.skills.length > 0)) && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {agent.channels?.map((ch) => (
              <span key={`c-${ch}`} className="zk-pill zk-pill--ember">#{ch}</span>
            ))}
            {agent.skills?.map((s) => (
              <span key={`s-${s.id}`} className="zk-pill zk-pill--warn" title={s.description || s.name}>{s.name}</span>
            ))}
          </div>
        )}

        {agent.workDir && (
          <div className="zk-mono" style={{ fontSize: 10, color: 'var(--zk-ok)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={agent.workDir}>
            {agent.workDir}
          </div>
        )}
      </div>

      <div style={{ flexShrink: 0, borderTop: '1px solid var(--zk-line)', padding: '6px 16px', display: 'flex', alignItems: 'center', gap: 6 }}>
        <Activity size={11} style={{ color: 'var(--zk-ok)' }} />
        <span style={{ fontSize: 10, fontWeight: 600, fontFamily: 'var(--zk-font-mono)', color: 'var(--zk-ink-mute)', letterSpacing: '0.02em' }}>Activity</span>
      </div>

      {/* Activity feed reaches the bottom of the full-screen panel on phone
          PWA. safe-bottom-fill lets entries bleed under the iOS home indicator
          while keeping the last row reachable above it once scrolled to end. */}
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin safe-bottom-fill">
        {entries.length === 0 ? (
          <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '32px 16px' }}>
            <Activity size={20} style={{ color: 'var(--zk-ink-low)', marginBottom: 8 }} />
            <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--zk-ink-mute)', fontFamily: 'var(--zk-font-sans)', margin: 0 }}>No activity</p>
            <p style={{ fontSize: 11, color: 'var(--zk-ink-low)', fontFamily: 'var(--zk-font-sans)', margin: '4px 0 0' }}>Activity will appear here when the agent starts working.</p>
          </div>
        ) : (
          <AgentActivityFeed entries={entries} className="p-3 space-y-1" />
        )}
      </div>
    </div>
  );
}

function uriName(uri: string): string {
  const parts = uri.replace(/\/+$/, '').split('/').filter(Boolean);
  return parts.length > 1 ? parts[parts.length - 1] : parts[0] || uri;
}

function OvTreeNode({
  entry, level, expandedDirs, treeCache, onToggleDir, onViewFile,
}: {
  entry: MemoryEntry; level: number; expandedDirs: Set<string>;
  treeCache: Record<string, MemoryEntry[]>;
  onToggleDir: (uri: string) => void; onViewFile: (uri: string) => void;
}) {
  const { uri, isDir } = entry;
  const isExpanded = isDir && expandedDirs.has(uri);
  const children = isDir ? treeCache[uri] : undefined;
  const name = uriName(uri);

  return (
    <>
      <button
        onClick={() => isDir ? onToggleDir(uri) : onViewFile(uri)}
        className="w-full flex items-start gap-1.5 py-1 text-left hover:bg-nc-elevated transition-colors"
        style={{ paddingLeft: `${12 + level * 16}px`, paddingRight: '12px' }}
      >
        {isDir ? (
          <ChevronRight size={12} className={`flex-shrink-0 text-nc-muted transition-transform duration-150 mt-0.5 ${isExpanded ? 'rotate-90' : ''}`} />
        ) : <span className="w-3 flex-shrink-0" />}
        {isDir
          ? (isExpanded ? <FolderOpenIcon size={12} className="flex-shrink-0 text-nc-cyan mt-0.5" /> : <Folder size={12} className="flex-shrink-0 text-nc-cyan mt-0.5" />)
          : <File size={12} className="flex-shrink-0 text-nc-muted mt-0.5" />}
        <div className="flex-1 min-w-0">
          <span className="text-xs font-mono text-nc-text truncate block">{name}</span>
          {!isDir && entry.abstract && (
            <span className="text-2xs text-nc-muted font-mono truncate block leading-tight">{entry.abstract}</span>
          )}
        </div>
      </button>
      {isDir && isExpanded && (
        <div>
          {children ? (
            children.length > 0 ? children.map((child) => (
              <OvTreeNode key={child.uri} entry={child} level={level + 1} expandedDirs={expandedDirs} treeCache={treeCache} onToggleDir={onToggleDir} onViewFile={onViewFile} />
            )) : (
              <div className="text-2xs text-nc-muted font-mono py-1" style={{ paddingLeft: `${12 + (level + 1) * 16}px` }}>(empty)</div>
            )
          ) : (
            <div className="text-2xs text-nc-muted font-mono py-1 animate-pulse" style={{ paddingLeft: `${12 + (level + 1) * 16}px` }}>loading...</div>
          )}
        </div>
      )}
    </>
  );
}

function OvSection({ agent, onViewFile }: { agent: ServerAgent; onViewFile: (uri: string) => void }) {
  const { activeWorkspaceId, memoryTreeCache, memoryTreeErrors, requestMemoryList } = useApp();
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [ovUser, setOvUser] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setChecked(false);
    setOvUser(null);
    setStatusError(null);
    fetchAgentOvStatus(agent.id)
      .then(data => {
        if (cancelled) return;
        setOvUser(data.enabled ? (data.user || agent.name) : null);
        setChecked(true);
      })
      .catch((e) => {
        if (cancelled) return;
        setStatusError(e instanceof Error ? e.message : 'Failed to load OV status');
        setChecked(true);
      });
    return () => { cancelled = true; };
  }, [activeWorkspaceId, agent.id, agent.name]);

  const rootUri = ovUser ? `viking://user/${ovUser}/` : null;
  const agentCache = useMemo(() => memoryTreeCache[agent.id] || {}, [memoryTreeCache, agent.id]);
  const agentErrors = useMemo(() => memoryTreeErrors[agent.id] || {}, [memoryTreeErrors, agent.id]);
  const rootLoaded = !!rootUri && Object.prototype.hasOwnProperty.call(agentCache, rootUri);
  const rootError = rootUri ? (agentErrors[rootUri] || null) : null;
  const rootErrorText = rootError && rootError.length > 160 ? `${rootError.slice(0, 157)}...` : rootError;
  const statusErrorText = statusError && statusError.length > 160 ? `${statusError.slice(0, 157)}...` : statusError;
  const rootEntries = useMemo(() => (rootUri ? agentCache[rootUri] || [] : []), [agentCache, rootUri]);

  useEffect(() => {
    if (rootUri && !rootLoaded && !rootError) {
      requestMemoryList(agent.id, rootUri);
    }
  }, [agent.id, rootUri, rootLoaded, rootError, requestMemoryList]);

  const handleToggleDir = useCallback((uri: string) => {
    setExpandedDirs(prev => {
      const next = new Set(prev);
      if (next.has(uri)) { next.delete(uri); } else {
        next.add(uri);
        if (!agentCache[uri]) requestMemoryList(agent.id, uri);
      }
      return next;
    });
  }, [agent.id, agentCache, requestMemoryList]);

  if (!checked) return null;

  if (!ovUser) {
    if (!statusErrorText) return null;
    return (
      <div className="border-t border-nc-border">
        <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-nc-border bg-nc-elevated/30">
          <Brain size={11} className="text-nc-cyan flex-shrink-0" />
          <span className="text-2xs font-bold text-nc-cyan font-mono tracking-wider">OV MEMORY</span>
        </div>
        <div className="text-2xs text-nc-red font-mono py-2 px-3 break-words">{statusErrorText}</div>
      </div>
    );
  }

  return (
    <div className="border-t border-nc-border">
      <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-nc-border bg-nc-elevated/30">
        <Brain size={11} className="text-nc-cyan flex-shrink-0" />
        <span className="text-2xs font-bold text-nc-cyan font-mono tracking-wider">OV MEMORY</span>
        <span className="text-2xs text-nc-muted font-mono">· {ovUser}</span>
      </div>
      <div className="py-0.5">
        {rootErrorText ? (
          <div className="flex items-start gap-2 py-2 px-3">
            <div className="min-w-0 flex-1 text-2xs text-nc-red font-mono break-words">{rootErrorText}</div>
            <button
              type="button"
              onClick={() => { if (rootUri) requestMemoryList(agent.id, rootUri); }}
              className="shrink-0 w-5 h-5 flex items-center justify-center border border-nc-border text-nc-muted hover:text-nc-cyan hover:border-nc-cyan"
              title="Retry OV memory list"
            >
              <RefreshCw size={11} />
            </button>
          </div>
        ) : !rootLoaded ? (
          <div className="text-2xs text-nc-muted font-mono py-2 px-3 animate-pulse">Loading OV data...</div>
        ) : rootEntries.length > 0 ? rootEntries.map((entry) => (
          <OvTreeNode key={entry.uri} entry={entry} level={0} expandedDirs={expandedDirs} treeCache={agentCache} onToggleDir={handleToggleDir} onViewFile={onViewFile} />
        )) : (
          <div className="text-2xs text-nc-muted font-mono py-2 px-3">No OV memories</div>
        )}
      </div>
    </div>
  );
}

function WorkspaceTab({ agent }: { agent: ServerAgent }) {
  const { workspaceFileContent, requestFileContent, memoryContentCache, requestMemoryContent } = useApp();
  const [viewingFile, setViewingFile] = useState<string | null>(null);
  const [viewingOvUri, setViewingOvUri] = useState<string | null>(null);
  const { expandedDirs, rootFiles, toggleDir, treeCache } = useWorkspaceTree(agent);

  const fileContent = viewingFile && workspaceFileContent?.agentId === agent.id && workspaceFileContent?.path === viewingFile
    ? workspaceFileContent.content
    : null;

  const ovContent = viewingOvUri
    ? (memoryContentCache[agent.id]?.[viewingOvUri]?.l2
        ?? memoryContentCache[agent.id]?.[viewingOvUri]?.__legacy__
        ?? null)
    : null;

  const previewContent = viewingOvUri ? ovContent : fileContent;
  const previewName = viewingOvUri ? uriName(viewingOvUri) : (viewingFile?.split('/').pop() || viewingFile);
  const previewTitle = viewingOvUri || viewingFile;
  const hasPreview = !!(viewingFile || viewingOvUri);

  const handleViewFile = useCallback((filePath: string) => {
    setViewingFile(filePath);
    setViewingOvUri(null);
    requestFileContent(agent.id, filePath);
  }, [agent.id, requestFileContent]);

  const handleViewOvFile = useCallback((uri: string) => {
    setViewingOvUri(uri);
    setViewingFile(null);
    requestMemoryContent(agent.id, uri, 'l2');
  }, [agent.id, requestMemoryContent]);

  const handleClosePreview = useCallback(() => {
    setViewingFile(null);
    setViewingOvUri(null);
  }, []);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div
        className="flex flex-col min-h-0"
        style={hasPreview ? { maxHeight: '50%', flex: '1 1 0%' } : { flex: '1 1 0%' }}
      >
        {agent.status === 'active' && (
          <div className="px-3 py-1.5 border-b border-nc-border">
            <span className="text-xs font-mono text-nc-muted truncate block">{agent.workDir || '/'}</span>
          </div>
        )}
        <div className="flex-1 overflow-y-auto scrollbar-thin safe-bottom-fill">
          {agent.status === 'active' && rootFiles.length > 0 ? (
            <div className="py-0.5">
              <WorkspaceTree
                files={rootFiles}
                treeCache={treeCache}
                expandedDirs={expandedDirs}
                onToggleDir={toggleDir}
                onFileSelect={handleViewFile}
                variant="compact"
                expandMode="static"
              />
            </div>
          ) : agent.status === 'active' ? (
            <div className="flex flex-col items-center justify-center text-center py-6">
              <FolderOpenIcon size={20} className="text-nc-muted mb-2" />
              <p className="text-xs text-nc-muted font-mono">No workspace files</p>
            </div>
          ) : null}
          <OvSection agent={agent} onViewFile={handleViewOvFile} />
        </div>
      </div>
      {hasPreview && (
        <div className="flex-1 flex flex-col min-h-0 border-t border-nc-border">
          <div className="flex items-center gap-2 px-3 py-1.5 border-b border-nc-border bg-nc-elevated/50">
            {viewingOvUri && <Brain size={11} className="text-nc-cyan flex-shrink-0" />}
            <span className="flex-1 text-xs font-mono text-nc-text truncate" title={previewTitle || ''}>
              {previewName}
            </span>
            <button
              onClick={handleClosePreview}
              className="w-5 h-5 flex items-center justify-center text-nc-muted hover:text-nc-red transition-colors"
              title="Close preview"
            >
              <X size={12} />
            </button>
          </div>
          <div
            className="flex-1 overflow-auto scrollbar-thin bg-nc-black/50 safe-bottom-fill"
            style={ncStyle({ textShadow: '0 0 4px rgb(var(--nc-green) / 0.3)' })}
          >
            {previewContent === null ? (
              <div className="p-3 text-xs font-mono text-nc-muted animate-pulse">Loading...</div>
            ) : (
              <SafePreviewContent text={previewContent} fileName={previewTitle || previewName || 'memory'} className="p-3" />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ConfigTab({ agent }: { agent: ServerAgent }) {
  const { machines, stopAgent, deleteAgent, closeAgentProfileRail, setAgentProfileId } = useApp();

  const handleDelete = async () => {
    const label = agent.displayName || agent.name;
    if (!window.confirm(`Delete agent ${label}? This removes the saved config and disconnects the running agent.`)) return;
    await deleteAgent(agent.id);
    setAgentProfileId(null);
    closeAgentProfileRail();
  };

  return (
    <AgentConfigForm
      agent={agent}
      machines={machines}
      onStop={() => stopAgent(agent.id)}
      onDelete={handleDelete}
      compact
    />
  );
}

/**
 * Renders the agent profile (PROFILE / MEM / CONFIG tabs) for the right rail or the
 * mobile full-screen right panel.
 *
 * - `inline` (default false): used inside `RightRail` on desktop. The rail
 *   owns the outer width + slide animation, so the panel drops its own
 *   `w-screen lg:w-[30vw]` wrapper and entry animation.
 * - `inline=false`: legacy full-panel render path, still used on mobile via
 *   `rightPanel='agent_profile'`.
 *
 * Both modes call `closeAgentProfileRail` from X. On desktop that just
 * clears `agentProfileId`, returning the rail to LIVE mode and leaving any
 * other right panel (thread, workspace, settings) untouched. On mobile it
 * also clears `rightPanel='agent_profile'` so the modal unmounts.
 */
export default function AgentProfilePanel({ inline = false }: { inline?: boolean }) {
  const { agents, configs, closeAgentProfileRail, agentProfileId, agentProfileTab, setAgentProfileTab, navigateToView, setMemoryFocusAgentId } = useApp();
  const tab = agentProfileTab as Tab;
  const setTab = (next: Tab) => setAgentProfileTab(next);

  const liveAgent = agents.find((a) => a.id === agentProfileId);
  const config = configs.find((c) => c.id === agentProfileId);

  const agent: ServerAgent | null = useMemo(() => (
    liveAgent || (config?.id ? {
      id: config.id,
      name: config.name,
      displayName: config.displayName,
      description: config.description,
      runtime: config.runtime ?? 'claude',
      model: config.model,
      picture: config.picture,
      visibility: config.visibility,
      maxConcurrentTasks: config.maxConcurrentTasks,
      autoStart: config.autoStart,
      instructions: config.instructions,
      skills: config.skills,
      lifecycle: config.lifecycle,
      envVars: config.envVars,
      workDir: config.workDir,
      ovEnabled: config.ovEnabled,
      ovEnabledIsDefault: config.ovEnabledIsDefault,
      ovDefault: config.ovDefault,
      openvikingProvisioned: config.openvikingProvisioned,
      openvikingMode: config.openvikingMode,
      openvikingCustomConfigured: config.openvikingCustomConfigured,
      status: 'inactive',
      activity: 'offline',
    } : null)
  ), [liveAgent, config]);

  useEffect(() => {
    if (agentProfileId && !agent) closeAgentProfileRail();
  }, [agentProfileId, agent, closeAgentProfileRail]);

  const outerClass = inline
    ? 'w-full h-full flex flex-col'
    : 'w-screen lg:w-[30vw] lg:min-w-[340px] lg:max-w-[520px] h-full flex flex-col animate-slide-in-right';

  if (!agent) {
    return null;
  }

  return (
    <div
      className={outerClass}
      style={{ background: 'var(--zk-bg-0)', borderLeft: '1px solid var(--zk-line)' }}
    >
      {/* Single header row: PROFILE / MEM / CONFIG tabs + close button share the
          row to save vertical space; tab height drives the close-button
          height so they align. safe-area-inset-top padding keeps the row
          below the iOS notch on phone PWA where this panel covers the full
          viewport without a parent TopBar. */}
      <div
        style={{
          borderBottom: '1px solid var(--zk-line)',
          display: 'flex', alignItems: 'stretch', flexShrink: 0,
          paddingTop: 'env(safe-area-inset-top, 0px)',
        }}
      >
        <div className="flex-1" />
        {TAB_CONFIG.map(({ key, label, icon: Icon }) => {
          const isMemNav = key === 'mem_nav';
          const active = !isMemNav && tab === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => {
                if (isMemNav) {
                  if (agent) setMemoryFocusAgentId(agent.id);
                  navigateToView('memory');
                  closeAgentProfileRail();
                } else {
                  setTab(key as Tab);
                }
              }}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '10px 12px', fontSize: 11, fontWeight: 600,
                fontFamily: 'var(--zk-font-mono)', letterSpacing: '0.02em',
                borderBottom: '2px solid', marginBottom: -1,
                borderColor: active ? 'var(--zk-ember)' : 'transparent',
                color: active ? 'var(--zk-ink)' : isMemNav ? 'var(--zk-ink-mute)' : 'var(--zk-ink-mute)',
                background: 'transparent', border: 'none',
                borderBottomWidth: 2, borderBottomStyle: 'solid',
                borderBottomColor: active ? 'var(--zk-ember)' : 'transparent',
                cursor: 'pointer',
                transition: 'color 160ms, border-color 160ms',
              }}
              onMouseEnter={(e) => { if (!active) e.currentTarget.style.color = 'var(--zk-ink)'; }}
              onMouseLeave={(e) => { if (!active) e.currentTarget.style.color = 'var(--zk-ink-mute)'; }}
            >
              <Icon size={12} />
              {label}
              {isMemNav && <span style={{ fontSize: 9, opacity: 0.5 }}>↗</span>}
            </button>
          );
        })}
        <button
          onClick={closeAgentProfileRail}
          className="zk-btn zk-btn--ghost zk-btn--icon"
          style={{ flexShrink: 0, alignSelf: 'center', marginRight: 8 }}
          title="Close"
        >
          <X size={16} />
        </button>
      </div>

      <div className="flex-1 min-h-0 flex flex-col">
        {tab === 'profile' && <ProfileTab agent={agent} />}
        {tab === 'workspace' && <WorkspaceTab agent={agent} />}
        {tab === 'config' && <ConfigTab key={agent.id} agent={agent} />}
      </div>
    </div>
  );
}
