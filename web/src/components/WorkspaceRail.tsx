import { Home, MessagesSquare, GitBranch, Cpu, Settings } from 'lucide-react';
import { useApp } from '../store/AppContext';
import ScanlineTear from './glitch/ScanlineTear';
import { isNightCity, ncStyle } from '../lib/themeUtils';

const hoverConfig = { trigger: 'hover' as const, minInterval: 200, maxInterval: 600, minSeverity: 0.3, maxSeverity: 0.8 };

export default function WorkspaceRail() {
  const { setViewMode, setSettingsOpen, viewMode } = useApp();
  const nc = isNightCity();

  if (!nc) {
    // Neo Brutalism rail — dark bg, yellow active, thick borders
    return (
      <div className="w-[72px] h-full flex flex-col items-center py-4 gap-3" style={{ background: '#2E2A26', borderRight: '3px solid #1A1A1A' }}>
        <div className="w-10 h-10 border-2 font-display font-black text-lg flex items-center justify-center" style={{ background: '#facc15', borderColor: '#facc15', color: '#1A1A1A' }}>
          S
        </div>
        <div className="w-8 my-1" style={{ borderTop: '2px solid #68645A' }} />

        <button onClick={() => setViewMode('channel')} className={`w-10 h-10 border-2 flex items-center justify-center transition-all duration-100 ${viewMode === 'channel' || viewMode === 'dm' ? 'shadow-[2px_2px_0px_0px_#1A1A1A]' : ''}`} style={viewMode === 'channel' || viewMode === 'dm' ? { background: '#facc15', color: '#1A1A1A', borderColor: '#1A1A1A' } : { color: '#C8C4BA', borderColor: '#68645A' }} title="Home">
          <Home size={20} />
        </button>

        <button onClick={() => setViewMode('threads')} className={`w-10 h-10 border-2 flex items-center justify-center transition-all duration-100 ${viewMode === 'threads' ? 'shadow-[2px_2px_0px_0px_#1A1A1A]' : ''}`} style={viewMode === 'threads' ? { background: '#0066FF', color: '#FAFAF5', borderColor: '#1A1A1A' } : { color: '#C8C4BA', borderColor: '#68645A' }} title="Threads">
          <MessagesSquare size={20} />
        </button>

        <button onClick={() => setViewMode('agents')} className={`w-10 h-10 border-2 flex items-center justify-center transition-all duration-100 ${viewMode === 'agents' ? 'shadow-[2px_2px_0px_0px_#1A1A1A]' : ''}`} style={viewMode === 'agents' ? { background: '#00CC66', color: '#1A1A1A', borderColor: '#1A1A1A' } : { color: '#C8C4BA', borderColor: '#68645A' }} title="Agents">
          <Cpu size={20} />
        </button>

        <div className="flex-1" />

        <button onClick={() => setSettingsOpen(true)} className="w-10 h-10 border-2 flex items-center justify-center transition-all duration-100" style={{ color: '#C8C4BA', borderColor: '#68645A' }} title="Settings">
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
