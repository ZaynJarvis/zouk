import { Home, MessagesSquare, FolderOpen, Cpu, Settings } from 'lucide-react';
import { useApp } from '../store/AppContext';
import ScanlineTear from './glitch/ScanlineTear';
import { isNightCity, ncStyle } from '../lib/themeUtils';

const hoverConfig = { trigger: 'hover' as const, minInterval: 200, maxInterval: 600, minSeverity: 0.3, maxSeverity: 0.8 };

export default function WorkspaceRail() {
  const { setViewMode, setSettingsOpen, viewMode, theme, rightPanel, setRightPanel } = useApp();
  const nc = isNightCity();
  const wapo = theme === 'washington-post';
  const wsOpen = rightPanel === 'workspace';
  const toggleWorkspace = () => setRightPanel(wsOpen ? null : 'workspace');

  const carbon = theme === 'carbon';

  if (!nc) {
    if (carbon) {
      return (
        <div className="w-[72px] h-full flex flex-col items-center py-4 gap-3 bg-nc-deep border-r border-nc-border">
          <div className="w-10 h-10 border border-nc-border bg-nc-cyan/10 font-display font-semibold text-lg flex items-center justify-center text-nc-text-bright" aria-hidden="true">
            Z
          </div>
          <div className="w-8 my-1 border-t border-nc-border" />

          <button onClick={() => setViewMode('channel')} className={`w-10 h-10 border flex items-center justify-center transition-all duration-100 ${viewMode === 'channel' || viewMode === 'dm' ? 'bg-nc-cyan/15 text-nc-cyan border-nc-cyan' : 'text-nc-muted border-nc-border hover:bg-nc-elevated hover:text-nc-text-bright'}`} title="Home" aria-label="Home">
            <Home size={20} />
          </button>

          <button onClick={() => setViewMode('agents')} className={`w-10 h-10 border flex items-center justify-center transition-all duration-100 ${viewMode === 'agents' ? 'bg-nc-green/15 text-nc-green border-nc-green' : 'text-nc-muted border-nc-border hover:bg-nc-elevated hover:text-nc-text-bright'}`} title="Agents" aria-label="Agents">
            <Cpu size={20} />
          </button>

          <button onClick={toggleWorkspace} className={`w-10 h-10 border flex items-center justify-center transition-all duration-100 ${wsOpen ? 'bg-nc-magenta/15 text-nc-magenta border-nc-magenta' : 'text-nc-muted border-nc-border hover:bg-nc-elevated hover:text-nc-text-bright'}`} title="Workspace" aria-label="Workspace" aria-pressed={wsOpen}>
            <FolderOpen size={20} />
          </button>

          <div className="flex-1" />

          <button onClick={() => setSettingsOpen(true)} className="w-10 h-10 border flex items-center justify-center transition-all duration-100 text-nc-muted border-nc-border hover:bg-nc-elevated hover:text-nc-text-bright" title="Settings" aria-label="Settings">
            <Settings size={20} />
          </button>
        </div>
      );
    }

    if (wapo) {
      return (
        <div className="w-[72px] h-full flex flex-col items-center py-4 gap-3 bg-nc-deep border-r border-nc-border">
          <div className="w-10 h-10 border border-nc-red bg-nc-surface font-display font-bold text-lg flex items-center justify-center text-nc-red" aria-hidden="true">
            Z
          </div>
          <div className="w-8 my-1 border-t border-nc-border" />

          <button onClick={() => setViewMode('channel')} className={`w-10 h-10 border flex items-center justify-center transition-all duration-100 ${viewMode === 'channel' || viewMode === 'dm' ? 'bg-nc-red text-nc-surface border-nc-red' : 'text-nc-red border-nc-border hover:bg-nc-elevated'}`} title="Home" aria-label="Home">
            <Home size={20} />
          </button>

          <button onClick={() => setViewMode('agents')} className={`w-10 h-10 border flex items-center justify-center transition-all duration-100 ${viewMode === 'agents' ? 'bg-nc-indigo text-nc-surface border-nc-indigo' : 'text-nc-red border-nc-border hover:bg-nc-elevated'}`} title="Agents" aria-label="Agents">
            <Cpu size={20} />
          </button>

          <button onClick={toggleWorkspace} className={`w-10 h-10 border flex items-center justify-center transition-all duration-100 ${wsOpen ? 'bg-nc-yellow text-nc-surface border-nc-yellow' : 'text-nc-red border-nc-border hover:bg-nc-elevated'}`} title="Workspace" aria-label="Workspace" aria-pressed={wsOpen}>
            <FolderOpen size={20} />
          </button>

          <div className="flex-1" />

          <button onClick={() => setSettingsOpen(true)} className="w-10 h-10 border flex items-center justify-center transition-all duration-100 text-nc-red border-nc-border hover:bg-nc-elevated" title="Settings" aria-label="Settings">
            <Settings size={20} />
          </button>
        </div>
      );
    }

    // Neo Brutalism rail — light bg, yellow active, thick black borders
    return (
      <div className="w-[72px] h-full flex flex-col items-center py-4 gap-3 bg-nc-deep border-r-[3px] border-nc-border-bright">
        <div className="w-10 h-10 border-2 border-nc-border-bright bg-nc-yellow font-display font-black text-lg flex items-center justify-center text-nc-text-bright" aria-hidden="true">
          Z
        </div>
        <div className="w-8 my-1 border-t-2 border-nc-border" />

        <button onClick={() => setViewMode('channel')} className={`w-10 h-10 border-2 flex items-center justify-center transition-all duration-100 ${viewMode === 'channel' || viewMode === 'dm' ? 'bg-nc-yellow text-nc-text-bright border-nc-border-bright shadow-[2px_2px_0px_0px_rgb(var(--nc-border-bright))]' : 'text-nc-muted border-nc-border hover:bg-nc-elevated hover:text-nc-text-bright'}`} title="Home" aria-label="Home">
          <Home size={20} />
        </button>

        <button onClick={() => setViewMode('agents')} className={`w-10 h-10 border-2 flex items-center justify-center transition-all duration-100 ${viewMode === 'agents' ? 'bg-nc-green text-nc-text-bright border-nc-border-bright shadow-[2px_2px_0px_0px_rgb(var(--nc-border-bright))]' : 'text-nc-muted border-nc-border hover:bg-nc-elevated hover:text-nc-text-bright'}`} title="Agents" aria-label="Agents">
          <Cpu size={20} />
        </button>

        <button onClick={toggleWorkspace} className={`w-10 h-10 border-2 flex items-center justify-center transition-all duration-100 ${wsOpen ? 'bg-nc-cyan text-nc-text-bright border-nc-border-bright shadow-[2px_2px_0px_0px_rgb(var(--nc-border-bright))]' : 'text-nc-muted border-nc-border hover:bg-nc-elevated hover:text-nc-text-bright'}`} title="Workspace" aria-label="Workspace" aria-pressed={wsOpen}>
          <FolderOpen size={20} />
        </button>

        <div className="flex-1" />

        <button onClick={() => setSettingsOpen(true)} className="w-10 h-10 border-2 flex items-center justify-center transition-all duration-100 text-nc-muted border-nc-border hover:bg-nc-elevated hover:text-nc-text-bright" title="Settings" aria-label="Settings">
          <Settings size={20} />
        </button>
      </div>
    );
  }

  // Night City rail — cyberpunk styling
  return (
    <div className="w-[72px] h-full bg-nc-deep border-r border-nc-border flex flex-col items-center py-4 gap-3">
      <ScanlineTear>
        <div
          className="w-10 h-10 border border-nc-cyan bg-nc-cyan/10 font-display font-black text-lg flex items-center justify-center text-nc-cyan"
          style={ncStyle({ textShadow: '0 0 8px rgb(var(--nc-cyan) / 0.5)' })}
          aria-hidden="true"
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
          aria-label="Chat"
        >
          <MessagesSquare size={20} />
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
          aria-label="Agents"
        >
          <Cpu size={20} />
        </button>
      </ScanlineTear>

      <ScanlineTear config={hoverConfig}>
        <button
          onClick={toggleWorkspace}
          className={`
            cyber-btn w-10 h-10 border flex items-center justify-center
            ${wsOpen
              ? 'bg-nc-magenta/15 text-nc-magenta border-nc-magenta shadow-nc-magenta'
              : 'text-nc-muted border-nc-border hover:text-nc-magenta hover:border-nc-magenta/50'}
          `}
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
          className="cyber-btn w-10 h-10 border border-nc-border flex items-center justify-center text-nc-muted hover:text-nc-yellow hover:border-nc-yellow/50"
          title="Settings"
          aria-label="Settings"
        >
          <Settings size={20} />
        </button>
      </ScanlineTear>
    </div>
  );
}
