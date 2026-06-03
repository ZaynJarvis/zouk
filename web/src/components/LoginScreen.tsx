import { GoogleLogin } from '@react-oauth/google';
import { Loader2 } from 'lucide-react';
import { useApp } from '../store/AppContext';
import { useState, useEffect, useCallback, useRef } from 'react';
import GlitchTransition from './glitch/GlitchTransition';
import ScanlineTear from './glitch/ScanlineTear';
import { initSupabase } from '../lib/supabase';
import { createMagicLoginChallenge, pollMagicLoginChallenge, type MagicLoginChallenge } from '../lib/api';
import UsernameSetupModal from './UsernameSetupModal';
import { getGuestNamed, setGuestNamed, getStoredCurrentUser } from '../store/storage';

const GLITCH_CHARS = '!<>-_\\/[]{}#$%^&*=+|;:0123456789ABCDEF';
const MAGIC_LINK_POLL_INTERVAL_MS = 2000;
const MAGIC_LINK_EXPIRES_MS = 5 * 60 * 1000;

function formatTimeLeft(ms: number) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function ScrambleTitle({ nc }: { nc: boolean }) {
  const [text, setText] = useState('ZOUK');
  const target = 'ZOUK';

  useEffect(() => {
    if (!nc) return; // No scramble effect on non-NC themes
    let frame: number;
    let iteration = 0;
    const animate = () => {
      setText(
        target
          .split('')
          .map((char, i) =>
            i < iteration ? char : GLITCH_CHARS[Math.floor(Math.random() * GLITCH_CHARS.length)]
          )
          .join('')
      );
      iteration += 0.15;
      if (iteration < target.length + 1) {
        frame = requestAnimationFrame(animate);
      }
    };
    const timeout = setTimeout(() => { frame = requestAnimationFrame(animate); }, 300);
    return () => { clearTimeout(timeout); cancelAnimationFrame(frame); };
  }, [nc]);

  if (!nc) {
    return (
      <h1 className="font-display font-black text-2xl text-nc-text-bright text-center mb-1">
        Zouk
      </h1>
    );
  }

  return (
    <h1
      className="font-display font-black text-3xl text-nc-cyan tracking-[0.2em] text-center mb-1"
      style={{ textShadow: '0 0 20px rgb(var(--nc-cyan) / 0.4), 0 0 60px rgb(var(--nc-cyan) / 0.1)' }}
    >
      {text}
    </h1>
  );
}

export default function LoginScreen() {
  const {
    loginWithGoogle,
    loginWithAuthResponse,
    loginWithSupabaseAccessToken,
    loginWithStoredAuth,
    loginAsGuest,
    hasGoogleAuth,
    hasMagicLinkAuth,
    supabaseConfig,
    allowlistActive,
    feishuEnabled,
  } = useApp();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [glitchActive, setGlitchActive] = useState(false);
  const [pendingAction, setPendingAction] = useState<'guest' | 'google' | 'magic' | null>(null);
  const [magicEmail, setMagicEmail] = useState('');
  const [magicLinkState, setMagicLinkState] = useState<'idle' | 'pending' | 'expired'>('idle');
  const [magicLinkExpiresAt, setMagicLinkExpiresAt] = useState<number | null>(null);
  const [magicLinkNow, setMagicLinkNow] = useState(() => Date.now());
  const [magicChallenge, setMagicChallenge] = useState<MagicLoginChallenge | null>(null);
  const magicLoginInFlightRef = useRef(false);
  // Guest username picker (one-time per browser). `guestNameRef` carries the
  // chosen name through the glitch transition into loginAsGuest.
  const [showGuestSetup, setShowGuestSetup] = useState(false);
  const [guestSuffixDefault, setGuestSuffixDefault] = useState('');
  const guestNameRef = useRef<string | undefined>(undefined);

  const startGuestGlitch = useCallback((name?: string) => {
    guestNameRef.current = name;
    setLoading(true);
    setPendingAction('guest');
    setGlitchActive(true);
  }, []);

  const handleGuestLogin = useCallback(() => {
    // Offer the username picker the first time this browser goes guest; after
    // that, reuse the stored guest identity and jump straight into the glitch.
    if (!getGuestNamed()) {
      setGuestSuffixDefault(getStoredCurrentUser().replace(/^guest-/i, ''));
      setShowGuestSetup(true);
      return;
    }
    startGuestGlitch();
  }, [startGuestGlitch]);

  const handleGuestSetupConfirm = useCallback((suffix: string) => {
    setGuestNamed();
    setShowGuestSetup(false);
    const cleaned = suffix.trim();
    // Server forces the `guest-` prefix too; send it pre-applied for clarity.
    startGuestGlitch(cleaned ? `guest-${cleaned}` : undefined);
  }, [startGuestGlitch]);

  const handleGuestSetupSkip = useCallback(() => {
    setGuestNamed();
    setShowGuestSetup(false);
    startGuestGlitch();
  }, [startGuestGlitch]);

  const handleGoogleSuccess = useCallback(async (credential: string) => {
    setLoading(true);
    setError(null);
    setPendingAction('google');
    try {
      await loginWithGoogle(credential);
    } catch (err) {
      const message = err instanceof Error && err.message ? err.message : 'Google sign-in failed.';
      setError(message);
      setLoading(false);
    }
  }, [loginWithGoogle]);

  const handleMagicLink = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!magicEmail.trim() || !supabaseConfig) return;
    setLoading(true);
    setError(null);
    setPendingAction('magic');
    setMagicLinkState('idle');
    setMagicLinkExpiresAt(null);
    setMagicChallenge(null);
    try {
      const challenge = await createMagicLoginChallenge(magicEmail.trim());
      const redirectUrl = new URL(window.location.origin);
      redirectUrl.searchParams.set('magic_challenge', challenge.challengeId);
      const supabase = initSupabase(supabaseConfig.url, supabaseConfig.anonKey);
      const { error: otpError } = await supabase.auth.signInWithOtp({
        email: magicEmail.trim(),
        options: { emailRedirectTo: redirectUrl.toString() },
      });
      if (otpError) throw otpError;
      const expiresAt = Number.isNaN(Date.parse(challenge.expiresAt))
        ? Date.now() + MAGIC_LINK_EXPIRES_MS
        : Date.parse(challenge.expiresAt);
      setMagicLinkNow(Date.now());
      setMagicLinkExpiresAt(expiresAt);
      setMagicChallenge(challenge);
      setMagicLinkState('pending');
    } catch (err) {
      const message = err instanceof Error && err.message ? err.message : 'Failed to send magic link.';
      setError(message);
    } finally {
      setLoading(false);
      setPendingAction(null);
    }
  }, [magicEmail, supabaseConfig]);

  const resetMagicLink = useCallback(() => {
    setMagicLinkState('idle');
    setMagicLinkExpiresAt(null);
    setMagicChallenge(null);
    setError(null);
    setPendingAction(null);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (magicLinkState !== 'pending' || !magicLinkExpiresAt) return;
    setMagicLinkNow(Date.now());
    const timer = window.setInterval(() => setMagicLinkNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [magicLinkState, magicLinkExpiresAt]);

  useEffect(() => {
    if (magicLinkState !== 'pending' || !magicLinkExpiresAt || !supabaseConfig) return;
    let cancelled = false;
    let pollTimer: number | null = null;
    let expiryTimer: number | null = null;

    const supabase = initSupabase(supabaseConfig.url, supabaseConfig.anonKey);

    const expire = () => {
      if (cancelled) return;
      setMagicLinkState('expired');
      setMagicLinkNow(Date.now());
      setPendingAction(null);
      setLoading(false);
    };

    const completeWithAccessToken = async (accessToken: string) => {
      if (magicLoginInFlightRef.current) return;
      magicLoginInFlightRef.current = true;
      setPendingAction('magic');
      setLoading(true);
      try {
        await loginWithSupabaseAccessToken(accessToken);
      } catch (err) {
        if (!cancelled) {
          const message = err instanceof Error && err.message ? err.message : 'Magic link login failed.';
          setError(message);
          setMagicLinkState('idle');
          setMagicLinkExpiresAt(null);
          setPendingAction(null);
          setLoading(false);
        }
      } finally {
        magicLoginInFlightRef.current = false;
      }
    };

    const poll = async () => {
      if (cancelled || magicLoginInFlightRef.current) return;
      if (Date.now() >= magicLinkExpiresAt) {
        expire();
        return;
      }
      if (magicChallenge) {
        try {
          const handoff = await pollMagicLoginChallenge(magicChallenge.challengeId, magicChallenge.pollToken);
          if (cancelled) return;
          if (handoff.status === 'expired') {
            expire();
            return;
          }
          if (handoff.status === 'completed') {
            loginWithAuthResponse(handoff);
            return;
          }
        } catch {
          // Keep polling; transient network errors should not cancel the wait.
        }
      }
      if (loginWithStoredAuth()) return;

      const { data, error: sessionError } = await supabase.auth.getSession();
      if (cancelled) return;
      if (sessionError) return;
      const accessToken = data.session?.access_token;
      if (accessToken) void completeWithAccessToken(accessToken);
    };

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.access_token) void completeWithAccessToken(session.access_token);
    });

    void poll();
    pollTimer = window.setInterval(() => { void poll(); }, MAGIC_LINK_POLL_INTERVAL_MS);
    expiryTimer = window.setTimeout(expire, Math.max(0, magicLinkExpiresAt - Date.now()));

    return () => {
      cancelled = true;
      if (pollTimer !== null) window.clearInterval(pollTimer);
      if (expiryTimer !== null) window.clearTimeout(expiryTimer);
      authListener.subscription.unsubscribe();
    };
  }, [loginWithAuthResponse, loginWithStoredAuth, loginWithSupabaseAccessToken, magicChallenge, magicLinkExpiresAt, magicLinkState, supabaseConfig]);

  const handleGlitchComplete = useCallback(() => {
    setGlitchActive(false);
    if (pendingAction === 'guest') {
      loginAsGuest(guestNameRef.current);
    }
    setPendingAction(null);
  }, [pendingAction, loginAsGuest]);

  // Atlas is the only theme. The Google sign-in button still wants to match
  // the active light/dark mode — derive dark via the data-mode attribute that
  // the boot script in index.html keeps in sync with the user's preference.
  const nc = false;
  const isDark = typeof document !== 'undefined' && document.documentElement.getAttribute('data-mode') === 'dark';

  const hasSeparator = hasGoogleAuth || hasMagicLinkAuth || feishuEnabled;
  const showGuestDivider = hasSeparator && !allowlistActive;
  const magicLinkTimeLeft = magicLinkExpiresAt ? Math.max(0, magicLinkExpiresAt - magicLinkNow) : 0;

  const handleFeishuLogin = useCallback(() => {
    // Server-driven OIDC: bounce to /api/auth/feishu/start, which 302s into
    // anycross.feishu.cn and eventually redirects back to `/` with a token.
    const returnTo = encodeURIComponent(window.location.pathname || '/');
    window.location.href = `/api/auth/feishu/start?return_to=${returnTo}`;
  }, []);

  return (
    <div className="login-shell flex items-center justify-center bg-nc-black font-body cyber-scanlines">
      <GlitchTransition
        active={glitchActive}
        duration={500}
        onComplete={handleGlitchComplete}
        themeAgnostic={pendingAction === null}
      />

      <UsernameSetupModal
        open={showGuestSetup}
        kind="guest"
        defaultValue={guestSuffixDefault}
        onConfirm={handleGuestSetupConfirm}
        onSkip={handleGuestSetupSkip}
      />

      {nc && (
        <div className="absolute inset-0 opacity-[0.03]" style={{
          backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgb(var(--nc-cyan) / 0.03) 2px, rgb(var(--nc-cyan) / 0.03) 4px)',
        }} />
      )}

      <div className="relative z-10 w-full sm:max-w-sm">
        <div className="sm:cyber-panel sm:p-8 sm:cyber-bevel p-5 pt-8">
          {nc && <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-nc-cyan/40 to-transparent" />}

          <div className="mb-4 sm:mb-8">
            <ScrambleTitle nc={nc} />
            <p className={`text-sm text-nc-muted text-center mt-2 ${nc ? 'tracking-[0.15em] uppercase font-medium' : ''}`}>
              {nc ? 'Jack into the system' : 'Sign in to continue'}
            </p>
          </div>

          {error && (
            <div className="mb-4 p-3 border border-nc-red/50 bg-nc-red/10 text-xs font-mono text-nc-red">
              {error}
            </div>
          )}

          {feishuEnabled && (
            <>
              <button
                onClick={handleFeishuLogin}
                disabled={loading}
                className="w-full py-2.5 px-4 mb-4 bg-nc-panel border border-nc-border-bright text-nc-text-bright font-bold text-sm hover:bg-nc-yellow disabled:opacity-50"
              >
                Sign in with Feishu/Lark
              </button>
              {(hasGoogleAuth || hasMagicLinkAuth) && (
                <div className="flex items-center gap-3 w-full mb-4">
                  <div className="flex-1 h-px bg-nc-border" />
                  <span className="text-xs text-nc-muted uppercase tracking-wider">or</span>
                  <div className="flex-1 h-px bg-nc-border" />
                </div>
              )}
            </>
          )}

          {hasGoogleAuth && (
            <>
              <div className="flex justify-center mb-4">
                <GoogleLogin
                  onSuccess={(response) => {
                    if (response.credential) {
                      handleGoogleSuccess(response.credential);
                    } else {
                      setError('No credential received from Google');
                    }
                  }}
                  onError={() => setError('Google sign-in was cancelled or failed')}
                  text="signin_with"
                  shape="rectangular"
                  theme={isDark ? "filled_black" : "outline"}
                  width={280}
                />
              </div>

              {(hasMagicLinkAuth || !allowlistActive) && (
                <div className="flex items-center gap-3 w-full mb-4">
                  <div className="flex-1 h-px bg-nc-border" />
                  <span className="text-xs text-nc-muted uppercase tracking-wider">or</span>
                  <div className="flex-1 h-px bg-nc-border" />
                </div>
              )}
            </>
          )}

          {hasMagicLinkAuth && (
            <div className="mb-4">
              {magicLinkState === 'pending' || magicLinkState === 'expired' ? (
                <div className={`p-3 border text-xs font-mono text-center ${
                  magicLinkState === 'expired'
                    ? 'border-nc-red/50 bg-nc-red/10 text-nc-red'
                    : nc
                    ? 'border-nc-cyan/40 bg-nc-cyan/5 text-nc-cyan'
                    : 'border-nc-border-bright bg-nc-panel text-nc-text-bright'
                }`}>
                  {magicLinkState === 'expired'
                    ? (nc ? 'LINK EXPIRED' : 'Magic link expired')
                    : (nc ? '✓ LINK TRANSMITTED' : 'Check your email')}<br />
                  <span className="text-nc-muted mt-1 block">
                    Magic link sent to {magicEmail}
                  </span>
                  {magicLinkState === 'pending' ? (
                    <span className="text-nc-muted mt-2 flex items-center justify-center gap-2">
                      <Loader2 size={12} className="animate-spin opacity-80" aria-hidden="true" />
                      Waiting for sign-in · {formatTimeLeft(magicLinkTimeLeft)}
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={resetMagicLink}
                      className="mt-3 px-3 py-1.5 border border-nc-border-bright text-nc-text-bright hover:bg-nc-yellow"
                    >
                      Send a new link
                    </button>
                  )}
                </div>
              ) : (
                <form onSubmit={handleMagicLink} className="space-y-2">
                  <input
                    type="email"
                    value={magicEmail}
                    onChange={e => setMagicEmail(e.target.value)}
                    placeholder={nc ? 'ENTER_EMAIL_ADDRESS' : 'Email address'}
                    disabled={loading}
                    className={`w-full px-3 py-2 text-sm bg-transparent border outline-none disabled:opacity-50 ${
                      nc
                        ? 'border-nc-cyan/30 text-nc-text-bright placeholder-nc-muted/50 font-mono focus:border-nc-cyan/70'
                        : 'border-nc-border text-nc-text-bright placeholder-nc-muted focus:border-nc-border-bright'
                    }`}
                  />
                  <button
                    type="submit"
                    disabled={loading || !magicEmail.trim()}
                    className={nc
                      ? 'w-full py-2.5 px-4 bg-nc-cyan/10 border border-nc-cyan/50 text-nc-cyan font-display font-bold text-sm tracking-[0.15em] uppercase hover:bg-nc-cyan/20 hover:shadow-nc-cyan active:bg-nc-cyan/30 disabled:opacity-50'
                      : 'w-full py-2.5 px-4 bg-nc-panel border border-nc-border-bright text-nc-text-bright font-bold text-sm hover:bg-nc-yellow disabled:opacity-50'
                    }
                  >
                    {loading && pendingAction === 'magic' ? (
                      <span className="flex items-center justify-center gap-2">
                        <Loader2 size={14} className="animate-spin opacity-80" aria-hidden="true" />
                        {nc ? 'Transmitting...' : 'Sending...'}
                      </span>
                    ) : (
                      nc ? 'Send Magic Link' : 'Send magic link'
                    )}
                  </button>
                </form>
              )}
            </div>
          )}

          {!hasGoogleAuth && !hasMagicLinkAuth && !allowlistActive && nc && (
            <div className="space-y-3 mb-6">
              <div className="flex items-center gap-2 text-2xs text-nc-muted uppercase tracking-wider">
                <div className="h-px flex-1 bg-nc-border" />
                <span>system access</span>
                <div className="h-px flex-1 bg-nc-border" />
              </div>
            </div>
          )}

          {showGuestDivider && (
            <div className="flex items-center gap-3 w-full mb-4">
              <div className="flex-1 h-px bg-nc-border" />
              <span className="text-xs text-nc-muted uppercase tracking-wider">or</span>
              <div className="flex-1 h-px bg-nc-border" />
            </div>
          )}

          {!allowlistActive && (
            <ScanlineTear className="w-full" config={{ trigger: 'hover', minInterval: 200, maxInterval: 600, minSeverity: 0.3, maxSeverity: 0.8 }}>
              <button
                onClick={handleGuestLogin}
                disabled={loading}
                className={nc
                  ? "cyber-btn-lg w-full py-3 px-4 bg-nc-cyan/10 border border-nc-cyan/50 text-nc-cyan font-display font-bold text-sm tracking-[0.15em] uppercase hover:bg-nc-cyan/20 hover:shadow-nc-cyan active:bg-nc-cyan/30 disabled:opacity-50"
                  : "cyber-btn-lg w-full py-2.5 px-4 bg-nc-panel border border-nc-border-bright text-nc-text-bright font-bold text-sm hover:bg-nc-yellow disabled:opacity-50"
                }
              >
                {loading && pendingAction === 'guest' ? (
                  <span className="flex items-center justify-center gap-2">
                    <Loader2 size={14} className="animate-spin opacity-80" aria-hidden="true" />
                    {nc ? 'Connecting...' : 'Connecting...'}
                  </span>
                ) : (
                  nc ? 'Initialize Guest Session' : 'Continue as Guest'
                )}
              </button>
            </ScanlineTear>
          )}


          {nc && <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-nc-red/20 to-transparent" />}
        </div>

        {nc ? (
          <div className="flex justify-between mt-3 px-1">
            <div className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 bg-nc-green animate-glow-pulse" />
              <span className="text-2xs font-mono text-nc-green/70">SYS_ONLINE</span>
            </div>
            <span className="text-2xs font-mono text-nc-muted/40">NC::2077</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}
