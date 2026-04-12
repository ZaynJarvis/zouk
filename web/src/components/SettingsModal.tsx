import { X, Sun, Moon, User, Palette, LogOut } from 'lucide-react';
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
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4 animate-fade-in" onClick={() => setSettingsOpen(false)}>
      <div
        className="w-full max-w-3xl h-[80vh] bg-cyber-surface border border-cyber-border shadow-neon-cyan-lg flex animate-bounce-in"
        onClick={e => e.stopPropagation()}
      >
        <div className="w-48 border-r border-cyber-border bg-cyber-void-light flex flex-col">
          <div className="px-4 py-4 border-b border-cyber-border">
            <h3 className="font-display font-bold text-lg text-cyber-cyan tracking-wider">SETTINGS</h3>
          </div>
          <nav className="flex-1 py-2">
            {sections.map(s => (
              <button
                key={s.id}
                onClick={() => setActiveSection(s.id)}
                className={`w-full flex items-center gap-2 px-4 py-2 text-sm transition-all ${
                  activeSection === s.id
                    ? 'bg-cyber-cyan/10 border-r-2 border-cyber-cyan text-cyber-cyan font-bold'
                    : 'text-cyber-chrome-400 hover:bg-cyber-elevated hover:text-cyber-chrome-200'
                }`}
              >
                <s.icon size={16} />
                {s.label}
              </button>
            ))}
          </nav>
        </div>

        <div className="flex-1 flex flex-col min-w-0">
          <div className="h-14 border-b border-cyber-border flex items-center justify-between px-6">
            <h4 className="font-display font-bold text-base text-cyber-chrome-50 uppercase tracking-wider">{activeSection}</h4>
            <button
              onClick={() => setSettingsOpen(false)}
              className="w-8 h-8 border border-cyber-border flex items-center justify-center text-cyber-chrome-400 hover:border-cyber-cyan/30 hover:text-cyber-cyan hover:bg-cyber-elevated transition-all"
            >
              <X size={16} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {activeSection === 'profile' && (
              <>
                <div className="flex items-center gap-4">
                  {authUser?.picture ? (
                    <img src={authUser.picture} alt="" className="w-12 h-12 border border-cyber-cyan/30" referrerPolicy="no-referrer" />
                  ) : (
                    <div className="w-12 h-12 border border-cyber-cyan/30 font-display font-bold text-lg flex items-center justify-center bg-cyber-cyan/10 text-cyber-cyan select-none">
                      {currentUser.charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div>
                    <h5 className="font-display font-bold text-lg text-cyber-chrome-50">{currentUser}</h5>
                    <p className="text-sm text-cyber-chrome-400 font-mono">
                      {authUser ? authUser.email : 'Guest user'}
                    </p>
                  </div>
                </div>

                {!authUser && (
                  <div>
                    <label className="block text-xs font-display font-bold uppercase tracking-widest text-cyber-chrome-400 mb-1.5">DISPLAY NAME</label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        defaultValue={currentUser}
                        onChange={e => setEditName(e.target.value)}
                        className="flex-1 px-3 py-2 cyber-input text-sm font-body"
                      />
                      <button
                        onClick={handleSaveName}
                        className="px-4 py-2 cyber-btn-green text-sm font-display font-bold tracking-wider"
                      >
                        SAVE
                      </button>
                    </div>
                  </div>
                )}

                <button
                  onClick={() => { logout(); setSettingsOpen(false); }}
                  className="flex items-center gap-2 px-4 py-2 cyber-btn-danger text-sm font-display font-bold tracking-wider"
                >
                  <LogOut size={14} />
                  {authUser ? 'SIGN OUT' : 'SWITCH USER'}
                </button>
              </>
            )}

            {activeSection === 'appearance' && (
              <div>
                <label className="block text-xs font-display font-bold uppercase tracking-widest text-cyber-chrome-400 mb-3">THEME</label>
                <div className="flex gap-3">
                  <button
                    onClick={() => setTheme('light')}
                    className={`flex-1 flex items-center gap-3 p-4 border transition-all ${
                      theme === 'light'
                        ? 'border-cyber-yellow/40 bg-cyber-yellow/10 shadow-neon-yellow'
                        : 'border-cyber-border hover:border-cyber-chrome-400'
                    }`}
                  >
                    <Sun size={24} className="text-cyber-yellow" />
                    <div className="text-left">
                      <div className="font-bold text-sm text-cyber-chrome-100">Light</div>
                      <div className="text-2xs text-cyber-chrome-400 font-mono">NOT AVAILABLE IN CYBERSPACE</div>
                    </div>
                  </button>
                  <button
                    onClick={() => setTheme('dark')}
                    className={`flex-1 flex items-center gap-3 p-4 border transition-all ${
                      theme === 'dark'
                        ? 'border-cyber-cyan/40 bg-cyber-cyan/10 shadow-neon-cyan'
                        : 'border-cyber-border hover:border-cyber-chrome-400'
                    }`}
                  >
                    <Moon size={24} className="text-cyber-cyan" />
                    <div className="text-left">
                      <div className="font-bold text-sm text-cyber-chrome-100">Cyber Dark</div>
                      <div className="text-2xs text-cyber-chrome-400 font-mono">DEFAULT INTERFACE</div>
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
