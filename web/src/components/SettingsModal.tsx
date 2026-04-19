import { useState, useCallback, useRef, useEffect } from 'react';
import { X, User, Palette, Monitor, Server, Camera, Smile, Plus, Trash2 } from 'lucide-react';
import { useApp } from '../store/AppContext';
import GlitchTransition from './glitch/GlitchTransition';
import ScanlineTear from './glitch/ScanlineTear';
import { themes, type ThemeId } from '../themes';
import { resizeAndEncode } from '../lib/imageEncode';

type Section = 'profile' | 'appearance' | 'avatars' | 'providers' | 'about';

const PROFILE_PRESET_MAX = 30;

const PREFS_KEY = 'zouk_preferences';

interface Preferences {
  fontSize: 'small' | 'medium' | 'large';
  chatWidth: '4xl' | '6xl' | '9xl';
}

function loadPrefs(): Preferences {
  try {
    const stored = localStorage.getItem(PREFS_KEY);
    if (stored) return { ...defaultPrefs, ...JSON.parse(stored) };
  } catch { /* ignore */ }
  return defaultPrefs;
}

const defaultPrefs: Preferences = { fontSize: 'medium', chatWidth: '4xl' };

function applyFontSizePreference(fontSize: Preferences['fontSize']) {
  if (fontSize === 'medium') {
    document.documentElement.removeAttribute('data-font-size');
    return;
  }
  document.documentElement.setAttribute('data-font-size', fontSize);
}

function applyChatWidthPreference(chatWidth: Preferences['chatWidth']) {
  if (chatWidth === '4xl') {
    document.documentElement.removeAttribute('data-chat-width');
    return;
  }
  document.documentElement.setAttribute('data-chat-width', chatWidth);
}

export default function SettingsModal() {
  const {
    settingsOpen, setSettingsOpen, theme, setTheme, currentUser, updateProfile, logout,
    wsConnected, daemonConnected, agents, machines, configs, authUser,
    profilePresets, addProfilePreset, removeProfilePreset,
  } = useApp();
  const [section, setSection] = useState<Section>('profile');
  const nc = theme === 'night-city';
  const brutalist = theme === 'brutalist';
  const [displayName, setDisplayName] = useState(currentUser);
  const [glitchActive, setGlitchActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const presetInputRef = useRef<HTMLInputElement>(null);
  const [presetError, setPresetError] = useState<string | null>(null);
  const [presetDragOver, setPresetDragOver] = useState(false);
  const [prefs, setPrefs] = useState<Preferences>(loadPrefs);

  useEffect(() => {
    applyFontSizePreference(prefs.fontSize);
  }, [prefs.fontSize]);

  useEffect(() => {
    applyChatWidthPreference(prefs.chatWidth);
  }, [prefs.chatWidth]);

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

  const handleAvatarUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await resizeAndEncode(file, 128);
      updateProfile(displayName || currentUser, dataUrl);
    } catch {
      // silently fail — image too large or invalid
    }
    e.target.value = '';
  }, [updateProfile, displayName, currentUser]);

  const processPresetFiles = useCallback(async (fileList: FileList | File[]) => {
    const images = Array.from(fileList).filter(f => f.type.startsWith('image/'));
    if (images.length === 0) return;

    const remaining = PROFILE_PRESET_MAX - profilePresets.length;
    if (remaining <= 0) {
      setPresetError(`Preset pool is full (${PROFILE_PRESET_MAX} max)`);
      return;
    }
    const accepted = images.slice(0, remaining);
    const dropped = images.length - accepted.length;

    setPresetError(null);
    let failures = 0;
    for (const file of accepted) {
      try {
        const dataUrl = await resizeAndEncode(file, 128);
        const res = await addProfilePreset(dataUrl, { silent: accepted.length > 1 });
        if (!res.ok) failures++;
      } catch {
        failures++;
      }
    }
    const parts: string[] = [];
    if (failures) parts.push(`${failures} failed`);
    if (dropped) parts.push(`${dropped} skipped — pool limit`);
    if (parts.length) setPresetError(parts.join('; '));
  }, [addProfilePreset, profilePresets.length]);

  const handlePresetUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    e.target.value = '';
    if (files && files.length) await processPresetFiles(files);
  }, [processPresetFiles]);

  const handlePresetDrop = useCallback(async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setPresetDragOver(false);
    if (e.dataTransfer.files?.length) await processPresetFiles(e.dataTransfer.files);
  }, [processPresetFiles]);

  const handleGlitchComplete = useCallback(() => {
    setGlitchActive(false);
  }, []);

  if (!settingsOpen) return null;

  const navItems: { key: Section; label: string; icon: typeof User }[] = [
    { key: 'profile', label: 'PROFILE', icon: User },
    { key: 'appearance', label: 'DISPLAY', icon: Palette },
    { key: 'avatars', label: 'AVATARS', icon: Smile },
    { key: 'providers', label: 'PROVIDERS', icon: Server },
    { key: 'about', label: 'SYSTEM', icon: Monitor },
  ];

  const presetCount = profilePresets.length;
  const atPresetLimit = presetCount >= PROFILE_PRESET_MAX;

  // Thick border variant only for brutalist
  const borderB = brutalist ? 'border-b-[3px] border-nc-border-bright' : 'border-b border-nc-border';

  return (
    <div
      className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 animate-fade-in p-4"
      onClick={(e) => e.target === e.currentTarget && setSettingsOpen(false)}
    >
      <GlitchTransition active={glitchActive} duration={400} onComplete={handleGlitchComplete} themeAgnostic />

      <div className={`cyber-panel w-full max-w-3xl h-[80vh] flex flex-col sm:flex-row overflow-hidden animate-bounce-in ${nc ? 'cyber-bevel' : ''}`}>
        <div className={`w-full sm:w-48 shrink-0 flex flex-row sm:flex-col bg-nc-deep order-last sm:order-first ${brutalist ? 'border-t-[3px] sm:border-t-0 sm:border-r-[3px] border-nc-border-bright' : 'border-t sm:border-t-0 sm:border-r border-nc-border'}`}>
          <div className={`hidden sm:flex h-14 items-center px-4 ${borderB}`}>
            {nc
              ? <h2 className="font-display font-black text-sm text-nc-cyan neon-cyan tracking-wider">SETTINGS</h2>
              : <h2 className="font-display font-bold text-base text-nc-text-bright">{nc ? 'SETTINGS' : 'Settings'}</h2>
            }
          </div>
          <nav className="flex flex-row sm:flex-col flex-1 sm:py-2 overflow-x-auto">
            {navItems.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                onClick={() => setSection(key)}
                className={`flex items-center justify-center sm:justify-start gap-2 px-4 py-2.5 text-sm font-bold transition-all flex-1 sm:flex-none sm:w-full ${nc ? 'tracking-wider' : ''} ${
                  section === key
                    ? `bg-nc-cyan/10 text-nc-cyan sm:border-r-2 border-nc-cyan border-b-2 sm:border-b-0`
                    : 'text-nc-muted hover:bg-nc-elevated hover:text-nc-text'
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
          <div className={`hidden sm:flex h-14 items-center justify-between px-6 ${borderB}`}>
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
                  <div
                    className="relative w-14 h-14 border border-nc-cyan bg-nc-cyan/10 font-display font-bold text-lg flex items-center justify-center text-nc-cyan cursor-pointer group overflow-hidden"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    {authUser?.picture ? (
                      <img src={authUser.picture} alt="" className="w-full h-full object-cover" />
                    ) : authUser?.gravatarUrl ? (
                      <img src={authUser.gravatarUrl} alt="" className="w-full h-full object-cover" />
                    ) : (
                      currentUser.charAt(0).toUpperCase()
                    )}
                    <div className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                      <Camera size={16} className="text-white" />
                    </div>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={handleAvatarUpload}
                    />
                  </div>
                  <div>
                    <p className="font-display font-bold text-nc-text-bright">{currentUser}</p>
                    <p className="text-xs text-nc-muted font-mono">{authUser ? authUser.email : 'GUEST_USER'}</p>
                    {authUser?.email && (
                      <a
                        href="https://gravatar.com"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-nc-cyan hover:underline"
                      >
                        Change avatar on Gravatar
                      </a>
                    )}
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
                  <label className="block text-xs font-bold text-nc-muted mb-3 uppercase tracking-wider">Font Size</label>
                  <div className="flex gap-2">
                    {(['small', 'medium', 'large'] as const).map(size => (
                      <button
                        key={size}
                        onClick={() => savePrefs({ fontSize: size })}
                        className={`flex-1 py-2 text-sm font-bold border transition-all ${
                          prefs.fontSize === size
                            ? 'bg-nc-cyan/15 text-nc-cyan border-nc-cyan'
                            : 'text-nc-muted border-nc-border hover:border-nc-cyan/50'
                        }`}
                      >
                        {size.charAt(0).toUpperCase() + size.slice(1)}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="hidden sm:block pt-4 border-t border-nc-border">
                  <label className="block text-xs font-bold text-nc-muted mb-3 uppercase tracking-wider">Chat Width</label>
                  <div className="flex gap-2">
                    {([
                      { id: '4xl', label: 'Normal' },
                      { id: '6xl', label: 'Wide' },
                      { id: '9xl', label: 'Full Screen' },
                    ] as const).map(({ id, label }) => (
                      <button
                        key={id}
                        onClick={() => savePrefs({ chatWidth: id })}
                        className={`flex-1 py-2 text-sm font-bold border transition-all ${
                          prefs.chatWidth === id
                            ? 'bg-nc-cyan/15 text-nc-cyan border-nc-cyan'
                            : 'text-nc-muted border-nc-border hover:border-nc-cyan/50'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

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

            {section === 'avatars' && (
              <div className="max-w-xl space-y-5">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <p className="text-sm font-bold text-nc-text-bright tracking-wider">AGENT_PRESETS</p>
                      <p className="text-xs text-nc-muted font-mono mt-0.5">
                        New agents are hashed into this pool for their starter avatar. Empty pool falls back to initials.
                      </p>
                    </div>
                    <span className="text-xs font-mono text-nc-muted">
                      {presetCount}{atPresetLimit ? ` / ${PROFILE_PRESET_MAX}` : ''}
                    </span>
                  </div>

                  {presetError && (
                    <p className="text-2xs font-mono text-nc-red mb-2">{presetError}</p>
                  )}

                  <div
                    onDragOver={(e) => { e.preventDefault(); if (!presetDragOver) setPresetDragOver(true); }}
                    onDragLeave={(e) => { if (e.currentTarget === e.target) setPresetDragOver(false); }}
                    onDrop={handlePresetDrop}
                    className={`relative grid grid-cols-6 gap-2 p-1 transition-colors ${presetDragOver ? 'bg-nc-cyan/5 outline outline-2 outline-dashed outline-nc-cyan/50' : ''}`}
                  >
                    {profilePresets.map(p => (
                      <div key={p.id} className="relative group aspect-square border border-nc-border bg-nc-panel overflow-hidden">
                        <img src={p.image} alt="" className="w-full h-full object-cover" />
                        <button
                          type="button"
                          onClick={() => removeProfilePreset(p.id)}
                          className="absolute inset-0 bg-black/60 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity text-nc-red"
                          title="Remove preset"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    ))}
                    {!atPresetLimit && (
                      <button
                        type="button"
                        onClick={() => presetInputRef.current?.click()}
                        className="aspect-square border border-dashed border-nc-border hover:border-nc-cyan hover:text-nc-cyan text-nc-muted flex items-center justify-center transition-colors"
                        title="Upload avatar presets"
                      >
                        <Plus size={18} />
                      </button>
                    )}
                    {presetDragOver && (
                      <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs font-mono text-nc-cyan bg-nc-deep/60">
                        DROP_TO_UPLOAD
                      </div>
                    )}
                  </div>
                  <p className="text-2xs font-mono text-nc-muted mt-1">
                    Drop images here or click + to upload. Multiple files supported.
                  </p>
                  <input
                    ref={presetInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={handlePresetUpload}
                  />
                  {atPresetLimit && (
                    <p className="text-2xs font-mono text-nc-yellow mt-2">
                      Preset pool is full ({PROFILE_PRESET_MAX} max). Remove one to upload more.
                    </p>
                  )}
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
                          <span className="text-2xs font-bold px-1.5 py-0.5 border border-nc-cyan/30 text-nc-cyan bg-nc-cyan/10">
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
