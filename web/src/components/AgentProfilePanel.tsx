import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import {
  X, Activity, Settings as SettingsIcon,
  Brain, ExternalLink, RefreshCw,
} from 'lucide-react';
import { useApp } from '../store/AppContext';
import type { ServerAgent } from '../types';
import { fetchAgentOvStatus } from '../lib/api';
import { AgentActivityFeed } from './agent/AgentActivityFeed';
import AgentConfigForm from './agent/AgentConfigForm';
import AgentProfileSummary from './agent/AgentProfileSummary';
import {
  Preview,
  TreeView,
  memoryFolderUri,
  memoryProfileUri,
  memoryUserRoot,
} from './MemoryView';
import '../styles/atlas-renderers.css';

type Tab = 'profile' | 'memory' | 'config';

const TAB_CONFIG: { key: Tab; label: string; icon: typeof Activity }[] = [
  { key: 'profile', label: 'Activity', icon: Activity },
  { key: 'memory', label: 'Memory', icon: Brain },
  { key: 'config', label: 'Config', icon: SettingsIcon },
];

function ProfileTab({ agent }: { agent: ServerAgent }) {
  const { loadAgentActivities } = useApp();
  const entries = agent.entries || [];

  useEffect(() => {
    loadAgentActivities(agent.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent.id]);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="shrink-0 overflow-y-auto scrollbar-thin px-4 pt-3 pb-2 space-y-3 max-h-[55%]">
        <AgentProfileSummary agent={agent} />
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

/* ---- Memory tab (independent display, tree + preview, top-down) ---- */

function MemoryTab({ agent }: { agent: ServerAgent }) {
  const {
    activeWorkspaceId,
    memoryTreeCache, memoryTreeErrors,
    requestMemoryList, requestMemoryContent,
    navigateToView, setMemoryFocusAgentId, closeAgentProfileRail,
  } = useApp();

  const [ovUser, setOvUser] = useState<string | null>(null);
  const [statusChecked, setStatusChecked] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);

  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const defaultsAppliedRef = useRef<string | null>(null);

  const [previewRatio, setPreviewRatio] = useState(0.5);
  const stackRef = useRef<HTMLDivElement | null>(null);
  const resizeCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => () => { resizeCleanupRef.current?.(); }, []);

  // Resolve OV user for this agent.
  useEffect(() => {
    let cancelled = false;
    setStatusChecked(false);
    setOvUser(null);
    setStatusError(null);
    setSelectedFile(null);
    setSelectedFolder(null);
    setExpanded(new Set());
    defaultsAppliedRef.current = null;
    fetchAgentOvStatus(agent.id)
      .then((data) => {
        if (cancelled) return;
        setOvUser(data.enabled ? (data.user || agent.name) : null);
        setStatusChecked(true);
      })
      .catch((e) => {
        if (cancelled) return;
        setStatusError(e instanceof Error ? e.message : 'Failed to load OV status');
        setStatusChecked(true);
      });
    return () => { cancelled = true; };
  }, [activeWorkspaceId, agent.id, agent.name]);

  const agentCache = useMemo(() => memoryTreeCache[agent.id] || {}, [memoryTreeCache, agent.id]);
  const agentErrors = useMemo(() => memoryTreeErrors[agent.id] || {}, [memoryTreeErrors, agent.id]);
  const rootUri = ovUser ? memoryUserRoot(ovUser) : null;
  const memDirUri = ovUser ? memoryFolderUri(ovUser, 'memories') : null;
  const profileUri = ovUser ? memoryProfileUri(ovUser) : null;
  const rootLoaded = !!rootUri && Object.prototype.hasOwnProperty.call(agentCache, rootUri);
  const rootError = rootUri ? (agentErrors[rootUri] || null) : null;
  const rootErrorText = rootError && rootError.length > 240 ? `${rootError.slice(0, 237)}...` : rootError;
  const statusErrorText = statusError && statusError.length > 240 ? `${statusError.slice(0, 237)}...` : statusError;

  // Fetch root listing once ovUser is known.
  useEffect(() => {
    if (rootUri && !rootLoaded && !rootError) {
      requestMemoryList(agent.id, rootUri);
    }
  }, [agent.id, rootUri, rootLoaded, rootError, requestMemoryList]);

  // Apply default expand + open once root is loaded.
  useEffect(() => {
    if (!ovUser || !rootUri || !memDirUri || !profileUri) return;
    const key = `${agent.id}:${ovUser}`;
    if (defaultsAppliedRef.current === key) return;
    defaultsAppliedRef.current = key;
    setExpanded((prev) => {
      const next = new Set(prev);
      next.add(rootUri);
      next.add(memDirUri);
      return next;
    });
    requestMemoryList(agent.id, memDirUri);
    setSelectedFile(profileUri);
    setSelectedFolder(null);
    requestMemoryContent(agent.id, profileUri, 'l2');
  }, [agent.id, ovUser, rootUri, memDirUri, profileUri, requestMemoryList, requestMemoryContent]);

  const fetchList = useCallback((uri?: string) => {
    requestMemoryList(agent.id, uri ?? rootUri ?? undefined);
  }, [agent.id, rootUri, requestMemoryList]);

  const fetchContent = useCallback((uri: string) => {
    requestMemoryContent(agent.id, uri, 'l2');
  }, [agent.id, requestMemoryContent]);

  const handleSelectFolder = useCallback((uri: string) => {
    setSelectedFolder(uri);
    setSelectedFile(null);
    requestMemoryContent(agent.id, uri, 'l0');
    requestMemoryContent(agent.id, uri, 'l1');
  }, [agent.id, requestMemoryContent]);

  const previewUri = selectedFile ?? selectedFolder;
  const previewIsDir = !selectedFile && !!selectedFolder;

  const beginResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const container = stackRef.current;
    if (!container) return;
    event.preventDefault();

    const updateRatio = (clientY: number) => {
      const rect = container.getBoundingClientRect();
      if (!rect.height) return;
      const next = (rect.bottom - clientY) / rect.height;
      setPreviewRatio(Math.max(0.2, Math.min(0.8, next)));
    };
    const stop = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
      resizeCleanupRef.current = null;
    };
    const onMove = (e: PointerEvent) => updateRatio(e.clientY);

    resizeCleanupRef.current?.();
    resizeCleanupRef.current = stop;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
    updateRatio(event.clientY);
  }, []);

  const openMemoryPage = useCallback(() => {
    setMemoryFocusAgentId(agent.id);
    navigateToView('memory');
    closeAgentProfileRail();
  }, [agent.id, navigateToView, setMemoryFocusAgentId, closeAgentProfileRail]);

  // Toolbar — shown above the tree.
  const toolbar = (
    <div
      style={{
        flexShrink: 0,
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '6px 10px 6px 12px',
        borderBottom: '1px solid var(--zk-line)',
        background: 'var(--zk-bg-1)',
      }}
    >
      <Brain size={11} style={{ color: 'var(--zk-ember)', flexShrink: 0 }} />
      <span
        className="zk-mono"
        style={{ fontSize: 10, fontWeight: 600, color: 'var(--zk-ink-mute)', letterSpacing: '0.06em' }}
      >
        OV MEMORY
      </span>
      {ovUser && (
        <span className="zk-mono" style={{ fontSize: 10, color: 'var(--zk-ink-low)' }}>· {ovUser}</span>
      )}
      <span style={{ flex: 1 }} />
      {rootUri && (
        <button
          type="button"
          onClick={() => fetchList(rootUri)}
          className="zk-btn zk-btn--ghost zk-btn--icon"
          title="Refresh"
          aria-label="Refresh memory"
          style={{ padding: 4 }}
        >
          <RefreshCw size={11} />
        </button>
      )}
      <button
        type="button"
        onClick={openMemoryPage}
        className="zk-btn zk-btn--ghost"
        title="Open Memory page"
        style={{ padding: '3px 8px', fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}
      >
        Open
        <ExternalLink size={10} />
      </button>
    </div>
  );

  if (!statusChecked) {
    return (
      <div className="flex-1 flex flex-col min-h-0">
        {toolbar}
        <div className="text-2xs text-nc-muted font-mono py-2 px-3 animate-pulse">Loading…</div>
      </div>
    );
  }

  if (!ovUser) {
    return (
      <div className="flex-1 flex flex-col min-h-0">
        {toolbar}
        <div className="text-2xs font-mono py-3 px-3 break-words" style={{ color: statusErrorText ? 'var(--zk-bad)' : 'var(--zk-ink-mute)' }}>
          {statusErrorText || 'OpenViking is not enabled for this agent. Toggle it on in the agent config.'}
        </div>
      </div>
    );
  }

  if (rootErrorText) {
    return (
      <div className="flex-1 flex flex-col min-h-0">
        {toolbar}
        <div className="flex items-start gap-2 py-2 px-3">
          <div className="min-w-0 flex-1 text-2xs font-mono break-words" style={{ color: 'var(--zk-bad)' }}>{rootErrorText}</div>
          <button
            type="button"
            onClick={() => rootUri && requestMemoryList(agent.id, rootUri)}
            className="zk-btn zk-btn--ghost zk-btn--icon"
            title="Retry"
            style={{ flexShrink: 0, padding: 4 }}
          >
            <RefreshCw size={11} />
          </button>
        </div>
      </div>
    );
  }

  if (!rootUri) return null;

  const previewBasisPct = Math.round(previewRatio * 100);
  const previewBasis = `calc(${previewBasisPct}% - 5px)`;
  const treeBasis = `calc(${100 - previewBasisPct}% - 5px)`;

  return (
    <div ref={stackRef} className="flex-1 flex flex-col min-h-0">
      {toolbar}

      {/* Tree pane (top) */}
      <div
        className="flex flex-col min-h-0"
        style={{ flex: previewUri ? `0 0 ${treeBasis}` : 1 }}
      >
        <TreeView
          agentId={agent.id}
          treeCache={agentCache}
          source="memory"
          fetchList={fetchList}
          fetchContent={fetchContent}
          selectedUri={selectedFile ?? selectedFolder}
          onSelectFile={setSelectedFile}
          onSelectFolder={handleSelectFolder}
          rootUri={rootUri}
          expanded={expanded}
          setExpanded={setExpanded}
          emptyMessage="No memories"
        />
      </div>

      {/* Drag handle — 1px divider line + an invisible ±4px hit area for
          easy grabbing. No background, no grip pill. */}
      {previewUri && (
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize preview"
          onPointerDown={beginResize}
          style={{
            flexShrink: 0,
            height: 1,
            background: 'var(--zk-line)',
            position: 'relative',
            cursor: 'row-resize',
            touchAction: 'none',
          }}
        >
          <span
            aria-hidden="true"
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              top: -4,
              bottom: -4,
            }}
          />
        </div>
      )}

      {/* Preview pane (bottom) */}
      {previewUri && (
        <div
          className="flex flex-col min-h-0"
          style={{ flex: `0 0 ${previewBasis}`, background: 'var(--zk-bg-0)' }}
        >
          <Preview
            agentId={agent.id}
            previewUri={previewUri}
            isDirectory={previewIsDir}
            source="memory"
            compact
            onBack={selectedFile ? () => setSelectedFile(null) : undefined}
          />
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
  const { agents, configs, closeAgentProfileRail, agentProfileId, agentProfileTab, setAgentProfileTab } = useApp();
  const tab = (agentProfileTab === 'workspace' ? 'profile' : agentProfileTab) as Tab;
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
          const active = tab === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '10px 12px', fontSize: 11, fontWeight: 600,
                fontFamily: 'var(--zk-font-mono)', letterSpacing: '0.02em',
                borderBottom: '2px solid', marginBottom: -1,
                borderColor: active ? 'var(--zk-ember)' : 'transparent',
                color: active ? 'var(--zk-ink)' : 'var(--zk-ink-mute)',
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
        {tab === 'memory' && <MemoryTab key={agent.id} agent={agent} />}
        {tab === 'config' && <ConfigTab key={agent.id} agent={agent} />}
      </div>
    </div>
  );
}
