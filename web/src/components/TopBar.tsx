import { Hash, Users, PanelRightOpen, PanelRightClose, Menu, Wifi, WifiOff } from 'lucide-react';
import { useApp } from '../store/AppContext';

export default function TopBar() {
  const {
    activeChannelName, viewMode,
    rightPanel, setRightPanel, closeRightPanel, sidebarOpen, setSidebarOpen,
    wsConnected, daemonConnected,
  } = useApp();

  return (
    <div className="h-14 border-b-3 border-nb-black dark:border-dark-border bg-nb-white dark:bg-dark-surface flex items-center px-2 sm:px-4 gap-2 sm:gap-3">
      <button
        onClick={() => setSidebarOpen(!sidebarOpen)}
        className="lg:hidden w-8 h-8 border-2 border-nb-black dark:border-dark-border flex items-center justify-center hover:bg-nb-gray-100 dark:hover:bg-dark-elevated transition-colors"
      >
        <Menu size={16} />
      </button>

      <div className="flex items-center gap-2 min-w-0">
        {(viewMode === 'channel' || viewMode === 'dm') && (
          <>
            {viewMode === 'channel' && <Hash size={18} className="flex-shrink-0 text-nb-black dark:text-dark-text font-bold" />}
            <h1 className="font-display font-extrabold text-lg text-nb-black dark:text-dark-text truncate">
              {activeChannelName}
            </h1>
          </>
        )}
        {viewMode === 'threads' && (
          <h1 className="font-display font-extrabold text-lg text-nb-black dark:text-dark-text">Threads</h1>
        )}
        {viewMode === 'agents' && (
          <h1 className="font-display font-extrabold text-lg text-nb-black dark:text-dark-text">Agents</h1>
        )}
      </div>

      <div className="flex-1" />

      <div className="flex items-center gap-2 text-xs">
        <span className={`flex items-center gap-1 px-2 py-0.5 border-2 font-semibold ${wsConnected ? 'border-nb-green bg-nb-green-light text-nb-black' : 'border-nb-red bg-nb-red-light text-nb-black'}`}>
          {wsConnected ? <Wifi size={12} /> : <WifiOff size={12} />}
          <span className="hidden sm:inline">{wsConnected ? 'Connected' : 'Disconnected'}</span>
        </span>
        {daemonConnected && (
          <span className="flex items-center gap-1 px-2 py-0.5 border-2 border-nb-blue bg-nb-blue-light text-nb-black font-semibold">
            <span className="hidden sm:inline">Daemon</span>
            <span className="sm:hidden">D</span>
          </span>
        )}
      </div>

      <div className="flex items-center gap-1">
        <button
          onClick={() => rightPanel === 'members' ? closeRightPanel() : setRightPanel('members')}
          className={`w-8 h-8 border-2 flex items-center justify-center transition-all
            ${rightPanel === 'members'
              ? 'border-nb-black bg-nb-blue text-nb-white shadow-nb-sm dark:border-dark-border'
              : 'border-nb-gray-200 dark:border-dark-border text-nb-gray-500 dark:text-dark-muted hover:border-nb-black dark:hover:border-dark-text hover:text-nb-black dark:hover:text-dark-text'
            }`}
          title="Members"
        >
          <Users size={16} />
        </button>

        <button
          onClick={() => rightPanel ? closeRightPanel() : setRightPanel('details')}
          className={`w-8 h-8 border-2 flex items-center justify-center transition-all
            ${rightPanel
              ? 'border-nb-black bg-nb-orange text-nb-black shadow-nb-sm dark:border-dark-border'
              : 'border-nb-gray-200 dark:border-dark-border text-nb-gray-500 dark:text-dark-muted hover:border-nb-black dark:hover:border-dark-text hover:text-nb-black dark:hover:text-dark-text'
            }`}
          title={rightPanel ? 'Close Panel' : 'Open Panel'}
        >
          {rightPanel ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
        </button>
      </div>
    </div>
  );
}
