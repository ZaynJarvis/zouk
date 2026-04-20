import { Hash, PanelRightOpen, PanelRightClose, Menu, Home, Cpu, Settings } from 'lucide-react';
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
    theme, setSettingsOpen,
  } = useApp();
  const themeVariant = resolveNavigationTheme(theme, isNightCity());
  const nc = themeVariant === 'night-city';
  const wapo = themeVariant === 'washington-post';
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
