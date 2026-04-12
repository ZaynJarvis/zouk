import { Home, MessageSquare, Bot, Settings } from 'lucide-react';
import { useApp } from '../store/AppContext';

export default function WorkspaceRail() {
  const {
    setViewMode, setSettingsOpen, viewMode,
    wsConnected, daemonConnected,
  } = useApp();

  return (
    <div className="w-[72px] h-full bg-nb-gray-800 dark:bg-dark-bg border-r-3 border-nb-black dark:border-dark-border flex flex-col items-center py-4 gap-3">
      <div className="w-10 h-10 border-2 border-nb-yellow bg-nb-yellow font-display font-black text-lg flex items-center justify-center text-nb-black">
        S
      </div>

      <div className="w-8 border-t-2 border-nb-gray-600 dark:border-dark-border my-1" />

      <button
        onClick={() => setViewMode('channel')}
        className={`
          w-10 h-10 border-2 border-nb-gray-600 flex items-center justify-center
          transition-all duration-100
          ${viewMode === 'channel' || viewMode === 'dm' ? 'bg-nb-yellow text-nb-black border-nb-black shadow-nb-sm' : 'text-nb-gray-300 hover:text-nb-white hover:border-nb-gray-400'}
          dark:border-dark-border
        `}
        title="Home"
      >
        <Home size={20} />
      </button>

      <button
        onClick={() => setViewMode('threads')}
        className={`
          w-10 h-10 border-2 border-nb-gray-600 flex items-center justify-center
          transition-all duration-100
          ${viewMode === 'threads' ? 'bg-nb-blue text-nb-white border-nb-black shadow-nb-sm' : 'text-nb-gray-300 hover:text-nb-white hover:border-nb-gray-400'}
          dark:border-dark-border
        `}
        title="Threads"
      >
        <MessageSquare size={20} />
      </button>

      <button
        onClick={() => setViewMode('agents')}
        className={`
          w-10 h-10 border-2 border-nb-gray-600 flex items-center justify-center
          transition-all duration-100
          ${viewMode === 'agents' ? 'bg-nb-green text-nb-black border-nb-black shadow-nb-sm' : 'text-nb-gray-300 hover:text-nb-white hover:border-nb-gray-400'}
          dark:border-dark-border
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
          className={`w-3 h-3 border border-nb-black dark:border-dark-border ${daemonConnected ? 'bg-nb-green' : 'bg-nb-gray-400'}`}
          title={daemonConnected ? 'Daemon connected' : 'Daemon disconnected'}
        />
        <div
          className={`w-3 h-3 border border-nb-black dark:border-dark-border ${wsConnected ? 'bg-nb-blue' : 'bg-nb-red'}`}
          title={wsConnected ? 'WebSocket connected' : 'WebSocket disconnected'}
        />
      </div>

      <button
        onClick={() => setSettingsOpen(true)}
        className="w-10 h-10 border-2 border-nb-gray-600 flex items-center justify-center text-nb-gray-300 hover:text-nb-white hover:border-nb-gray-400 transition-all duration-100 dark:border-dark-border"
        title="Settings"
      >
        <Settings size={20} />
      </button>
    </div>
  );
}
