import { Hop as Home, MessageSquare, Bot, Settings } from 'lucide-react';
import { useApp } from '../store/AppContext';

export default function WorkspaceRail() {
  const {
    setViewMode, setSettingsOpen, viewMode,
    wsConnected, daemonConnected,
  } = useApp();

  return (
    <div className="w-[72px] h-full bg-cyber-void-light border-r border-cyber-border flex flex-col items-center py-4 gap-3">
      <div className="w-10 h-10 bg-cyber-cyan/10 border border-cyber-cyan/40 font-display font-bold text-lg flex items-center justify-center text-cyber-cyan shadow-neon-cyan hex-corner">
        Z
      </div>

      <div className="w-8 border-t border-cyber-border my-1" />

      <button
        onClick={() => setViewMode('channel')}
        className={`
          w-10 h-10 border flex items-center justify-center transition-all duration-200
          ${viewMode === 'channel' || viewMode === 'dm'
            ? 'bg-cyber-cyan/10 text-cyber-cyan border-cyber-cyan/40 shadow-neon-cyan'
            : 'text-cyber-chrome-400 border-cyber-border hover:text-cyber-cyan hover:border-cyber-cyan/30'}
        `}
        title="Home"
      >
        <Home size={20} />
      </button>

      <button
        onClick={() => setViewMode('threads')}
        className={`
          w-10 h-10 border flex items-center justify-center transition-all duration-200
          ${viewMode === 'threads'
            ? 'bg-cyber-magenta/10 text-cyber-magenta border-cyber-magenta/40 shadow-neon-magenta'
            : 'text-cyber-chrome-400 border-cyber-border hover:text-cyber-magenta hover:border-cyber-magenta/30'}
        `}
        title="Threads"
      >
        <MessageSquare size={20} />
      </button>

      <button
        onClick={() => setViewMode('agents')}
        className={`
          w-10 h-10 border flex items-center justify-center transition-all duration-200
          ${viewMode === 'agents'
            ? 'bg-cyber-green/10 text-cyber-green border-cyber-green/40 shadow-neon-green'
            : 'text-cyber-chrome-400 border-cyber-border hover:text-cyber-green hover:border-cyber-green/30'}
        `}
        title="Agents"
      >
        <Bot size={20} />
      </button>

      <div className="flex-1" />

      <div className="flex flex-col items-center gap-2 mb-2">
        <div
          className={`w-3 h-3 rounded-full ${daemonConnected ? 'bg-cyber-green shadow-neon-green' : 'bg-cyber-chrome-600'}`}
          title={daemonConnected ? 'Daemon connected' : 'Daemon disconnected'}
        />
        <div
          className={`w-3 h-3 rounded-full ${wsConnected ? 'bg-cyber-cyan shadow-neon-cyan' : 'bg-cyber-red shadow-neon-red'}`}
          title={wsConnected ? 'WebSocket connected' : 'WebSocket disconnected'}
        />
      </div>

      <button
        onClick={() => setSettingsOpen(true)}
        className="w-10 h-10 border border-cyber-border flex items-center justify-center text-cyber-chrome-400 hover:text-cyber-cyan hover:border-cyber-cyan/30 transition-all duration-200"
        title="Settings"
      >
        <Settings size={20} />
      </button>
    </div>
  );
}
