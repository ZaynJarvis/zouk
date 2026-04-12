import { GoogleLogin } from '@react-oauth/google';
import { useApp } from '../store/AppContext';
import { useState, useEffect, useCallback } from 'react';
import GlitchTransition from './glitch/GlitchTransition';
import ScanlineTear from './glitch/ScanlineTear';
import { themes, applyTheme } from '../themes';
import { ncStyle, isNightCity } from '../lib/themeUtils';

const GLITCH_CHARS = '!<>-_\\/[]{}#$%^&*=+|;:0123456789ABCDEF';

function ScrambleTitle() {
  const [text, setText] = useState('ZOUK');
  const target = 'ZOUK';

  useEffect(() => {
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
  }, []);

  return (
    <h1
      className="font-display font-black text-3xl text-nc-cyan tracking-[0.2em] text-center mb-1"
      style={ncStyle({ textShadow: '0 0 20px rgb(var(--nc-cyan) / 0.4), 0 0 60px rgb(var(--nc-cyan) / 0.1)' })}
    >
      {text}
    </h1>
  );
}

export default function LoginScreen() {
  const { loginWithGoogle, loginAsGuest, hasGoogleAuth, theme, setTheme } = useApp();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [glitchActive, setGlitchActive] = useState(false);
  const [pendingAction, setPendingAction] = useState<'guest' | 'google' | null>(null);
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
    } catch {
      setError('Google sign-in failed. Is GOOGLE_CLIENT_ID configured on the server?');
      setLoading(false);
    }
  }, [loginWithGoogle]);

  const handleGlitchComplete = useCallback(() => {
    setGlitchActive(false);
    if (pendingAction === 'guest') {
      loginAsGuest();
    }
    setPendingAction(null);
  }, [pendingAction, loginAsGuest]);

  return (
    <div className="h-screen w-screen flex items-center justify-center bg-nc-black font-body cyber-scanlines">
      <GlitchTransition active={glitchActive} duration={500} onComplete={handleGlitchComplete} />

      {isNightCity() && (
        <div className="absolute inset-0 opacity-[0.03]" style={{
          backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgb(var(--nc-cyan) / 0.03) 2px, rgb(var(--nc-cyan) / 0.03) 4px)',
        }} />
      )}

      <div className="relative z-10 w-full max-w-sm">
        <div className="cyber-panel p-8 cyber-bevel">
          <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-nc-cyan/40 to-transparent" />

          <div className="mb-8">
            <ScrambleTitle />
            <p className="text-sm text-nc-muted text-center tracking-[0.15em] uppercase font-medium mt-2">
              Jack into the system
            </p>
          </div>

          {error && (
            <div className="mb-4 p-3 border border-nc-red/50 bg-nc-red/10 text-xs font-mono text-nc-red">
              {error}
            </div>
          )}

          <div className="space-y-3 mb-6">
            <div className="flex items-center gap-2 text-2xs text-nc-muted uppercase tracking-wider">
              <div className="h-px flex-1 bg-nc-border" />
              <span>system access</span>
              <div className="h-px flex-1 bg-nc-border" />
            </div>
          </div>

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
                  width={280}
                />
              </div>

              <div className="flex items-center gap-2 text-2xs text-nc-muted uppercase tracking-wider mb-4">
                <div className="h-px flex-1 bg-nc-border" />
                <span>or</span>
                <div className="h-px flex-1 bg-nc-border" />
              </div>
            </>
          )}

          <ScanlineTear className="w-full" config={{ trigger: 'hover', minInterval: 200, maxInterval: 600, minSeverity: 0.3, maxSeverity: 0.8 }}>
            <button
              onClick={handleGuestLogin}
              disabled={loading}
              className="cyber-btn-lg w-full py-3 px-4 bg-nc-cyan/10 border border-nc-cyan/50 text-nc-cyan font-display font-bold text-sm tracking-[0.15em] uppercase hover:bg-nc-cyan/20 hover:shadow-nc-cyan active:bg-nc-cyan/30 disabled:opacity-50"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-3 h-3 border border-nc-cyan border-t-transparent animate-spin" />
                  Connecting...
                </span>
              ) : (
                'Initialize Guest Session'
              )}
            </button>
          </ScanlineTear>

          <div className="mt-6 flex items-center gap-3">
            <div className="h-px flex-1 bg-nc-border" />
            <span className="text-2xs text-nc-muted/60 font-mono">THEME</span>
            <div className="h-px flex-1 bg-nc-border" />
          </div>

          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
            {themes.map((t) => {
              const active = theme === t.id;
              const isNight = t.id === 'night-city';
              const isDaylight = t.id === 'daylight';
              const isBrutalist = t.id === 'brutalist';

              return (
                <button
                  key={t.id}
                  onClick={() => {
                    if (!active) {
                      setPendingAction(null);
                      applyTheme(t.id);
                      setTheme(t.id);
                      setGlitchActive(true);
                    }
                  }}
                  className={`relative overflow-hidden px-3 py-3 text-center transition-all duration-200 ${
                    isNight
                      ? 'cyber-btn cyber-bevel-sm uppercase font-display tracking-[0.18em]'
                      : isDaylight
                        ? 'rounded-md font-body font-semibold tracking-[0.12em]'
                        : 'font-display font-black tracking-[0.14em] uppercase'
                  }`}
                  style={{
                    border: isBrutalist ? '3px solid #171717' : `1px solid ${active ? t.preview.accent : `${t.preview.accent}88`}`,
                    background: isNight
                      ? (active ? 'rgba(94, 246, 255, 0.16)' : 'rgba(10, 10, 15, 0.92)')
                      : isDaylight
                        ? (active ? 'linear-gradient(180deg, #ffffff 0%, #f3f4f6 100%)' : 'linear-gradient(180deg, #f9fafb 0%, #eef2f7 100%)')
                        : (active ? '#facc15' : '#fffaf0'),
                    color: isDaylight ? '#111827' : t.preview.text,
                    boxShadow: isNight
                      ? (active ? '0 0 14px rgba(94,246,255,0.22)' : 'inset 0 1px 0 rgba(94,246,255,0.08)')
                      : isDaylight
                        ? (active ? '0 8px 20px rgba(15,23,42,0.10)' : '0 4px 14px rgba(15,23,42,0.06)')
                        : (active ? '4px 4px 0 #171717' : '3px 3px 0 #171717'),
                    textTransform: isDaylight ? 'none' : 'uppercase',
                  }}
                >
                  {isNight && (
                    <div
                      className="absolute left-0 right-0 top-0 h-[2px] opacity-90"
                      style={{ background: t.preview.accent }}
                    />
                  )}
                  <span className="relative block text-xs">
                    {t.name}
                    {active ? ' / ACTIVE' : ''}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-nc-red/20 to-transparent" />
        </div>

        <div className="flex justify-between mt-3 px-1">
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 bg-nc-green animate-glow-pulse" />
            <span className="text-2xs font-mono text-nc-green/70">SYS_ONLINE</span>
          </div>
          <span className="text-2xs font-mono text-nc-muted/40">NC::2077</span>
        </div>
      </div>
    </div>
  );
}
