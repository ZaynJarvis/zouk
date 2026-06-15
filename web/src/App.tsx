import { useEffect, useRef, useState } from 'react';
import { GoogleOAuthProvider } from '@react-oauth/google';
import { Loader2 } from 'lucide-react';
import { AppProvider, useApp } from './store/AppContext';
import WorkspaceRail from './components/WorkspaceRail';
import ChannelSidebar from './components/ChannelSidebar';
import TopBar from './components/TopBar';
import MessageList from './components/MessageList';
import MessageComposer from './components/MessageComposer';
import RightPanel from './components/RightPanel';
import ThreadPanel from './components/ThreadPanel';
import AgentStatus, { AgentStatusPeek } from './components/AgentStatus';
import AgentProfilePanel from './components/AgentProfilePanel';
import PinnedRail from './components/PinnedRail';
import SettingsModal from './components/SettingsModal';
import ChannelSettingsModal from './components/ChannelSettingsModal';
import UsernameSetupModal from './components/UsernameSetupModal';
import { takenNameSet } from './lib/usernames';
import ToastContainer from './components/ToastContainer';
import AgentsView from './components/AgentPanel';
import TasksView from './components/TasksView';
import MemoryView from './components/MemoryView';
import LoginScreen from './components/LoginScreen';
import * as api from './lib/api';
import { isMobileViewport } from './lib/layout';
import { useEdgeSwipeRight } from './hooks/useEdgeSwipeRight';
import { useVisualViewportChatShell } from './hooks/useVisualViewportChatShell';
import { initSupabase } from './lib/supabase';
import { setStoredAuth, setStoredCurrentUser, setStoredActiveWorkspaceId, getStoredActiveWorkspaceIdOrNull, setPendingUsernameSetup } from './store/storage';
import { normalizeWorkspaceId } from './lib/workspaceRoute';

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

function FeishuAuthSync({ enabled }: { enabled: boolean }) {
  const { setFeishuEnabled } = useApp();
  useEffect(() => { setFeishuEnabled(enabled); }, [enabled, setFeishuEnabled]);
  return null;
}

function OvDenylistSync({ denylist, mcpDenylist }: { denylist: string[]; mcpDenylist: string[] }) {
  const { setOvRuntimeDenylist, setOvMcpRuntimeDenylist } = useApp();
  useEffect(() => { setOvRuntimeDenylist(denylist); }, [denylist, setOvRuntimeDenylist]);
  useEffect(() => { setOvMcpRuntimeDenylist(mcpDenylist); }, [mcpDenylist, setOvMcpRuntimeDenylist]);
  return null;
}

function WorkspaceAccessDeniedView() {
  const { workspaceAccessDenial, workspaces, setActiveWorkspaceId } = useApp();
  if (!workspaceAccessDenial) return null;
  const { requestedWorkspaceId, reason } = workspaceAccessDenial;
  const headline = reason === 'missing'
    ? 'This server does not exist.'
    : reason === 'unauthenticated'
      ? 'Sign in to access this server.'
      : 'You do not have access to this server yet.';
  const detail = reason === 'denied'
    ? 'Ask the workspace owner to invite your account. Once they do, this page will load on the next refresh.'
    : reason === 'missing'
      ? 'The link you followed points to a workspace that has been deleted or renamed.'
      : 'You need to sign in with an invited account to view this workspace.';
  const fallback = workspaces.find(w => w.id === 'default') || workspaces[0];
  return (
    <div className="flex-1 flex items-center justify-center px-6 py-12" role="status">
      <div className="max-w-md w-full rounded-lg border border-nc-border-bright/60 bg-transparent text-nc-muted p-6 text-center">
        <div className="text-sm uppercase tracking-wide text-nc-muted/70 mb-2">/z/{requestedWorkspaceId}</div>
        <div className="text-lg text-nc-text mb-3">{headline}</div>
        <div className="text-sm text-nc-muted mb-4">{detail}</div>
        {fallback && (
          <button
            type="button"
            onClick={() => setActiveWorkspaceId(fallback.id)}
            className="inline-flex items-center justify-center rounded-md border border-nc-border-bright/60 px-3 py-1.5 text-sm text-nc-text hover:bg-nc-bg-2 transition"
          >
            Go to {fallback.name || fallback.id}
          </button>
        )}
      </div>
    </div>
  );
}

function AppShell() {
  const { viewMode, sidebarOpen, setSidebarOpen, isLoggedIn, rightPanel, closeRightPanel, nowRailHidden, agentProfileId, usernameSetup, dismissUsernameSetup, updateProfile, workspaceAccessDenial, humans, agents, currentUser } = useApp();
  const threadRailRef = useRef<HTMLDivElement | null>(null);
  const [mobileSurface, setMobileSurface] = useState(() => isMobileViewport());
  const [mobileSidebarClosing, setMobileSidebarClosing] = useState(false);
  const showMessageView = viewMode === 'channel' || viewMode === 'dm';
  const useViewportShell = isLoggedIn && showMessageView && mobileSurface;

  useVisualViewportChatShell({ enabled: useViewportShell });

  useEffect(() => {
    const onResize = () => {
      const nextMobile = isMobileViewport();
      setMobileSurface(nextMobile);
      if (nextMobile) setSidebarOpen(false);
    };
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

  // Desktop thread rail: click outside the panel closes it (same as the × button).
  // Attached in the capture phase so it runs before React's bubble-phase onClick.
  // That ordering lets `openThread` on a different message re-open the panel
  // cleanly after this listener closes the current one. On mobile the thread
  // panel remains full-screen, so "outside" clicks naturally don't happen.
  useEffect(() => {
    if (rightPanel !== 'thread') return;
    if (mobileSurface) return;
    const onClickOutside = (e: MouseEvent) => {
      const panel = threadRailRef.current;
      if (!panel) return;
      const target = e.target as Node | null;
      if (target instanceof Element && target.closest('.image-lightbox')) return;
      if (target && panel.contains(target)) return;
      closeRightPanel();
    };
    document.addEventListener('click', onClickOutside, true);
    return () => document.removeEventListener('click', onClickOutside, true);
  }, [rightPanel, closeRightPanel, mobileSurface]);

  if (!isLoggedIn) {
    return <LoginScreen />;
  }

  // Desktop only renders the ChannelSidebar in conversational views — Memory
  // / Tasks / Agents are full-canvas surfaces with their own layouts.
  // The MOBILE sidebar modal, the floating menu button, and the edge-swipe
  // gesture all want to be reachable from any view (the channel modal also
  // hosts the workspace nav row), so they are no longer gated on
  // showChannelSidebar.
  const showChannelSidebarDesktop = showMessageView;
  // AgentStatus panel shows by default on the right when in a conversation.
  // Desktop threads reuse the same right rail; other modal panels still own
  // the overlay path. Mobile keeps the right column free for the message stream.
  const showRightRail = showMessageView && (!rightPanel || rightPanel === 'thread');
  const showOverlayPanel = !!rightPanel && (rightPanel !== 'thread' || mobileSurface);

  return (
    <div
      className="app-shell flex overflow-hidden font-body text-nc-text"
      style={{ background: 'var(--zk-bg-0)', color: 'var(--zk-ink)' }}
    >
      <div className="hidden lg:block">
        <WorkspaceRail />
      </div>

      {/* Desktop sidebar: only visible in conversational views */}
      {showChannelSidebarDesktop && (
        <div className="hidden lg:flex flex-shrink-0">
          <ChannelSidebar />
        </div>
      )}

      {/* Mobile sidebar: centered modal (lg:hidden keeps it out of desktop layout).
          The overlay pads for iOS safe areas so the centered modal can never
          encroach on the status-bar or home-indicator bands — without this,
          a tall sidebar at 80dvh on a small viewport could clip into the
          notch on non-chat pages where the page header stops above it.
          dvh instead of vh so iOS Safari/PWA dynamic chrome (URL bar, keyboard,
          home indicator) doesn't clip the modal. min-h-0 makes the inner
          flex column allow its scroll body to shrink and scroll. The modal
          is reachable from any view (the workspace nav row inside handles
          cross-view navigation). The wrapper uses zk-* tokens (not the
          legacy cyber-panel) so the surface and border match the rest of
          the atlas chrome. */}
      {sidebarOpen && (
        <div
          className={`lg:hidden fixed inset-0 bg-nc-black/60 z-40 flex items-center justify-center transition-opacity duration-[180ms] ${mobileSidebarClosing ? 'opacity-0' : 'opacity-100 animate-fade-in'}`}
          style={{
            paddingTop: 'env(safe-area-inset-top, 0px)',
            paddingBottom: 'env(safe-area-inset-bottom, 0px)',
          }}
          onClick={closeMobileSidebar}
        >
          <div
            className={`w-[82vw] max-w-sm max-h-[80dvh] min-h-0 flex flex-col rounded-xl overflow-hidden shadow-2xl ${mobileSidebarClosing ? '' : 'animate-slide-in-left'}`}
            style={{
              background: 'var(--zk-bg-1)',
              border: '1px solid var(--zk-line)',
            }}
            onClick={e => e.stopPropagation()}
          >
            <ChannelSidebar phoneModal />
          </div>
        </div>
      )}

      <div className={`flex-1 flex flex-col min-w-0 ${useViewportShell ? 'zouk-vv-chat-shell' : ''}`}>
        {/* TopBar is only needed in home (channel/dm) view. Full-canvas views
            render a safe-area-aware header with the mobile menu button inside
            the title row. TopBar stays mounted even when a right panel is
            open — toggling it caused the chat to scroll up briefly before the
            phone panel slid in. Instead, the panel positions itself fixed
            inset-0 on phone so it covers TopBar without unmounting it. */}
        {showMessageView && (
          <>
            <TopBar />
            {/* Mobile spacer reserves the h-12/14 below the fixed TopBar so
                message content does not slide under the bar. */}
            <div className="top-bar-mobile-spacer flex-shrink-0 safe-top lg:hidden" aria-hidden="true">
              <div className="h-12 sm:h-14" />
            </div>
          </>
        )}
        <div className="flex-1 relative min-h-0 flex">
          <div className="flex-1 min-w-0 relative">
            <div className="absolute inset-0 flex flex-col min-w-0">
              {workspaceAccessDenial ? (
                <WorkspaceAccessDeniedView />
              ) : (
                <>
                  {showMessageView && (
                    <>
                      <PinnedRail />
                      <MessageList />
                      <MessageComposer />
                    </>
                  )}
                  {viewMode === 'agents' && <AgentsView />}
                  {viewMode === 'tasks' && <TasksView />}
                  {viewMode === 'memory' && <MemoryView />}
                </>
              )}
            </div>
            {/* Contextual right panels (details / settings / mobile thread). On phone
                we position fixed inset-0 so the panel covers TopBar (z-30)
                without the layout-shift cost of unmounting the bar. Desktop
                keeps the in-column absolute placement for non-rail panels.
                Threads are hidden here on desktop and rendered in the unified
                right rail below. */}
            {showOverlayPanel && (
              <div
                className={
                  rightPanel === 'thread'
                    ? 'fixed inset-0 z-40 flex pointer-events-none lg:hidden'
                    : 'fixed inset-0 z-40 flex pointer-events-none lg:absolute lg:inset-y-0 lg:left-auto lg:right-0 lg:z-20'
                }
              >
                <div className="pointer-events-auto h-full shadow-2xl">
                  <RightPanel />
                </div>
              </div>
            )}
          </div>

          {/* Right rail — default right column on lg+. Conversation-adjacent
              content (LIVE, AGENT tabs, desktop THREAD) shares the same
              animated container so width
              transitions smoothly:
                - LIVE: 320px, renders AgentStatus
                - AGENT: clamp(340px, 30vw, 520px), renders AgentProfilePanel inline
                - THREAD: min(760px, 46vw), renders ThreadPanel inline
                - Collapsed: 24px AgentStatusPeek strip (user-toggled)
              Width transitions to 0 (instead of unmounting) when workspace /
              channel settings panels open, preventing abrupt layout shifts on
              toggle. Mobile uses the rightPanel full-screen modal path — the
              rail is desktop-only. */}
          <div
            className="hidden lg:block overflow-hidden"
            style={{
              width: !showRightRail
                ? 0
                : rightPanel === 'thread'
                  ? 'min(760px, 46vw)'
                : nowRailHidden
                  ? 24
                  : agentProfileId
                    ? 'clamp(340px, 30vw, 520px)'
                    : 320,
              flexShrink: 0,
              transition: 'width 200ms var(--zk-ease-out)',
            }}
          >
            {rightPanel === 'thread'
              ? (
                <div ref={threadRailRef} className="h-full shadow-2xl">
                  <ThreadPanel />
                </div>
              )
              : nowRailHidden
              ? <AgentStatusPeek />
              : agentProfileId
                ? <AgentProfilePanel key={agentProfileId} inline />
                : <AgentStatus />}
          </div>
        </div>
      </div>

      <SettingsModal />
      <ChannelSettingsModal />
      <UsernameSetupModal
        open={!!usernameSetup}
        kind="email"
        defaultValue={usernameSetup?.defaultValue || ''}
        takenNames={takenNameSet(humans, agents)}
        selfName={currentUser}
        onConfirm={(name) => { updateProfile(name); dismissUsernameSetup(); }}
        onSkip={dismissUsernameSetup}
      />
      <ToastContainer />
    </div>
  );
}

function AppWithAuth() {
  const [clientId, setClientId] = useState<string | null>(null);
  const [supabaseConfig, setSupabaseConfig] = useState<{ url: string; anonKey: string } | null>(null);
  const [allowlistActive, setAllowlistActive] = useState(false);
  const [feishuEnabled, setFeishuEnabled] = useState(false);
  const [ovRuntimeDenylist, setOvRuntimeDenylist] = useState<string[]>([]);
  const [ovMcpRuntimeDenylist, setOvMcpRuntimeDenylist] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      // Feishu OIDC redirect lands here as `/?auth=feishu&token=…`. Adopt the
      // session before fetching auth config so the store boots already-logged-in.
      try {
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.get('auth') === 'feishu' && urlParams.get('token')) {
          const token = urlParams.get('token')!;
          const firstLogin = urlParams.get('first') === '1';
          urlParams.delete('auth');
          urlParams.delete('token');
          urlParams.delete('first');
          const qs = urlParams.toString();
          window.history.replaceState({}, '', window.location.pathname + (qs ? `?${qs}` : ''));
          const user = await api.fetchAuthMe(token);
          setStoredAuth(token, user);
          setStoredCurrentUser(user.name);
          // First Feishu sign-in → hand the default name to the store, which
          // opens the one-time username picker once it mounts.
          if (firstLogin) setPendingUsernameSetup(user.name);
        }
      } catch (e) {
        console.error('[auth] Feishu session adoption failed:', e);
      }

      try {
        const config = await api.getAuthConfig();
        setClientId(config.googleClientId || null);
        setAllowlistActive(!!config.allowlistActive);
        setFeishuEnabled(!!config.feishuEnabled);
        if (Array.isArray(config.ovRuntimeDenylist)) {
          setOvRuntimeDenylist(config.ovRuntimeDenylist);
        }
        if (Array.isArray(config.ovMcpRuntimeDenylist)) {
          setOvMcpRuntimeDenylist(config.ovMcpRuntimeDenylist);
        }

        if (config.supabaseUrl && config.supabaseAnonKey) {
          const sc = { url: config.supabaseUrl, anonKey: config.supabaseAnonKey };
          setSupabaseConfig(sc);

          // Handle magic link / OAuth callback. We use Supabase implicit flow
          // (see lib/supabase.ts) so the access_token lands in the URL hash and
          // works cross-browser. We still accept a PKCE ?code= as a fallback for
          // any provider that issues one.
          const urlParams = new URLSearchParams(window.location.search);
          const code = urlParams.get('code');
          const magicLoginChallengeId = urlParams.get('magic_challenge') || undefined;
          const hash = new URLSearchParams(window.location.hash.slice(1));
          const hashToken = hash.get('access_token');
          const hashType = hash.get('type');
          // Supabase tags the callback with type=magiclink for existing users,
          // type=signup for first-time signups, and type=recovery for password
          // resets. All of them carry a valid session access_token.
          const isAuthCallbackType =
            hashType === 'magiclink' || hashType === 'signup' || hashType === 'recovery';

          try {
            let accessToken: string | null = null;

            if (hashToken && isAuthCallbackType) {
              accessToken = hashToken;
            } else if (code) {
              const supabase = initSupabase(sc.url, sc.anonKey);
              const { data, error } = await supabase.auth.exchangeCodeForSession(code);
              if (error) {
                console.error('[auth] PKCE exchange failed (likely cross-browser):', error);
              } else if (data.session?.access_token) {
                accessToken = data.session.access_token;
              }
            }

            if (accessToken) {
              // Strip `?code=` / `?magic_challenge=` but keep `/z/<ws>` —
              // otherwise the workspace the invitee actually clicked on is
              // lost the moment we hand off to AppProvider, and the store
              // mount falls through to the alphabetical fallback.
              window.history.replaceState({}, '', window.location.pathname);
              const result = await api.supabaseLogin(accessToken, magicLoginChallengeId);
              setStoredAuth(result.token, result.user);
              setStoredCurrentUser(result.user.name);
              // First sign-in for this email → open the one-time username picker
              // once the store mounts (cross-browser magic-link path).
              if (result.firstLogin) setPendingUsernameSetup(result.user.name);
              const accessible = result.accessibleWorkspaces || [];
              if (accessible.length > 0) {
                const accessibleIds = new Set(accessible.map(w => w.id));
                // Priority: URL path → server's read of requestedWorkspaceId
                // (X-Workspace-Id header) → stored → alphabetical fallback.
                // Same priority as `routePostLoginWorkspace` to keep the two
                // login entry points in lock-step.
                const candidates: (string | null | undefined)[] = [
                  (() => {
                    const match = window.location.pathname.match(/^\/z\/([^/]+)/);
                    return match ? match[1] : null;
                  })(),
                  result.requestedWorkspaceId || null,
                  getStoredActiveWorkspaceIdOrNull(),
                ];
                let chosen: string | null = null;
                for (const candidate of candidates) {
                  if (!candidate) continue;
                  if (accessibleIds.has(normalizeWorkspaceId(candidate))) {
                    chosen = candidate;
                    break;
                  }
                }
                if (!chosen) {
                  const sortedByName = [...accessible].sort((a, b) =>
                    (a.name || a.id || '').localeCompare(b.name || b.id || '')
                  );
                  chosen = sortedByName[0].id;
                }
                setStoredActiveWorkspaceId(chosen);
              }
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

  if (!loaded) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-nc-black">
        <Loader2 size={28} className="animate-spin text-nc-muted" aria-label="Loading" />
      </div>
    );
  }

  const syncComponents = (
    <>
      <AllowlistSync active={allowlistActive} />
      {supabaseConfig && <SupabaseConfigSync config={supabaseConfig} />}
      <FeishuAuthSync enabled={feishuEnabled} />
      <OvDenylistSync denylist={ovRuntimeDenylist} mcpDenylist={ovMcpRuntimeDenylist} />
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
