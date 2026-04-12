import { GoogleLogin } from '@react-oauth/google';
import { useApp } from '../store/AppContext';
import { useState } from 'react';

export default function LoginScreen() {
  const { loginWithGoogle, loginAsGuest, hasGoogleAuth, theme } = useApp();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const isCyber = theme === 'cyberpunk';

  return (
    <div className={`h-screen w-screen flex items-center justify-center font-body ${
      isCyber
        ? 'bg-[#050505] font-cyber'
        : 'bg-nb-gray-100 dark:bg-dark-bg'
    }`}
      style={isCyber ? {
        background: 'radial-gradient(circle at top left, rgba(247, 80, 73, 0.15), transparent 28%), radial-gradient(circle at top right, rgba(94, 246, 255, 0.12), transparent 24%), radial-gradient(circle at 50% 110%, rgba(14, 14, 231, 0.15), transparent 26%), linear-gradient(180deg, #040405 0%, #090b12 40%, #050505 100%)',
      } : undefined}
    >
      <div className={`w-full max-w-sm p-8 ${
        isCyber
          ? 'bg-[rgba(8,10,16,0.98)] border-[1px] border-[rgba(94,246,255,0.2)] shadow-[0_0_60px_rgba(14,14,231,0.2),0_0_30px_rgba(94,246,255,0.1)]'
          : 'bg-nb-white dark:bg-dark-surface border-3 border-nb-black dark:border-dark-border shadow-nb-lg'
      }`}>
        <h1 className={`font-black text-2xl text-center mb-2 ${
          isCyber
            ? 'font-cyber-display text-cp-cyan'
            : 'font-display text-nb-black dark:text-dark-text'
        }`}
          style={isCyber ? { textShadow: '0 0 7px rgba(94, 246, 255, 0.7), 0 0 20px rgba(94, 246, 255, 0.4)' } : undefined}
        >
          {isCyber ? '// ZOUK' : 'Zouk'}
        </h1>
        <p className={`text-sm text-center mb-8 ${
          isCyber ? 'text-white/40 font-cyber tracking-wider uppercase text-xs' : 'text-nb-gray-500 dark:text-dark-muted'
        }`}>
          {isCyber ? 'Access Terminal' : 'Sign in to continue'}
        </p>

        {error && (
          <div className={`mb-4 p-3 border text-sm ${
            isCyber
              ? 'border-cp-red/40 bg-cp-red/10 text-cp-red'
              : 'border-2 border-nb-red bg-red-50 dark:bg-red-900/20 text-nb-red'
          }`}>
            {error}
          </div>
        )}

        <div className="flex flex-col items-center gap-4">
          {hasGoogleAuth && (
            <>
              <GoogleLogin
                onSuccess={async (response) => {
                  if (!response.credential) {
                    setError('No credential received from Google');
                    return;
                  }
                  setLoading(true);
                  setError(null);
                  try {
                    await loginWithGoogle(response.credential);
                  } catch {
                    setError('Google sign-in failed. Is GOOGLE_CLIENT_ID configured on the server?');
                  } finally {
                    setLoading(false);
                  }
                }}
                onError={() => setError('Google sign-in was cancelled or failed')}
                text="signin_with"
                shape="rectangular"
                width={280}
              />

              <div className="flex items-center gap-3 w-full">
                <div className={`flex-1 h-px ${isCyber ? 'bg-[rgba(94,246,255,0.15)]' : 'bg-nb-gray-200 dark:bg-dark-border'}`} />
                <span className={`text-xs uppercase tracking-wider ${isCyber ? 'text-cp-cyan/40 font-cyber' : 'text-nb-gray-400 dark:text-dark-muted'}`}>or</span>
                <div className={`flex-1 h-px ${isCyber ? 'bg-[rgba(94,246,255,0.15)]' : 'bg-nb-gray-200 dark:bg-dark-border'}`} />
              </div>
            </>
          )}

          <button
            onClick={() => {
              setLoading(true);
              loginAsGuest();
            }}
            disabled={loading}
            className={`w-full py-2.5 px-4 text-sm font-bold transition-all disabled:opacity-50 ${
              isCyber
                ? 'border border-[rgba(94,246,255,0.4)] bg-[rgba(94,246,255,0.1)] text-cp-cyan font-cyber uppercase tracking-wider hover:bg-[rgba(94,246,255,0.2)] hover:shadow-[0_0_16px_rgba(94,246,255,0.3)]'
                : 'border-2 border-nb-black dark:border-dark-border bg-nb-cream dark:bg-dark-elevated text-nb-black dark:text-dark-text shadow-nb-sm hover:shadow-nb active:translate-x-[2px] active:translate-y-[2px] active:shadow-none'
            }`}
          >
            {isCyber ? '> Enter as Guest' : 'Continue as Guest'}
          </button>
        </div>

        <p className={`mt-6 text-2xs text-center ${
          isCyber ? 'text-white/25 font-cyber' : 'text-nb-gray-400 dark:text-dark-muted'
        }`}>
          Guest users get a random display name
        </p>
      </div>
    </div>
  );
}
