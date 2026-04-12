import { GoogleLogin } from '@react-oauth/google';
import { useApp } from '../store/AppContext';
import { useState } from 'react';

export default function LoginScreen() {
  const { loginWithGoogle, loginAsGuest, hasGoogleAuth } = useApp();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  return (
    <div className="h-screen w-screen flex items-center justify-center bg-nb-gray-100 dark:bg-dark-bg font-body">
      <div className="w-full max-w-sm p-8 bg-nb-white dark:bg-dark-surface border-3 border-nb-black dark:border-dark-border shadow-nb-lg">
        <h1 className="font-display font-black text-2xl text-nb-black dark:text-dark-text text-center mb-2">
          Zouk
        </h1>
        <p className="text-sm text-nb-gray-500 dark:text-dark-muted text-center mb-8">
          Sign in to continue
        </p>

        {error && (
          <div className="mb-4 p-3 border-2 border-nb-red bg-red-50 dark:bg-red-900/20 text-sm text-nb-red">
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
                <div className="flex-1 h-px bg-nb-gray-200 dark:bg-dark-border" />
                <span className="text-xs text-nb-gray-400 dark:text-dark-muted uppercase tracking-wider">or</span>
                <div className="flex-1 h-px bg-nb-gray-200 dark:bg-dark-border" />
              </div>
            </>
          )}

          <button
            onClick={() => {
              setLoading(true);
              loginAsGuest();
            }}
            disabled={loading}
            className="w-full py-2.5 px-4 border-2 border-nb-black dark:border-dark-border bg-nb-cream dark:bg-dark-elevated text-nb-black dark:text-dark-text text-sm font-bold shadow-nb-sm hover:shadow-nb active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all disabled:opacity-50"
          >
            Continue as Guest
          </button>
        </div>

        <p className="mt-6 text-2xs text-nb-gray-400 dark:text-dark-muted text-center">
          Guest users get a random display name
        </p>
      </div>
    </div>
  );
}
