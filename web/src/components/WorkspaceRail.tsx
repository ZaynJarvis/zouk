import { Home, MessagesSquare, FolderOpen, Cpu, Settings } from 'lucide-react';
import { useApp } from '../store/AppContext';
import ScanlineTear from './glitch/ScanlineTear';
import { isNightCity, ncStyle } from '../lib/themeUtils';
import {
  getWorkspaceRailButtonClass,
  resolveNavigationTheme,
  workspaceRailThemeConfig,
} from './navigation/themeVariants';

const hoverConfig = { trigger: 'hover' as const, minInterval: 200, maxInterval: 600, minSeverity: 0.3, maxSeverity: 0.8 };

export default function WorkspaceRail() {
  const { setViewMode, setSettingsOpen, viewMode, theme, rightPanel, setRightPanel } = useApp();
  const themeVariant = resolveNavigationTheme(theme, isNightCity());
  const nc = themeVariant === 'night-city';
  const wsOpen = rightPanel === 'workspace';
  const toggleWorkspace = () => setRightPanel(wsOpen ? null : 'workspace');
  const railTheme = workspaceRailThemeConfig[themeVariant];

  if (!nc) {
    return (
      <div className={railTheme.shell}>
        <div className={railTheme.logo} aria-hidden="true">
          Z
        </div>
        <div className={railTheme.divider} />

        <button onClick={() => setViewMode('channel')} className={getWorkspaceRailButtonClass(themeVariant, 'home', viewMode === 'channel' || viewMode === 'dm')} title={railTheme.homeButtonTitle} aria-label={railTheme.homeLabel}>
          <Home size={20} />
        </button>

        <button onClick={() => setViewMode('agents')} className={getWorkspaceRailButtonClass(themeVariant, 'agents', viewMode === 'agents')} title="Agents" aria-label="Agents">
          <Cpu size={20} />
        </button>

        <button onClick={toggleWorkspace} className={getWorkspaceRailButtonClass(themeVariant, 'workspace', wsOpen)} title="Workspace" aria-label="Workspace" aria-pressed={wsOpen}>
          <FolderOpen size={20} />
        </button>

        <div className="flex-1" />

        <button onClick={() => setSettingsOpen(true)} className={getWorkspaceRailButtonClass(themeVariant, 'settings', false)} title="Settings" aria-label="Settings">
          <Settings size={20} />
        </button>
      </div>
    );
  }

  // Night City rail — cyberpunk styling
  return (
    <div className={railTheme.shell}>
      <ScanlineTear>
        <div
          className={railTheme.logo}
          style={ncStyle({ textShadow: '0 0 8px rgb(var(--nc-cyan) / 0.5)' })}
          aria-hidden="true"
        >
          Z
        </div>
      </ScanlineTear>

      <div className={railTheme.divider} />

      <ScanlineTear config={hoverConfig}>
        <button
          onClick={() => setViewMode('channel')}
          className={getWorkspaceRailButtonClass(themeVariant, 'home', viewMode === 'channel' || viewMode === 'dm')}
          title={railTheme.homeButtonTitle}
          aria-label={railTheme.homeLabel}
        >
          <MessagesSquare size={20} />
        </button>
      </ScanlineTear>

      <ScanlineTear config={hoverConfig}>
        <button
          onClick={() => setViewMode('agents')}
          className={getWorkspaceRailButtonClass(themeVariant, 'agents', viewMode === 'agents')}
          title="Agents"
          aria-label="Agents"
        >
          <Cpu size={20} />
        </button>
      </ScanlineTear>

      <ScanlineTear config={hoverConfig}>
        <button
          onClick={toggleWorkspace}
          className={getWorkspaceRailButtonClass(themeVariant, 'workspace', wsOpen)}
          title="Workspace"
          aria-label="Workspace"
          aria-pressed={wsOpen}
        >
          <FolderOpen size={20} />
        </button>
      </ScanlineTear>

      <div className="flex-1" />

      <ScanlineTear config={{ trigger: 'hover', minInterval: 300, maxInterval: 800, minSeverity: 0.2, maxSeverity: 0.6 }}>
        <button
          onClick={() => setSettingsOpen(true)}
          className={getWorkspaceRailButtonClass(themeVariant, 'settings', false)}
          title="Settings"
          aria-label="Settings"
        >
          <Settings size={20} />
        </button>
      </ScanlineTear>
    </div>
  );
}
