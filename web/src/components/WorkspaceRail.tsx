import { MessagesSquare, GitBranch, Cpu, Settings } from 'lucide-react';
import { useApp } from '../store/AppContext';
import ScanlineTear from './glitch/ScanlineTear';

const hoverConfig = { trigger: 'hover' as const, minInterval: 200, maxInterval: 600, minSeverity: 0.3, maxSeverity: 0.8 };

export default function WorkspaceRail() {
  const {
    setViewMode, setSettingsOpen, viewMode,
    wsConnected, daemonConnected,
  } = useApp();
  return (
    <div className="w-[72px] h-full bg-nc-deep border-r border-nc-border flex flex-col items-center py-4 gap-3">
      <ScanlineTear>
        <div
          className="w-10 h-10 border border-nc-cyan bg-nc-cyan/10 font-display font-black text-lg flex items-center justify-center text-nc-cyan"
          style={{ textShadow: '0 0 8px rgba(94,246,255,0.5)' }}
        >
          Z
        </div>
      </ScanlineTear>

      <div className="w-8 cyber-divider my-1" />

      <ScanlineTear config={hoverConfig}>
        <button
          onClick={() => setViewMode('channel')}
          className={`
            cyber-btn w-10 h-10 border flex items-center justify-center
            ${viewMode === 'channel' || viewMode === 'dm'
              ? 'bg-nc-cyan/15 text-nc-cyan border-nc-cyan shadow-nc-cyan'
              : 'text-nc-muted border-nc-border hover:text-nc-cyan hover:border-nc-cyan/50'}
          `}
          title="Chat"
        >
          <MessagesSquare size={20} />
        </button>
      </ScanlineTear>

      <ScanlineTear config={hoverConfig}>
        <button
          onClick={() => setViewMode('threads')}
          className={`
            cyber-btn w-10 h-10 border flex items-center justify-center
            ${viewMode === 'threads'
              ? 'bg-nc-magenta/15 text-nc-magenta border-nc-magenta shadow-nc-magenta'
              : 'text-nc-muted border-nc-border hover:text-nc-magenta hover:border-nc-magenta/50'}
          `}
          title="Threads"
        >
          <GitBranch size={20} />
        </button>
      </ScanlineTear>

      <ScanlineTear config={hoverConfig}>
        <button
          onClick={() => setViewMode('agents')}
          className={`
            cyber-btn w-10 h-10 border flex items-center justify-center
            ${viewMode === 'agents'
              ? 'bg-nc-green/15 text-nc-green border-nc-green shadow-nc-green'
              : 'text-nc-muted border-nc-border hover:text-nc-green hover:border-nc-green/50'}
          `}
          title="Agents"
        >
          <Cpu size={20} />
        </button>
      </ScanlineTear>

      <div className="flex-1" />

      <div className="flex flex-col items-center gap-2 mb-2">
        <div
          className={`w-3 h-3 ${daemonConnected ? 'bg-nc-green shadow-nc-green' : 'bg-nc-muted/30'}`}
          title={daemonConnected ? 'Daemon connected' : 'Daemon disconnected'}
        />
        <div
          className={`w-3 h-3 ${wsConnected ? 'bg-nc-cyan shadow-nc-cyan' : 'bg-nc-red shadow-nc-red'}`}
          title={wsConnected ? 'WebSocket connected' : 'WebSocket disconnected'}
        />
      </div>

      <ScanlineTear config={{ trigger: 'hover', minInterval: 300, maxInterval: 800, minSeverity: 0.2, maxSeverity: 0.6 }}>
        <button
          onClick={() => setSettingsOpen(true)}
          className="cyber-btn w-10 h-10 border border-nc-border flex items-center justify-center text-nc-muted hover:text-nc-yellow hover:border-nc-yellow/50"
          title="Settings"
        >
          <Settings size={20} />
        </button>
      </ScanlineTear>
    </div>
  );
}
