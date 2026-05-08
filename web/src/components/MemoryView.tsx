import { useState, useEffect, useCallback, useMemo, memo } from 'react';
import {
  Brain, ChevronRight, File, Folder, FolderOpen,
  RefreshCw, ArrowLeft, Search, Plus,
} from 'lucide-react';
import { useApp } from '../store/AppContext';
import type { ServerAgent, MemoryEntry } from '../types';
import { parseMarkdown } from '../lib/markdown';

function uriName(uri: string): string {
  const parts = uri.replace(/\/+$/, '').split('/').filter(Boolean);
  return parts.length > 1 ? parts[parts.length - 1] : parts[0] || uri;
}

function isMarkdownFile(uri: string): boolean {
  return /\.(md|mdx|markdown)$/i.test(uri);
}

// ---------------------------------------------------------------------------
// AgentSelector — horizontal strip of agent avatars
// ---------------------------------------------------------------------------

function AgentSelector({
  agents,
  selectedId,
  onSelect,
}: {
  agents: ServerAgent[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  if (agents.length === 0) {
    return (
      <div className="px-4 py-2.5 text-xs text-nc-muted font-mono">
        No agents
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 px-4 py-2.5 overflow-x-auto scrollbar-thin">
      {agents.map((agent) => {
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
            className={`relative flex items-center gap-2 px-3 py-1.5 text-xs font-mono transition-all flex-shrink-0 ${
              isSelected
                ? 'border border-nc-border-bright bg-nc-elevated text-nc-text-bright'
                : 'border border-transparent text-nc-muted hover:text-nc-text hover:bg-nc-elevated/50'
            }`}
          >
            <div className={`relative w-6 h-6 flex items-center justify-center font-display font-bold text-xs ${
              isSelected
                ? 'border border-nc-border-bright bg-nc-panel text-nc-text-bright'
                : 'border border-nc-border bg-nc-surface text-nc-muted'
            }`}>
              {agent.picture ? (
                <img src={agent.picture} alt="" className="w-full h-full object-cover" />
              ) : (
                initial
              )}
              <span className={`absolute -bottom-0.5 -right-0.5 w-2 h-2 ${activityColor} border border-nc-black`} />
            </div>
            <span>@{agent.displayName || agent.name}</span>
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// MemoryTreeNode
// ---------------------------------------------------------------------------

const TreeNode = memo(function TreeNode({
  entry,
  level,
  expandedDirs,
  treeCache,
  selectedUri,
  onToggleDir,
  onSelectFile,
}: {
  entry: MemoryEntry;
  level: number;
  expandedDirs: Set<string>;
  treeCache: Record<string, MemoryEntry[]>;
  selectedUri: string | null;
  onToggleDir: (uri: string) => void;
  onSelectFile: (uri: string) => void;
}) {
  const { uri, isDir } = entry;
  const isExpanded = isDir && expandedDirs.has(uri);
  const children = isDir ? treeCache[uri] : undefined;
  const name = uriName(uri);
  const isSelected = !isDir && uri === selectedUri;

  return (
    <>
      <button
        onClick={() => isDir ? onToggleDir(uri) : onSelectFile(uri)}
        className={`w-full flex items-center gap-1.5 py-1.5 text-left hover:bg-nc-elevated/60 transition-colors ${
          isSelected ? 'bg-nc-elevated' : ''
        }`}
        style={{ paddingLeft: `${12 + level * 16}px`, paddingRight: '12px' }}
      >
        {isDir ? (
          <ChevronRight
            size={12}
            className={`flex-shrink-0 text-nc-muted transition-transform duration-150 ${isExpanded ? 'rotate-90' : ''}`}
          />
        ) : (
          <span className="w-3 flex-shrink-0" />
        )}
        {isDir
          ? (isExpanded
            ? <FolderOpen size={14} className="flex-shrink-0 text-nc-yellow" />
            : <Folder size={14} className="flex-shrink-0 text-nc-yellow" />)
          : <File size={14} className="flex-shrink-0 text-nc-muted" />
        }
        <span className={`text-sm font-mono truncate ${isSelected ? 'text-nc-text-bright' : 'text-nc-text'}`}>
          {name}
        </span>
      </button>
      {isDir && isExpanded && (
        <div>
          {children ? (
            children.length > 0 ? (
              children.map((child) => (
                <TreeNode
                  key={child.uri}
                  entry={child}
                  level={level + 1}
                  expandedDirs={expandedDirs}
                  treeCache={treeCache}
                  selectedUri={selectedUri}
                  onToggleDir={onToggleDir}
                  onSelectFile={onSelectFile}
                />
              ))
            ) : (
              <div
                className="text-2xs text-nc-muted font-mono py-1"
                style={{ paddingLeft: `${12 + (level + 1) * 16}px` }}
              >
                (empty)
              </div>
            )
          ) : (
            <div
              className="text-2xs text-nc-muted font-mono py-1 animate-pulse"
              style={{ paddingLeft: `${12 + (level + 1) * 16}px` }}
            >
              loading...
            </div>
          )}
        </div>
      )}
    </>
  );
});

// ---------------------------------------------------------------------------
// TreePane — left side of the atlas-fs-style layout
// ---------------------------------------------------------------------------

function TreePane({
  agent,
  selectedUri,
  onSelectFile,
}: {
  agent: ServerAgent;
  selectedUri: string | null;
  onSelectFile: (uri: string) => void;
}) {
  const { memoryTreeCache, requestMemoryList } = useApp();
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const agentCache = useMemo(() => memoryTreeCache[agent.id] || {}, [memoryTreeCache, agent.id]);
  const rootEntries = useMemo(() => agentCache['viking:///'] || [], [agentCache]);

  useEffect(() => {
    requestMemoryList(agent.id);
  }, [agent.id, requestMemoryList]);

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

  return (
    <div className="flex flex-col min-h-0 h-full">
      {/* Tree header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-nc-border">
        <Brain size={14} className="text-nc-yellow flex-shrink-0" />
        <span className="flex-1 text-xs font-mono text-nc-muted truncate">
          viking:///
        </span>
        <button
          onClick={handleRefresh}
          className="w-6 h-6 border border-nc-border bg-nc-panel flex items-center justify-center hover:bg-nc-elevated hover:border-nc-border-bright text-nc-muted hover:text-nc-text transition-colors"
          title="Refresh"
        >
          <RefreshCw size={10} />
        </button>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-nc-border">
        <div
          className="flex-1 flex items-center gap-1.5 px-2 py-1 border border-nc-border/50 bg-nc-panel opacity-40 cursor-not-allowed"
          title="Semantic search (coming soon)"
        >
          <Search size={10} className="text-nc-muted flex-shrink-0" />
          <span className="text-2xs text-nc-muted font-mono">Search...</span>
        </div>
        <button
          disabled
          className="w-6 h-6 border border-nc-border bg-nc-panel flex items-center justify-center opacity-40 cursor-not-allowed"
          title="Add memory (coming soon)"
        >
          <Plus size={10} className="text-nc-muted" />
        </button>
      </div>

      {/* Tree */}
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {rootEntries.length > 0 ? (
          <div className="py-0.5">
            {rootEntries.map((entry) => (
              <TreeNode
                key={entry.uri}
                entry={entry}
                level={0}
                expandedDirs={expandedDirs}
                treeCache={agentCache}
                selectedUri={selectedUri}
                onToggleDir={handleToggleDir}
                onSelectFile={onSelectFile}
              />
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center text-center py-12">
            <Brain size={24} className="text-nc-muted mb-2" />
            <p className="text-xs text-nc-muted font-mono">No memories</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PreviewPane — right side, renders file content with markdown
// ---------------------------------------------------------------------------

function PreviewPane({
  agentId,
  uri,
  onBack,
}: {
  agentId: string;
  uri: string;
  onBack?: () => void;
}) {
  const { memoryFileContent } = useApp();
  const match = memoryFileContent?.agentId === agentId && memoryFileContent?.uri === uri
    ? memoryFileContent
    : null;
  const content = match?.content ?? null;
  const fileName = uriName(uri);
  const isMd = isMarkdownFile(uri);

  return (
    <div className="flex flex-col min-h-0 h-full">
      {/* Preview header */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-nc-border bg-nc-elevated/30">
        {onBack && (
          <button
            onClick={onBack}
            className="w-6 h-6 flex items-center justify-center text-nc-muted hover:text-nc-text transition-colors lg:hidden"
          >
            <ArrowLeft size={14} />
          </button>
        )}
        <File size={14} className="text-nc-muted flex-shrink-0" />
        <span className="flex-1 text-sm font-mono text-nc-text-bright truncate" title={uri}>
          {fileName}
        </span>
        <span className="text-2xs text-nc-muted font-mono flex-shrink-0">
          {uri}
        </span>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {content === null ? (
          <div className="flex items-center justify-center py-16">
            <span className="text-sm text-nc-muted font-mono animate-pulse">Loading...</span>
          </div>
        ) : isMd ? (
          <div className="p-4 sm:p-6 lg:p-8 max-w-3xl text-sm leading-relaxed">
            {parseMarkdown(content, [])}
          </div>
        ) : (
          <pre className="p-4 sm:p-6 lg:p-8 text-sm font-mono text-nc-text whitespace-pre-wrap break-words">
            {content}
          </pre>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// EmptyPreview — shown when no file is selected
// ---------------------------------------------------------------------------

function EmptyPreview() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center px-6">
      <Brain size={32} className="text-nc-muted/30 mb-3" />
      <p className="text-sm text-nc-muted">Select a file to preview</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// MemoryView — full-page atlas-fs-style layout
// ---------------------------------------------------------------------------

export default function MemoryView() {
  const { agents, requestMemoryContent } = useApp();
  const allAgents = agents;
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [selectedUri, setSelectedUri] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedAgentId && allAgents.length > 0) {
      setSelectedAgentId(allAgents[0].id);
    }
    if (selectedAgentId && !allAgents.find(a => a.id === selectedAgentId)) {
      setSelectedAgentId(allAgents.length > 0 ? allAgents[0].id : null);
      setSelectedUri(null);
    }
  }, [allAgents, selectedAgentId]);

  const handleSelectAgent = useCallback((id: string) => {
    setSelectedAgentId(id);
    setSelectedUri(null);
  }, []);

  const handleSelectFile = useCallback((uri: string) => {
    setSelectedUri(uri);
    if (selectedAgentId) {
      requestMemoryContent(selectedAgentId, uri);
    }
  }, [selectedAgentId, requestMemoryContent]);

  const handleBack = useCallback(() => {
    setSelectedUri(null);
  }, []);

  const selectedAgent = allAgents.find(a => a.id === selectedAgentId);

  return (
    <div className="flex flex-col h-full bg-nc-surface">
      {/* Agent selector strip */}
      <div className="border-b border-nc-border bg-nc-surface flex-shrink-0">
        <AgentSelector
          agents={allAgents}
          selectedId={selectedAgentId}
          onSelect={handleSelectAgent}
        />
      </div>

      {selectedAgent ? (
        <>
          {/* Desktop: side-by-side tree + preview */}
          <div className="hidden lg:flex flex-1 min-h-0">
            {/* Tree pane */}
            <div className="w-[280px] xl:w-[320px] flex-shrink-0 border-r border-nc-border bg-nc-surface">
              <TreePane
                agent={selectedAgent}
                selectedUri={selectedUri}
                onSelectFile={handleSelectFile}
              />
            </div>
            {/* Preview pane */}
            <div className="flex-1 min-w-0 bg-nc-panel">
              {selectedUri ? (
                <PreviewPane agentId={selectedAgent.id} uri={selectedUri} />
              ) : (
                <EmptyPreview />
              )}
            </div>
          </div>

          {/* Mobile: stacked tree / preview with navigation */}
          <div className="flex lg:hidden flex-1 min-h-0">
            {selectedUri ? (
              <div className="flex-1 flex flex-col min-h-0">
                <PreviewPane
                  agentId={selectedAgent.id}
                  uri={selectedUri}
                  onBack={handleBack}
                />
              </div>
            ) : (
              <div className="flex-1 min-h-0">
                <TreePane
                  agent={selectedAgent}
                  selectedUri={selectedUri}
                  onSelectFile={handleSelectFile}
                />
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center text-center py-16 px-4">
          <Brain size={36} className="text-nc-muted/30 mb-3" />
          <p className="text-sm font-bold text-nc-muted">No agents</p>
          <p className="text-xs text-nc-muted mt-1">
            Configure an agent to browse its memory.
          </p>
        </div>
      )}
    </div>
  );
}
