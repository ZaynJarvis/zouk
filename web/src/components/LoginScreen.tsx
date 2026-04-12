import { GoogleLogin } from '@react-oauth/google';
import { useApp } from '../store/AppContext';
import { useState } from 'react';

export default function LoginScreen() {
  const { loginWithGoogle, loginAsGuest, hasGoogleAuth } = useApp();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  return (
    <div className="h-screen w-screen flex items-center justify-center bg-cyber-void font-body scanline-overlay">
      <div className="w-full max-w-sm p-8 bg-cyber-surface border border-cyber-border shadow-neon-cyan-lg animate-bounce-in relative">
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-cyber-cyan to-transparent" />

        <h1 className="font-display font-bold text-2xl text-cyber-cyan text-center mb-2 tracking-widest animate-neon-breathe">
          ZOUK
        </h1>
        <p className="text-sm text-cyber-chrome-300 text-center mb-8 font-mono tracking-wider">
          AUTHENTICATE TO CONTINUE
        </p>

        {error && (
          <div className="mb-4 p-3 border border-cyber-red/40 bg-cyber-red/5 text-sm text-cyber-red font-mono">
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
                <div className="flex-1 h-px bg-cyber-border" />
                <span className="text-xs text-cyber-chrome-400 uppercase tracking-widest font-mono">or</span>
                <div className="flex-1 h-px bg-cyber-border" />
              </div>
            </>
          )}

          <button
            onClick={() => {
              setLoading(true);
              loginAsGuest();
            }}
            disabled={loading}
            className="w-full py-2.5 px-4 cyber-btn-primary font-display font-bold text-sm tracking-wider disabled:opacity-50 transition-all"
          >
            ENTER AS GUEST
          </button>
        </div>

        <p className="mt-6 text-2xs text-cyber-chrome-500 text-center font-mono tracking-wider">
          GUEST USERS RECEIVE RANDOMIZED CALLSIGN
        </p>

        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-cyber-cyan/30 to-transparent" />
      </div>
    </div>
  );
}
