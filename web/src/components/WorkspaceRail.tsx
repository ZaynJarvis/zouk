import { Home, MessageSquare, Bot, Settings } from 'lucide-react';
import { useApp } from '../store/AppContext';

export default function WorkspaceRail() {
  const {
    setViewMode, setSettingsOpen, viewMode,
    wsConnected, daemonConnected, theme,
  } = useApp();

  const isCyber = theme === 'cyberpunk';

  return (
    <div data-component="workspace-rail" className={`w-[72px] h-full border-r-3 flex flex-col items-center py-4 gap-3 ${
      isCyber
        ? 'bg-[rgba(8,10,16,0.98)] border-[rgba(94,246,255,0.2)]'
        : 'bg-nb-gray-800 dark:bg-dark-bg border-nb-black dark:border-dark-border'
    }`}>
      <div className={`w-10 h-10 border-2 font-display font-black text-lg flex items-center justify-center ${
        isCyber
          ? 'border-cp-cyan bg-transparent text-cp-cyan'
          : 'border-nb-yellow bg-nb-yellow text-nb-black'
      }`}>
        Z
      </div>

      <div className={`w-8 border-t-2 my-1 ${isCyber ? 'border-[rgba(94,246,255,0.2)]' : 'border-nb-gray-600 dark:border-dark-border'}`} />

      <button
        onClick={() => setViewMode('channel')}
        className={`
          w-10 h-10 border-2 flex items-center justify-center transition-all duration-100
          ${isCyber
            ? (viewMode === 'channel' || viewMode === 'dm'
              ? 'bg-[rgba(94,246,255,0.15)] text-cp-cyan border-cp-cyan shadow-[0_0_12px_rgba(94,246,255,0.2)]'
              : 'text-white/40 border-[rgba(255,255,255,0.1)] hover:text-cp-cyan hover:border-[rgba(94,246,255,0.3)]')
            : (viewMode === 'channel' || viewMode === 'dm'
              ? 'bg-nb-yellow text-nb-black border-nb-black shadow-nb-sm'
              : 'text-nb-gray-300 hover:text-nb-white hover:border-nb-gray-400 border-nb-gray-600 dark:border-dark-border')
          }
        `}
        title="Home"
      >
        <Home size={20} />
      </button>

      <button
        onClick={() => setViewMode('threads')}
        className={`
          w-10 h-10 border-2 flex items-center justify-center transition-all duration-100
          ${isCyber
            ? (viewMode === 'threads'
              ? 'bg-[rgba(14,14,231,0.3)] text-cp-cyan border-cp-indigo shadow-[0_0_12px_rgba(14,14,231,0.3)]'
              : 'text-white/40 border-[rgba(255,255,255,0.1)] hover:text-cp-cyan hover:border-[rgba(94,246,255,0.3)]')
            : (viewMode === 'threads'
              ? 'bg-nb-blue text-nb-white border-nb-black shadow-nb-sm'
              : 'text-nb-gray-300 hover:text-nb-white hover:border-nb-gray-400 border-nb-gray-600 dark:border-dark-border')
          }
        `}
        title="Threads"
      >
        <MessageSquare size={20} />
      </button>

      <button
        onClick={() => setViewMode('agents')}
        className={`
          w-10 h-10 border-2 flex items-center justify-center transition-all duration-100
          ${isCyber
            ? (viewMode === 'agents'
              ? 'bg-[rgba(115,248,85,0.15)] text-cp-green border-cp-green shadow-[0_0_12px_rgba(115,248,85,0.2)]'
              : 'text-white/40 border-[rgba(255,255,255,0.1)] hover:text-cp-green hover:border-[rgba(115,248,85,0.3)]')
            : (viewMode === 'agents'
              ? 'bg-nb-green text-nb-black border-nb-black shadow-nb-sm'
              : 'text-nb-gray-300 hover:text-nb-white hover:border-nb-gray-400 border-nb-gray-600 dark:border-dark-border')
          }
        `}
        title="Agents"
      >
        <Bot size={20} />
      </button>

      {/* Saved Items - commented out: no protocol support
      <button title="Saved Items">
        <Bookmark size={20} />
      </button>
      */}

      <div className="flex-1" />

      <div className="flex flex-col items-center gap-2 mb-2">
        <div
          className={`w-3 h-3 border ${
            isCyber
              ? (daemonConnected ? 'bg-cp-green border-cp-green shadow-[0_0_4px_rgba(115,248,85,0.5)]' : 'bg-white/20 border-white/20')
              : `border-nb-black dark:border-dark-border ${daemonConnected ? 'bg-nb-green' : 'bg-nb-gray-400'}`
          }`}
          title={daemonConnected ? 'Daemon connected' : 'Daemon disconnected'}
        />
        <div
          className={`w-3 h-3 border ${
            isCyber
              ? (wsConnected ? 'bg-cp-cyan border-cp-cyan shadow-[0_0_4px_rgba(94,246,255,0.5)]' : 'bg-cp-red border-cp-red shadow-[0_0_4px_rgba(247,80,73,0.5)]')
              : `border-nb-black dark:border-dark-border ${wsConnected ? 'bg-nb-blue' : 'bg-nb-red'}`
          }`}
          title={wsConnected ? 'WebSocket connected' : 'WebSocket disconnected'}
        />
      </div>

      <button
        onClick={() => setSettingsOpen(true)}
        className={`w-10 h-10 border-2 flex items-center justify-center transition-all duration-100 ${
          isCyber
            ? 'text-white/40 border-[rgba(255,255,255,0.1)] hover:text-cp-cyan hover:border-[rgba(94,246,255,0.3)]'
            : 'border-nb-gray-600 text-nb-gray-300 hover:text-nb-white hover:border-nb-gray-400 dark:border-dark-border'
        }`}
        title="Settings"
      >
        <Settings size={20} />
      </button>
    </div>
  );
}
