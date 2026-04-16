import { useState, useCallback } from 'react';
import { X, User, Palette, Monitor, Server, SlidersHorizontal } from 'lucide-react';
import { useApp } from '../store/AppContext';
import GlitchTransition from './glitch/GlitchTransition';
import ScanlineTear from './glitch/ScanlineTear';
import { themes, type ThemeId } from '../themes';

type Section = 'profile' | 'appearance' | 'providers' | 'preferences' | 'about';

const PREFS_KEY = 'zouk_preferences';

interface Preferences {
  fontSize: 'small' | 'medium' | 'large';
  notifications: boolean;
  language: 'en' | 'zh' | 'ja';
}

function loadPrefs(): Preferences {
  try {
    const stored = localStorage.getItem(PREFS_KEY);
    if (stored) return { ...defaultPrefs, ...JSON.parse(stored) };
  } catch { /* ignore */ }
  return defaultPrefs;
}

const defaultPrefs: Preferences = { fontSize: 'medium', notifications: true, language: 'en' };

export default function SettingsModal() {
  const {
    settingsOpen, setSettingsOpen, theme, setTheme, currentUser, updateProfile, logout,
    wsConnected, daemonConnected, agents, machines, configs,
  } = useApp();
  const [section, setSection] = useState<Section>('profile');
  const nc = theme === 'night-city';
  const [displayName, setDisplayName] = useState(currentUser);
  const [glitchActive, setGlitchActive] = useState(false);
  const [prefs, setPrefs] = useState<Preferences>(loadPrefs);

  const savePrefs = useCallback((update: Partial<Preferences>) => {
    setPrefs(prev => {
      const next = { ...prev, ...update };
      localStorage.setItem(PREFS_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const handleThemeChange = useCallback((newTheme: ThemeId) => {
    if (newTheme === theme) return;
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
    { key: 'providers', label: 'PROVIDERS', icon: Server },
    { key: 'preferences', label: 'PREFERENCES', icon: SlidersHorizontal },
    { key: 'about', label: 'SYSTEM', icon: Monitor },
  ];

  return (
    <div
      className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 animate-fade-in p-4"
      onClick={(e) => e.target === e.currentTarget && setSettingsOpen(false)}
    >
      <GlitchTransition active={glitchActive} duration={400} onComplete={handleGlitchComplete} themeAgnostic />

      <div className="cyber-panel w-full max-w-3xl h-[80vh] flex flex-col sm:flex-row overflow-hidden animate-bounce-in cyber-bevel">
        <div className={`w-full sm:w-48 shrink-0 flex flex-row sm:flex-col ${nc ? 'bg-nc-deep border-b sm:border-b-0 sm:border-r border-nc-border' : 'bg-nc-panel border-b-[3px] sm:border-b-0 sm:border-r-[3px] border-nc-border-bright'}`}>
          <div className={`hidden sm:block px-4 py-4 ${nc ? 'border-b border-nc-border' : 'border-b-2 border-nc-border'}`}>
            {nc
              ? <h2 className="font-display font-black text-sm text-nc-cyan neon-cyan tracking-wider">SETTINGS</h2>
              : <h2 className="font-display font-black text-lg text-nc-text-bright">Settings</h2>
            }
          </div>
          <nav className="flex flex-row sm:flex-col flex-1 sm:py-2 overflow-x-auto">
            {navItems.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                onClick={() => setSection(key)}
                className={`flex items-center justify-center sm:justify-start gap-2 px-4 py-2.5 text-sm font-bold transition-all flex-1 sm:flex-none sm:w-full ${nc ? 'tracking-wider' : ''} ${
                  section === key
                    ? (nc ? 'bg-nc-cyan/10 text-nc-cyan sm:border-r-2 border-nc-cyan border-b-2 sm:border-b-0' : 'bg-nc-yellow sm:border-r-[3px] border-nc-border-bright text-nc-text-bright border-b-[3px] sm:border-b-0')
                    : (nc ? 'text-nc-muted hover:bg-nc-elevated hover:text-nc-text' : 'text-nc-muted hover:bg-nc-elevated hover:text-nc-text-bright')
                }`}
              >
                <Icon size={16} />
                <span className="hidden sm:inline">{nc ? label : label.charAt(0) + label.slice(1).toLowerCase()}</span>
              </button>
            ))}
            <button
              onClick={() => setSettingsOpen(false)}
              className="flex sm:hidden items-center justify-center px-3 py-2.5 text-nc-muted hover:text-nc-red"
            >
              <X size={16} />
            </button>
          </nav>
        </div>

        <div className="flex-1 flex flex-col min-h-0">
          <div className={`hidden sm:flex h-14 items-center justify-between px-6 ${nc ? 'border-b border-nc-border' : 'border-b-[3px] border-nc-border-bright'}`}>
            <h3 className={`font-display font-bold text-base text-nc-text-bright ${nc ? 'tracking-wider' : 'capitalize'}`}>
              {nc ? navItems.find(n => n.key === section)?.label : navItems.find(n => n.key === section)?.label.charAt(0).toUpperCase()! + navItems.find(n => n.key === section)?.label.slice(1).toLowerCase()}
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
                      onClick={() => { setSettingsOpen(false); logout(); }}
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

            {section === 'providers' && (
              <div className="max-w-md space-y-6">
                <div>
                  <label className="block text-xs font-bold text-nc-muted mb-3 uppercase tracking-wider">Agent Configurations</label>
                  {configs.length === 0 ? (
                    <div className="cyber-panel-elevated p-4 text-sm text-nc-muted font-mono">No agent configs defined</div>
                  ) : (
                    <div className="space-y-2">
                      {configs.map(cfg => (
                        <div key={cfg.name} className="cyber-panel-elevated p-3 flex items-center justify-between">
                          <div>
                            <p className="text-sm font-bold text-nc-text-bright">{cfg.displayName || cfg.name}</p>
                            <p className="text-xs text-nc-muted font-mono mt-0.5">{cfg.runtime}{cfg.model ? ` · ${cfg.model}` : ''}</p>
                          </div>
                          <span className={`text-2xs font-bold px-1.5 py-0.5 border ${nc ? 'border-nc-cyan/30 text-nc-cyan bg-nc-cyan/10' : 'border-nc-border-bright text-nc-text-bright bg-nc-elevated'}`}>
                            {cfg.runtime}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-bold text-nc-muted mb-3 uppercase tracking-wider">Connected Machines</label>
                  {machines.length === 0 ? (
                    <div className="cyber-panel-elevated p-4 text-sm text-nc-muted font-mono">No machines connected</div>
                  ) : (
                    <div className="space-y-2">
                      {machines.map(m => (
                        <div key={m.id} className="cyber-panel-elevated p-3 flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className={`w-2 h-2 ${m.status === 'online' ? 'bg-nc-green' : 'bg-nc-muted/30'}`} />
                            <div>
                              <p className="text-sm font-bold text-nc-text-bright">{m.alias || m.hostname}</p>
                              <p className="text-xs text-nc-muted font-mono mt-0.5">{m.os}{m.runtimes?.length ? ` · ${m.runtimes.join(', ')}` : ''}</p>
                            </div>
                          </div>
                          {m.agentIds && m.agentIds.length > 0 && (
                            <span className="text-2xs text-nc-muted font-mono">{m.agentIds.length} agent{m.agentIds.length !== 1 ? 's' : ''}</span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {section === 'preferences' && (
              <div className="max-w-md space-y-6">
                <div>
                  <label className="block text-xs font-bold text-nc-muted mb-3 uppercase tracking-wider">Font Size</label>
                  <div className="flex gap-2">
                    {(['small', 'medium', 'large'] as const).map(size => (
                      <button
                        key={size}
                        onClick={() => savePrefs({ fontSize: size })}
                        className={`flex-1 py-2 text-sm font-bold border transition-all ${
                          prefs.fontSize === size
                            ? (nc ? 'bg-nc-cyan/15 text-nc-cyan border-nc-cyan' : 'bg-nc-yellow text-nc-text-bright border-nc-border-bright')
                            : (nc ? 'text-nc-muted border-nc-border hover:border-nc-cyan/50' : 'text-nc-muted border-nc-border hover:border-nc-border-bright')
                        }`}
                      >
                        {size.charAt(0).toUpperCase() + size.slice(1)}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-nc-muted mb-3 uppercase tracking-wider">Notifications</label>
                  <button
                    onClick={() => savePrefs({ notifications: !prefs.notifications })}
                    className={`flex items-center gap-3 px-4 py-2.5 border w-full text-left transition-all ${
                      prefs.notifications
                        ? (nc ? 'border-nc-green/50 bg-nc-green/10 text-nc-green' : 'border-nc-border-bright bg-nc-elevated text-nc-text-bright')
                        : (nc ? 'border-nc-border bg-nc-panel text-nc-muted' : 'border-nc-border bg-nc-panel text-nc-muted')
                    }`}
                  >
                    <span className={`w-8 h-4 border relative transition-all ${
                      prefs.notifications
                        ? (nc ? 'border-nc-green bg-nc-green/20' : 'border-nc-border-bright bg-nc-yellow')
                        : 'border-nc-border bg-nc-panel'
                    }`}>
                      <span className={`absolute top-0.5 w-2.5 h-2.5 transition-all ${
                        prefs.notifications
                          ? (nc ? 'right-0.5 bg-nc-green' : 'right-0.5 bg-nc-text-bright')
                          : 'left-0.5 bg-nc-muted'
                      }`} />
                    </span>
                    <span className="text-sm font-bold">{prefs.notifications ? 'Enabled' : 'Disabled'}</span>
                  </button>
                </div>

                <div>
                  <label className="block text-xs font-bold text-nc-muted mb-3 uppercase tracking-wider">Language</label>
                  <div className="flex gap-2">
                    {([['en', 'English'], ['zh', '中文'], ['ja', '日本語']] as const).map(([code, label]) => (
                      <button
                        key={code}
                        onClick={() => savePrefs({ language: code as Preferences['language'] })}
                        className={`flex-1 py-2 text-sm font-bold border transition-all ${
                          prefs.language === code
                            ? (nc ? 'bg-nc-cyan/15 text-nc-cyan border-nc-cyan' : 'bg-nc-yellow text-nc-text-bright border-nc-border-bright')
                            : (nc ? 'text-nc-muted border-nc-border hover:border-nc-cyan/50' : 'text-nc-muted border-nc-border hover:border-nc-border-bright')
                        }`}
                      >
                        {label}
                      </button>
                    ))}
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

                <div>
                  <label className="block text-xs font-bold text-nc-muted mb-3 uppercase tracking-wider">Connection Status</label>
                  <div className="space-y-2">
                    <div className="cyber-panel-elevated p-3 flex items-center justify-between">
                      <span className="text-sm text-nc-text-bright font-bold">WebSocket</span>
                      <div className="flex items-center gap-2">
                        <span className={`w-2 h-2 ${wsConnected ? 'bg-nc-green' : 'bg-nc-red'}`} />
                        <span className={`text-xs font-mono ${wsConnected ? 'text-nc-green' : 'text-nc-red'}`}>
                          {wsConnected ? 'CONNECTED' : 'DISCONNECTED'}
                        </span>
                      </div>
                    </div>
                    <div className="cyber-panel-elevated p-3 flex items-center justify-between">
                      <span className="text-sm text-nc-text-bright font-bold">Daemon</span>
                      <div className="flex items-center gap-2">
                        <span className={`w-2 h-2 ${daemonConnected ? 'bg-nc-green' : 'bg-nc-red'}`} />
                        <span className={`text-xs font-mono ${daemonConnected ? 'text-nc-green' : 'text-nc-red'}`}>
                          {daemonConnected ? 'CONNECTED' : 'DISCONNECTED'}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-nc-muted mb-3 uppercase tracking-wider">Runtime Info</label>
                  <div className="cyber-panel-elevated p-3 text-xs font-mono space-y-1">
                    <p className="text-nc-muted">Agents online: <span className="text-nc-text-bright">{agents.filter(a => a.status === 'active').length} / {agents.length}</span></p>
                    <p className="text-nc-muted">Machines: <span className="text-nc-text-bright">{machines.length}</span></p>
                    <p className="text-nc-muted">Configs: <span className="text-nc-text-bright">{configs.length}</span></p>
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
