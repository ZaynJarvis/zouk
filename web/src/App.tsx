import { useEffect, useState } from 'react';
import { GoogleOAuthProvider } from '@react-oauth/google';
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
import * as api from './lib/api';

function GoogleAuthSync() {
  const { setHasGoogleAuth } = useApp();
  useEffect(() => { setHasGoogleAuth(true); }, [setHasGoogleAuth]);
  return null;
}

function AppShell() {
  const { theme, viewMode, sidebarOpen, setSidebarOpen, isLoggedIn } = useApp();

  useEffect(() => {
    document.documentElement.classList.remove('dark', 'cyberpunk');
    if (theme === 'dark') document.documentElement.classList.add('dark');
    if (theme === 'cyberpunk') document.documentElement.classList.add('cyberpunk');
  }, [theme]);

  if (!isLoggedIn) {
    return <LoginScreen />;
  }

  const showMessageView = viewMode === 'channel' || viewMode === 'dm';

  return (
    <div className={`h-screen w-screen flex overflow-hidden font-body text-nb-black dark:text-dark-text ${
      theme === 'cyberpunk'
        ? 'bg-cp-black text-white/88 font-cyber cp-bg cp-scanlines'
        : 'bg-nb-gray-100 dark:bg-dark-bg'
    }`}>
      <WorkspaceRail />

      {/* Mobile backdrop — tapping it closes the sidebar */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar: overlay on mobile, inline on desktop */}
      <div className={`
        fixed top-0 left-[72px] z-40 h-full flex-shrink-0
        transition-transform duration-200 ease-in-out
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
        lg:relative lg:top-auto lg:left-auto lg:translate-x-0 lg:transition-none
      `}>
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
          {/* Hide right panel on mobile — too narrow */}
          <div className="hidden lg:contents">
            <RightPanel />
          </div>
        </div>
      </div>

      <SettingsModal />
      <ToastContainer />
    </div>
  );
}

function AppWithAuth() {
  const [clientId, setClientId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    api.getAuthConfig()
      .then(({ googleClientId }) => {
        setClientId(googleClientId || null);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  if (!loaded) return null;

  if (clientId) {
    return (
      <GoogleOAuthProvider clientId={clientId}>
        <AppProvider>
          <GoogleAuthSync />
          <AppShell />
        </AppProvider>
      </GoogleOAuthProvider>
    );
  }

  // No Google client ID configured — skip OAuth wrapper
  return (
    <AppProvider>
      <AppShell />
    </AppProvider>
  );
}

export default function App() {
  return <AppWithAuth />;
}
