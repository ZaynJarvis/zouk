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
import { initSupabase } from './lib/supabase';
import { setStoredAuth, setStoredCurrentUser } from './store/storage';

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

function SupabaseConfigSync({ config }: { config: { url: string; anonKey: string } }) {
  const { setSupabaseConfig } = useApp();
  useEffect(() => { setSupabaseConfig(config); }, [config, setSupabaseConfig]);
  return null;
}

function AppShell() {
  const { viewMode, sidebarOpen, setSidebarOpen, isLoggedIn, rightPanel, closeRightPanel } = useApp();
  const rightPanelRef = useRef<HTMLDivElement | null>(null);
  const [mobileSidebarClosing, setMobileSidebarClosing] = useState(false);

  useEffect(() => {
    const onResize = () => { if (isMobileViewport()) setSidebarOpen(false); };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [setSidebarOpen]);

  useEdgeSwipeRight(() => {
    (document.activeElement as HTMLElement)?.blur();
    setSidebarOpen(true);
  }, { enabled: !sidebarOpen });

  const closeMobileSidebar = () => {
    setMobileSidebarClosing(true);
    setTimeout(() => {
      setSidebarOpen(false);
      setMobileSidebarClosing(false);
    }, 180);
  };

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

      {/* Desktop sidebar: always visible */}
      <div className="hidden lg:flex flex-shrink-0">
        <ChannelSidebar />
      </div>

      {/* Mobile sidebar: centered modal (lg:hidden keeps it out of desktop layout) */}
      {sidebarOpen && (
        <div
          className={`lg:hidden fixed inset-0 bg-nc-black/60 z-40 flex items-center justify-center transition-opacity duration-[180ms] ${mobileSidebarClosing ? 'opacity-0' : 'opacity-100 animate-fade-in'}`}
          onClick={closeMobileSidebar}
        >
          <div
            className={`w-[82vw] max-w-sm max-h-[65vh] flex flex-col cyber-panel rounded-xl overflow-hidden shadow-2xl ${mobileSidebarClosing ? '' : 'animate-slide-in-left'}`}
            onClick={e => e.stopPropagation()}
          >
            <ChannelSidebar phoneModal />
          </div>
        </div>
      )}

      <div className="flex-1 flex flex-col min-w-0">
        <TopBar />
        {/* Mobile spacer: TopBar is position:fixed on mobile so it no longer
            occupies flex space — this div holds the equivalent height. */}
        <div className="flex-shrink-0 safe-top lg:hidden" aria-hidden="true">
          <div className="h-12 sm:h-14" />
        </div>
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
  const [supabaseConfig, setSupabaseConfig] = useState<{ url: string; anonKey: string } | null>(null);
  const [allowlistActive, setAllowlistActive] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const config = await api.getAuthConfig();
        setClientId(config.googleClientId || null);
        setAllowlistActive(!!config.allowlistActive);

        if (config.supabaseUrl && config.supabaseAnonKey) {
          const sc = { url: config.supabaseUrl, anonKey: config.supabaseAnonKey };
          setSupabaseConfig(sc);

          // Handle magic link callback — PKCE flow (?code=) or implicit flow (#access_token=)
          const urlParams = new URLSearchParams(window.location.search);
          const code = urlParams.get('code');
          const hash = new URLSearchParams(window.location.hash.slice(1));
          const hashToken = hash.get('access_token');
          const hashType = hash.get('type');

          try {
            let accessToken: string | null = null;

            if (code) {
              const supabase = initSupabase(sc.url, sc.anonKey);
              const { data, error } = await supabase.auth.exchangeCodeForSession(code);
              if (!error && data.session?.access_token) {
                accessToken = data.session.access_token;
              }
            } else if (hashToken && hash.get('token_type') === 'bearer') {
              // type=magiclink for returning users, type=signup for first-time users
              accessToken = hashToken;
            }

            if (accessToken) {
              window.history.replaceState({}, '', window.location.pathname);
              const result = await api.supabaseLogin(accessToken);
              setStoredAuth(result.token, result.user);
              setStoredCurrentUser(result.user.name);
            }
          } catch (e) {
            console.error('[auth] Magic link exchange failed:', e);
          }
        }
      } catch {
        // ignore config fetch errors
      }
      setLoaded(true);
    })();
  }, []);

  if (!loaded) return null;

  const syncComponents = (
    <>
      <AllowlistSync active={allowlistActive} />
      {supabaseConfig && <SupabaseConfigSync config={supabaseConfig} />}
    </>
  );

  if (clientId) {
    return (
      <GoogleOAuthProvider clientId={clientId}>
        <AppProvider>
          <GoogleAuthSync />
          {syncComponents}
          <AppShell />
        </AppProvider>
      </GoogleOAuthProvider>
    );
  }

  return (
    <AppProvider>
      {syncComponents}
      <AppShell />
    </AppProvider>
  );
}

export default function App() {
  return <AppWithAuth />;
}
