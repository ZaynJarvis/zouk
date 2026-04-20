import { useState, useEffect, useCallback, useMemo, memo } from 'react';
import {
  Brain, ChevronRight, ChevronDown, File, Folder, FolderOpen,
  RefreshCw, X, ArrowLeft, Search, Plus,
} from 'lucide-react';
import { useApp } from '../store/AppContext';
import type { ServerAgent, MemoryEntry } from '../types';
import { isNightCity, ncStyle } from '../lib/themeUtils';

/** Extract display name from a viking:// URI */
function uriName(uri: string): string {
  // strip trailing slash, then take last segment
  const parts = uri.replace(/\/+$/, '').split('/').filter(Boolean);
  // "viking:" is part of the split — skip the scheme
  return parts.length > 1 ? parts[parts.length - 1] : parts[0] || uri;
}

// ---------------------------------------------------------------------------
// AgentAvatarStrip (same as WorkspacePanel — self-contained per panel convention)
// ---------------------------------------------------------------------------

function AgentAvatarStrip({
  agents,
  selectedId,
  onSelect,
}: {
  agents: ServerAgent[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const nc = isNightCity();
  const activeAgents = agents.filter(a => a.status === 'active');

  if (activeAgents.length === 0) {
    return (
      <div className="px-3 py-2 text-xs text-nc-muted font-mono">
        No active agents
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5 px-3 py-2 overflow-x-auto scrollbar-thin">
      {activeAgents.map((agent) => {
        const isSelected = agent.id === selectedId;
        const initial = (agent.displayName || agent.name).charAt(0).toUpperCase();
        const activityColor = agent.activity === 'working' || agent.activity === 'thinking'
          ? 'bg-nc-yellow'
          : agent.activity === 'online' ? 'bg-nc-green'
          : agent.activity === 'error' ? 'bg-nc-red'
          : 'bg-nc-muted/30';

        return (
          <button
            key={agent.id}
            onClick={() => onSelect(agent.id)}
            title={agent.displayName || agent.name}
            className={`relative w-8 h-8 flex-shrink-0 flex items-center justify-center font-display font-bold text-xs transition-all ${
              isSelected
                ? (nc
                  ? 'border border-nc-cyan bg-nc-cyan/15 text-nc-cyan shadow-nc-cyan'
                  : 'border-2 border-nc-border-bright bg-nc-yellow text-nc-text-bright shadow-[1px_1px_0px_0px_#1A1A1A]')
                : (nc
                  ? 'border border-nc-border bg-nc-elevated text-nc-muted hover:border-nc-cyan/50 hover:text-nc-text'
                  : 'border border-nc-border bg-nc-surface text-nc-muted hover:bg-nc-elevated')
            }`}
          >
            {agent.picture ? (
              <img src={agent.picture} alt="" className="w-full h-full object-cover" />
            ) : (
              initial
            )}
            <span className={`absolute -bottom-0.5 -right-0.5 w-2 h-2 ${activityColor} border border-nc-black`} />
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// MemoryToolbar — placeholder for future semantic search + add memory
// ---------------------------------------------------------------------------

function MemoryToolbar() {
  return (
    <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-nc-border">
      <div
        className="flex-1 flex items-center gap-1.5 px-2 py-1 border border-nc-border/50 bg-nc-panel opacity-40 cursor-not-allowed"
        title="Semantic search (coming soon)"
      >
        <Search size={10} className="text-nc-muted flex-shrink-0" />
        <span className="text-2xs text-nc-muted font-mono">Search memories...</span>
      </div>
      <button
        disabled
        className="w-6 h-6 border border-nc-border bg-nc-panel flex items-center justify-center opacity-40 cursor-not-allowed"
        title="Add memory (coming soon)"
      >
        <Plus size={10} className="text-nc-muted" />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// MemoryTreeNode
// ---------------------------------------------------------------------------

const MemoryTreeNode = memo(function MemoryTreeNode({
  entry,
  level,
  expandedDirs,
  treeCache,
  onToggleDir,
  onViewFile,
}: {
  entry: MemoryEntry;
  level: number;
  expandedDirs: Set<string>;
  treeCache: Record<string, MemoryEntry[]>;
  onToggleDir: (uri: string) => void;
  onViewFile: (uri: string) => void;
}) {
  const { uri, isDir } = entry;
  const isExpanded = isDir && expandedDirs.has(uri);
  const children = isDir ? treeCache[uri] : undefined;
  const name = uriName(uri);
  const contentPadding = { paddingLeft: `${12 + (level + 1) * 16}px` };

  return (
    <>
      <button
        onClick={() => isDir ? onToggleDir(uri) : onViewFile(uri)}
        className="w-full flex items-start gap-1.5 py-1 text-left hover:bg-nc-elevated transition-colors"
        style={{ paddingLeft: `${12 + level * 16}px`, paddingRight: '12px' }}
      >
        {isDir ? (
          <ChevronRight
            size={12}
            className={`flex-shrink-0 text-nc-muted transition-transform duration-150 mt-0.5 ${isExpanded ? 'rotate-90' : ''}`}
          />
        ) : (
          <span className="w-3 flex-shrink-0" />
        )}
        {isDir
          ? (isExpanded
            ? <FolderOpen size={12} className="flex-shrink-0 text-nc-yellow mt-0.5" />
            : <Folder size={12} className="flex-shrink-0 text-nc-yellow mt-0.5" />)
          : <File size={12} className="flex-shrink-0 text-nc-muted mt-0.5" />
        }
        <div className="flex-1 min-w-0">
          <span className="text-xs font-mono text-nc-text truncate block">{name}</span>
          {!isDir && entry.abstract && (
            <span className="text-2xs text-nc-muted font-mono truncate block leading-tight">
              {entry.abstract}
            </span>
          )}
        </div>
        {!isDir && entry.modTime && (
          <span className="text-2xs text-nc-muted flex-shrink-0 font-mono mt-0.5">
            {entry.modTime}
          </span>
        )}
      </button>
      {isDir && isExpanded && (
        <div
          className="overflow-hidden transition-[grid-template-rows] duration-200"
          style={{ display: 'grid', gridTemplateRows: '1fr' }}
        >
          <div className="min-h-0">
            {children ? (
              children.length > 0 ? (
                children.map((child) => (
                  <MemoryTreeNode
                    key={child.uri}
                    entry={child}
                    level={level + 1}
                    expandedDirs={expandedDirs}
                    treeCache={treeCache}
                    onToggleDir={onToggleDir}
                    onViewFile={onViewFile}
                  />
                ))
              ) : (
                <div className="text-2xs text-nc-muted font-mono py-1" style={contentPadding}>
                  (empty)
                </div>
              )
            ) : (
              <div className="text-2xs text-nc-muted font-mono py-1 animate-pulse" style={contentPadding}>
                loading...
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
});

// ---------------------------------------------------------------------------
// MemoryTree
// ---------------------------------------------------------------------------

function MemoryTree({
  agent,
  onViewFile,
}: {
  agent: ServerAgent;
  onViewFile: (uri: string) => void;
}) {
  const { memoryTreeCache, requestMemoryList } = useApp();
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const agentCache = useMemo(() => memoryTreeCache[agent.id] || {}, [memoryTreeCache, agent.id]);
  const rootEntries = useMemo(() => agentCache['viking:///'] || [], [agentCache]);

  useEffect(() => {
    if (agent.status === 'active') {
      requestMemoryList(agent.id);
    }
  }, [agent.id, agent.status, requestMemoryList]);

  const handleToggleDir = useCallback((uri: string) => {
    setExpandedDirs(prev => {
      const next = new Set(prev);
      if (next.has(uri)) {
        next.delete(uri);
      } else {
        next.add(uri);
        if (!agentCache[uri]) {
          requestMemoryList(agent.id, uri);
        }
      }
      return next;
    });
  }, [agent.id, agentCache, requestMemoryList]);

  const handleRefresh = useCallback(() => {
    requestMemoryList(agent.id);
    setExpandedDirs(new Set());
  }, [agent.id, requestMemoryList]);

  if (agent.status !== 'active') {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center py-8">
        <Brain size={20} className="text-nc-muted mb-2" />
        <p className="text-xs text-nc-muted font-mono">AGENT_OFFLINE</p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-nc-border">
        <span className="flex-1 text-xs font-mono text-nc-muted truncate">
          viking:///
        </span>
        <button
          onClick={handleRefresh}
          className="w-6 h-6 border border-nc-border bg-nc-panel flex items-center justify-center hover:bg-nc-elevated hover:border-nc-cyan text-nc-muted hover:text-nc-cyan transition-colors"
          title="Refresh"
        >
          <RefreshCw size={10} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {rootEntries.length > 0 ? (
          <div className="py-0.5">
            {rootEntries.map((entry) => (
              <MemoryTreeNode
                key={entry.uri}
                entry={entry}
                level={0}
                expandedDirs={expandedDirs}
                treeCache={agentCache}
                onToggleDir={handleToggleDir}
                onViewFile={onViewFile}
              />
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center text-center py-8">
            <Brain size={18} className="text-nc-muted mb-2" />
            <p className="text-xs text-nc-muted font-mono">No memories</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// MemoryPreview
// ---------------------------------------------------------------------------

function MemoryPreview({
  agentId,
  uri,
  onClose,
}: {
  agentId: string;
  uri: string;
  onClose: () => void;
}) {
  const { memoryFileContent } = useApp();
  const nc = isNightCity();
  const match = memoryFileContent?.agentId === agentId && memoryFileContent?.uri === uri
    ? memoryFileContent
    : null;
  const content = match?.content ?? null;
  const fileName = uriName(uri);

  return (
    <div className="flex-1 flex flex-col min-h-0 border-t border-nc-border">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-nc-border bg-nc-elevated/50">
        <Brain size={12} className="text-nc-yellow flex-shrink-0" />
        <span className="flex-1 text-xs font-mono text-nc-text truncate" title={uri}>
          {fileName}
        </span>
        <button
          onClick={onClose}
          className="w-5 h-5 flex items-center justify-center text-nc-muted hover:text-nc-red transition-colors"
        >
          <X size={12} />
        </button>
      </div>
      <pre
        className="flex-1 overflow-auto p-3 text-xs font-mono text-nc-green whitespace-pre-wrap scrollbar-thin bg-nc-black/50"
        style={nc ? ncStyle({ textShadow: '0 0 4px rgb(var(--nc-green) / 0.3)' }) : undefined}
      >
        {content ?? 'Loading...'}
      </pre>
    </div>
  );
}

// ---------------------------------------------------------------------------
// MemoryPanel (default export)
// ---------------------------------------------------------------------------

export default function MemoryPanel() {
  const { agents, closeRightPanel, requestMemoryContent } = useApp();
  const nc = isNightCity();
  const activeAgents = agents.filter(a => a.status === 'active');
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [viewingUri, setViewingUri] = useState<string | null>(null);
  const [splitMode, setSplitMode] = useState(false);

  // Auto-select first active agent if none selected
  useEffect(() => {
    if (!selectedAgentId && activeAgents.length > 0) {
      setSelectedAgentId(activeAgents[0].id);
    }
    if (selectedAgentId && !activeAgents.find(a => a.id === selectedAgentId)) {
      setSelectedAgentId(activeAgents.length > 0 ? activeAgents[0].id : null);
      setViewingUri(null);
    }
  }, [activeAgents, selectedAgentId]);

  const handleSelectAgent = useCallback((id: string) => {
    setSelectedAgentId(id);
    setViewingUri(null);
  }, []);

  const handleViewFile = useCallback((uri: string) => {
    setViewingUri(uri);
    setSplitMode(true);
    if (selectedAgentId) {
      requestMemoryContent(selectedAgentId, uri);
    }
  }, [selectedAgentId, requestMemoryContent]);

  const handleClosePreview = useCallback(() => {
    setViewingUri(null);
    setSplitMode(false);
  }, []);

  const selectedAgent = activeAgents.find(a => a.id === selectedAgentId);

  return (
    <div className={`w-screen lg:w-[340px] xl:w-[380px] flex-shrink-0 flex flex-col h-full border-l ${
      nc ? 'border-nc-border bg-nc-deep' : 'border-nc-border bg-nc-surface'
    }`}>
      {/* Header */}
      <div className={`flex items-center justify-between px-3 py-2.5 border-b ${
        nc ? 'border-nc-border' : 'border-nc-border'
      }`}>
        <h3 className={`font-display font-bold text-xs tracking-wider ${
          nc ? 'text-nc-yellow' : 'text-nc-text-bright'
        }`}>
          {nc ? 'MEMORY' : 'Memory'}
        </h3>
        <div className="flex items-center gap-1">
          {viewingUri && (
            <button
              onClick={() => setSplitMode(!splitMode)}
              title={splitMode ? 'Full preview' : 'Split view'}
              className="w-6 h-6 flex items-center justify-center text-nc-muted hover:text-nc-yellow transition-colors"
            >
              <ChevronDown size={12} className={splitMode ? 'rotate-180' : ''} />
            </button>
          )}
          <button
            onClick={closeRightPanel}
            className="w-6 h-6 flex items-center justify-center text-nc-muted hover:text-nc-red transition-colors"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Agent avatar strip */}
      <div className={`border-b ${nc ? 'border-nc-border' : 'border-nc-border'}`}>
        <AgentAvatarStrip
          agents={agents}
          selectedId={selectedAgentId}
          onSelect={handleSelectAgent}
        />
      </div>

      {/* Toolbar — search + add placeholders */}
      <MemoryToolbar />

      {/* Selected agent info */}
      {selectedAgent && (
        <div className={`flex items-center gap-2 px-3 py-1.5 border-b text-xs ${
          nc ? 'border-nc-border bg-nc-elevated/30' : 'border-nc-border bg-nc-elevated'
        }`}>
          <span className={`font-bold font-mono ${nc ? 'text-nc-yellow' : 'text-nc-text-bright'}`}>
            @{selectedAgent.displayName || selectedAgent.name}
          </span>
          <span className="text-nc-muted font-mono">
            {selectedAgent.runtime || ''}{selectedAgent.model ? ` · ${selectedAgent.model}` : ''}
          </span>
        </div>
      )}

      {/* Content area */}
      {selectedAgent ? (
        <div className="flex-1 flex flex-col min-h-0">
          {splitMode && viewingUri ? (
            <>
              <div className="flex-1 min-h-0 flex flex-col" style={{ maxHeight: '50%' }}>
                <MemoryTree agent={selectedAgent} onViewFile={handleViewFile} />
              </div>
              <MemoryPreview
                agentId={selectedAgent.id}
                uri={viewingUri}
                onClose={handleClosePreview}
              />
            </>
          ) : viewingUri ? (
            <div className="flex-1 flex flex-col min-h-0">
              <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-nc-border">
                <button
                  onClick={handleClosePreview}
                  className="w-6 h-6 border border-nc-border bg-nc-panel flex items-center justify-center hover:bg-nc-elevated hover:border-nc-yellow text-nc-muted hover:text-nc-yellow transition-colors"
                >
                  <ArrowLeft size={12} />
                </button>
                <span className="text-xs font-mono text-nc-muted truncate">{viewingUri}</span>
              </div>
              <MemoryPreview
                agentId={selectedAgent.id}
                uri={viewingUri}
                onClose={handleClosePreview}
              />
            </div>
          ) : (
            <MemoryTree agent={selectedAgent} onViewFile={handleViewFile} />
          )}
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center text-center py-12 px-4">
          <Brain size={28} className={nc ? 'text-nc-yellow/30' : 'text-nc-muted'} />
          <p className={`text-sm font-bold mt-3 ${nc ? 'text-nc-yellow/50 font-mono' : 'text-nc-muted'}`}>
            {nc ? 'NO_ACTIVE_AGENTS' : 'No active agents'}
          </p>
          <p className="text-xs text-nc-muted mt-1 font-mono">
            Start an agent to browse its memory.
          </p>
        </div>
      )}
    </div>
  );
}
