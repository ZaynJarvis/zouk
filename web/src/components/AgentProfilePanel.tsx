import { useCallback, useEffect, useState } from 'react';
import {
  X, Bot, User as UserIcon, Activity, FolderOpen, Settings as SettingsIcon, MessageCircle,
} from 'lucide-react';
import { useApp } from '../store/AppContext';
import type { ServerAgent } from '../types';
import { activityLabels } from '../lib/activityStatus';
import { ncStyle } from '../lib/themeUtils';
import { formatRuntime } from '../lib/runtimeLabels';
import StatusDot from './StatusDot';
import { agentAvatarStatus, agentLifecycle, agentStatus, avatarPaletteClass, avatarRadiusClass } from '../lib/avatarStatus';
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
  const status = agentStatus(agent);
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
            <StatusDot status={status} ringClass="border-nc-surface" />
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

      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin">
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
      </div>
    </div>
  );
}
