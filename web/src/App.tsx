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
  const { theme, viewMode, sidebarOpen, isLoggedIn } = useApp();

  useEffect(() => {
    document.documentElement.classList.add('dark');
  }, [theme]);

  if (!isLoggedIn) {
    return <LoginScreen />;
  }

  const showMessageView = viewMode === 'channel' || viewMode === 'dm';

  return (
    <div className="h-screen w-screen flex overflow-hidden bg-cyber-void font-body text-cyber-chrome-100 scanline-overlay">
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

  return (
    <AppProvider>
      <AppShell />
    </AppProvider>
  );
}

export default function App() {
  return <AppWithAuth />;
}
