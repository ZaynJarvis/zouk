import { Hash, PanelRightOpen, PanelRightClose, Menu, Wifi, WifiOff, Home, Cpu, FolderOpen, Settings } from 'lucide-react';
import { useApp } from '../store/AppContext';
import GlitchText from './glitch/GlitchText';
import ScanlineTear from './glitch/ScanlineTear';
import { isNightCity } from '../lib/themeUtils';

export default function TopBar() {
  const {
    activeChannelName, viewMode, setViewMode,
    rightPanel, setRightPanel, closeRightPanel, sidebarOpen, setSidebarOpen,
    wsConnected, daemonConnected, theme, setSettingsOpen,
  } = useApp();
  const nc = isNightCity();
  const wapo = theme === 'washington-post';
  const carbon = theme === 'carbon';

  return (
    <div className={`h-14 bg-nc-surface flex items-center px-2 sm:px-4 gap-2 sm:gap-3 scanline-overlay ${nc ? 'border-b border-nc-border' : (wapo || carbon) ? 'border-b border-nc-border' : 'border-b-[3px] border-nc-border-bright'}`}>
      <ScanlineTear config={{ trigger: 'hover', minInterval: 200, maxInterval: 600, minSeverity: 0.3, maxSeverity: 0.8 }}>
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className={`lg:hidden w-8 h-8 border flex items-center justify-center ${nc ? 'cyber-btn border-nc-border text-nc-muted hover:bg-nc-elevated hover:text-nc-cyan' : carbon ? 'border-nc-border text-nc-muted hover:bg-nc-elevated hover:text-nc-text-bright' : wapo ? 'border-nc-border text-nc-red hover:bg-nc-elevated' : 'border-2 border-nc-border text-nc-muted hover:bg-nc-elevated hover:text-nc-text-bright'}`}
          aria-label={sidebarOpen ? 'Close sidebar' : 'Open sidebar'}
          aria-expanded={sidebarOpen}
        >
          <Menu size={16} />
        </button>
      </ScanlineTear>

      <div className="lg:hidden flex items-center gap-1">
        <ScanlineTear config={{ trigger: 'hover', minInterval: 200, maxInterval: 600, minSeverity: 0.3, maxSeverity: 0.8 }}>
          <button
            onClick={() => setViewMode('channel')}
            className={`w-8 h-8 border flex items-center justify-center ${nc ? 'cyber-btn border-nc-border text-nc-muted hover:bg-nc-elevated hover:text-nc-cyan' : carbon ? 'border-nc-border text-nc-muted hover:bg-nc-elevated hover:text-nc-text-bright' : wapo ? 'border-nc-border text-nc-red hover:bg-nc-elevated' : 'border-2 border-nc-border text-nc-muted hover:bg-nc-elevated hover:text-nc-text-bright'} ${(viewMode === 'channel' || viewMode === 'dm') ? (nc ? 'border-nc-cyan text-nc-cyan' : wapo ? 'bg-nc-red text-nc-surface' : carbon ? 'bg-nc-cyan/15 text-nc-cyan border-nc-cyan' : 'bg-nc-yellow text-nc-text-bright border-nc-border-bright') : ''}`}
            title="Home"
            aria-label="Home"
          >
            <Home size={16} />
          </button>
        </ScanlineTear>

        <ScanlineTear config={{ trigger: 'hover', minInterval: 200, maxInterval: 600, minSeverity: 0.3, maxSeverity: 0.8 }}>
          <button
            onClick={() => setViewMode('agents')}
            className={`w-8 h-8 border flex items-center justify-center ${nc ? 'cyber-btn border-nc-border text-nc-muted hover:bg-nc-elevated hover:text-nc-green' : carbon ? 'border-nc-border text-nc-muted hover:bg-nc-elevated hover:text-nc-text-bright' : wapo ? 'border-nc-border text-nc-red hover:bg-nc-elevated' : 'border-2 border-nc-border text-nc-muted hover:bg-nc-elevated hover:text-nc-text-bright'} ${viewMode === 'agents' ? (nc ? 'border-nc-green text-nc-green' : wapo ? 'bg-nc-indigo text-nc-surface' : carbon ? 'bg-nc-green/15 text-nc-green border-nc-green' : 'bg-nc-green text-nc-text-bright border-nc-border-bright') : ''}`}
            title="Agents"
            aria-label="Agents"
          >
            <Cpu size={16} />
          </button>
        </ScanlineTear>

        <ScanlineTear config={{ trigger: 'hover', minInterval: 200, maxInterval: 600, minSeverity: 0.3, maxSeverity: 0.8 }}>
          <button
            onClick={() => setRightPanel(rightPanel === 'workspace' ? null : 'workspace')}
            className={`w-8 h-8 border flex items-center justify-center ${nc ? 'cyber-btn border-nc-border text-nc-muted hover:bg-nc-elevated hover:text-nc-magenta' : carbon ? 'border-nc-border text-nc-muted hover:bg-nc-elevated hover:text-nc-text-bright' : wapo ? 'border-nc-border text-nc-red hover:bg-nc-elevated' : 'border-2 border-nc-border text-nc-muted hover:bg-nc-elevated hover:text-nc-text-bright'} ${rightPanel === 'workspace' ? (nc ? 'border-nc-magenta text-nc-magenta' : wapo ? 'bg-nc-yellow text-nc-surface' : carbon ? 'bg-nc-magenta/15 text-nc-magenta border-nc-magenta' : 'bg-nc-cyan text-nc-text-bright border-nc-border-bright') : ''}`}
            title="Workspace"
            aria-label="Workspace"
            aria-pressed={rightPanel === 'workspace'}
          >
            <FolderOpen size={16} />
          </button>
        </ScanlineTear>

        <ScanlineTear config={{ trigger: 'hover', minInterval: 200, maxInterval: 600, minSeverity: 0.3, maxSeverity: 0.8 }}>
          <button
            onClick={() => setSettingsOpen(true)}
            className={`w-8 h-8 border flex items-center justify-center ${nc ? 'cyber-btn border-nc-border text-nc-muted hover:bg-nc-elevated hover:text-nc-yellow' : carbon ? 'border-nc-border text-nc-muted hover:bg-nc-elevated hover:text-nc-text-bright' : wapo ? 'border-nc-border text-nc-red hover:bg-nc-elevated' : 'border-2 border-nc-border text-nc-muted hover:bg-nc-elevated hover:text-nc-text-bright'}`}
            title="Settings"
            aria-label="Settings"
          >
            <Settings size={16} />
          </button>
        </ScanlineTear>
      </div>

      <div className="flex items-center gap-2 min-w-0">
        {(viewMode === 'channel' || viewMode === 'dm') && (
          <>
            {viewMode === 'channel' && <Hash size={18} className={`flex-shrink-0 ${nc ? 'text-nc-cyan' : 'text-nc-text-bright font-bold'}`} />}
            {nc
              ? <GlitchText as="h1" className="font-display font-extrabold text-lg text-nc-text-bright truncate tracking-wider" intensity="low">{activeChannelName}</GlitchText>
              : wapo
                ? <h1 className="font-display font-bold text-[1.1rem] text-nc-text-bright truncate">{activeChannelName}</h1>
                : <h1 className="font-display font-extrabold text-lg text-nc-text-bright truncate">{activeChannelName}</h1>
            }
          </>
        )}
        {viewMode === 'agents' && (
          nc
            ? <GlitchText as="h1" className="font-display font-extrabold text-lg text-nc-text-bright tracking-wider" intensity="low">Agents</GlitchText>
            : <h1 className="font-display font-extrabold text-lg text-nc-text-bright">Agents</h1>
        )}
      </div>

      <div className="flex-1" />

      <div className="hidden sm:flex items-center gap-2 text-xs">
        {nc ? (
          <>
            <span className={`status-chip-sm flex items-center gap-1 font-mono ${wsConnected ? 'tone-terminal' : 'tone-critical'}`}>
              {wsConnected ? <Wifi size={12} /> : <WifiOff size={12} />}
              <span>{wsConnected ? 'LINKED' : 'OFFLINE'}</span>
            </span>
            {daemonConnected && (
              <span className="status-chip-sm flex items-center gap-1 font-mono tone-telemetry">
                DAEMON
              </span>
            )}
          </>
        ) : wapo ? (
          <>
            <span className={`flex items-center gap-1 px-2.5 py-1 border rounded-full font-semibold ${wsConnected ? 'border-[#5b8770] text-[#335c4a] bg-[#f4fbf6]' : 'border-[#b55b60] text-[#8a3239] bg-[#fff4f3]'}`}>
              {wsConnected ? <Wifi size={12} /> : <WifiOff size={12} />}
              {wsConnected ? 'Linked' : 'Offline'}
            </span>
            {daemonConnected && (
              <span className="flex items-center gap-1 px-2.5 py-1 border rounded-full border-[#c1934c] text-[#8a6326] bg-[#fffbf1] font-semibold">
                Daemon
              </span>
            )}
          </>
        ) : carbon ? (
          <>
            <span className={`flex items-center gap-1 px-2.5 py-1 border rounded-full font-semibold ${wsConnected ? 'border-nc-green/40 bg-nc-green/10 text-nc-green' : 'border-nc-red/40 bg-nc-red/10 text-nc-red'}`}>
              {wsConnected ? <Wifi size={12} /> : <WifiOff size={12} />}
              {wsConnected ? 'Linked' : 'Offline'}
            </span>
            {daemonConnected && (
              <span className="flex items-center gap-1 px-2.5 py-1 border rounded-full border-nc-cyan/40 bg-nc-cyan/10 text-nc-cyan font-semibold">
                Daemon
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

      <div className="flex items-center gap-1">
        <ScanlineTear config={{ trigger: 'hover', minInterval: 200, maxInterval: 600, minSeverity: 0.3, maxSeverity: 0.8 }}>
          <button
            onClick={() => rightPanel ? closeRightPanel() : setRightPanel('details')}
            className={nc
              ? `cyber-btn w-8 h-8 border flex items-center justify-center ${rightPanel ? 'border-nc-yellow bg-nc-yellow/15 text-nc-yellow shadow-nc-yellow' : 'border-nc-border text-nc-muted hover:border-nc-yellow/50 hover:text-nc-yellow'}`
              : `w-8 h-8 border-2 flex items-center justify-center transition-all ${rightPanel ? 'border-nc-border-bright bg-[#FF6B00] text-nc-text-bright shadow-[2px_2px_0px_0px_#1A1A1A]' : 'border-nc-border text-nc-muted hover:border-nc-border-bright hover:text-nc-text-bright'}`
            }
            title={rightPanel ? 'Close Panel' : 'Open Panel'}
            aria-label={rightPanel ? 'Close side panel' : 'Open side panel'}
            aria-expanded={!!rightPanel}
          >
            {rightPanel ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
          </button>
        </ScanlineTear>

      </div>
    </div>
  );
}
