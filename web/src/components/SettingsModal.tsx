import { useState, useCallback, useRef, useEffect, useSyncExternalStore } from 'react';
import { X, User, Palette, Monitor, Server, Camera, Smile, Plus, Trash2, Link2, Activity, Ban, RefreshCw, Globe2, Brain } from 'lucide-react';
import { useApp } from '../store/AppContext';
import GlitchTransition from './glitch/GlitchTransition';
import ScanlineTear from './glitch/ScanlineTear';
import { themes, themeSupportsColorMode, type ThemeId } from '../themes';
import type { ColorMode } from '../types';
import { resizeAndEncode } from '../lib/imageEncode';
import * as api from '../lib/api';
import type { WsClientStats } from '../lib/api';
import type { ServerChannel, WorkspaceEmbedSettings, WorkspaceOpenvikingSettings } from '../types';
import {
  getStoredLinkTransforms,
  setStoredLinkTransforms,
  subscribeLinkTransforms,
  type LinkTransformRule,
} from '../store/storage';

type Section = 'profile' | 'appearance' | 'avatars' | 'providers' | 'connections' | 'links' | 'embed' | 'openviking' | 'about';

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
    settingsOpen, setSettingsOpen, theme, setTheme, colorMode, setColorMode,
    currentUser, updateProfile, logout,
    wsConnected, agents, machines, configs, authUser,
    profilePresets, addProfilePreset, removeProfilePreset,
    workspaces, activeWorkspaceId, setActiveWorkspaceId,
    channels, canAdminWorkspace,
  } = useApp();
  const [section, setSection] = useState<Section>('profile');
  const nc = false;
  const brutalist = false;
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
  }, [theme, setTheme]);

  const handleColorModeChange = useCallback((mode: ColorMode) => {
    if (mode === colorMode) return;
    setColorMode(mode);
  }, [colorMode, setColorMode]);

  const showColorModeToggle = themeSupportsColorMode(theme);

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

    const localPresetCount = profilePresets.filter(p => !p.shared).length;
    const remaining = PROFILE_PRESET_MAX - localPresetCount;
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
  }, [addProfilePreset, profilePresets]);

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
    { key: 'connections', label: 'CONNECTIONS', icon: Activity },
    { key: 'links', label: 'LINKS', icon: Link2 },
    { key: 'embed', label: 'EMBED', icon: Globe2 },
    { key: 'openviking', label: 'OPENVIKING', icon: Brain },
    { key: 'about', label: 'SYSTEM', icon: Monitor },
  ];
  const currentNavItem = navItems.find((item) => item.key === section) ?? navItems[0];
  const sectionTitle = nc
    ? currentNavItem.label
    : currentNavItem.label.charAt(0) + currentNavItem.label.slice(1).toLowerCase();

  const presetCount = profilePresets.length;
  const localPresetCount = profilePresets.filter(p => !p.shared).length;
  const atPresetLimit = localPresetCount >= PROFILE_PRESET_MAX;
  const presetCountLabel = activeWorkspaceId === 'default'
    ? `${localPresetCount}${atPresetLimit ? ` / ${PROFILE_PRESET_MAX}` : ''}`
    : `${presetCount} total · ${localPresetCount}${atPresetLimit ? ` / ${PROFILE_PRESET_MAX}` : ''} local`;
  const activeWorkspace = workspaces.find(w => w.id === activeWorkspaceId) || workspaces[0] || null;

  // Thick border variant only for brutalist
  const borderB = brutalist ? 'border-b-[3px] border-nc-border-bright' : 'border-b border-nc-border';

  return (
    <div
      className="fixed inset-0 bg-nc-black/70 flex items-center justify-center z-50 animate-fade-in p-4 safe-top safe-bottom"
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
              {sectionTitle}
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

          <div className="overflow-y-auto p-6 scrollbar-thin">
            <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between border border-nc-border bg-nc-panel/70 px-3 py-2">
              <div>
                <p className="text-xs font-bold text-nc-text-bright tracking-wider">SERVER</p>
                <p className="text-2xs font-mono text-nc-muted mt-0.5">Switch the active Zouk server.</p>
              </div>
              <select
                value={activeWorkspace?.id || activeWorkspaceId || 'default'}
                onChange={(e) => setActiveWorkspaceId(e.target.value)}
                className="cyber-input min-w-0 sm:min-w-48 px-2 py-1.5 text-xs font-mono"
                aria-label="Switch server"
              >
                {workspaces.map(workspace => (
                  <option key={workspace.id} value={workspace.id}>{workspace.name}</option>
                ))}
              </select>
            </div>

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
                      Logout
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

                {showColorModeToggle && (
                  <div>
                    <label className="block text-xs font-bold text-nc-muted mb-3 uppercase tracking-wider">Color Mode</label>
                    <div className="inline-flex p-0.5 rounded-lg bg-nc-elevated border border-nc-border" role="tablist">
                      {([
                        { id: 'light', label: 'Light' },
                        { id: 'dark', label: 'Dark' },
                        { id: 'system', label: 'System' },
                      ] as Array<{ id: ColorMode; label: string }>).map(opt => {
                        const active = colorMode === opt.id;
                        return (
                          <button
                            key={opt.id}
                            type="button"
                            role="tab"
                            aria-selected={active}
                            onClick={() => handleColorModeChange(opt.id)}
                            className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors ${
                              active
                                ? 'bg-nc-surface text-nc-text-bright shadow-sm'
                                : 'text-nc-muted hover:text-nc-text-bright'
                            }`}
                          >
                            {opt.label}
                          </button>
                        );
                      })}
                    </div>
                    <p className="text-xs text-nc-muted mt-2">
                      System follows your OS preference and updates automatically.
                    </p>
                  </div>
                )}
              </div>
            )}

            {section === 'avatars' && (
              <div className="max-w-xl space-y-5">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <p className="text-sm font-bold text-nc-text-bright tracking-wider">AGENT_PRESETS</p>
                      <p className="text-xs text-nc-muted font-mono mt-0.5">
                        Default server presets are shared across all servers. Empty pool falls back to initials.
                      </p>
                    </div>
                    <span className="text-xs font-mono text-nc-muted">
                      {presetCountLabel}
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
                      <div
                        key={p.id}
                        className="relative group aspect-square border border-nc-border bg-nc-panel overflow-hidden"
                        title={p.shared ? 'Shared from default server' : undefined}
                      >
                        <img src={p.image} alt="" className="w-full h-full object-cover" />
                        {p.shared ? (
                          <span className="absolute left-1 top-1 w-5 h-5 bg-nc-deep/85 border border-nc-cyan/40 flex items-center justify-center text-nc-cyan">
                            <Link2 size={11} />
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => removeProfilePreset(p.id)}
                            className="absolute right-1 top-1 w-6 h-6 bg-nc-deep/85 border border-nc-red/50 flex items-center justify-center text-nc-red opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:bg-nc-red/15 transition-all"
                            title="Remove preset"
                          >
                            <Trash2 size={12} />
                          </button>
                        )}
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


            {section === 'connections' && <ConnectionsSection />}

            {section === 'links' && <LinkTransformsSection />}

            {section === 'embed' && (
              <EmbedSection
                channels={channels}
                canAdminWorkspace={!!canAdminWorkspace}
                activeWorkspaceId={activeWorkspaceId}
              />
            )}

            {section === 'openviking' && (
              <OpenvikingSection
                canAdminWorkspace={!!canAdminWorkspace}
                activeWorkspaceId={activeWorkspaceId}
              />
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
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-nc-muted mb-3 uppercase tracking-wider">Runtime Info</label>
                  <div className="cyber-panel-elevated p-3 text-xs font-mono space-y-1">
                    <p className="text-nc-muted">Agents online: <span className="text-nc-text-bright">{agents.filter(a => a.status === 'active').length} / {agents.length}</span></p>
                    <p className="text-nc-muted">Machines: <span className="text-nc-text-bright">{machines.length}</span></p>
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

function EmbedSection({
  channels,
  canAdminWorkspace,
  activeWorkspaceId,
}: {
  channels: ServerChannel[];
  canAdminWorkspace: boolean;
  activeWorkspaceId: string;
}) {
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [originsText, setOriginsText] = useState('https://studio.zaynjarvis.com');
  const [selectedChannelIds, setSelectedChannelIds] = useState<Set<string>>(new Set());
  const [ttl, setTtl] = useState(3600);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const channelRows = channels.filter((ch) => (ch.type || 'channel') === 'channel');

  const applySettings = useCallback((settings: WorkspaceEmbedSettings) => {
    setEnabled(settings.enabled);
    setOriginsText((settings.allowedOrigins || []).join('\n') || 'https://studio.zaynjarvis.com');
    setSelectedChannelIds(new Set(settings.allowedChannelIds || []));
    setTtl(settings.tokenTtlSeconds || 3600);
    setSavedAt(settings.updatedAt || null);
  }, []);

  const refresh = useCallback(async () => {
    if (!canAdminWorkspace) {
      setLoaded(true);
      return;
    }
    setLoaded(false);
    setError(null);
    try {
      applySettings(await api.getEmbedSettings());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load embed settings');
    } finally {
      setLoaded(true);
    }
  }, [applySettings, canAdminWorkspace]);

  useEffect(() => {
    refresh();
  }, [refresh, activeWorkspaceId]);

  const origins = originsText
    .split(/[\n,]+/)
    .map((origin) => origin.trim())
    .filter(Boolean);
  const selectedChannels = channelRows.filter((channel) => selectedChannelIds.has(channel.id));
  const firstChannel = selectedChannels[0]?.name || channelRows[0]?.name || 'all';
  const zoukOrigin = typeof window !== 'undefined' ? window.location.origin : 'https://zouk.zaynjarvis.com';
  const snippet = [
    `const session = await fetch("${zoukOrigin}/api/auth/embed-guest-session", {`,
    '  method: "POST",',
    '  headers: { "Content-Type": "application/json" },',
    `  body: JSON.stringify({ workspaceId: "${activeWorkspaceId}", channel: "${firstChannel}", name: "reader" })`,
    '}).then((res) => res.json());',
    '',
    `const ws = new WebSocket("${zoukOrigin.replace(/^http/, 'ws')}/ws?token=" + session.token + "&workspaceId=${activeWorkspaceId}");`,
  ].join('\n');

  const toggleChannel = (id: string) => {
    setSelectedChannelIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const save = async () => {
    if (!canAdminWorkspace || busy) return;
    setBusy(true);
    setError(null);
    try {
      const settings = await api.saveEmbedSettings({
        enabled,
        allowedOrigins: origins,
        allowedChannelIds: [...selectedChannelIds],
        tokenTtlSeconds: ttl,
      });
      applySettings(settings);
      setSavedAt(settings.updatedAt || new Date().toISOString());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save embed settings');
    } finally {
      setBusy(false);
    }
  };

  if (!canAdminWorkspace) {
    return (
      <div className="max-w-xl space-y-4">
        <div>
          <p className="text-sm font-bold text-nc-text-bright tracking-wider">EMBED_ACCESS</p>
          <p className="text-xs text-nc-muted font-mono mt-0.5">Workspace admin access is required.</p>
        </div>
      </div>
    );
  }

  if (!loaded) {
    return <p className="text-xs font-mono text-nc-muted">Loading embed settings...</p>;
  }

  return (
    <div className="max-w-2xl space-y-5">
      <div>
        <p className="text-sm font-bold text-nc-text-bright tracking-wider">EMBED_ACCESS</p>
        <p className="text-xs text-nc-muted font-mono mt-0.5">
          Mint short-lived guest sessions for approved external origins and channel scopes.
        </p>
      </div>

      {error && (
        <div className="p-3 border border-nc-red/50 bg-nc-red/10 text-xs font-mono text-nc-red">
          {error}
        </div>
      )}

      <label className="flex items-center justify-between gap-3 cyber-panel-elevated p-3 cursor-pointer">
        <span>
          <span className="block text-sm font-bold text-nc-text-bright">Enable external chat</span>
          <span className="block text-xs font-mono text-nc-muted mt-0.5">Browser tokens are scoped to the channels below.</span>
        </span>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          className="w-5 h-5 accent-cyan-400"
        />
      </label>

      <div>
        <label className="block text-xs font-bold text-nc-muted mb-1.5 uppercase tracking-wider">Allowed origins</label>
        <textarea
          value={originsText}
          onChange={(e) => setOriginsText(e.target.value)}
          className="cyber-input w-full px-3 py-2 text-xs font-mono min-h-24"
          spellCheck={false}
          placeholder="https://studio.zaynjarvis.com"
        />
        <p className="text-2xs font-mono text-nc-muted mt-1">One origin per line. Include local dev origins when testing locally.</p>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="block text-xs font-bold text-nc-muted uppercase tracking-wider">Channel scope</label>
          <span className="text-2xs font-mono text-nc-muted">{selectedChannelIds.size} selected</span>
        </div>
        <div className="grid sm:grid-cols-2 gap-2">
          {channelRows.map(channel => (
            <label
              key={channel.id}
              className={`flex items-center gap-2 border px-3 py-2 text-sm cursor-pointer ${
                selectedChannelIds.has(channel.id)
                  ? 'border-nc-cyan/60 bg-nc-cyan/10 text-nc-cyan'
                  : 'border-nc-border text-nc-muted hover:text-nc-text hover:bg-nc-elevated'
              }`}
            >
              <input
                type="checkbox"
                checked={selectedChannelIds.has(channel.id)}
                onChange={() => toggleChannel(channel.id)}
                className="accent-cyan-400"
              />
              <span className="font-mono">#{channel.name}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="max-w-xs">
        <label className="block text-xs font-bold text-nc-muted mb-1.5 uppercase tracking-wider">Token TTL seconds</label>
        <input
          type="number"
          min={300}
          max={86400}
          step={60}
          value={ttl}
          onChange={(e) => setTtl(Number(e.target.value))}
          className="cyber-input w-full px-3 py-2 text-xs font-mono"
        />
      </div>

      <div>
        <label className="block text-xs font-bold text-nc-muted mb-1.5 uppercase tracking-wider">External bootstrap</label>
        <pre className="cyber-panel-elevated p-3 overflow-x-auto text-2xs font-mono text-nc-muted whitespace-pre-wrap">
          {snippet}
        </pre>
      </div>

      <div className="flex items-center gap-3">
        <ScanlineTear config={{ trigger: 'hover', minInterval: 200, maxInterval: 600, minSeverity: 0.3, maxSeverity: 0.8 }}>
          <button
            onClick={save}
            disabled={busy}
            className="cyber-btn px-4 py-2 bg-nc-cyan/10 border border-nc-cyan/50 text-nc-cyan font-bold text-sm tracking-wider disabled:opacity-40"
          >
            {busy ? 'Saving...' : 'Save'}
          </button>
        </ScanlineTear>
        {savedAt && <span className="text-2xs font-mono text-nc-muted">Saved {new Date(savedAt).toLocaleTimeString()}</span>}
      </div>
    </div>
  );
}

function OpenvikingSection({
  canAdminWorkspace,
  activeWorkspaceId,
}: {
  canAdminWorkspace: boolean;
  activeWorkspaceId: string;
}) {
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [settings, setSettings] = useState<WorkspaceOpenvikingSettings | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [url, setUrl] = useState('');
  const [rootApiKey, setRootApiKey] = useState('');
  const [keyDirty, setKeyDirty] = useState(false);
  const [account, setAccount] = useState('');
  const [accountDirty, setAccountDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const applySettings = useCallback((next: WorkspaceOpenvikingSettings) => {
    setSettings(next);
    setEnabled(next.enabled);
    setUrl(next.url || '');
    setRootApiKey('');
    setKeyDirty(false);
    setAccount(next.account || '');
    setAccountDirty(false);
    setSavedAt(next.updatedAt || null);
  }, []);

  const refresh = useCallback(async () => {
    if (!canAdminWorkspace) {
      setLoaded(true);
      return;
    }
    setLoaded(false);
    setError(null);
    try {
      applySettings(await api.getOpenvikingSettings());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load OpenViking settings');
    } finally {
      setLoaded(true);
    }
  }, [applySettings, canAdminWorkspace]);

  useEffect(() => {
    refresh();
  }, [refresh, activeWorkspaceId]);

  const save = async () => {
    if (!canAdminWorkspace || busy) return;
    setBusy(true);
    setError(null);
    try {
      const next = await api.saveOpenvikingSettings({
        enabled,
        url: url.trim(),
        rootApiKey: keyDirty ? rootApiKey : undefined,
        // Only send `account` when the user actually touched it. That way
        // saving the panel without editing leaves the stored override alone.
        account: accountDirty ? account.trim() : undefined,
      });
      applySettings(next);
      setSavedAt(next.updatedAt || new Date().toISOString());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save OpenViking settings');
    } finally {
      setBusy(false);
    }
  };

  const clearKey = async () => {
    if (!canAdminWorkspace || busy) return;
    if (!window.confirm('Clear the stored root API key for this workspace? Provisioning will fall back to the server env key (if configured).')) return;
    setBusy(true);
    setError(null);
    try {
      const next = await api.saveOpenvikingSettings({
        enabled: false,
        url: url.trim(),
        clearRootApiKey: true,
        account: '',
      });
      applySettings(next);
      setSavedAt(next.updatedAt || new Date().toISOString());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to clear root key');
    } finally {
      setBusy(false);
    }
  };

  if (!canAdminWorkspace) {
    return (
      <div className="max-w-xl space-y-4">
        <div>
          <p className="text-sm font-bold text-nc-text-bright tracking-wider">OPENVIKING_PROVISIONING</p>
          <p className="text-xs text-nc-muted font-mono mt-0.5">Workspace admin access is required.</p>
        </div>
      </div>
    );
  }

  if (!loaded) {
    return <p className="text-xs font-mono text-nc-muted">Loading OpenViking settings...</p>;
  }

  const effective = settings?.effective || null;
  const env = settings?.env || null;
  const sourceLabel = effective
    ? effective.source === 'workspace'
      ? 'workspace override'
      : 'server env fallback'
    : 'none — provisioning disabled';
  const rootConfigured = !!settings?.rootConfigured;
  const accountFromKey = settings?.accountFromKey || null;
  // Live preview of which account would be used given the current form state.
  const effectiveAccountPreview = account.trim() || accountFromKey || '';

  return (
    <div className="max-w-2xl space-y-5">
      <div>
        <p className="text-sm font-bold text-nc-text-bright tracking-wider">OPENVIKING_PROVISIONING</p>
        <p className="text-xs text-nc-muted font-mono mt-0.5">
          Per-workspace override for the OV server that mints agent memory keys. Same kind of credential as the server env (<code>OPENVIKING_ROOT_KEY</code>) — the account is encoded in the key, so no separate account field is needed. Leave disabled to fall back to the server env.
        </p>
      </div>

      {error && (
        <div className="p-3 border border-nc-red/50 bg-nc-red/10 text-xs font-mono text-nc-red">
          {error}
        </div>
      )}

      <div className="cyber-panel-elevated p-3 text-2xs font-mono space-y-1">
        <p className="text-nc-muted">Effective: <span className="text-nc-text-bright">{effective ? `${effective.url} (account=${effective.account})` : '—'}</span></p>
        <p className="text-nc-muted">Source: <span className="text-nc-text-bright">{sourceLabel}</span></p>
        {env && (
          <p className="text-nc-muted">Server env: <span className="text-nc-text-bright">{env.url} (account={env.account})</span></p>
        )}
      </div>

      <label className="flex items-center justify-between gap-3 cyber-panel-elevated p-3 cursor-pointer">
        <span>
          <span className="block text-sm font-bold text-nc-text-bright">Enable workspace override</span>
          <span className="block text-xs font-mono text-nc-muted mt-0.5">When enabled, new agents in this workspace provision under the URL + root key below instead of the server env.</span>
        </span>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          className="w-5 h-5 accent-cyan-400"
        />
      </label>

      <div>
        <label className="block text-xs font-bold text-nc-muted mb-1.5 uppercase tracking-wider">OpenViking URL</label>
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://ov.example.com"
          className="cyber-input w-full px-3 py-2 text-xs font-mono"
          spellCheck={false}
        />
      </div>

      <div>
        <label className="block text-xs font-bold text-nc-muted mb-1.5 uppercase tracking-wider">Root API key</label>
        <input
          type="password"
          value={rootApiKey}
          onChange={(e) => { setRootApiKey(e.target.value); setKeyDirty(true); }}
          placeholder={rootConfigured ? '•••••••••• (configured — leave blank to keep)' : 'paste root key (new-format: account.user.secret)'}
          className="cyber-input w-full px-3 py-2 text-xs font-mono"
          spellCheck={false}
        />
        <p className="text-2xs font-mono text-nc-muted mt-1">
          Same shape as the server <code>OPENVIKING_ROOT_KEY</code> env. New-format keys (<code>account.user.secret</code>) carry the account in the key itself; legacy hex keys don&apos;t — for those, set <em>Account</em> below explicitly.
          {accountFromKey && (
            <span> Stored key&apos;s decoded account: <code>{accountFromKey}</code>.</span>
          )}
        </p>
      </div>

      <div>
        <label className="block text-xs font-bold text-nc-muted mb-1.5 uppercase tracking-wider">Account (optional override)</label>
        <input
          type="text"
          value={account}
          onChange={(e) => { setAccount(e.target.value); setAccountDirty(true); }}
          placeholder={accountFromKey ? `(blank — decode from key: ${accountFromKey})` : 'required for legacy hex keys, or to pin a multi-account root'}
          className="cyber-input w-full px-3 py-2 text-xs font-mono"
          spellCheck={false}
        />
        <p className="text-2xs font-mono text-nc-muted mt-1">
          Leave blank to use the account encoded in the root key. Set explicitly when (a) the root key grants access to multiple accounts, or (b) you&apos;re using a legacy hex key.
          {effectiveAccountPreview && (
            <span> Will provision under: <code>{effectiveAccountPreview}</code>.</span>
          )}
        </p>
      </div>

      <div className="cyber-panel-elevated p-3 text-2xs font-mono text-nc-muted space-y-1">
        <p>Memory namespace is derived from the agent <em>name</em>: <code>alice</code> → <code>zouk-alice</code>; <code>alice[1]</code> shares with <code>alice</code>.</p>
        <p>Existing provisioned agents keep their stored <code>user_id</code> — renaming or switching workspace URL does not migrate their OV memory; re-provision (clear + restart) if you want to move them.</p>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <ScanlineTear config={{ trigger: 'hover', minInterval: 200, maxInterval: 600, minSeverity: 0.3, maxSeverity: 0.8 }}>
          <button
            onClick={save}
            disabled={busy}
            className="cyber-btn px-4 py-2 bg-nc-cyan/10 border border-nc-cyan/50 text-nc-cyan font-bold text-sm tracking-wider disabled:opacity-40"
          >
            {busy ? 'Saving...' : 'Save'}
          </button>
        </ScanlineTear>
        {rootConfigured && (
          <ScanlineTear config={{ trigger: 'hover', minInterval: 200, maxInterval: 600, minSeverity: 0.3, maxSeverity: 0.8 }}>
            <button
              onClick={clearKey}
              disabled={busy}
              className="cyber-btn px-4 py-2 bg-nc-red/10 border border-nc-red/50 text-nc-red font-bold text-sm tracking-wider disabled:opacity-40"
            >
              Clear root key
            </button>
          </ScanlineTear>
        )}
        {savedAt && <span className="text-2xs font-mono text-nc-muted">Saved {new Date(savedAt).toLocaleTimeString()}</span>}
      </div>
    </div>
  );
}

function formatRelativeAgo(ts: number | null): string {
  if (!ts) return '—';
  const delta = Math.max(0, Date.now() - ts);
  if (delta < 1500) return 'just now';
  if (delta < 60_000) return `${Math.round(delta / 1000)}s ago`;
  if (delta < 3_600_000) return `${Math.round(delta / 60_000)}m ago`;
  if (delta < 86_400_000) return `${Math.round(delta / 3_600_000)}h ago`;
  return `${Math.round(delta / 86_400_000)}d ago`;
}

function formatRelativeIn(ts: number): string {
  const delta = Math.max(0, ts - Date.now());
  if (delta < 1500) return 'now';
  if (delta < 60_000) return `in ${Math.round(delta / 1000)}s`;
  if (delta < 3_600_000) return `in ${Math.round(delta / 60_000)}m`;
  if (delta < 86_400_000) return `in ${Math.round(delta / 3_600_000)}h`;
  return `in ${Math.round(delta / 86_400_000)}d`;
}

function clientStatus(client: WsClientStats, threshold: number): { label: string; tone: 'ok' | 'warn' | 'bad' } {
  if (client.blockedUntil > Date.now()) {
    if (client.manualBlock) return { label: 'REVOKED', tone: 'bad' };
    if (client.kind === 'invalid_token') return { label: 'BAD-TOKEN', tone: 'bad' };
    return { label: 'AUTO-BLOCKED', tone: 'bad' };
  }
  if (client.kind === 'invalid_token') return { label: 'BAD-TOKEN', tone: 'warn' };
  if (client.connectsLastMinute >= threshold) return { label: 'STORMING', tone: 'bad' };
  if (client.connectsLastMinute >= Math.max(3, Math.floor(threshold / 2))) return { label: 'CHATTY', tone: 'warn' };
  if (client.openCount > 0) return { label: 'CONNECTED', tone: 'ok' };
  return { label: 'IDLE', tone: 'ok' };
}

function ConnectionsSection() {
  const [data, setData] = useState<{ resp: import('../lib/api').WsClientsResponse | null; loaded: boolean }>({ resp: null, loaded: false });
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [tick, setTick] = useState(0); // forces re-render so "Xs ago" updates

  const refresh = useCallback(async () => {
    try {
      const resp = await api.getWsClients();
      setData({ resp, loaded: true });
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load WS clients');
      setData(prev => ({ ...prev, loaded: true }));
    }
  }, []);

  useEffect(() => {
    refresh();
    const poll = setInterval(refresh, 5000);
    const ticker = setInterval(() => setTick(t => t + 1), 1000);
    return () => { clearInterval(poll); clearInterval(ticker); };
  }, [refresh]);

  const revoke = useCallback(async (id: string, label: string) => {
    if (!window.confirm(`Revoke session for ${label}? This deletes their auth token and force-closes any open WS. They'll have to sign in again.`)) return;
    setBusyId(id);
    try {
      await api.revokeWsClient(id);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Revoke failed');
    } finally {
      setBusyId(null);
    }
  }, [refresh]);

  const unblock = useCallback(async (id: string) => {
    setBusyId(id);
    try {
      await api.unblockWsClient(id);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unblock failed');
    } finally {
      setBusyId(null);
    }
  }, [refresh]);

  const resp = data.resp;
  const clients = resp?.clients ?? [];
  const threshold = resp?.autoBlockThreshold ?? 12;
  const maxOpen = resp?.autoBlockMaxOpen ?? 3;
  void tick;

  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <p className="text-sm font-bold text-nc-text-bright tracking-wider">WS_CLIENTS</p>
        <p className="text-xs text-nc-muted font-mono mt-0.5">
          Per-token /ws connect rate. Churn threshold: {threshold} connects / {resp?.rateWindowSeconds ?? 60}s when {maxOpen} or fewer sockets stay open. Auto-block lasts {Math.round((resp?.blockDurationSeconds ?? 300) / 60)}m. Revoking deletes the auth session and force-closes open sockets.
        </p>
      </div>

      <div className="flex items-center justify-between">
        <span className="text-2xs font-mono text-nc-muted">
          {data.loaded ? `${clients.length} client${clients.length === 1 ? '' : 's'} tracked` : 'Loading…'}
        </span>
        <ScanlineTear config={{ trigger: 'hover', minInterval: 200, maxInterval: 600, minSeverity: 0.3, maxSeverity: 0.8 }}>
          <button
            onClick={refresh}
            className="cyber-btn px-3 py-1.5 text-xs font-mono text-nc-cyan border border-nc-cyan/40 hover:bg-nc-cyan/10 flex items-center gap-1.5"
          >
            <RefreshCw size={12} />
            Refresh
          </button>
        </ScanlineTear>
      </div>

      {error && (
        <div className="p-3 border border-nc-red/50 bg-nc-red/10 text-xs font-mono text-nc-red">
          {error}
        </div>
      )}

      {data.loaded && clients.length === 0 && !error && (
        <p className="text-xs font-mono text-nc-muted italic">No /ws clients tracked yet. Activity appears as soon as anyone connects.</p>
      )}

      <div className="space-y-1.5">
        {clients.map(client => {
          const status = clientStatus(client, threshold);
          const toneClass = status.tone === 'bad' ? 'text-nc-red' : status.tone === 'warn' ? 'text-nc-yellow' : 'text-nc-green';
          const isSelf = resp?.callerId === client.id;
          const isBlocked = client.blockedUntil > Date.now();
          const blockTimeLeft = isBlocked ? formatRelativeIn(client.blockedUntil) : null;
          const label = client.ownerName
            || client.ownerEmail
            || (client.kind === 'ip' ? `guest@${client.ip || '?'}`
              : client.kind === 'invalid_token' ? `bad-token@${client.ip || '?'}`
              : `(no session) ${client.id.slice(0, 8)}`);
          return (
            <div
              key={client.id}
              className={`cyber-panel-elevated p-3 ${isBlocked ? 'border-nc-red/40' : ''}`}
            >
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 shrink-0 border border-nc-border bg-nc-deep flex items-center justify-center overflow-hidden">
                  {client.ownerPicture ? (
                    <img src={client.ownerPicture} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-xs font-mono text-nc-muted">{(label.charAt(0) || '?').toUpperCase()}</span>
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-mono text-nc-text-bright truncate">{label}</span>
                    {isSelf && <span className="text-2xs font-mono text-nc-cyan border border-nc-cyan/50 px-1">YOU</span>}
                    <span className={`text-2xs font-mono font-bold ${toneClass} border border-current/50 px-1`}>{status.label}</span>
                    {client.kind === 'ip' && <span className="text-2xs font-mono text-nc-muted border border-nc-border px-1">IP</span>}
                    {client.kind === 'invalid_token' && <span className="text-2xs font-mono text-nc-red border border-nc-red/50 px-1">INVALID_TOKEN</span>}
                    {client.sessionExists === false && client.kind === 'token' && (
                      <span className="text-2xs font-mono text-nc-muted border border-nc-border px-1">SESSION_GONE</span>
                    )}
                  </div>
                  <p className="text-2xs font-mono text-nc-muted mt-0.5 truncate">
                    {client.ownerEmail || client.ip || '—'} · id {client.id.slice(0, 8)}
                  </p>
                  <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-1 text-2xs font-mono text-nc-muted">
                    <span>conn/min: <span className={toneClass}>{client.connectsLastMinute}</span></span>
                    <span>open: <span className="text-nc-text-bright">{client.openCount}</span></span>
                    <span>total: <span className="text-nc-text-bright">{client.totalConnects}</span></span>
                    <span>rejected: <span className="text-nc-text-bright">{client.totalRejections}</span></span>
                    <span>last conn: {formatRelativeAgo(client.lastConnectAt)}</span>
                    <span>last close: {formatRelativeAgo(client.lastDisconnectAt)}</span>
                    <span>first seen: {formatRelativeAgo(client.firstSeenAt)}</span>
                    {isBlocked && (
                      <span className="text-nc-red">expires: {blockTimeLeft}</span>
                    )}
                  </div>
                  {isBlocked && client.blockReason && (
                    <p className="text-2xs font-mono text-nc-red mt-1.5">↳ {client.blockReason}</p>
                  )}
                </div>

                <div className="flex flex-col gap-1.5 shrink-0">
                  {client.kind === 'token' && client.sessionExists !== false && (
                    <ScanlineTear config={{ trigger: 'hover', minInterval: 200, maxInterval: 600, minSeverity: 0.3, maxSeverity: 0.8 }}>
                      <button
                        onClick={() => revoke(client.id, label)}
                        disabled={busyId === client.id || isSelf}
                        title={isSelf ? "Can't revoke your own session" : 'Revoke this session'}
                        className="cyber-btn px-2.5 py-1 text-xs font-mono text-nc-red border border-nc-red/50 hover:bg-nc-red/10 disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-1"
                      >
                        <Ban size={12} />
                        Revoke
                      </button>
                    </ScanlineTear>
                  )}
                  {isBlocked && (
                    <button
                      onClick={() => unblock(client.id)}
                      disabled={busyId === client.id}
                      title="Lift the block (does NOT restore a deleted session)"
                      className="cyber-btn px-2.5 py-1 text-xs font-mono text-nc-muted border border-nc-border hover:text-nc-text-bright disabled:opacity-30"
                    >
                      Unblock
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function randomId(): string {
  return 'r-' + Math.random().toString(36).slice(2, 10);
}

function validatePattern(pattern: string): string | null {
  try {
    new RegExp(pattern);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : 'Invalid regex';
  }
}

function LinkTransformsSection() {
  const rules = useSyncExternalStore(subscribeLinkTransforms, getStoredLinkTransforms);
  const [drafts, setDrafts] = useState<Record<string, { pattern: string; replacement: string }>>({});
  const [newPattern, setNewPattern] = useState('');
  const [newReplacement, setNewReplacement] = useState('');
  const [testInput, setTestInput] = useState('https://github.com/ZaynJarvis/zouk/pull/142');

  const getDraft = (rule: LinkTransformRule) =>
    drafts[rule.id] ?? { pattern: rule.pattern, replacement: rule.replacement };

  const setDraft = (id: string, update: Partial<{ pattern: string; replacement: string }>) => {
    setDrafts(prev => {
      const current = prev[id] ?? { pattern: '', replacement: '' };
      return { ...prev, [id]: { ...current, ...update } };
    });
  };

  const saveDraft = (rule: LinkTransformRule) => {
    const draft = drafts[rule.id];
    if (!draft) return;
    if (validatePattern(draft.pattern)) return;
    const next = rules.map(r => (r.id === rule.id ? { ...r, pattern: draft.pattern, replacement: draft.replacement } : r));
    setStoredLinkTransforms(next);
    setDrafts(prev => {
      const next = { ...prev };
      delete next[rule.id];
      return next;
    });
  };

  const addRule = () => {
    if (!newPattern.trim()) return;
    if (validatePattern(newPattern)) return;
    const next = [...rules, { id: randomId(), pattern: newPattern, replacement: newReplacement }];
    setStoredLinkTransforms(next);
    setNewPattern('');
    setNewReplacement('');
  };

  const removeRule = (id: string) => {
    setStoredLinkTransforms(rules.filter(r => r.id !== id));
  };

  const previewFor = (rule: LinkTransformRule): string => {
    try {
      const re = new RegExp(rule.pattern);
      if (re.test(testInput)) return testInput.replace(re, rule.replacement);
    } catch { /* invalid — handled inline */ }
    return '—';
  };

  const newPatternError = newPattern ? validatePattern(newPattern) : null;

  return (
    <div className="max-w-xl space-y-5">
      <div>
        <p className="text-sm font-bold text-nc-text-bright tracking-wider">LINK_TRANSFORMS</p>
        <p className="text-xs text-nc-muted font-mono mt-0.5">
          Rewrite pasted URLs into short anchors. First matching rule wins. Pattern is a JS regex; replacement uses <code className="px-1 bg-nc-elevated">$1</code> etc. for capture groups.
        </p>
      </div>

      <div>
        <label className="block text-xs font-bold text-nc-muted mb-1.5 uppercase tracking-wider">Preview against</label>
        <input
          value={testInput}
          onChange={e => setTestInput(e.target.value)}
          placeholder="https://example.com/..."
          className="cyber-input w-full px-3 py-2 text-xs font-mono"
        />
      </div>

      {rules.length === 0 ? (
        <p className="text-xs font-mono text-nc-muted italic">No rules. Add one below.</p>
      ) : (
        <div className="space-y-2">
          {rules.map(rule => {
            const draft = getDraft(rule);
            const dirty = draft.pattern !== rule.pattern || draft.replacement !== rule.replacement;
            const patternError = validatePattern(draft.pattern);
            return (
              <div key={rule.id} className="cyber-panel-elevated p-3 space-y-2">
                <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                  <input
                    value={draft.pattern}
                    onChange={e => setDraft(rule.id, { pattern: e.target.value })}
                    placeholder="^https://github\.com/.*/pull/(\d+).*$"
                    className="cyber-input flex-1 min-w-0 px-2 py-1.5 text-xs font-mono"
                  />
                  <div className="flex items-center gap-2">
                    <span className="text-nc-muted text-xs font-mono">→</span>
                    <input
                      value={draft.replacement}
                      onChange={e => setDraft(rule.id, { replacement: e.target.value })}
                      placeholder="#$1"
                      className="cyber-input flex-1 sm:w-28 sm:flex-none min-w-0 px-2 py-1.5 text-xs font-mono"
                    />
                    <button
                      onClick={() => saveDraft(rule)}
                      disabled={!dirty || !!patternError}
                      className="cyber-btn px-2.5 py-1.5 bg-nc-cyan/10 border border-nc-cyan/50 text-nc-cyan text-2xs font-bold tracking-wider disabled:opacity-40 flex-shrink-0"
                    >
                      SAVE
                    </button>
                    <button
                      onClick={() => removeRule(rule.id)}
                      className="p-1.5 text-nc-muted hover:text-nc-red flex-shrink-0"
                      title="Remove rule"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
                <div className="flex items-center gap-2 text-2xs font-mono text-nc-muted">
                  <span>PREVIEW:</span>
                  <span className="text-nc-cyan truncate">{previewFor(rule)}</span>
                </div>
                {patternError && (
                  <p className="text-2xs font-mono text-nc-red">Invalid regex: {patternError}</p>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="pt-4 border-t border-nc-border">
        <label className="block text-xs font-bold text-nc-muted mb-1.5 uppercase tracking-wider">Add rule</label>
        <div className="flex flex-col sm:flex-row sm:items-center gap-2">
          <input
            value={newPattern}
            onChange={e => setNewPattern(e.target.value)}
            placeholder="Pattern (JS regex)"
            className="cyber-input flex-1 min-w-0 px-2 py-1.5 text-xs font-mono"
          />
          <div className="flex items-center gap-2">
            <span className="text-nc-muted text-xs font-mono">→</span>
            <input
              value={newReplacement}
              onChange={e => setNewReplacement(e.target.value)}
              placeholder="Replacement"
              className="cyber-input flex-1 sm:w-28 sm:flex-none min-w-0 px-2 py-1.5 text-xs font-mono"
            />
            <ScanlineTear config={{ trigger: 'hover', minInterval: 200, maxInterval: 600, minSeverity: 0.3, maxSeverity: 0.8 }}>
              <button
                onClick={addRule}
                disabled={!newPattern.trim() || !!newPatternError}
                className="cyber-btn px-3 py-1.5 bg-nc-cyan/10 border border-nc-cyan/50 text-nc-cyan text-2xs font-bold tracking-wider disabled:opacity-40 flex-shrink-0"
              >
                ADD
              </button>
            </ScanlineTear>
          </div>
        </div>
        {newPatternError && (
          <p className="text-2xs font-mono text-nc-red mt-1.5">Invalid regex: {newPatternError}</p>
        )}
      </div>
    </div>
  );
}
