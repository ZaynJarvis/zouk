import { useEffect } from 'react';
import { AppProvider, useApp } from './store/AppContext';
import WorkspaceRail from './components/WorkspaceRail';
import ChannelSidebar from './components/ChannelSidebar';
import TopBar from './components/TopBar';
import MessageList from './components/MessageList';
import MessageComposer from './components/MessageComposer';
import RightPanel from './components/RightPanel';
import SettingsModal from './components/SettingsModal';
import ToastContainer from './components/ToastContainer';
import ThreadsView from './components/ThreadsView';
import AgentsView from './components/AgentPanel';
import LoginScreen from './components/LoginScreen';

function AppShell() {
  const { theme, viewMode, sidebarOpen, isLoggedIn } = useApp();

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  if (!isLoggedIn) {
    return <LoginScreen />;
  }

  const showMessageView = viewMode === 'channel' || viewMode === 'dm';

  return (
    <div className="h-screen w-screen flex overflow-hidden bg-nb-gray-100 dark:bg-dark-bg font-body text-nb-black dark:text-dark-text">
      <WorkspaceRail />

      <div className={`${sidebarOpen ? 'block' : 'hidden'} lg:block flex-shrink-0`}>
        <ChannelSidebar />
      </div>

      <div className="flex-1 flex flex-col min-w-0">
        <TopBar />
        <div className="flex-1 flex min-h-0">
          <div className="flex-1 flex flex-col min-w-0">
            {showMessageView && (
              <>
                <MessageList />
                <MessageComposer />
              </>
            )}
            {viewMode === 'threads' && <ThreadsView />}
            {viewMode === 'agents' && <AgentsView />}
          </div>
          <RightPanel />
        </div>
      </div>

      <SettingsModal />
      <ToastContainer />
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <AppShell />
    </AppProvider>
  );
}
