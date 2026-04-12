import { Hash, Users, PanelRightOpen, PanelRightClose, Menu, Wifi, WifiOff } from 'lucide-react';
import { useApp } from '../store/AppContext';

export default function TopBar() {
  const {
    activeChannelName, viewMode,
    rightPanel, setRightPanel, closeRightPanel, sidebarOpen, setSidebarOpen,
    wsConnected, daemonConnected,
  } = useApp();

  return (
    <div className="h-14 border-b border-cyber-border bg-cyber-surface flex items-center px-4 gap-3">
      <button
        onClick={() => setSidebarOpen(!sidebarOpen)}
        className="lg:hidden w-8 h-8 border border-cyber-border flex items-center justify-center hover:bg-cyber-elevated hover:text-cyber-cyan transition-colors"
      >
        <Menu size={16} />
      </button>

      <div className="flex items-center gap-2 min-w-0">
        {(viewMode === 'channel' || viewMode === 'dm') && (
          <>
            {viewMode === 'channel' && <Hash size={18} className="flex-shrink-0 text-cyber-cyan" />}
            <h1 className="font-display font-bold text-lg text-cyber-chrome-50 truncate tracking-wide">
              {activeChannelName}
            </h1>
          </>
        )}
        {viewMode === 'threads' && (
          <h1 className="font-display font-bold text-lg text-cyber-chrome-50 tracking-wide">THREADS</h1>
        )}
        {viewMode === 'agents' && (
          <h1 className="font-display font-bold text-lg text-cyber-chrome-50 tracking-wide">AGENTS</h1>
        )}
      </div>

      <div className="flex-1" />

      <div className="flex items-center gap-2 text-xs">
        <span className={`flex items-center gap-1 px-2 py-0.5 border font-mono text-2xs tracking-wider ${
          wsConnected
            ? 'border-cyber-green/30 bg-cyber-green/5 text-cyber-green'
            : 'border-cyber-red/30 bg-cyber-red/5 text-cyber-red'
        }`}>
          {wsConnected ? <Wifi size={12} /> : <WifiOff size={12} />}
          {wsConnected ? 'ONLINE' : 'OFFLINE'}
        </span>
        {daemonConnected && (
          <span className="flex items-center gap-1 px-2 py-0.5 border border-cyber-cyan/30 bg-cyber-cyan/5 text-cyber-cyan font-mono text-2xs tracking-wider">
            DAEMON
          </span>
        )}
      </div>

      <div className="flex items-center gap-1">
        <button
          onClick={() => rightPanel === 'members' ? closeRightPanel() : setRightPanel('members')}
          className={`w-8 h-8 border flex items-center justify-center transition-all duration-200
            ${rightPanel === 'members'
              ? 'border-cyber-cyan/40 bg-cyber-cyan/10 text-cyber-cyan shadow-neon-cyan'
              : 'border-cyber-border text-cyber-chrome-400 hover:border-cyber-cyan/30 hover:text-cyber-cyan'
            }`}
          title="Members"
        >
          <Users size={16} />
        </button>

        <button
          onClick={() => rightPanel ? closeRightPanel() : setRightPanel('details')}
          className={`w-8 h-8 border flex items-center justify-center transition-all duration-200
            ${rightPanel
              ? 'border-cyber-magenta/40 bg-cyber-magenta/10 text-cyber-magenta shadow-neon-magenta'
              : 'border-cyber-border text-cyber-chrome-400 hover:border-cyber-magenta/30 hover:text-cyber-magenta'
            }`}
          title={rightPanel ? 'Close Panel' : 'Open Panel'}
        >
          {rightPanel ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
        </button>
      </div>
    </div>
  );
}
