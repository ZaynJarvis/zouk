import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  X, User as UserIcon, Activity, FolderOpen, Settings as SettingsIcon, MessageCircle,
  Brain, ChevronRight, File, Folder, FolderOpen as FolderOpenIcon,
} from 'lucide-react';
import { useApp } from '../store/AppContext';
import type { ServerAgent, MemoryEntry } from '../types';
import { activityLabels } from '../lib/activityStatus';
import { ncStyle } from '../lib/themeUtils';
import { formatRuntime } from '../lib/runtimeLabels';
import { agentAvatarStatus, agentLifecycle, avatarPaletteClass, avatarRadiusClass } from '../lib/avatarStatus';
import { AgentActivityFeed } from './agent/AgentActivityFeed';
import { WorkspaceTree } from './workspace/WorkspaceTree';
import { useWorkspaceTree } from './workspace/useWorkspaceTree';

type Tab = 'profile' | 'workspace';

const TAB_CONFIG: { key: Tab; label: string; icon: typeof Activity }[] = [
  { key: 'profile', label: 'PROFILE', icon: UserIcon },
  { key: 'workspace', label: 'FILES', icon: FolderOpen },
];

function ProfileTab({ agent }: { agent: ServerAgent }) {
  const { machines, openAgentSettings, selectChannel, loadAgentActivities, theme } = useApp();
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
          <div className="relative w-12 h-12 shrink-0">
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
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 min-w-0">
              <div className="font-display font-black text-base text-nc-text-bright truncate tracking-wider">
                @{agent.displayName || agent.name}
              </div>
              <span className="text-2xs bg-nc-green/10 text-nc-green border border-nc-green/30 px-1.5 py-0.5 font-bold uppercase font-mono leading-none shrink-0">
                Agent
              </span>
            </div>
            <div className="text-2xs text-nc-muted font-mono mt-0.5 truncate">
              {isActive ? activityLabels[activity] : 'INACTIVE'}
              {agent.activityDetail && isActive ? ` · ${agent.activityDetail}` : ''}
            </div>
          </div>
          <div className="flex gap-1 shrink-0">
            <button
              onClick={() => selectChannel(agent.name, true)}
              title="Message"
              className="cyber-btn w-7 h-7 flex items-center justify-center border border-nc-cyan bg-nc-cyan/10 text-nc-cyan hover:bg-nc-cyan/20"
            >
              <MessageCircle size={13} />
            </button>
            <button
              onClick={() => openAgentSettings(agent.id)}
              title="Config"
              className="cyber-btn w-7 h-7 flex items-center justify-center border border-nc-border bg-nc-panel text-nc-muted hover:text-nc-cyan hover:border-nc-cyan"
            >
              <SettingsIcon size={13} />
            </button>
          </div>
        </div>

        {agent.description && (
          <p className="text-xs text-nc-text leading-relaxed">{agent.description}</p>
        )}

        <div className="text-2xs font-mono text-nc-muted flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
          <span className="text-nc-text-bright">{runtimeLabel}</span>
          {agent.model && (
            <>
              <span>·</span>
              <span className="text-nc-text-bright truncate">{agent.model}</span>
            </>
          )}
          {machineLabel && (
            <>
              <span>·</span>
              <span className="text-nc-green truncate">@{machineLabel}</span>
            </>
          )}
        </div>

        {((agent.channels && agent.channels.length > 0) || (agent.skills && agent.skills.length > 0)) && (
          <div className="flex flex-wrap gap-1">
            {agent.channels?.map((ch) => (
              <span key={`c-${ch}`} className="px-1.5 py-0.5 border border-nc-cyan/30 bg-nc-cyan/10 text-2xs font-bold text-nc-cyan font-mono">
                #{ch}
              </span>
            ))}
            {agent.skills?.map((s) => (
              <span
                key={`s-${s.id}`}
                title={s.description || s.name}
                className="px-1.5 py-0.5 border border-nc-yellow/30 bg-nc-yellow/10 text-2xs font-bold text-nc-yellow font-mono"
              >
                {s.name}
              </span>
            ))}
          </div>
        )}

        {agent.workDir && (
          <div className="text-2xs font-mono text-nc-green truncate" title={agent.workDir}>
            {agent.workDir}
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-nc-border px-4 py-1.5 flex items-center gap-1.5">
        <Activity size={11} className="text-nc-green" />
        <span className="text-2xs font-bold text-nc-muted font-mono tracking-wider">ACTIVITY</span>
      </div>

      {/* Activity feed reaches the bottom of the full-screen panel on phone
          PWA. safe-bottom-fill lets entries bleed under the iOS home indicator
          while keeping the last row reachable above it once scrolled to end. */}
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin safe-bottom-fill">
        {entries.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center py-8 px-4">
            <Activity size={20} className="text-nc-muted mb-2" />
            <p className="text-xs text-nc-muted font-bold font-mono">NO_ACTIVITY</p>
            <p className="text-2xs text-nc-muted mt-1 font-mono">Activity will appear here when the agent starts working.</p>
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
  const { memoryTreeCache, requestMemoryList } = useApp();
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [ovUser, setOvUser] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    fetch(`/api/agents/${agent.id}/ov/status`)
      .then(r => r.json())
      .then(data => { setOvUser(data.enabled ? (data.user || agent.name) : null); setChecked(true); })
      .catch(() => setChecked(true));
  }, [agent.id, agent.name]);

  const rootUri = ovUser ? `viking://user/${ovUser}/` : null;
  const agentCache = useMemo(() => memoryTreeCache[agent.id] || {}, [memoryTreeCache, agent.id]);
  const rootEntries = useMemo(() => (rootUri ? agentCache[rootUri] || [] : []), [agentCache, rootUri]);

  useEffect(() => {
    if (rootUri && rootEntries.length === 0) {
      requestMemoryList(agent.id, rootUri);
    }
  }, [agent.id, rootUri, rootEntries.length, requestMemoryList]);

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

  if (!checked || !ovUser) return null;

  return (
    <div className="border-t border-nc-border">
      <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-nc-border bg-nc-elevated/30">
        <Brain size={11} className="text-nc-cyan flex-shrink-0" />
        <span className="text-2xs font-bold text-nc-cyan font-mono tracking-wider">OV MEMORY</span>
        <span className="text-2xs text-nc-muted font-mono">· {ovUser}</span>
      </div>
      <div className="py-0.5">
        {rootEntries.length > 0 ? rootEntries.map((entry) => (
          <OvTreeNode key={entry.uri} entry={entry} level={0} expandedDirs={expandedDirs} treeCache={agentCache} onToggleDir={handleToggleDir} onViewFile={onViewFile} />
        )) : (
          <div className="text-2xs text-nc-muted font-mono py-2 px-3 animate-pulse">Loading OV data...</div>
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
              <FolderOpen size={20} className="text-nc-muted mb-2" />
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
          <pre
            className="flex-1 overflow-auto p-3 text-xs font-mono text-nc-green whitespace-pre-wrap scrollbar-thin bg-nc-black/50 safe-bottom-fill"
            style={ncStyle({ textShadow: '0 0 4px rgb(var(--nc-green) / 0.3)' })}
          >
            {previewContent ?? 'Loading...'}
          </pre>
        </div>
      )}
    </div>
  );
}

export default function AgentProfilePanel() {
  const { agents, configs, closeRightPanel, agentProfileId } = useApp();
  const [tab, setTab] = useState<Tab>('profile');

  const liveAgent = agents.find((a) => a.id === agentProfileId);
  const config = configs.find((c) => c.id === agentProfileId);

  const agent: ServerAgent | null = liveAgent || (config?.id ? {
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
    workDir: config.workDir,
    status: 'inactive',
    activity: 'offline',
  } : null);

  if (!agent) {
    return (
      <div
        className="w-screen lg:w-[30vw] lg:min-w-[340px] lg:max-w-[520px] h-full border-l border-nc-border flex flex-col items-center justify-center"
        style={{ background: 'var(--zk-bg-0)' }}
      >
        <p className="text-sm text-nc-muted font-mono mb-3">AGENT_NOT_FOUND</p>
        <button
          onClick={closeRightPanel}
          className="px-3 py-1.5 border border-nc-border text-xs text-nc-muted hover:text-nc-text-bright font-mono"
        >
          CLOSE
        </button>
      </div>
    );
  }

  return (
    <div
      className="w-screen lg:w-[30vw] lg:min-w-[340px] lg:max-w-[520px] h-full border-l border-nc-border flex flex-col animate-slide-in-right"
      style={{ background: 'var(--zk-bg-0)' }}
    >
      {/* Single header row: PROFILE / FILES tabs + close button share the
          row to save vertical space; tab height drives the close-button
          height so they align. safe-area-inset-top padding keeps the row
          below the iOS notch on phone PWA where this panel covers the full
          viewport without a parent TopBar. */}
      <div
        className="border-b border-nc-border flex items-stretch shrink-0"
        style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
      >
        <div className="flex-1" />
        {TAB_CONFIG.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-bold font-mono border-b-2 -mb-[1px] transition-colors tracking-wider ${
              tab === key
                ? 'border-nc-cyan text-nc-cyan'
                : 'border-transparent text-nc-muted hover:text-nc-text-bright'
            }`}
          >
            <Icon size={12} />
            {label}
          </button>
        ))}
        <button
          onClick={closeRightPanel}
          className="flex items-center justify-center px-3 text-nc-muted hover:text-nc-red transition-colors shrink-0"
          title="Close"
        >
          <X size={16} />
        </button>
      </div>

      <div className="flex-1 min-h-0 flex flex-col">
        {tab === 'profile' && <ProfileTab agent={agent} />}
        {tab === 'workspace' && <WorkspaceTab agent={agent} />}
      </div>
    </div>
  );
}
