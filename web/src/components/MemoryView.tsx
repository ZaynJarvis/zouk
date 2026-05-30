/* MemoryView — atlas-fs-style browser for per-agent OpenViking memory and
   workspace Files. Inspired by V3MemoryApp in tmp/.../v3-bold.jsx.

   Sources:
   - 'memory' (default): browses OpenViking via requestMemoryList /
     requestMemoryContent. URIs look like `viking://user/...`.
   - 'files': browses the agent's workspace via requestWorkspaceFiles /
     requestFileContent. Identifiers are filesystem paths; root is empty.

   Layout: single-column tree on the left, preview pane on the right. The
   tree is also re-exported for use inside the agent sidebar's Memory tab. */

import {
  useCallback, useEffect, useMemo, useRef, useState, memo,
} from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import {
  ChevronRight, File, Folder, RefreshCw, ArrowLeft,
} from 'lucide-react';
import { useApp } from '../store/AppContext';
import type { ServerAgent, MemoryEntry } from '../types';
import { fetchAgentOvStatus } from '../lib/api';
import { isMobileViewport } from '../lib/layout';
import { Avatar } from './zk/primitives';
import { LEVEL_META } from './memory/atlas-helpers';
import {
  fileKindLabel,
  isJsonFile,
  isJsonlFile,
  isMarkdownFile,
  SafePreviewContent,
} from './memory/renderPreviewContent';
import ViewHeader from './ViewHeader';
import '../styles/atlas-renderers.css';

export type Source = 'memory' | 'files';

export const MEMORY_ROOT = 'viking://';
const FILES_ROOT = '';

export const rootFor = (s: Source) => (s === 'memory' ? MEMORY_ROOT : FILES_ROOT);

export function memoryUserRoot(ovUser: string): string {
  return `viking://user/${ovUser}/`;
}

export function memoryFolderUri(ovUser: string, folder: string): string {
  return `viking://user/${ovUser}/${folder}/`;
}

export function memoryProfileUri(ovUser: string): string {
  return `viking://user/${ovUser}/memories/profile.md`;
}

// Hide dot-prefixed entries (.ov, .git, .DS_Store, .cache, ...) from the Files
// view. They're agent-internal scaffolding, not content the user wants to
// browse here. Memory view never receives a leading-dot URI segment, so this
// only affects 'files' source.
function visibleEntries(entries: MemoryEntry[], source: Source): MemoryEntry[] {
  if (source !== 'files') return entries;
  return entries.filter((e) => {
    const name = uriBasename(e.uri, source);
    return !name.startsWith('.');
  });
}

/* ---- URI / path helpers --------------------------------------------- */

export function uriBasename(uri: string, source: Source): string {
  if (source === 'memory') {
    if (!uri || uri === MEMORY_ROOT || uri === 'viking:///') return '/';
    const trimmed = uri.replace(/\/+$/, '');
    const idx = trimmed.lastIndexOf('/');
    if (idx < 0) return trimmed;
    return trimmed.slice(idx + 1) || '/';
  }
  // Files
  if (!uri) return '~';
  const trimmed = uri.replace(/\/+$/, '');
  if (!trimmed) return '~';
  const idx = trimmed.lastIndexOf('/');
  if (idx < 0) return trimmed;
  return trimmed.slice(idx + 1) || '/';
}

/* ---- Agent chip strip — horizontal, prominent (high-frequency switch) ---- */

function AgentChipStrip({
  agents, selectedId, onSelect,
}: {
  agents: ServerAgent[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  if (agents.length === 0) {
    return (
      <div
        style={{
          padding: '10px 22px', fontSize: 12,
          color: 'var(--zk-ink-mute)', fontFamily: 'var(--zk-font-mono)',
        }}
      >
        No agents available.
      </div>
    );
  }

  return (
    <div
      className="zk-scroll"
      style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '6px 16px',
        borderBottom: '1px solid var(--zk-line)',
        overflowX: 'auto',
        flexShrink: 0,
        background: 'var(--zk-bg-0)',
      }}
    >
      {agents.map((a) => {
        const active = a.id === selectedId;
        return (
          <button
            key={a.id}
            type="button"
            onClick={() => onSelect(a.id)}
            aria-pressed={active}
            title={a.displayName || a.name}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '4px 10px 4px 4px',
              border: '1px solid',
              borderColor: active ? 'var(--zk-ember)' : 'var(--zk-line-2)',
              background: active ? 'var(--zk-ember-soft)' : 'var(--zk-bg-1)',
              borderRadius: 999, cursor: 'pointer',
              color: active ? 'var(--zk-ember)' : 'var(--zk-ink-dim)',
              fontFamily: 'var(--zk-font-sans)', fontSize: 12,
              flexShrink: 0,
              transition: 'background 160ms var(--zk-ease-out), border-color 160ms var(--zk-ease-out), color 160ms var(--zk-ease-out)',
            }}
          >
            <Avatar
              src={a.picture}
              name={a.displayName || a.name}
              kind="agent"
              size="sm"
              activity={a.activity}
            />
            <span style={{ fontWeight: active ? 500 : 400 }}>
              {a.displayName || a.name}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/* ---- Preview pane (file or folder) --------------------------------- */

// OpenViking returns these placeholder strings when a directory's L0/L1
// hasn't been generated yet. Treat them as "no content" so the chip + section
// don't render.
const DIR_PLACEHOLDER_RE = /^\[directory (overview|abstract) is not (generated|ready)\]$/i;

type LevelKey = 'l0' | 'l1' | 'l2';
const FOLDER_LEVELS: LevelKey[] = ['l0', 'l1'];
const FILE_LEVELS: LevelKey[] = ['l2'];

export function Preview({
  agentId, previewUri, isDirectory, source, onBack, compact = false,
}: {
  agentId: string | null;
  previewUri: string | null;
  isDirectory: boolean;
  source: Source;
  onBack?: () => void;
  compact?: boolean;
}) {
  const { memoryContentCache, workspaceFileContent } = useApp();
  const [activeLevels, setActiveLevels] = useState<LevelKey[] | null>(null);

  // Reset selected levels when target changes
  useEffect(() => { setActiveLevels(null); }, [previewUri, isDirectory]);

  if (!agentId || !previewUri) {
    return (
      <div
        style={{
          padding: 32, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          color: 'var(--zk-ink-mute)', fontFamily: 'var(--zk-font-mono)', fontSize: 12,
          height: '100%',
        }}
      >
        No selection
      </div>
    );
  }
  const activePreviewUri = previewUri;

  // Per-level content, with placeholder strings stripped to null.
  const bundle: Record<LevelKey, string | null> = { l0: null, l1: null, l2: null };
  if (source === 'memory') {
    const slot = memoryContentCache[agentId]?.[previewUri] || {};
    for (const lv of (['l0', 'l1', 'l2'] as LevelKey[])) {
      const c = slot[lv];
      if (typeof c === 'string' && c.trim() && !DIR_PLACEHOLDER_RE.test(c.trim())) {
        bundle[lv] = c;
      }
    }
    // Fall back to legacy (no-level) fetches under L2 for backward compat.
    if (bundle.l2 == null && typeof slot.__legacy__ === 'string') {
      bundle.l2 = slot.__legacy__;
    }
  } else if (!isDirectory) {
    const match = workspaceFileContent?.agentId === agentId && workspaceFileContent?.path === previewUri
      ? workspaceFileContent : null;
    bundle.l2 = match?.content ?? null;
  }

  const requestedLevels = isDirectory ? FOLDER_LEVELS : FILE_LEVELS;
  const available = requestedLevels.filter((lv) => bundle[lv] != null);
  const active = activeLevels ?? available;

  const fileName = uriBasename(previewUri, source);
  const isMd = !isDirectory && isMarkdownFile(previewUri);
  const isJson = !isDirectory && isJsonFile(previewUri);
  const isJsonl = !isDirectory && isJsonlFile(previewUri);
  const kind = isDirectory ? 'FOLDER'
    : isMd ? 'MARKDOWN'
    : isJson ? 'JSON'
    : isJsonl ? 'JSONL'
    : fileKindLabel(previewUri);

  const toggleLevel = (lv: LevelKey) => {
    setActiveLevels((prev) => {
      const cur = prev ?? available;
      if (cur.includes(lv)) {
        const next = cur.filter((x) => x !== lv);
        return next.length ? next : cur;
      }
      // Preserve canonical L0 < L1 < L2 order
      return requestedLevels.filter((x) => x === lv || cur.includes(x));
    });
  };

  function renderContent(text: string, lv: LevelKey) {
    // L0/L1 are always markdown summaries from OpenViking, regardless of the
    // entry's own type. L2 follows the file's mime/extension.
    const renderName = (lv !== 'l2' || isMd) ? `${fileName}.${lv}.md` : activePreviewUri;
    return <SafePreviewContent text={text} fileName={renderName} className="atlas-section-body" />;
  }

  const headerPad = compact ? '10px 14px 8px' : '18px 24px 16px';
  const nameSize = compact ? 13 : 14;
  const metaSize = compact ? 10 : 11;

  return (
    <div className="zk-fade-in" style={{ display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%' }}>
      <header style={{ padding: headerPad, borderBottom: '1px solid var(--zk-line)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: compact ? 6 : 10 }}>
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="zk-btn zk-btn--ghost zk-btn--icon lg:!hidden"
              aria-label="Back"
              style={{ padding: 4 }}
            >
              <ArrowLeft size={13} />
            </button>
          )}
          {isDirectory
            ? <Folder size={13} color="var(--zk-ink-dim)" />
            : <File size={13} color="var(--zk-ink-dim)" />}
          <span
            style={{
              fontFamily: 'var(--zk-font-mono)', fontSize: nameSize,
              color: 'var(--zk-ink)', fontWeight: 500,
            }}
            className="zk-truncate"
          >
            {fileName}
          </span>
          <span className="zk-grow" />
          <span
            style={{
              padding: '2px 8px',
              fontFamily: 'var(--zk-font-mono)', fontSize: 10,
              color: 'var(--zk-ink-mute)',
              border: '1px solid var(--zk-line-2)', borderRadius: 4,
              letterSpacing: '0.06em',
            }}
          >
            {kind}
          </span>
        </div>
        <div
          className="zk-truncate"
          style={{
            display: 'flex', gap: 18,
            fontFamily: 'var(--zk-font-mono)', fontSize: metaSize,
            color: 'var(--zk-ink-mute)',
          }}
          title={previewUri}
        >
          <span><span style={{ color: 'var(--zk-ink-low)' }}>path</span> {previewUri}</span>
        </div>
      </header>

      {/* Level chips — shown when multiple levels available */}
      {available.length > 1 && (
        <div className="atlas-level-chips">
          {available.map((lv) => {
            const m = LEVEL_META[lv as keyof typeof LEVEL_META];
            if (!m) return null;
            return (
              <button
                key={lv}
                className="atlas-level-chip"
                data-active={active.includes(lv)}
                onClick={() => toggleLevel(lv)}
                title={m.desc}
                type="button"
              >
                <span className="atlas-level-name">{m.name}</span>
                <span className="atlas-level-label">{m.label}</span>
              </button>
            );
          })}
        </div>
      )}

      <div className="zk-scroll" style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        {available.length === 0 ? (
          <div style={{ padding: 64, textAlign: 'center', fontSize: 12, color: 'var(--zk-ink-mute)', fontFamily: 'var(--zk-font-mono)' }}>
            {isDirectory ? 'No summary generated for this folder yet.' : 'loading…'}
          </div>
        ) : (
          active.map((lv, i) => {
            const m = LEVEL_META[lv as keyof typeof LEVEL_META];
            const c = bundle[lv];
            if (c == null) return null;
            return (
              <section key={lv}>
                {i > 0 && <div className="atlas-section-divider" />}
                {available.length > 1 && m && (
                  <header className="atlas-section-head">
                    <span className="atlas-level-name">{m.name}</span>
                    <span className="atlas-level-label">{m.label}</span>
                    <span style={{ flex: 1 }} />
                    <span className="atlas-level-desc">{m.desc}</span>
                  </header>
                )}
                {renderContent(c, lv)}
              </section>
            );
          })
        )}
      </div>
    </div>
  );
}

/* ---- Tree view (alternate paradigm) -------------------------------- */

const TreeNode = memo(function TreeNode({
  entry, level, expanded, treeCache, selectedUri, source,
  onToggle, onSelectFile, onSelectFolder,
}: {
  entry: MemoryEntry;
  level: number;
  expanded: Set<string>;
  treeCache: Record<string, MemoryEntry[]>;
  selectedUri: string | null;
  source: Source;
  onToggle: (uri: string) => void;
  onSelectFile: (uri: string) => void;
  onSelectFolder?: (uri: string) => void;
}) {
  const { uri, isDir } = entry;
  const isExpanded = isDir && expanded.has(uri);
  const children = isDir ? (treeCache[uri] ? visibleEntries(treeCache[uri], source) : undefined) : undefined;
  const name = uriBasename(uri, source);
  const isSelected = uri === selectedUri;

  return (
    <>
      <button
        type="button"
        onClick={() => {
          if (isDir) {
            onToggle(uri);
            onSelectFolder?.(uri);
          } else {
            onSelectFile(uri);
          }
        }}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 6,
          padding: '5px 10px',
          paddingLeft: `${10 + level * 14}px`,
          background: isSelected ? 'var(--zk-ember-soft)' : 'transparent',
          border: 0, borderRadius: 5, cursor: 'pointer',
          color: isSelected ? 'var(--zk-ember)' : 'var(--zk-ink-dim)',
          textAlign: 'left',
          transition: 'background 140ms var(--zk-ease-out)',
        }}
      >
        {isDir ? (
          <ChevronRight
            size={11}
            color={isSelected ? 'var(--zk-ember)' : 'var(--zk-ink-mute)'}
            style={{ transition: 'transform 120ms', transform: isExpanded ? 'rotate(90deg)' : 'none', flexShrink: 0 }}
          />
        ) : (
          <span style={{ width: 11, flexShrink: 0 }} />
        )}
        {isDir
          ? <Folder size={11} color={isSelected ? 'var(--zk-ember)' : 'var(--zk-ink-dim)'} />
          : <File size={11} color={isSelected ? 'var(--zk-ember)' : 'var(--zk-ink-mute)'} />}
        <span
          style={{
            fontFamily: 'var(--zk-font-mono)', fontSize: 12,
            fontWeight: isSelected ? 500 : 400,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            flex: 1,
          }}
        >
          {name}
        </span>
      </button>
      {isDir && isExpanded && (
        children ? (
          children.length === 0 ? (
            <div style={{ paddingLeft: `${10 + (level + 1) * 14}px`, fontSize: 11, color: 'var(--zk-ink-low)', fontFamily: 'var(--zk-font-mono)', fontStyle: 'italic' }}>
              empty
            </div>
          ) : (
            children.map((c) => (
              <TreeNode
                key={c.uri}
                entry={c}
                level={level + 1}
                expanded={expanded}
                treeCache={treeCache}
                selectedUri={selectedUri}
                source={source}
                onToggle={onToggle}
                onSelectFile={onSelectFile}
                onSelectFolder={onSelectFolder}
              />
            ))
          )
        ) : (
          <div style={{ paddingLeft: `${10 + (level + 1) * 14}px`, fontSize: 11, color: 'var(--zk-ink-low)', fontFamily: 'var(--zk-font-mono)', fontStyle: 'italic' }}>
            loading…
          </div>
        )
      )}
    </>
  );
});

export function TreeView({
  agentId, treeCache, source, fetchList, fetchContent,
  selectedUri, onSelectFile, onSelectFolder,
  rootUri,
  expanded: controlledExpanded,
  setExpanded: setControlledExpanded,
  emptyMessage,
}: {
  agentId: string;
  treeCache: Record<string, MemoryEntry[]>;
  source: Source;
  fetchList: (uri?: string) => void;
  fetchContent: (uri: string) => void;
  selectedUri: string | null;
  onSelectFile: (uri: string) => void;
  onSelectFolder?: (uri: string) => void;
  rootUri?: string;
  expanded?: Set<string>;
  setExpanded?: (updater: (prev: Set<string>) => Set<string>) => void;
  emptyMessage?: string;
}) {
  const [internalExpanded, setInternalExpanded] = useState<Set<string>>(new Set());
  const expanded = controlledExpanded ?? internalExpanded;
  const setExpanded = setControlledExpanded ?? setInternalExpanded;
  const root = rootUri ?? rootFor(source);
  const rootEntries = visibleEntries(
    treeCache[root] || (source === 'memory' && root === MEMORY_ROOT ? (treeCache['viking:///'] || []) : []),
    source,
  );

  useEffect(() => {
    if (!treeCache[root] && !(source === 'memory' && root === MEMORY_ROOT && treeCache['viking:///'])) {
      fetchList(rootUri);
    }
  }, [agentId, treeCache, fetchList, root, source, rootUri]);

  const handleToggle = useCallback((uri: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(uri)) {
        next.delete(uri);
      } else {
        next.add(uri);
        if (!treeCache[uri]) fetchList(uri);
      }
      return next;
    });
  }, [treeCache, fetchList, setExpanded]);

  const handlePickFile = useCallback((uri: string) => {
    onSelectFile(uri);
    fetchContent(uri);
  }, [onSelectFile, fetchContent]);

  return (
    <div className="zk-scroll" style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '6px 4px' }}>
      {rootEntries.length === 0 ? (
        <div style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--zk-ink-mute)', fontSize: 12, fontFamily: 'var(--zk-font-mono)' }}>
          {emptyMessage ?? (source === 'memory' ? 'No memories' : 'No files')}
        </div>
      ) : (
        rootEntries.map((e) => (
          <TreeNode
            key={e.uri}
            entry={e}
            level={0}
            expanded={expanded}
            treeCache={treeCache}
            selectedUri={selectedUri}
            source={source}
            onToggle={handleToggle}
            onSelectFile={handlePickFile}
            onSelectFolder={onSelectFolder}
          />
        ))
      )}
    </div>
  );
}

/* ---- Top-level view ------------------------------------------------- */

export default function MemoryView() {
  const {
    agents, memoryTreeCache, requestMemoryList, requestMemoryContent,
    wsTreeCache, requestWorkspaceFiles, requestFileContent,
  } = useApp();
  const { memoryFocusAgentId, setMemoryFocusAgentId } = useApp();
  const [agentId, setAgentId] = useState<string | null>(memoryFocusAgentId);
  const selectedAgent = useMemo(() => agentId ? agents.find(a => a.id === agentId) ?? null : null, [agentId, agents]);
  // Treat undefined as enabled to stay forward-compatible with servers that
  // haven't shipped the OV gate yet — only actively false flips behavior.
  const ovEnabledForAgent = selectedAgent?.ovEnabled !== false;
  const [source, setSource] = useState<Source>('memory');
  // When the selected agent has OV off, force the source tab to Files. Don't
  // auto-flip back if the user later picks an OV-enabled agent — they can
  // click Memory explicitly. The Memory tab is only greyed out (not hidden)
  // so the affordance stays discoverable.
  useEffect(() => {
    if (!ovEnabledForAgent && source !== 'files') setSource('files');
  }, [ovEnabledForAgent, source]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [ovUser, setOvUser] = useState<string | null>(null);
  const [isMobileSurface, setIsMobileSurface] = useState(() => isMobileViewport());
  const [mobilePreviewRatio, setMobilePreviewRatio] = useState(0.46);
  const stackRef = useRef<HTMLDivElement | null>(null);
  const rootRefreshKeyRef = useRef<string | null>(null);
  const previewResizeCleanupRef = useRef<(() => void) | null>(null);
  const defaultsAppliedRef = useRef<string | null>(null);

  useEffect(() => {
    const update = () => setIsMobileSurface(isMobileViewport());
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  useEffect(() => {
    return () => {
      previewResizeCleanupRef.current?.();
    };
  }, []);

  useEffect(() => {
    if (memoryFocusAgentId && agents.find((a) => a.id === memoryFocusAgentId)) {
      setAgentId(memoryFocusAgentId);
      setMemoryFocusAgentId(null);
    }
  }, [memoryFocusAgentId, agents, setMemoryFocusAgentId]);

  useEffect(() => {
    if (!agentId && agents.length > 0) setAgentId(agents[0].id);
    if (agentId && !agents.find((a) => a.id === agentId)) {
      setAgentId(agents[0]?.id ?? null);
      setSelectedFile(null);
      setSelectedFolder(null);
      setExpanded(new Set());
    }
  }, [agents, agentId, source]);

  // Resolve OV user for the selected agent so we can default-expand and
  // default-open the agent's profile.md when on the memory source.
  useEffect(() => {
    if (!agentId) { setOvUser(null); return; }
    let cancelled = false;
    fetchAgentOvStatus(agentId)
      .then((data) => {
        if (cancelled) return;
        setOvUser(data.enabled ? (data.user || agents.find((a) => a.id === agentId)?.name || null) : null);
      })
      .catch(() => { if (!cancelled) setOvUser(null); });
    return () => { cancelled = true; };
  }, [agentId, agents]);

  /* Per-source data adapter — uniform Record<uri, MemoryEntry[]> shape. */
  const agentCache = useMemo(() => {
    if (!agentId) return {} as Record<string, MemoryEntry[]>;
    if (source === 'memory') {
      return memoryTreeCache[agentId] || {};
    }
    const ws = wsTreeCache[agentId] || {};
    const out: Record<string, MemoryEntry[]> = {};
    for (const [dirPath, files] of Object.entries(ws)) {
      out[dirPath] = files.map((f) => ({
        uri: f.path || f.name,
        isDir: f.isDirectory,
        size: f.size,
        modTime: f.modifiedAt,
      }));
    }
    return out;
  }, [agentId, source, memoryTreeCache, wsTreeCache]);

  const fetchList = useCallback((uri?: string) => {
    if (!agentId) return;
    if (source === 'memory') {
      requestMemoryList(agentId, uri);
    } else {
      requestWorkspaceFiles(agentId, uri ?? '');
    }
  }, [agentId, source, requestMemoryList, requestWorkspaceFiles]);

  const fetchContent = useCallback((uri: string) => {
    if (!agentId) return;
    if (source === 'memory') {
      requestMemoryContent(agentId, uri, 'l2');
    } else {
      requestFileContent(agentId, uri);
    }
  }, [agentId, source, requestMemoryContent, requestFileContent]);

  const fetchFolderSummaries = useCallback((uri: string) => {
    if (!agentId || source !== 'memory') return;
    if (!uri || uri === MEMORY_ROOT) return;
    requestMemoryContent(agentId, uri, 'l0');
    requestMemoryContent(agentId, uri, 'l1');
  }, [agentId, source, requestMemoryContent]);

  // Reset selection when agent or source changes; eagerly load root.
  useEffect(() => {
    setSelectedFile(null);
    setSelectedFolder(null);
    setExpanded(new Set());
    defaultsAppliedRef.current = null;
  }, [agentId, source]);

  useEffect(() => {
    if (!agentId) return;
    const root = rootFor(source);
    const has = agentCache[root] || (source === 'memory' && agentCache['viking:///']);
    const refreshKey = `${agentId}:${source}:${root}`;
    const shouldRefreshRoot = source === 'memory' && rootRefreshKeyRef.current !== refreshKey;
    if (!has || shouldRefreshRoot) {
      rootRefreshKeyRef.current = refreshKey;
      fetchList(source === 'memory' ? root : undefined);
    }
  }, [agentId, source, agentCache, fetchList]);

  // Default expand path + open profile.md for the selected agent's OV root.
  // Runs once per (agent, source) pair; user expand/collapse is preserved.
  useEffect(() => {
    if (!agentId || source !== 'memory' || !ovUser) return;
    const key = `${agentId}:${source}:${ovUser}`;
    if (defaultsAppliedRef.current === key) return;
    defaultsAppliedRef.current = key;
    // OV root structure is viking:// → user/ → <ovUser>/ → memories/ → profile.md.
    // Each ancestor must be in the expanded set; expanding only the leaves
    // hides them under a collapsed parent.
    const userParent = 'viking://user/';
    const userRoot = memoryUserRoot(ovUser);
    const memDir = memoryFolderUri(ovUser, 'memories');
    setExpanded((prev) => {
      const next = new Set(prev);
      next.add(userParent);
      next.add(userRoot);
      next.add(memDir);
      return next;
    });
    // Warm the listings so the expanded path renders without a click.
    requestMemoryList(agentId, userParent);
    requestMemoryList(agentId, userRoot);
    requestMemoryList(agentId, memDir);
    // Default-open the profile.md.
    const profile = memoryProfileUri(ovUser);
    setSelectedFile(profile);
    setSelectedFolder(null);
    requestMemoryContent(agentId, profile, 'l2');
  }, [agentId, source, ovUser, requestMemoryList, requestMemoryContent]);

  const handleSelectFolder = useCallback((uri: string) => {
    setSelectedFolder(uri);
    setSelectedFile(null);
    if (source === 'memory') {
      fetchFolderSummaries(uri);
    }
  }, [source, fetchFolderSummaries]);

  const refreshActive = useCallback(() => {
    if (!agentId) return;
    fetchList(rootFor(source));
    expanded.forEach((u) => fetchList(u));
    if (selectedFile) fetchContent(selectedFile);
    if (selectedFolder && source === 'memory') fetchFolderSummaries(selectedFolder);
  }, [agentId, source, expanded, selectedFile, selectedFolder, fetchList, fetchContent, fetchFolderSummaries]);

  const previewUri = selectedFile ?? selectedFolder;
  const previewIsDir = !selectedFile && !!selectedFolder;
  const showMobilePreview = isMobileSurface && !!previewUri;
  const showPreviewPane = !isMobileSurface || !!previewUri;
  const mobilePreviewPercent = Math.round(mobilePreviewRatio * 100);
  const mobilePreviewBasis = `calc(${mobilePreviewPercent}% - 5px)`;
  const mobileBrowserBasis = `calc(${100 - mobilePreviewPercent}% - 5px)`;

  const beginPreviewResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const container = stackRef.current;
    if (!container || !previewUri || !isMobileSurface) return;
    event.preventDefault();

    const updateRatio = (clientY: number) => {
      const rect = container.getBoundingClientRect();
      if (!rect.height) return;
      const next = (rect.bottom - clientY) / rect.height;
      setMobilePreviewRatio(Math.max(0.28, Math.min(0.72, next)));
    };

    const stop = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
      previewResizeCleanupRef.current = null;
    };

    const onMove = (moveEvent: PointerEvent) => {
      updateRatio(moveEvent.clientY);
    };

    previewResizeCleanupRef.current?.();
    previewResizeCleanupRef.current = stop;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
    updateRatio(event.clientY);
  }, [previewUri, isMobileSurface]);

  return (
    <div
      style={{
        height: '100%', width: '100%',
        display: 'flex', flexDirection: 'column',
        background: 'var(--zk-bg-0)', color: 'var(--zk-ink)',
        minHeight: 0,
      }}
    >
      <ViewHeader
        title="Memory"
        actions={
          <>
            {/* Source toggle — Memory (OpenViking) / Files (workspace) */}
            <div className="zk-seg" role="tablist" aria-label="Source">
              <button
                type="button"
                role="tab"
                aria-selected={source === 'memory'}
                aria-disabled={!ovEnabledForAgent}
                disabled={!ovEnabledForAgent}
                title={ovEnabledForAgent ? undefined : 'OpenViking is not enabled for this agent — toggle it on in agent config'}
                className={source === 'memory' ? 'is-active' : ''}
                onClick={() => { if (ovEnabledForAgent) setSource('memory'); }}
              >
                Memory
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={source === 'files'}
                className={source === 'files' ? 'is-active' : ''}
                onClick={() => setSource('files')}
              >
                Files
              </button>
            </div>
            <button
              type="button"
              className="zk-btn zk-btn--ghost zk-btn--icon"
              onClick={refreshActive}
              title="Refresh"
              aria-label="Refresh"
            >
              <RefreshCw size={13} />
            </button>
          </>
        }
      />

      {/* Agent chip strip — horizontal, always visible (high-frequency switch). */}
      <AgentChipStrip
        agents={agents}
        selectedId={agentId}
        onSelect={setAgentId}
      />

      {!selectedAgent ? (
        <div
          style={{
            flex: 1, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', textAlign: 'center',
            padding: '64px 16px',
          }}
        >
          <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--zk-ink)' }}>No agents yet</p>
          <p style={{ fontSize: 12, color: 'var(--zk-ink-mute)', marginTop: 4, fontFamily: 'var(--zk-font-mono)' }}>
            Configure an agent to browse its memory.
          </p>
        </div>
      ) : (
        <div ref={stackRef} className="flex flex-col lg:flex-row" style={{ flex: 1, minHeight: 0 }}>
          <div
            className="flex lg:w-[320px]"
            style={{
              flex: isMobileSurface ? (showMobilePreview ? `0 0 ${mobileBrowserBasis}` : 1) : undefined,
              flexShrink: isMobileSurface ? 1 : 0,
              borderRight: isMobileSurface ? '0' : '1px solid var(--zk-line)',
              borderBottom: isMobileSurface && showMobilePreview ? '1px solid var(--zk-line)' : undefined,
              flexDirection: 'column',
              minHeight: 0,
              background: 'var(--zk-bg-0)',
            }}
          >
            <TreeView
              agentId={selectedAgent.id}
              treeCache={agentCache}
              source={source}
              fetchList={fetchList}
              fetchContent={fetchContent}
              selectedUri={selectedFile ?? selectedFolder}
              onSelectFile={setSelectedFile}
              onSelectFolder={handleSelectFolder}
              expanded={expanded}
              setExpanded={setExpanded}
            />
          </div>

          {showMobilePreview && (
            <div className="lg:hidden flex-shrink-0" style={{ background: 'var(--zk-bg-0)' }}>
              <div
                role="separator"
                aria-orientation="horizontal"
                aria-label="Resize preview"
                onPointerDown={beginPreviewResize}
                style={{
                  height: 10,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'row-resize',
                  touchAction: 'none',
                }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    width: 40,
                    height: 4,
                    borderRadius: 999,
                    background: 'var(--zk-line-2)',
                  }}
                />
              </div>
            </div>
          )}

          <div
            className={`flex-col ${showPreviewPane ? 'flex' : 'hidden lg:flex'}`}
            style={{
              flex: isMobileSurface ? (showMobilePreview ? `0 0 ${mobilePreviewBasis}` : 1) : 1,
              minWidth: 0,
              minHeight: 0,
              flexDirection: 'column',
              background: 'var(--zk-bg-0)',
            }}
          >
            <Preview agentId={selectedAgent.id} previewUri={previewUri} isDirectory={previewIsDir} source={source} onBack={selectedFile ? () => setSelectedFile(null) : undefined} />
          </div>
        </div>
      )}
    </div>
  );
}
