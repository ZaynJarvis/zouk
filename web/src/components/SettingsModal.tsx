import { X, Sun, Moon, Zap, User, Palette, LogOut } from 'lucide-react';
import { useApp } from '../store/AppContext';
import { useState } from 'react';

const sections = [
  { id: 'profile', label: 'Profile', icon: User },
  { id: 'appearance', label: 'Appearance', icon: Palette },
] as const;

type SectionId = typeof sections[number]['id'];

export default function SettingsModal() {
  const { settingsOpen, setSettingsOpen, theme, setTheme, currentUser, updateCurrentUser, authUser, logout } = useApp();
  const [activeSection, setActiveSection] = useState<SectionId>('profile');
  const [editName, setEditName] = useState('');

  if (!settingsOpen) return null;

  const handleSaveName = () => {
    const trimmed = editName.trim();
    if (trimmed && trimmed !== currentUser) {
      updateCurrentUser(trimmed);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-nb-black/40 dark:bg-black/60 flex items-center justify-center p-4 animate-fade-in" onClick={() => setSettingsOpen(false)}>
      <div
        className="w-full max-w-3xl h-[80vh] bg-nb-white dark:bg-dark-surface border-3 border-nb-black dark:border-dark-border shadow-nb-lg flex animate-bounce-in"
        onClick={e => e.stopPropagation()}
      >
        <div className="w-48 border-r-3 border-nb-black dark:border-dark-border bg-nb-cream dark:bg-dark-bg flex flex-col">
          <div className="px-4 py-4 border-b-2 border-nb-gray-200 dark:border-dark-border">
            <h3 className="font-display font-black text-lg text-nb-black dark:text-dark-text">Settings</h3>
          </div>
          <nav className="flex-1 py-2">
            {sections.map(s => (
              <button
                key={s.id}
                onClick={() => setActiveSection(s.id)}
                className={`w-full flex items-center gap-2 px-4 py-2 text-sm transition-all ${
                  activeSection === s.id
                    ? 'bg-nb-yellow border-r-3 border-nb-black font-bold text-nb-black dark:text-nb-black'
                    : 'text-nb-gray-600 dark:text-dark-muted hover:bg-nb-gray-100 dark:hover:bg-dark-elevated hover:text-nb-black dark:hover:text-dark-text'
                }`}
              >
                <s.icon size={16} />
                {s.label}
              </button>
            ))}
          </nav>
        </div>

        <div className="flex-1 flex flex-col min-w-0">
          <div className="h-14 border-b-3 border-nb-black dark:border-dark-border flex items-center justify-between px-6">
            <h4 className="font-display font-extrabold text-base text-nb-black dark:text-dark-text capitalize">{activeSection}</h4>
            <button
              onClick={() => setSettingsOpen(false)}
              className="w-8 h-8 border-2 border-nb-gray-200 dark:border-dark-border flex items-center justify-center text-nb-gray-500 hover:border-nb-black dark:hover:border-dark-text hover:text-nb-black dark:hover:text-dark-text hover:bg-nb-gray-100 dark:hover:bg-dark-elevated transition-all"
            >
              <X size={16} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {activeSection === 'profile' && (
              <>
                <div className="flex items-center gap-4">
                  {authUser?.picture ? (
                    <img src={authUser.picture} alt="" className="w-12 h-12 border-2 border-nb-black dark:border-dark-border" referrerPolicy="no-referrer" />
                  ) : (
                    <div className="w-12 h-12 border-2 border-nb-black dark:border-dark-border font-display font-bold text-lg flex items-center justify-center bg-nb-yellow select-none">
                      {currentUser.charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div>
                    <h5 className="font-display font-bold text-lg text-nb-black dark:text-dark-text">{currentUser}</h5>
                    <p className="text-sm text-nb-gray-500 dark:text-dark-muted">
                      {authUser ? authUser.email : 'Guest user'}
                    </p>
                  </div>
                </div>

                {!authUser && (
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-nb-gray-500 dark:text-dark-muted mb-1.5">Display Name</label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        defaultValue={currentUser}
                        onChange={e => setEditName(e.target.value)}
                        className="flex-1 px-3 py-2 border-2 border-nb-black dark:border-dark-border bg-nb-white dark:bg-dark-elevated text-sm font-body text-nb-black dark:text-dark-text focus:outline-none focus:shadow-nb-sm transition-shadow"
                      />
                      <button
                        onClick={handleSaveName}
                        className="px-4 py-2 border-2 border-nb-black bg-nb-green text-nb-black text-sm font-bold shadow-nb-sm hover:shadow-nb active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all"
                      >
                        Save
                      </button>
                    </div>
                  </div>
                )}

                <button
                  onClick={() => { logout(); setSettingsOpen(false); }}
                  className="flex items-center gap-2 px-4 py-2 border-2 border-nb-black bg-nb-red/10 text-nb-red text-sm font-bold shadow-nb-sm hover:shadow-nb active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all"
                >
                  <LogOut size={14} />
                  {authUser ? 'Sign out' : 'Switch user'}
                </button>
              </>
            )}

            {activeSection === 'appearance' && (
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-nb-gray-500 dark:text-dark-muted mb-3">Theme</label>
                <div className="grid grid-cols-3 gap-3">
                  <button
                    onClick={() => setTheme('light')}
                    className={`flex flex-col items-center gap-2 p-4 border-3 transition-all ${
                      theme === 'light'
                        ? 'border-nb-black bg-nb-yellow-light shadow-nb'
                        : 'border-nb-gray-200 dark:border-dark-border hover:border-nb-black dark:hover:border-dark-text'
                    }`}
                  >
                    <Sun size={24} className="text-nb-yellow" />
                    <div className="text-center">
                      <div className="font-bold text-sm text-nb-black dark:text-dark-text">Light</div>
                      <div className="text-2xs text-nb-gray-500 dark:text-dark-muted">Bright</div>
                    </div>
                  </button>
                  <button
                    onClick={() => setTheme('dark')}
                    className={`flex flex-col items-center gap-2 p-4 border-3 transition-all ${
                      theme === 'dark'
                        ? 'border-nb-black bg-nb-gray-800 text-nb-white shadow-nb dark:border-dark-text'
                        : 'border-nb-gray-200 dark:border-dark-border hover:border-nb-black dark:hover:border-dark-text'
                    }`}
                  >
                    <Moon size={24} className="text-nb-blue" />
                    <div className="text-center">
                      <div className="font-bold text-sm text-nb-black dark:text-dark-text">Dark</div>
                      <div className="text-2xs text-nb-gray-500 dark:text-dark-muted">Muted</div>
                    </div>
                  </button>
                  <button
                    onClick={() => setTheme('cyberpunk')}
                    className={`flex flex-col items-center gap-2 p-4 border-3 transition-all ${
                      theme === 'cyberpunk'
                        ? 'border-cp-cyan bg-cp-black text-cp-cyan shadow-nb'
                        : 'border-nb-gray-200 dark:border-dark-border hover:border-nb-black dark:hover:border-dark-text'
                    }`}
                  >
                    <Zap size={24} className="text-cp-cyan" />
                    <div className="text-center">
                      <div className={`font-bold text-sm ${theme === 'cyberpunk' ? 'text-cp-cyan' : 'text-nb-black dark:text-dark-text'}`}>Cyber</div>
                      <div className={`text-2xs ${theme === 'cyberpunk' ? 'text-cp-cyan/60' : 'text-nb-gray-500 dark:text-dark-muted'}`}>Night City</div>
                    </div>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
