import { Hash, Users, PanelRightOpen, PanelRightClose, Menu, Wifi, WifiOff, MessageSquare, Bot, Settings } from 'lucide-react';
import { useApp } from '../store/AppContext';
import GlitchText from './glitch/GlitchText';
import ScanlineTear from './glitch/ScanlineTear';
import { isNightCity } from '../lib/themeUtils';

export default function TopBar() {
  const {
    activeChannelName, viewMode, setViewMode,
    rightPanel, setRightPanel, closeRightPanel, sidebarOpen, setSidebarOpen,
    wsConnected, daemonConnected, setSettingsOpen,
  } = useApp();
  const nc = isNightCity();

  return (
    <div className={`h-14 bg-nc-surface flex items-center px-2 sm:px-4 gap-2 sm:gap-3 scanline-overlay ${nc ? 'border-b border-nc-border' : 'border-b-[3px] border-nc-border-bright'}`}>
      <ScanlineTear config={{ trigger: 'hover', minInterval: 200, maxInterval: 600, minSeverity: 0.3, maxSeverity: 0.8 }}>
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className={`lg:hidden w-11 h-11 border flex items-center justify-center ${nc ? 'cyber-btn border-nc-border text-nc-muted hover:bg-nc-elevated hover:text-nc-cyan' : 'border-2 border-nc-border text-nc-muted hover:bg-nc-elevated hover:text-nc-text-bright'}`}
        >
          <Menu size={16} />
        </button>
      </ScanlineTear>

      <div className="flex items-center gap-2 min-w-0">
        {(viewMode === 'channel' || viewMode === 'dm') && (
          <>
            {viewMode === 'channel' && <Hash size={18} className={`flex-shrink-0 ${nc ? 'text-nc-cyan' : 'text-nc-text-bright font-bold'}`} />}
            {nc
              ? <GlitchText as="h1" className="font-display font-extrabold text-lg text-nc-text-bright truncate tracking-wider" intensity="low">{activeChannelName}</GlitchText>
              : <h1 className="font-display font-extrabold text-lg text-nc-text-bright truncate">{activeChannelName}</h1>
            }
          </>
        )}
        {viewMode === 'threads' && (
          nc
            ? <GlitchText as="h1" className="font-display font-extrabold text-lg text-nc-text-bright tracking-wider" intensity="low">Threads</GlitchText>
            : <h1 className="font-display font-extrabold text-lg text-nc-text-bright">Threads</h1>
        )}
        {viewMode === 'agents' && (
          nc
            ? <GlitchText as="h1" className="font-display font-extrabold text-lg text-nc-text-bright tracking-wider" intensity="low">Agents</GlitchText>
            : <h1 className="font-display font-extrabold text-lg text-nc-text-bright">Agents</h1>
        )}
      </div>

      <div className="flex-1" />

      <div className="flex items-center gap-2 text-xs">
        {nc ? (
          <>
            <span className={`status-chip-sm flex items-center gap-1 font-mono ${wsConnected ? 'tone-terminal' : 'tone-critical'}`}>
              {wsConnected ? <Wifi size={12} /> : <WifiOff size={12} />}
              <span className="hidden sm:inline">{wsConnected ? 'LINKED' : 'OFFLINE'}</span>
            </span>
            {daemonConnected && (
              <span className="status-chip-sm flex items-center gap-1 font-mono tone-telemetry">
                <span className="hidden sm:inline">DAEMON</span>
                <span className="sm:hidden">D</span>
              </span>
            )}
          </>
        ) : (
          <>
            <span className={`flex items-center gap-1 px-2 py-0.5 border-2 font-semibold ${wsConnected ? 'border-nc-green bg-[#D4F5E2] text-nc-text-bright' : 'border-nc-red bg-[#FED7D7] text-nc-text-bright'}`}>
              {wsConnected ? <Wifi size={12} /> : <WifiOff size={12} />}
              {wsConnected ? 'Connected' : 'Disconnected'}
            </span>
            {daemonConnected && (
              <span className="flex items-center gap-1 px-2 py-0.5 border-2 border-nc-cyan bg-[#D6EAFF] text-nc-text-bright font-semibold">
                Daemon
              </span>
            )}
          </>
        )}
      </div>

      {/* Mobile-only: view mode switches + settings (hidden on desktop where WorkspaceRail provides these) */}
      <div className="flex lg:hidden items-center gap-1">
        <button
          onClick={() => setViewMode('threads')}
          className={`cyber-btn w-11 h-11 border flex items-center justify-center transition-all
            ${viewMode === 'threads'
              ? 'border-nc-cyan bg-nc-cyan/15 text-nc-cyan shadow-nc-cyan'
              : 'border-nc-border text-nc-muted hover:border-nc-cyan/50 hover:text-nc-cyan'
            }`}
          title="Threads"
        >
          <MessageSquare size={14} />
        </button>
        <button
          onClick={() => setViewMode('agents')}
          className={`cyber-btn w-11 h-11 border flex items-center justify-center transition-all
            ${viewMode === 'agents'
              ? 'border-nc-green bg-nc-green/15 text-nc-green shadow-nc-green'
              : 'border-nc-border text-nc-muted hover:border-nc-green/50 hover:text-nc-green'
            }`}
          title="Agents"
        >
          <Bot size={14} />
        </button>
        <button
          onClick={() => setSettingsOpen(true)}
          className="cyber-btn w-11 h-11 border border-nc-border flex items-center justify-center text-nc-muted hover:border-nc-cyan/50 hover:text-nc-cyan transition-all"
          title="Settings"
        >
          <Settings size={14} />
        </button>
      </div>

      <div className="flex items-center gap-1">
        <ScanlineTear config={{ trigger: 'hover', minInterval: 200, maxInterval: 600, minSeverity: 0.3, maxSeverity: 0.8 }}>
          <button
            onClick={() => rightPanel === 'members' ? closeRightPanel() : setRightPanel('members')}
            className={nc
              ? `cyber-btn w-8 h-8 border flex items-center justify-center ${rightPanel === 'members' ? 'border-nc-cyan bg-nc-cyan/15 text-nc-cyan shadow-nc-cyan' : 'border-nc-border text-nc-muted hover:border-nc-cyan/50 hover:text-nc-cyan'}`
              : `w-8 h-8 border-2 flex items-center justify-center transition-all ${rightPanel === 'members' ? 'border-nc-border-bright bg-nc-cyan text-white shadow-[2px_2px_0px_0px_#1A1A1A]' : 'border-nc-border text-nc-muted hover:border-nc-border-bright hover:text-nc-text-bright'}`
            }
            title="Members"
          >
            <Users size={16} />
          </button>
        </ScanlineTear>

        <ScanlineTear config={{ trigger: 'hover', minInterval: 200, maxInterval: 600, minSeverity: 0.3, maxSeverity: 0.8 }}>
          <button
            onClick={() => rightPanel ? closeRightPanel() : setRightPanel('details')}
            className={nc
              ? `cyber-btn w-8 h-8 border flex items-center justify-center ${rightPanel ? 'border-nc-yellow bg-nc-yellow/15 text-nc-yellow shadow-nc-yellow' : 'border-nc-border text-nc-muted hover:border-nc-yellow/50 hover:text-nc-yellow'}`
              : `w-8 h-8 border-2 flex items-center justify-center transition-all ${rightPanel ? 'border-nc-border-bright bg-[#FF6B00] text-nc-text-bright shadow-[2px_2px_0px_0px_#1A1A1A]' : 'border-nc-border text-nc-muted hover:border-nc-border-bright hover:text-nc-text-bright'}`
            }
            title={rightPanel ? 'Close Panel' : 'Open Panel'}
          >
            {rightPanel ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
          </button>
        </ScanlineTear>
      </div>
    </div>
  );
}
