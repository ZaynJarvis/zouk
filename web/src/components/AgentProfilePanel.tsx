import { useState, useEffect, useCallback, memo, useMemo } from 'react';
import {
  X, Bot, User as UserIcon, Activity, FolderOpen, File, Folder,
  ChevronRight, Server, Settings as SettingsIcon, Zap, MessageCircle,
} from 'lucide-react';
import { useApp } from '../store/AppContext';
import type { ServerAgent, WorkspaceFile } from '../types';
import { activityColors, activityLabels, getActivityColor } from '../lib/activityStatus';
import { formatRuntime } from '../lib/runtimeLabels';

type Tab = 'profile' | 'workspace' | 'activity';

const TAB_CONFIG: { key: Tab; label: string; icon: typeof Activity }[] = [
  { key: 'profile', label: 'PROFILE', icon: UserIcon },
  { key: 'workspace', label: 'FILES', icon: FolderOpen },
  { key: 'activity', label: 'ACTIVITY', icon: Activity },
];

const TreeNode = memo(function TreeNode({
  file, agentId, level, expandedDirs, treeCache, onToggleDir,
}: {
  file: WorkspaceFile;
  agentId: string;
  level: number;
  expandedDirs: Set<string>;
  treeCache: Record<string, WorkspaceFile[]>;
  onToggleDir: (dirPath: string) => void;
}) {
  const dirPath = file.path || file.name;
  const isDir = file.isDirectory;
  const isExpanded = isDir && expandedDirs.has(dirPath);
  const children = isDir ? treeCache[dirPath] : undefined;

  return (
    <>
      <button
        onClick={() => isDir && onToggleDir(dirPath)}
        disabled={!isDir}
        className="w-full flex items-center gap-1.5 py-1 text-left hover:bg-nc-elevated transition-colors disabled:cursor-default"
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

function ProfileTab({ agent }: { agent: ServerAgent }) {
  const { machines, openAgentSettings, selectChannel } = useApp();
  const machine = agent.machineId ? machines.find((m) => m.id === agent.machineId) : null;
  const activity = agent.activity || 'offline';
  const isActive = agent.status === 'active';

  return (
    <div className="flex-1 overflow-y-auto scrollbar-thin p-4 space-y-4">
      <div className="flex items-start gap-3">
        <div className="relative w-16 h-16 border border-nc-cyan/30 bg-nc-cyan/10 flex items-center justify-center shrink-0 overflow-hidden font-display font-bold text-xl text-nc-cyan">
          {agent.picture ? (
            <img src={agent.picture} alt="" className="w-full h-full object-cover" />
          ) : (
            (agent.displayName || agent.name).charAt(0).toUpperCase()
          )}
          <span className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 border border-nc-surface ${activityColors[activity]}`} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-display font-black text-lg text-nc-text-bright truncate tracking-wider">
            @{agent.displayName || agent.name}
          </div>
          <div className="text-2xs bg-nc-green/10 text-nc-green border border-nc-green/30 inline-block px-1.5 py-0.5 font-bold uppercase font-mono leading-none mt-1">
            Agent
          </div>
          <div className="text-xs text-nc-muted font-mono mt-1.5">
            {isActive ? activityLabels[activity] : 'INACTIVE'}
            {agent.activityDetail && isActive ? ` · ${agent.activityDetail}` : ''}
          </div>
        </div>
      </div>

      <div className="flex gap-2">
        <button
          onClick={() => selectChannel(agent.name, true)}
          className="cyber-btn flex items-center gap-1.5 px-3 py-1.5 border border-nc-cyan bg-nc-cyan/10 text-xs font-bold text-nc-cyan hover:bg-nc-cyan/20 font-mono"
        >
          <MessageCircle size={12} /> MESSAGE
        </button>
        <button
          onClick={() => openAgentSettings(agent.id)}
          className="cyber-btn flex items-center gap-1.5 px-3 py-1.5 border border-nc-border bg-nc-panel text-xs font-bold text-nc-muted hover:text-nc-cyan hover:border-nc-cyan font-mono"
        >
          <SettingsIcon size={12} /> CONFIG
        </button>
      </div>

      {agent.description && (
        <div>
          <div className="text-xs font-bold text-nc-muted mb-1.5 font-mono tracking-wider">DESCRIPTION</div>
          <p className="text-sm text-nc-text leading-relaxed">{agent.description}</p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="text-xs font-bold text-nc-muted mb-1 font-mono tracking-wider">RUNTIME</div>
          <div className="text-sm text-nc-text-bright font-mono">
            {formatRuntime(agent.runtime) || 'Unknown'}
          </div>
        </div>
        <div>
          <div className="text-xs font-bold text-nc-muted mb-1 font-mono tracking-wider">MODEL</div>
          <div className="text-sm text-nc-text-bright font-mono truncate">
            {agent.model || '—'}
          </div>
        </div>
      </div>

      {machine && (
        <div>
          <div className="flex items-center gap-1.5 text-xs font-bold text-nc-muted mb-1 font-mono tracking-wider">
            <Server size={11} className="text-nc-green" /> MACHINE
          </div>
          <div className="flex items-center gap-2 px-3 py-2 border border-nc-border bg-nc-elevated">
            <span className="w-2 h-2 bg-nc-green shrink-0" />
            <span className="font-bold text-sm text-nc-text-bright font-mono truncate">
              {machine.alias || machine.hostname}
            </span>
          </div>
        </div>
      )}

      {agent.channels && agent.channels.length > 0 && (
        <div>
          <div className="text-xs font-bold text-nc-muted mb-1.5 font-mono tracking-wider">CHANNELS</div>
          <div className="flex flex-wrap gap-1.5">
            {agent.channels.map((ch) => (
              <span key={ch} className="px-2 py-0.5 border border-nc-cyan/30 bg-nc-cyan/10 text-xs font-bold text-nc-cyan font-mono">
                #{ch}
              </span>
            ))}
          </div>
        </div>
      )}

      {agent.skills && agent.skills.length > 0 && (
        <div>
          <div className="text-xs font-bold text-nc-muted mb-1.5 font-mono tracking-wider">SKILLS</div>
          <div className="space-y-1.5">
            {agent.skills.map((s) => (
              <div key={s.id} className="flex items-start gap-2 p-2 border border-nc-border bg-nc-panel">
                <Zap size={12} className="text-nc-yellow shrink-0 mt-0.5" />
                <div className="min-w-0 flex-1">
                  <div className="font-bold text-sm text-nc-text-bright">{s.name}</div>
                  {s.description && <div className="text-xs text-nc-muted font-mono">{s.description}</div>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {agent.workDir && (
        <div>
          <div className="text-xs font-bold text-nc-muted mb-1 font-mono tracking-wider">WORK_DIR</div>
          <div className="p-2 border border-nc-border bg-nc-elevated text-xs font-mono text-nc-green break-all">
            {agent.workDir}
          </div>
        </div>
      )}
    </div>
  );
}

function WorkspaceTab({ agent }: { agent: ServerAgent }) {
  const { wsTreeCache, requestWorkspaceFiles } = useApp();
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const agentCache = useMemo(() => wsTreeCache[agent.id] || {}, [wsTreeCache, agent.id]);
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
        if (!agentCache[dirPath]) {
          requestWorkspaceFiles(agent.id, dirPath);
        }
      }
      return next;
    });
  }, [agent.id, agentCache, requestWorkspaceFiles]);

  if (agent.status !== 'active') {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center py-12 px-4">
        <FolderOpen size={24} className="text-nc-muted mb-2" />
        <p className="text-sm text-nc-muted font-bold font-mono">AGENT_OFFLINE</p>
        <p className="text-xs text-nc-muted mt-1 font-mono">Start the agent to browse its workspace.</p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="px-3 py-1.5 border-b border-nc-border">
        <span className="text-xs font-mono text-nc-muted truncate block">{agent.workDir || '/'}</span>
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
              />
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center text-center py-12">
            <FolderOpen size={20} className="text-nc-muted mb-2" />
            <p className="text-xs text-nc-muted font-mono">No files</p>
          </div>
        )}
      </div>
    </div>
  );
}

function ActivityTab({ agent }: { agent: ServerAgent }) {
  const entries = agent.entries || [];
  if (entries.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center py-12 px-4">
        <Activity size={24} className="text-nc-muted mb-2" />
        <p className="text-sm text-nc-muted font-bold font-mono">NO_ACTIVITY</p>
        <p className="text-xs text-nc-muted mt-1 font-mono">Activity will appear here when the agent starts working.</p>
      </div>
    );
  }
  return (
    <div className="flex-1 overflow-y-auto scrollbar-thin p-3 space-y-1">
      {entries.map((entry, i) => (
        <div
          key={i}
          className={`text-xs font-mono px-3 py-1.5 border ${
            entry.kind === 'status'
              ? 'bg-nc-cyan/5 text-nc-cyan border-nc-cyan/20'
              : entry.kind === 'thinking'
                ? 'bg-nc-yellow/5 text-nc-yellow border-nc-yellow/20'
                : entry.kind === 'tool_start'
                  ? 'bg-nc-green/5 text-nc-green border-nc-green/20'
                  : 'bg-nc-elevated text-nc-muted border-nc-border'
          }`}
        >
          {entry.kind === 'text' && <span>{entry.text}</span>}
          {entry.kind === 'status' && (
            <span className="flex items-center gap-1.5">
              <span className={`w-1.5 h-1.5 ${getActivityColor(entry.activity)}`} />
              [{entry.activity}] {entry.detail || ''}
            </span>
          )}
          {entry.kind === 'thinking' && <span>THINKING: {entry.text || ''}</span>}
          {entry.kind === 'tool_start' && <span>TOOL: {entry.toolName}</span>}
        </div>
      ))}
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
      <div className="w-screen lg:w-[30vw] lg:min-w-[340px] lg:max-w-[520px] h-full border-l border-nc-border bg-nc-surface flex flex-col items-center justify-center">
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
    <div className="w-screen lg:w-[30vw] lg:min-w-[340px] lg:max-w-[520px] h-full border-l border-nc-border bg-nc-surface flex flex-col animate-slide-in-right">
      <div className="h-14 border-b border-nc-border flex items-center justify-between px-4 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <Bot size={14} className="text-nc-cyan shrink-0" />
          <h3 className="font-display font-extrabold text-base text-nc-text-bright tracking-wider truncate">
            @{agent.displayName || agent.name}
          </h3>
        </div>
        <button
          onClick={closeRightPanel}
          className="w-8 h-8 border border-nc-border flex items-center justify-center text-nc-muted hover:border-nc-red hover:text-nc-red hover:bg-nc-red/10 transition-all shrink-0"
          title="Close"
        >
          <X size={16} />
        </button>
      </div>

      <div className="flex border-b border-nc-border px-2 shrink-0">
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
      </div>

      <div className="flex-1 min-h-0 flex flex-col">
        {tab === 'profile' && <ProfileTab agent={agent} />}
        {tab === 'workspace' && <WorkspaceTab agent={agent} />}
        {tab === 'activity' && <ActivityTab agent={agent} />}
      </div>
    </div>
  );
}
