import { useState, useEffect, useCallback, memo } from 'react';
import {
  FolderOpen, File, Folder, ChevronRight, RefreshCw, X, ArrowLeft,
  ChevronDown, Eye,
} from 'lucide-react';
import { useApp } from '../store/AppContext';
import type { ServerAgent, WorkspaceFile } from '../types';
import { isNightCity, ncStyle } from '../lib/themeUtils';

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

const TreeNode = memo(function TreeNode({
  file,
  agentId,
  level,
  expandedDirs,
  treeCache,
  onToggleDir,
  onViewFile,
}: {
  file: WorkspaceFile;
  agentId: string;
  level: number;
  expandedDirs: Set<string>;
  treeCache: Record<string, WorkspaceFile[]>;
  onToggleDir: (dirPath: string) => void;
  onViewFile: (path: string) => void;
}) {
  const dirPath = file.path || file.name;
  const isDir = file.isDirectory;
  const isExpanded = isDir && expandedDirs.has(dirPath);
  const children = isDir ? treeCache[dirPath] : undefined;

  return (
    <>
      <button
        onClick={() => isDir ? onToggleDir(dirPath) : onViewFile(dirPath)}
        className="w-full flex items-center gap-1.5 py-1 text-left hover:bg-nc-elevated transition-colors"
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
            ? <FolderOpen size={12} className="flex-shrink-0 text-nc-yellow" />
            : <Folder size={12} className="flex-shrink-0 text-nc-yellow" />)
          : <File size={12} className="flex-shrink-0 text-nc-muted" />
        }
        <span className="flex-1 text-xs font-mono text-nc-text truncate">{file.name}</span>
        {!isDir && file.size !== undefined && (
          <span className="text-2xs text-nc-muted flex-shrink-0 font-mono">
            {file.size < 1024 ? `${file.size}B` : `${(file.size / 1024).toFixed(1)}K`}
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
                  <TreeNode
                    key={child.path || child.name}
                    file={child}
                    agentId={agentId}
                    level={level + 1}
                    expandedDirs={expandedDirs}
                    treeCache={treeCache}
                    onToggleDir={onToggleDir}
                    onViewFile={onViewFile}
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
        </div>
      )}
    </>
  );
});

function FileTree({
  agent,
  onViewFile,
}: {
  agent: ServerAgent;
  onViewFile: (path: string) => void;
}) {
  const { wsTreeCache, requestWorkspaceFiles } = useApp();
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const agentCache = wsTreeCache[agent.id] || {};
  const rootFiles = agentCache[''] || [];

  useEffect(() => {
    if (agent.status === 'active') {
      requestWorkspaceFiles(agent.id);
    }
  }, [agent.id, agent.status, requestWorkspaceFiles]);

  const handleToggleDir = useCallback((dirPath: string) => {
    setExpandedDirs(prev => {
      const next = new Set(prev);
      if (next.has(dirPath)) {
        next.delete(dirPath);
      } else {
        next.add(dirPath);
        // Request children if not cached
        if (!agentCache[dirPath]) {
          requestWorkspaceFiles(agent.id, dirPath);
        }
      }
      return next;
    });
  }, [agent.id, agentCache, requestWorkspaceFiles]);

  const handleRefresh = useCallback(() => {
    requestWorkspaceFiles(agent.id);
    setExpandedDirs(new Set());
  }, [agent.id, requestWorkspaceFiles]);

  if (agent.status !== 'active') {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center py-8">
        <FolderOpen size={20} className="text-nc-muted mb-2" />
        <p className="text-xs text-nc-muted font-mono">AGENT_OFFLINE</p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-nc-border">
        <span className="flex-1 text-xs font-mono text-nc-muted truncate">
          {agent.workDir || '/'}
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
        {rootFiles.length > 0 ? (
          <div className="py-0.5">
            {rootFiles.map((f) => (
              <TreeNode
                key={f.path || f.name}
                file={f}
                agentId={agent.id}
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
            <FolderOpen size={18} className="text-nc-muted mb-2" />
            <p className="text-xs text-nc-muted font-mono">No files</p>
          </div>
        )}
      </div>
    </div>
  );
}

function FilePreview({
  agentId,
  filePath,
  onClose,
}: {
  agentId: string;
  filePath: string;
  onClose: () => void;
}) {
  const { workspaceFileContent } = useApp();
  const nc = isNightCity();
  const content = workspaceFileContent?.agentId === agentId && workspaceFileContent?.path === filePath
    ? workspaceFileContent.content
    : null;

  const fileName = filePath.split('/').pop() || filePath;

  return (
    <div className="flex-1 flex flex-col min-h-0 border-t border-nc-border">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-nc-border bg-nc-elevated/50">
        <Eye size={12} className="text-nc-cyan flex-shrink-0" />
        <span className="flex-1 text-xs font-mono text-nc-text truncate" title={filePath}>
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

export default function WorkspacePanel() {
  const { agents, closeRightPanel, requestFileContent } = useApp();
  const nc = isNightCity();
  const activeAgents = agents.filter(a => a.status === 'active');
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [viewingFile, setViewingFile] = useState<string | null>(null);
  const [splitMode, setSplitMode] = useState(false);
  const [profileExpanded, setProfileExpanded] = useState(true);

  // Auto-select first active agent if none selected
  useEffect(() => {
    if (!selectedAgentId && activeAgents.length > 0) {
      setSelectedAgentId(activeAgents[0].id);
    }
    // Clear selection if selected agent is no longer active
    if (selectedAgentId && !activeAgents.find(a => a.id === selectedAgentId)) {
      setSelectedAgentId(activeAgents.length > 0 ? activeAgents[0].id : null);
      setViewingFile(null);
    }
  }, [activeAgents, selectedAgentId]);

  const handleSelectAgent = useCallback((id: string) => {
    setSelectedAgentId(id);
    setViewingFile(null);
  }, []);

  const handleViewFile = useCallback((path: string) => {
    setViewingFile(path);
    setSplitMode(true);
    if (selectedAgentId) {
      requestFileContent(selectedAgentId, path);
    }
  }, [selectedAgentId, requestFileContent]);

  const handleClosePreview = useCallback(() => {
    setViewingFile(null);
    setSplitMode(false);
  }, []);

  const selectedAgent = activeAgents.find(a => a.id === selectedAgentId);

  return (
    <div className={`w-[340px] xl:w-[380px] flex-shrink-0 flex flex-col h-full border-l ${
      nc ? 'border-nc-border bg-nc-deep' : 'border-nc-border bg-nc-surface'
    }`}>
      {/* Header */}
      <div className={`flex items-center justify-between px-3 py-2.5 border-b ${
        nc ? 'border-nc-border' : 'border-nc-border'
      }`}>
        <h3 className={`font-display font-bold text-xs tracking-wider ${
          nc ? 'text-nc-cyan' : 'text-nc-text-bright'
        }`}>
          {nc ? 'WORKSPACE' : 'Workspace'}
        </h3>
        <div className="flex items-center gap-1">
          {viewingFile && (
            <button
              onClick={() => setSplitMode(!splitMode)}
              title={splitMode ? 'Full preview' : 'Split view'}
              className="w-6 h-6 flex items-center justify-center text-nc-muted hover:text-nc-cyan transition-colors"
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

      {/* Selected agent info */}
      {selectedAgent && (
        <div className={`border-b text-xs ${nc ? 'border-nc-border bg-nc-elevated/30' : 'border-nc-border bg-nc-elevated'}`}>
          <button
            onClick={() => setProfileExpanded((open) => !open)}
            className="w-full flex items-center gap-2 px-3 py-2 text-left"
          >
            <div className={`w-9 h-9 shrink-0 border overflow-hidden font-display font-bold text-sm flex items-center justify-center ${nc ? 'border-nc-cyan/40 bg-nc-cyan/10 text-nc-cyan' : 'border-nc-border bg-nc-panel text-nc-text-bright'}`}>
              {selectedAgent.picture ? (
                <img src={selectedAgent.picture} alt="" className="w-full h-full object-cover" />
              ) : (
                (selectedAgent.displayName || selectedAgent.name).charAt(0).toUpperCase()
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className={`font-bold font-mono truncate ${nc ? 'text-nc-cyan' : 'text-nc-text-bright'}`}>
                @{selectedAgent.displayName || selectedAgent.name}
              </div>
              <div className="text-nc-muted font-mono truncate">
                {selectedAgent.runtime || 'unknown'}{selectedAgent.model ? ` · ${selectedAgent.model}` : ''}
              </div>
            </div>
            <ChevronDown size={12} className={`text-nc-muted transition-transform ${profileExpanded ? 'rotate-180' : ''}`} />
          </button>
          {profileExpanded && (
            <div className="px-3 pb-2">
              {selectedAgent.description && (
                <p className="text-nc-text text-xs leading-5 mb-1.5">
                  {selectedAgent.description}
                </p>
              )}
              <div className="text-nc-muted font-mono text-2xs">
                {selectedAgent.workDir || '/'}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Content area */}
      {selectedAgent ? (
        <div className="flex-1 flex flex-col min-h-0">
          {splitMode && viewingFile ? (
            <>
              <div className="flex-1 min-h-0 flex flex-col" style={{ maxHeight: '50%' }}>
                <FileTree agent={selectedAgent} onViewFile={handleViewFile} />
              </div>
              <FilePreview
                agentId={selectedAgent.id}
                filePath={viewingFile}
                onClose={handleClosePreview}
              />
            </>
          ) : viewingFile ? (
            <div className="flex-1 flex flex-col min-h-0">
              <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-nc-border">
                <button
                  onClick={handleClosePreview}
                  className="w-6 h-6 border border-nc-border bg-nc-panel flex items-center justify-center hover:bg-nc-elevated hover:border-nc-cyan text-nc-muted hover:text-nc-cyan transition-colors"
                >
                  <ArrowLeft size={12} />
                </button>
                <span className="text-xs font-mono text-nc-muted truncate">{viewingFile}</span>
              </div>
              <FilePreview
                agentId={selectedAgent.id}
                filePath={viewingFile}
                onClose={handleClosePreview}
              />
            </div>
          ) : (
            <FileTree agent={selectedAgent} onViewFile={handleViewFile} />
          )}
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center text-center py-12 px-4">
          <FolderOpen size={28} className={nc ? 'text-nc-cyan/30' : 'text-nc-muted'} />
          <p className={`text-sm font-bold mt-3 ${nc ? 'text-nc-cyan/50 font-mono' : 'text-nc-muted'}`}>
            {nc ? 'NO_ACTIVE_AGENTS' : 'No active agents'}
          </p>
          <p className="text-xs text-nc-muted mt-1 font-mono">
            Start an agent to browse its workspace.
          </p>
        </div>
      )}
    </div>
  );
}
