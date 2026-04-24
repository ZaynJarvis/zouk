import { useEffect, useRef, useState } from 'react';
import { GoogleOAuthProvider } from '@react-oauth/google';
import { Menu } from 'lucide-react';
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
import TasksView from './components/TasksView';
import LoginScreen from './components/LoginScreen';
import * as api from './lib/api';
import { isMobileViewport } from './lib/layout';
import { useEdgeSwipeRight } from './hooks/useEdgeSwipeRight';

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

function AppShell() {
  const { viewMode, sidebarOpen, setSidebarOpen, isLoggedIn, rightPanel, closeRightPanel } = useApp();
  const rightPanelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onResize = () => { if (isMobileViewport()) setSidebarOpen(false); };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [setSidebarOpen]);

  useEdgeSwipeRight(() => setSidebarOpen(true), { enabled: !sidebarOpen });

  // Thread panel: click outside the panel closes it (same as the × button).
  // Attached in the capture phase so it runs before React's bubble-phase onClick.
  // That ordering lets `openThread` on a different message re-open the panel
  // cleanly after this listener closes the current one. On mobile the panel is
  // full-width so "outside" clicks naturally don't happen; touch scrolls never
  // fire `click`, so they don't misfire a close.
  // Only wired for 'thread'; other right panels keep their explicit-close UX.
  useEffect(() => {
    if (rightPanel !== 'thread') return;
    const onClickOutside = (e: MouseEvent) => {
      const panel = rightPanelRef.current;
      if (!panel) return;
      const target = e.target as Node | null;
      if (target && panel.contains(target)) return;
      closeRightPanel();
    };
    document.addEventListener('click', onClickOutside, true);
    return () => document.removeEventListener('click', onClickOutside, true);
  }, [rightPanel, closeRightPanel]);

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
            {viewMode === 'tasks' && <TasksView />}
            {!showMessageView && !sidebarOpen && (
              <button
                type="button"
                onClick={() => setSidebarOpen(true)}
                aria-label="Open sidebar"
                className="lg:hidden fixed left-4 z-20 w-10 h-10 rounded-full flex items-center justify-center border border-nc-border text-nc-muted bg-nc-surface hover:text-nc-cyan hover:border-nc-cyan/50 transition-colors"
                style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 1rem)' }}
              >
                <Menu size={18} />
              </button>
            )}
          </div>
          <div className="absolute inset-y-0 right-0 z-20 flex pointer-events-none">
            <div ref={rightPanelRef} className="pointer-events-auto h-full shadow-2xl">
              <RightPanel />
            </div>
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
