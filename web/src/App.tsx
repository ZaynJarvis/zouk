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
import AgentsView from './components/AgentPanel';
import LoginScreen from './components/LoginScreen';
import * as api from './lib/api';
import { isMobileViewport } from './lib/layout';
import { useEdgeSwipeRight } from './hooks/useEdgeSwipeRight';
import type { RightPanel as RightPanelState, ViewMode } from './types';

function GoogleAuthSync() {
  const { setHasGoogleAuth } = useApp();
  useEffect(() => { setHasGoogleAuth(true); }, [setHasGoogleAuth]);
  return null;
}

function AllowlistSync({ active }: { active: boolean }) {
  const { setAllowlistActive } = useApp();
  useEffect(() => { setAllowlistActive(active); }, [active, setAllowlistActive]);
  return null;
}

function BottomSafeAreaFill({
  viewMode,
  rightPanel,
  sidebarOpen,
  settingsOpen,
}: {
  viewMode: ViewMode;
  rightPanel: RightPanelState;
  sidebarOpen: boolean;
  settingsOpen: boolean;
}) {
  let backgroundClass = 'bg-nc-black';
  let layerClass = 'z-10';

  if (settingsOpen) {
    backgroundClass = 'bg-nc-black/70';
    layerClass = 'z-[45]';
  } else if (sidebarOpen) {
    backgroundClass = 'bg-black/40';
    layerClass = 'z-[35]';
  } else if (rightPanel) {
    backgroundClass = rightPanel === 'thread' ? 'bg-nc-black' : 'bg-nc-surface';
    layerClass = 'z-[25]';
  } else if (viewMode === 'agents') {
    backgroundClass = 'bg-nc-surface';
  }

  return (
    <div
      aria-hidden="true"
      className={`lg:hidden fixed inset-x-0 bottom-0 pointer-events-none transition-colors duration-200 ${backgroundClass} ${layerClass}`}
      style={{ height: 'env(safe-area-inset-bottom, 0px)' }}
    />
  );
}

function AppShell() {
  const { viewMode, rightPanel, sidebarOpen, setSidebarOpen, settingsOpen, isLoggedIn } = useApp();

  useEffect(() => {
    const onResize = () => { if (isMobileViewport()) setSidebarOpen(false); };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [setSidebarOpen]);

  useEdgeSwipeRight(() => setSidebarOpen(true), { enabled: !sidebarOpen });

  if (!isLoggedIn) {
    return <LoginScreen />;
  }

  const showMessageView = viewMode === 'channel' || viewMode === 'dm';

  return (
    <div className="app-shell flex overflow-hidden bg-nc-black font-body text-nc-text cyber-scanlines">
      <div className="hidden lg:block">
        <WorkspaceRail />
      </div>

      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div
          className="lg:hidden fixed inset-0 bg-black/40 z-30"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      <div className={`
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
        lg:translate-x-0 lg:relative lg:z-auto
        fixed inset-y-0 left-0 z-40
        transition-transform duration-200 ease-out
        flex-shrink-0
      `}>
        <ChannelSidebar />
      </div>

      <div className="flex-1 flex flex-col min-w-0">
        <TopBar />
        <div className="flex-1 relative min-h-0">
          <div className="absolute inset-0 flex flex-col min-w-0">
            {showMessageView && (
              <>
                <MessageList />
                <MessageComposer />
              </>
            )}
            {viewMode === 'agents' && <AgentsView />}
          </div>
          <div className="absolute inset-y-0 right-0 z-20 flex pointer-events-none">
            <div className="pointer-events-auto h-full shadow-2xl">
              <RightPanel />
            </div>
          </div>
        </div>
      </div>

      <SettingsModal />
      <ToastContainer />
      <BottomSafeAreaFill
        viewMode={viewMode}
        rightPanel={rightPanel}
        sidebarOpen={sidebarOpen}
        settingsOpen={settingsOpen}
      />
    </div>
  );
}

function AppWithAuth() {
  const [clientId, setClientId] = useState<string | null>(null);
  const [allowlistActive, setAllowlistActive] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    api.getAuthConfig()
      .then(({ googleClientId, allowlistActive }) => {
        setClientId(googleClientId || null);
        setAllowlistActive(!!allowlistActive);
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
          <AllowlistSync active={allowlistActive} />
          <AppShell />
        </AppProvider>
      </GoogleOAuthProvider>
    );
  }

  return (
    <AppProvider>
      <AllowlistSync active={allowlistActive} />
      <AppShell />
    </AppProvider>
  );
}

export default function App() {
  return <AppWithAuth />;
}
