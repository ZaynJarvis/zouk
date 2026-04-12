import { useApp } from '../store/AppContext';
import { useState } from 'react';

export default function LoginScreen() {
  const { loginAsGuest } = useApp();
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

        <div className="flex flex-col items-center gap-4">
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
