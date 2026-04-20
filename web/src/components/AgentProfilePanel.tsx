import { useCallback, useEffect, useState } from 'react';
import {
  X, Bot, User as UserIcon, Activity, FolderOpen, Server, Settings as SettingsIcon, Zap, MessageCircle,
} from 'lucide-react';
import { useApp } from '../store/AppContext';
import type { ServerAgent } from '../types';
import { activityLabels } from '../lib/activityStatus';
import { ncStyle } from '../lib/themeUtils';
import { formatRuntime } from '../lib/runtimeLabels';
import { AgentActivityFeed } from './agent/AgentActivityFeed';
import { WorkspaceTree } from './workspace/WorkspaceTree';
import { useWorkspaceTree } from './workspace/useWorkspaceTree';

type Tab = 'profile' | 'workspace' | 'activity';

const TAB_CONFIG: { key: Tab; label: string; icon: typeof Activity }[] = [
  { key: 'profile', label: 'PROFILE', icon: UserIcon },
  { key: 'workspace', label: 'FILES', icon: FolderOpen },
  { key: 'activity', label: 'ACTIVITY', icon: Activity },
];

function ProfileTab({ agent }: { agent: ServerAgent }) {
  const { machines, openAgentSettings, selectChannel } = useApp();
  const machine = agent.machineId ? machines.find((m) => m.id === agent.machineId) : null;
  const activity = agent.activity || 'offline';
  const isActive = agent.status === 'active';

  return (
    <div className="flex-1 overflow-y-auto scrollbar-thin p-4 space-y-4">
      <div className="flex items-start gap-3">
        <div className="w-16 h-16 border border-nc-cyan/30 bg-nc-cyan/10 flex items-center justify-center shrink-0 overflow-hidden font-display font-bold text-xl text-nc-cyan">
          {agent.picture ? (
            <img src={agent.picture} alt="" className="w-full h-full object-cover" />
          ) : (
            (agent.displayName || agent.name).charAt(0).toUpperCase()
          )}
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
  const { workspaceFileContent, requestFileContent } = useApp();
  const [viewingFile, setViewingFile] = useState<string | null>(null);
  const { expandedDirs, rootFiles, toggleDir, treeCache } = useWorkspaceTree(agent);

  const fileContent = workspaceFileContent?.agentId === agent.id && workspaceFileContent?.path === viewingFile
    ? workspaceFileContent.content
    : null;

  const handleViewFile = useCallback((filePath: string) => {
    setViewingFile(filePath);
    requestFileContent(agent.id, filePath);
  }, [agent.id, requestFileContent]);

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
      <div
        className="flex flex-col min-h-0"
        style={viewingFile ? { maxHeight: '50%', flex: '1 1 0%' } : { flex: '1 1 0%' }}
      >
        <div className="px-3 py-1.5 border-b border-nc-border">
          <span className="text-xs font-mono text-nc-muted truncate block">{agent.workDir || '/'}</span>
        </div>
        <div className="flex-1 overflow-y-auto scrollbar-thin">
          {rootFiles.length > 0 ? (
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
          ) : (
            <div className="flex flex-col items-center justify-center text-center py-12">
              <FolderOpen size={20} className="text-nc-muted mb-2" />
              <p className="text-xs text-nc-muted font-mono">No files</p>
            </div>
          )}
        </div>
      </div>
      {viewingFile && (
        <div className="flex-1 flex flex-col min-h-0 border-t border-nc-border">
          <div className="flex items-center gap-2 px-3 py-1.5 border-b border-nc-border bg-nc-elevated/50">
            <span className="flex-1 text-xs font-mono text-nc-text truncate" title={viewingFile}>
              {viewingFile.split('/').pop() || viewingFile}
            </span>
            <button
              onClick={() => setViewingFile(null)}
              className="w-5 h-5 flex items-center justify-center text-nc-muted hover:text-nc-red transition-colors"
              title="Close preview"
            >
              <X size={12} />
            </button>
          </div>
          <pre
            className="flex-1 overflow-auto p-3 text-xs font-mono text-nc-green whitespace-pre-wrap scrollbar-thin bg-nc-black/50"
            style={ncStyle({ textShadow: '0 0 4px rgb(var(--nc-green) / 0.3)' })}
          >
            {fileContent ?? 'Loading...'}
          </pre>
        </div>
      )}
    </div>
  );
}

function ActivityTab({ agent }: { agent: ServerAgent }) {
  const { loadAgentActivities } = useApp();
  const entries = agent.entries || [];

  useEffect(() => {
    loadAgentActivities(agent.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent.id]);

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
    <AgentActivityFeed entries={entries} className="flex-1 overflow-y-auto scrollbar-thin p-3 space-y-1" />
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
