import { Hash, PanelRightOpen, PanelRightClose, Menu, Wifi, WifiOff, Home, Cpu, Settings } from 'lucide-react';
import { useApp } from '../store/AppContext';
import GlitchText from './glitch/GlitchText';
import ScanlineTear from './glitch/ScanlineTear';
import { isNightCity } from '../lib/themeUtils';
import {
  getTopBarMobileIconButtonClass,
  getTopBarRightPanelButtonClass,
  getTopBarShellClass,
  resolveNavigationTheme,
} from './navigation/themeVariants';

export default function TopBar() {
  const {
    activeChannelName, viewMode, setViewMode,
    rightPanel, setRightPanel, closeRightPanel, sidebarOpen, setSidebarOpen,
    wsConnected, daemonConnected, theme, setSettingsOpen,
  } = useApp();
  const themeVariant = resolveNavigationTheme(theme, isNightCity());
  const nc = themeVariant === 'night-city';
  const wapo = themeVariant === 'washington-post';
  const carbon = themeVariant === 'carbon';
  const inHomeView = viewMode === 'channel' || viewMode === 'dm';

  return (
    <div className={getTopBarShellClass(themeVariant)}>
    <div className={`h-12 sm:h-14 flex items-center px-2 sm:px-4 gap-2 sm:gap-3`}>
      <ScanlineTear config={{ trigger: 'hover', minInterval: 200, maxInterval: 600, minSeverity: 0.3, maxSeverity: 0.8 }}>
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className={`lg:hidden ${getTopBarMobileIconButtonClass(themeVariant, 'cyan')}`}
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
            className={getTopBarMobileIconButtonClass(themeVariant, 'cyan', inHomeView)}
            title="Home"
            aria-label="Home"
          >
            <Home size={16} />
          </button>
        </ScanlineTear>

        <ScanlineTear config={{ trigger: 'hover', minInterval: 200, maxInterval: 600, minSeverity: 0.3, maxSeverity: 0.8 }}>
          <button
            onClick={() => setViewMode('agents')}
            className={getTopBarMobileIconButtonClass(themeVariant, 'green', viewMode === 'agents')}
            title="Agents"
            aria-label="Agents"
          >
            <Cpu size={16} />
          </button>
        </ScanlineTear>

        <ScanlineTear config={{ trigger: 'hover', minInterval: 200, maxInterval: 600, minSeverity: 0.3, maxSeverity: 0.8 }}>
          <button
            onClick={() => setSettingsOpen(true)}
            className={getTopBarMobileIconButtonClass(themeVariant, 'yellow')}
            title="Settings"
            aria-label="Settings"
          >
            <Settings size={16} />
          </button>
        </ScanlineTear>
      </div>

      <div className="flex items-center gap-2 min-w-0">
        {inHomeView && (
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
            className={getTopBarRightPanelButtonClass(themeVariant, !!rightPanel)}
            title={rightPanel ? 'Close Panel' : 'Open Panel'}
            aria-label={rightPanel ? 'Close side panel' : 'Open side panel'}
            aria-expanded={!!rightPanel}
          >
            {rightPanel ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
          </button>
        </ScanlineTear>

      </div>
    </div>
    </div>
  );
}
