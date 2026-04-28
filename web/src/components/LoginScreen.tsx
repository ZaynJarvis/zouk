import { GoogleLogin } from '@react-oauth/google';
import { useApp } from '../store/AppContext';
import { useState, useEffect, useCallback } from 'react';
import GlitchTransition from './glitch/GlitchTransition';
import ScanlineTear from './glitch/ScanlineTear';
import { themes } from '../themes';
import { initSupabase } from '../lib/supabase';

const GLITCH_CHARS = '!<>-_\\/[]{}#$%^&*=+|;:0123456789ABCDEF';

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
  const { loginWithGoogle, loginAsGuest, hasGoogleAuth, hasMagicLinkAuth, supabaseConfig, allowlistActive, theme, setTheme } = useApp();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [glitchActive, setGlitchActive] = useState(false);
  const [pendingAction, setPendingAction] = useState<'guest' | 'google' | 'magic' | null>(null);
  const [magicEmail, setMagicEmail] = useState('');
  const [magicLinkSent, setMagicLinkSent] = useState(false);

  const handleGuestLogin = useCallback(() => {
    setLoading(true);
    setPendingAction('guest');
    setGlitchActive(true);
  }, []);

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
    try {
      const supabase = initSupabase(supabaseConfig.url, supabaseConfig.anonKey);
      const { error: otpError } = await supabase.auth.signInWithOtp({
        email: magicEmail.trim(),
        options: { emailRedirectTo: window.location.origin },
      });
      if (otpError) throw otpError;
      setMagicLinkSent(true);
    } catch (err) {
      const message = err instanceof Error && err.message ? err.message : 'Failed to send magic link.';
      setError(message);
    } finally {
      setLoading(false);
      setPendingAction(null);
    }
  }, [magicEmail, supabaseConfig]);

  const handleGlitchComplete = useCallback(() => {
    setGlitchActive(false);
    if (pendingAction === 'guest') {
      loginAsGuest();
    }
    setPendingAction(null);
  }, [pendingAction, loginAsGuest]);

  const nc = theme === 'night-city';

  const hasSeparator = hasGoogleAuth || hasMagicLinkAuth;
  const showGuestDivider = hasSeparator && !allowlistActive;

  return (
    <div className="login-shell flex sm:items-center items-start justify-center bg-nc-black font-body cyber-scanlines">
      <GlitchTransition
        active={glitchActive}
        duration={500}
        onComplete={handleGlitchComplete}
        themeAgnostic={pendingAction === null}
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
                  theme={nc ? "filled_black" : "outline"}
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
              {magicLinkSent ? (
                <div className={`p-3 border text-xs font-mono text-center ${
                  nc
                    ? 'border-nc-cyan/40 bg-nc-cyan/5 text-nc-cyan'
                    : 'border-nc-border-bright bg-nc-panel text-nc-text-bright'
                }`}>
                  {nc ? '✓ LINK TRANSMITTED' : 'Check your email'}<br />
                  <span className="text-nc-muted mt-1 block">Magic link sent to {magicEmail}</span>
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
                        <span className={`w-3 h-3 border ${nc ? 'border-nc-cyan' : 'border-nc-border-bright'} border-t-transparent animate-spin`} />
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
                    <span className={`w-3 h-3 border ${nc ? 'border-nc-cyan' : 'border-nc-border-bright'} border-t-transparent animate-spin`} />
                    {nc ? 'Connecting...' : 'Connecting...'}
                  </span>
                ) : (
                  nc ? 'Initialize Guest Session' : 'Continue as Guest'
                )}
              </button>
            </ScanlineTear>
          )}


          <div className="mt-4 hidden sm:flex items-center gap-3">
            <div className="h-px flex-1 bg-nc-border" />
            <span className="text-2xs text-nc-muted/60 font-mono">THEME</span>
            <div className="h-px flex-1 bg-nc-border" />
          </div>

          <div className="mt-3 grid grid-cols-2 sm:grid-cols-1 gap-3">
            {themes.map((t) => {
              const Btn = t.ThemeSelectButton;
              return (
                <Btn
                  key={t.id}
                  selected={theme === t.id}
                  onClick={() => {
                    if (theme !== t.id) {
                      setPendingAction(null);
                      setTheme(t.id);
                      if (t.id === 'night-city') {
                        setGlitchActive(true);
                      }
                    }
                  }}
                />
              );
            })}
          </div>

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
