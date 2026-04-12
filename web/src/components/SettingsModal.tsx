import { useState, useCallback } from 'react';
import { X, User, Palette, Monitor } from 'lucide-react';
import { useApp } from '../store/AppContext';
import GlitchTransition from './glitch/GlitchTransition';
import ScanlineTear from './glitch/ScanlineTear';
import { themes, type ThemeId, applyTheme } from '../themes';
import { isNightCity } from '../lib/themeUtils';

type Section = 'profile' | 'appearance' | 'about';

export default function SettingsModal() {
  const { settingsOpen, setSettingsOpen, theme, setTheme, currentUser, updateProfile } = useApp();
  const [section, setSection] = useState<Section>('profile');
  const [displayName, setDisplayName] = useState(currentUser);
  const [glitchActive, setGlitchActive] = useState(false);

  const handleThemeChange = useCallback((newTheme: ThemeId) => {
    if (newTheme === theme) return;
    applyTheme(newTheme);
    setTheme(newTheme);
    if (newTheme === 'night-city') {
      setGlitchActive(true);
    }
  }, [theme, setTheme]);

  const handleGlitchComplete = useCallback(() => {
    setGlitchActive(false);
  }, []);

  if (!settingsOpen) return null;

  const navItems: { key: Section; label: string; icon: typeof User }[] = [
    { key: 'profile', label: 'PROFILE', icon: User },
    { key: 'appearance', label: 'DISPLAY', icon: Palette },
    { key: 'about', label: 'SYSTEM', icon: Monitor },
  ];

  return (
    <div
      className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 animate-fade-in"
      onClick={(e) => e.target === e.currentTarget && setSettingsOpen(false)}
    >
      <GlitchTransition active={glitchActive} duration={400} onComplete={handleGlitchComplete} themeAgnostic />

      <div className="cyber-panel w-full max-w-3xl h-[80vh] flex overflow-hidden animate-bounce-in cyber-bevel">
        {(() => { const nc = isNightCity(); return (
        <div className={`w-48 flex flex-col ${nc ? 'bg-nc-deep border-r border-nc-border' : 'bg-nc-panel border-r-[3px] border-nc-border-bright'}`}>
          <div className={`px-4 py-4 ${nc ? 'border-b border-nc-border' : 'border-b-2 border-nc-border'}`}>
            {nc
              ? <h2 className="font-display font-black text-sm text-nc-cyan neon-cyan tracking-wider">SETTINGS</h2>
              : <h2 className="font-display font-black text-lg text-nc-text-bright">Settings</h2>
            }
          </div>
          <nav className="flex-1 py-2">
            {navItems.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                onClick={() => setSection(key)}
                className={`w-full flex items-center gap-2 px-4 py-2.5 text-sm font-bold transition-all ${nc ? 'tracking-wider' : ''} ${
                  section === key
                    ? (nc ? 'bg-nc-cyan/10 text-nc-cyan border-r-2 border-nc-cyan' : 'bg-nc-yellow border-r-[3px] border-nc-border-bright text-nc-text-bright')
                    : (nc ? 'text-nc-muted hover:bg-nc-elevated hover:text-nc-text' : 'text-nc-muted hover:bg-nc-elevated hover:text-nc-text-bright')
                }`}
              >
                <Icon size={16} />
                {nc ? label : label.charAt(0) + label.slice(1).toLowerCase()}
              </button>
            ))}
          </nav>
        </div>
        ); })()}

        <div className="flex-1 flex flex-col">
          <div className={`h-14 flex items-center justify-between px-6 ${isNightCity() ? 'border-b border-nc-border' : 'border-b-[3px] border-nc-border-bright'}`}>
            <h3 className={`font-display font-bold text-base text-nc-text-bright ${isNightCity() ? 'tracking-wider' : 'capitalize'}`}>
              {isNightCity() ? navItems.find(n => n.key === section)?.label : navItems.find(n => n.key === section)?.label.charAt(0).toUpperCase()! + navItems.find(n => n.key === section)?.label.slice(1).toLowerCase()}
            </h3>
            <ScanlineTear config={{ trigger: 'hover', minInterval: 200, maxInterval: 600, minSeverity: 0.3, maxSeverity: 0.8 }}>
              <button
                onClick={() => setSettingsOpen(false)}
                className="cyber-btn w-8 h-8 border border-nc-border flex items-center justify-center text-nc-muted hover:border-nc-red hover:text-nc-red hover:bg-nc-red/10"
              >
                <X size={16} />
              </button>
            </ScanlineTear>
          </div>

          <div className="flex-1 overflow-y-auto p-6 scrollbar-thin">
            {section === 'profile' && (
              <div className="max-w-md space-y-6">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 border border-nc-cyan bg-nc-cyan/10 font-display font-bold text-lg flex items-center justify-center text-nc-cyan">
                    {currentUser.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <p className="font-display font-bold text-nc-text-bright">{currentUser}</p>
                    <p className="text-xs text-nc-muted font-mono">GUEST_USER</p>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-nc-muted mb-1.5 uppercase tracking-wider">Display Name</label>
                  <input
                    value={displayName}
                    onChange={e => setDisplayName(e.target.value)}
                    className="cyber-input w-full px-3 py-2 text-sm"
                  />
                </div>

                <ScanlineTear config={{ trigger: 'hover', minInterval: 200, maxInterval: 600, minSeverity: 0.3, maxSeverity: 0.8 }}>
                  <button
                    onClick={() => {
                      if (displayName.trim() && displayName !== currentUser) {
                        updateProfile(displayName.trim());
                      }
                    }}
                    className="cyber-btn px-4 py-2 bg-nc-cyan/10 border border-nc-cyan/50 text-nc-cyan font-bold text-sm tracking-wider"
                  >
                    Update Profile
                  </button>
                </ScanlineTear>

                <div className="pt-4 border-t border-nc-border">
                  <ScanlineTear config={{ trigger: 'hover', minInterval: 200, maxInterval: 600, minSeverity: 0.3, maxSeverity: 0.8 }}>
                    <button
                      onClick={() => { setSettingsOpen(false); }}
                      className="cyber-btn px-4 py-2 bg-nc-red/10 border border-nc-red/50 text-nc-red font-bold text-sm tracking-wider"
                    >
                      Disconnect
                    </button>
                  </ScanlineTear>
                </div>
              </div>
            )}

            {section === 'appearance' && (
              <div className="max-w-md space-y-6">
                <div>
                  <label className="block text-xs font-bold text-nc-muted mb-3 uppercase tracking-wider">Theme</label>
                  <div className="grid grid-cols-2 gap-3">
                    {themes.map((t) => {
                      const Btn = t.ThemeSelectButton;
                      return (
                        <Btn
                          key={t.id}
                          selected={theme === t.id}
                          onClick={() => handleThemeChange(t.id)}
                        />
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {section === 'about' && (
              <div className="max-w-md space-y-4">
                <div className="cyber-panel-elevated p-4">
                  <div className="text-xs font-mono text-nc-cyan">
                    <p>ZOUK_PLATFORM v2.0.77</p>
                    <p className="text-nc-muted mt-1">Theme: {themes.find(t => t.id === theme)?.name}</p>
                    <p className="text-nc-muted mt-1">Pluggable theme system — add themes via /themes folder</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
