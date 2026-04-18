import { useState, useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import type {
  MessageRecord, ServerChannel, ServerAgent, ServerHuman,
  AgentConfig, ServerMachine, ViewMode, RightPanel, Theme, Toast,
  WorkspaceFile,
} from '../types';
import { SlockWebSocket } from '../lib/ws';
import type { WsEvent } from '../lib/ws';
import * as api from '../lib/api';
import { normalizeMessage } from '../lib/api';
import type { AuthUser } from '../lib/api';
import { applyTheme } from '../themes';

const CURRENT_USER_KEY = 'zouk_current_user';
const AUTH_TOKEN_KEY = 'zouk_auth_token';
const AUTH_USER_KEY = 'zouk_auth_user';

function getStoredUser(): string {
  // If we have a Google-authenticated user, use their name
  const authUser = localStorage.getItem(AUTH_USER_KEY);
  if (authUser) {
    try {
      const parsed = JSON.parse(authUser);
      if (parsed.name) return parsed.name;
    } catch { /* ignore */ }
  }
  const stored = localStorage.getItem(CURRENT_USER_KEY);
  if (stored) return stored;
  const name = 'user-' + Math.random().toString(36).slice(2, 6);
  localStorage.setItem(CURRENT_USER_KEY, name);
  return name;
}

function getStoredAuth(): { token: string; user: AuthUser } | null {
  const token = localStorage.getItem(AUTH_TOKEN_KEY);
  const userStr = localStorage.getItem(AUTH_USER_KEY);
  if (token && userStr) {
    try {
      return { token, user: JSON.parse(userStr) };
    } catch { /* ignore */ }
  }
  return null;
}

export function useAppStore() {
  const [theme, setTheme] = useState<Theme>(() => {
    const stored = localStorage.getItem('zouk_theme');
    if (stored === 'night-city' || stored === 'brutalist' || stored === 'washington-post' || stored === 'carbon') return stored;
    return 'night-city';
  });
  const [currentUser, setCurrentUser] = useState(getStoredUser);
  const [channels, setChannels] = useState<ServerChannel[]>([]);
  const [agents, setAgents] = useState<ServerAgent[]>([]);
  const [humans, setHumans] = useState<ServerHuman[]>([]);
  const [configs, setConfigs] = useState<AgentConfig[]>([]);
  const [machines, setMachines] = useState<ServerMachine[]>([]);
  const [activeChannelName, setActiveChannelName] = useState<string>('general');
  const [viewMode, setViewMode] = useState<ViewMode>('channel');
  const [rightPanel, setRightPanel] = useState<RightPanel>(null);
  const [activeThreadMessage, setActiveThreadMessage] = useState<MessageRecord | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth >= 1024);
  const [messages, setMessages] = useState<MessageRecord[]>([]);
  const [threadMessages, setThreadMessages] = useState<MessageRecord[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [wsConnected, setWsConnected] = useState(false);
  const [daemonConnected, setDaemonConnected] = useState(false);
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [threadedMessageIds, setThreadedMessageIds] = useState<Set<string>>(new Set());
  // Workspace file trees per agent: agentId -> { dirPath, files }
  const [workspaceFiles, setWorkspaceFiles] = useState<Record<string, { dirPath: string; files: WorkspaceFile[] }>>({});
  // Tree cache: agentId -> dirPath -> files (for recursive tree rendering)
  const [wsTreeCache, setWsTreeCache] = useState<Record<string, Record<string, WorkspaceFile[]>>>({});
  const [workspaceFileContent, setWorkspaceFileContent] = useState<{ agentId: string; path: string; content: string } | null>(null);
  const [authUser, setAuthUser] = useState<AuthUser | null>(() => getStoredAuth()?.user || null);
  const [authToken, setAuthToken] = useState<string | null>(() => getStoredAuth()?.token || null);
  const [isLoggedIn, setIsLoggedIn] = useState(() => !!getStoredAuth());
  const [hasGoogleAuth, setHasGoogleAuth] = useState(false);

  const wsRef = useRef<SlockWebSocket | null>(null);
  const activeChannelRef = useRef(activeChannelName);
  activeChannelRef.current = activeChannelName;
  const viewModeRef = useRef(viewMode);
  viewModeRef.current = viewMode;
  const currentUserRef = useRef(currentUser);
  currentUserRef.current = currentUser;

  const serverUrl = import.meta.env.VITE_SLOCK_SERVER_URL || '';

  useLayoutEffect(() => {
    localStorage.setItem('zouk_theme', theme);
    applyTheme(theme);
  }, [theme]);

  const addToast = useCallback((message: string, type: Toast['type'] = 'info') => {
    const id = `toast-${Date.now()}`;
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 4000);
  }, []);

  const handleWsEvent = useCallback((event: WsEvent) => {
    switch (event.type) {
      case 'ws:connected' as string:
        setWsConnected(true);
        break;
      case 'ws:disconnected' as string:
        setWsConnected(false);
        break;
      case 'init': {
        const e = event as { channels: ServerChannel[]; agents: ServerAgent[]; humans: ServerHuman[]; configs: AgentConfig[]; machines: ServerMachine[] };
        setChannels(e.channels || []);
        setAgents(e.agents || []);
        setHumans(e.humans || []);
        setConfigs(e.configs || []);
        setMachines(e.machines || []);
        if (e.channels?.length && !e.channels.find(c => c.name === activeChannelRef.current)) {
          setActiveChannelName(e.channels[0].name);
        }
        break;
      }
      case 'message':
      case 'new_message': {
        const e = event as { message: MessageRecord };
        if (!e.message) break;
        const msg = normalizeMessage(e.message);

        if (msg.channel_type === 'thread') {
          setThreadMessages(prev => [...prev, msg]);
          // Track which parent messages have threads
          if (msg.parent_channel_name) {
            setThreadedMessageIds(prev => {
              const next = new Set(prev);
              // The parent message ID can be derived from channel_name for thread messages
              // Thread channel_name format includes the parent msg short ID
              next.add(msg.channel_name);
              return next;
            });
          }
        } else {
          const isDmMessage = msg.channel_type === 'dm';
          // For DMs, resolve peer name from dm_parties or canonical channel name
          let conversationKey = msg.channel_name;
          if (isDmMessage) {
            if (msg.dm_parties && msg.dm_parties.length === 2) {
              // Pick the party that isn't the current user
              const currentName = currentUserRef.current;
              conversationKey = msg.dm_parties.find(p => p !== currentName) || msg.dm_parties[0];
            } else if (msg.channel_name.startsWith('dm:')) {
              // Canonical name like "dm:alice,zeus" — resolve peer
              const parties = msg.channel_name.substring(3).split(',');
              const currentName = currentUserRef.current;
              conversationKey = parties.find(p => p !== currentName) || parties[0];
            }
          }

          const isActiveConversation = conversationKey === activeChannelRef.current
            && ((isDmMessage && viewModeRef.current === 'dm')
                || (!isDmMessage && viewModeRef.current !== 'dm'));

          if (isActiveConversation) {
            // Update channel_name to peer name for consistent frontend display
            if (isDmMessage) msg.channel_name = conversationKey;
            setMessages(prev => [...prev, msg]);
          } else {
            setUnreadCounts(prev => ({
              ...prev,
              [conversationKey]: (prev[conversationKey] || 0) + 1,
            }));
          }
        }
        break;
      }
      case 'agent_status': {
        const e = event as { agentId: string; status: string };
        if (e.status === 'deleted') {
          setAgents(prev => prev.filter(a => a.id !== e.agentId));
        } else {
          setAgents(prev => prev.map(a =>
            a.id === e.agentId ? { ...a, status: e.status as 'active' | 'inactive' } : a
          ));
        }
        break;
      }
      case 'agent_activity': {
        const e = event as { agentId: string; activity: string; detail?: string; entries?: unknown[] };
        // Daemon sends deltas — each message carries only the new trajectory
        // entries for this activity change (heartbeats omit `entries`). Append
        // to the running log instead of replacing so the Activity tab keeps
        // history. Cap length to avoid unbounded growth.
        const incoming = (e.entries as ServerAgent['entries'] | undefined) || [];
        setAgents(prev => prev.map(a => {
          if (a.id !== e.agentId) return a;
          const nextEntries = incoming.length > 0
            ? [...(a.entries || []), ...incoming].slice(-500)
            : a.entries;
          return {
            ...a,
            activity: e.activity as ServerAgent['activity'],
            activityDetail: e.detail,
            entries: nextEntries,
          };
        }));
        break;
      }
      case 'daemon_connected':
        setDaemonConnected(true);
        break;
      case 'daemon_disconnected':
        setDaemonConnected(false);
        break;
      case 'channel_created': {
        const e = event as { channel: ServerChannel };
        setChannels(prev => {
          if (prev.find(c => c.id === e.channel.id)) return prev;
          return [...prev, e.channel];
        });
        break;
      }
      case 'agent_started': {
        const e = event as { agent: ServerAgent };
        setAgents(prev => {
          const idx = prev.findIndex(a => a.id === e.agent.id);
          if (idx >= 0) {
            const copy = [...prev];
            // `agent_started` is also fired on reconnect/restore — the payload
            // doesn't carry trajectory entries, so preserve any activity log
            // we've already accumulated locally.
            const preservedEntries = e.agent.entries ?? copy[idx].entries;
            copy[idx] = { ...e.agent, entries: preservedEntries };
            return copy;
          }
          return [...prev, e.agent];
        });
        break;
      }
      case 'config_updated': {
        const e = event as { configs: AgentConfig[] };
        setConfigs(e.configs || []);
        break;
      }
      case 'machine:connected': {
        const e = event as { machine: ServerMachine };
        setMachines(prev => {
          if (prev.find(m => m.id === e.machine.id)) return prev;
          return [...prev, e.machine];
        });
        break;
      }
      case 'machine:updated': {
        const e = event as { machine: ServerMachine };
        setMachines(prev => prev.map(m => m.id === e.machine.id ? e.machine : m));
        break;
      }
      case 'machine:disconnected': {
        const e = event as { machineId: string };
        setMachines(prev => prev.filter(m => m.id !== e.machineId));
        break;
      }
      case 'workspace:file_tree': {
        const e = event as { agentId: string; dirPath: string; files: WorkspaceFile[] };
        setWorkspaceFiles(prev => ({ ...prev, [e.agentId]: { dirPath: e.dirPath, files: e.files } }));
        setWsTreeCache(prev => ({
          ...prev,
          [e.agentId]: { ...(prev[e.agentId] || {}), [e.dirPath || '']: e.files },
        }));
        break;
      }
      case 'workspace:file_content': {
        const e = event as { agentId: string; requestId: string; content: string };
        setWorkspaceFileContent({ agentId: e.agentId, path: e.requestId, content: e.content });
        break;
      }
    }
  }, []);

  useEffect(() => {
    const ws = new SlockWebSocket(serverUrl);
    wsRef.current = ws;
    const unsub = ws.on(handleWsEvent);
    ws.connect();
    return () => {
      unsub();
      ws.disconnect();
    };
  }, [serverUrl, handleWsEvent]);

  useEffect(() => {
    let cancelled = false;
    // Clear immediately so that if the fetch fails (e.g. an intermediate proxy
    // returns a cached 304 for a different URL), the previous channel's
    // messages don't linger while the new title is already shown.
    setMessages([]);
    setLoadingMessages(true);
    const isDm = viewModeRef.current === 'dm';
    api.fetchMessages(activeChannelName, isDm, 200, isDm ? currentUserRef.current : undefined).then(msgs => {
      if (!cancelled) {
        setMessages(msgs);
        setLoadingMessages(false);
        setUnreadCounts(prev => {
          const copy = { ...prev };
          delete copy[activeChannelName];
          return copy;
        });
      }
    }).catch(() => {
      if (!cancelled) {
        setMessages([]);
        setLoadingMessages(false);
      }
    });
    return () => { cancelled = true; };
  }, [activeChannelName, viewMode]);

  const selectChannel = useCallback((name: string, isDm = false) => {
    setActiveChannelName(name);
    setViewMode(isDm ? 'dm' : 'channel');
    setThreadMessages([]);
    setActiveThreadMessage(null);
    if (rightPanel === 'thread') setRightPanel(null);
    // Auto-close sidebar on mobile
    if (window.innerWidth < 1024) setSidebarOpen(false);
  }, [rightPanel]);

  const sendMessageAction = useCallback(async (content: string, threadTarget?: string) => {
    const isDm = viewModeRef.current === 'dm';
    const target = threadTarget || (isDm ? `dm:@${activeChannelRef.current}` : `#${activeChannelRef.current}`);
    try {
      await api.sendMessage(content, target, currentUser);
    } catch {
      addToast('Failed to send message', 'error');
    }
  }, [currentUser, addToast]);

  const openThread = useCallback((message: MessageRecord) => {
    setActiveThreadMessage(message);
    setRightPanel('thread');
    setThreadMessages([]);
    // Fetch existing thread replies
    const isDm = message.channel_type === 'dm';
    const sender = isDm ? currentUserRef.current : undefined;
    api.fetchThreadMessages(message.channel_name, message.id, isDm, 200, sender).then(msgs => {
      setThreadMessages(msgs);
    }).catch(() => {
      // Thread may have no history yet, that's fine
    });
  }, []);

  const closeRightPanel = useCallback(() => {
    setRightPanel(null);
    setActiveThreadMessage(null);
    setThreadMessages([]);
  }, []);

  const createChannelAction = useCallback(async (name: string) => {
    try {
      await api.createChannel(name);
      addToast(`Channel #${name} created`, 'success');
    } catch {
      addToast('Failed to create channel', 'error');
    }
  }, [addToast]);

  const startAgentAction = useCallback(async (config: {
    id?: string; name: string; displayName?: string; description?: string;
    runtime: string; model?: string; machineId?: string; channels?: string[];
  }) => {
    try {
      await api.startAgent(config);
      addToast(`Agent ${config.name} starting...`, 'info');
    } catch {
      addToast('Failed to start agent', 'error');
    }
  }, [addToast]);

  const stopAgentAction = useCallback(async (agentId: string) => {
    try {
      await api.stopAgent(agentId);
      addToast('Agent stopping...', 'info');
    } catch {
      addToast('Failed to stop agent', 'error');
    }
  }, [addToast]);

  const deleteAgentAction = useCallback(async (agentId: string) => {
    try {
      await api.deleteAgent(agentId);
      addToast('Agent deleted', 'info');
    } catch {
      addToast('Failed to delete agent', 'error');
    }
  }, [addToast]);

  const saveAgentConfigAction = useCallback(async (config: AgentConfig) => {
    try {
      await api.saveAgentConfig(config);
      addToast(`Agent config "${config.displayName || config.name}" saved`, 'success');
    } catch {
      addToast('Failed to save agent config', 'error');
    }
  }, [addToast]);

  const updateAgentConfigAction = useCallback(async (agentId: string, updates: Partial<ServerAgent>) => {
    try {
      await api.updateAgentConfig(agentId, updates);
      addToast('Agent config updated', 'info');
    } catch {
      addToast('Failed to update agent config', 'error');
    }
  }, [addToast]);

  const updateCurrentUser = useCallback((name: string, picture?: string) => {
    localStorage.setItem(CURRENT_USER_KEY, name);
    setCurrentUser(name);
    // Persist to server if logged in
    const token = localStorage.getItem(AUTH_TOKEN_KEY);
    if (token) {
      api.updateUserProfile(name, picture).then(({ user }) => {
        localStorage.setItem(AUTH_USER_KEY, JSON.stringify(user));
        setAuthUser(user);
      }).catch(() => {});
    }
  }, []);

  const loginWithGoogle = useCallback(async (credential: string) => {
    const { token, user } = await api.googleLogin(credential);
    // Server already uses email prefix as name; use it as display name
    localStorage.setItem(AUTH_TOKEN_KEY, token);
    localStorage.setItem(AUTH_USER_KEY, JSON.stringify(user));
    localStorage.setItem(CURRENT_USER_KEY, user.name);
    setAuthToken(token);
    setAuthUser(user);
    setIsLoggedIn(true);
    setCurrentUser(user.name);
  }, []);

  const loginAsGuest = useCallback(() => {
    // Clear any existing auth and use the random name
    localStorage.removeItem(AUTH_TOKEN_KEY);
    localStorage.removeItem(AUTH_USER_KEY);
    setAuthToken(null);
    setAuthUser(null);
    setIsLoggedIn(true);
    // currentUser already has a random name from getStoredUser()
  }, []);

  const logoutAction = useCallback(async () => {
    if (authToken) {
      await api.logout(authToken).catch(() => {});
    }
    localStorage.removeItem(AUTH_TOKEN_KEY);
    localStorage.removeItem(AUTH_USER_KEY);
    localStorage.removeItem(CURRENT_USER_KEY);
    setAuthToken(null);
    setAuthUser(null);
    setIsLoggedIn(false);
    // Generate new random name for next guest session
    const name = 'user-' + Math.random().toString(36).slice(2, 6);
    localStorage.setItem(CURRENT_USER_KEY, name);
    setCurrentUser(name);
  }, [authToken]);

  const wsSend = useCallback((data: Record<string, unknown>) => {
    wsRef.current?.send(data);
  }, []);

  const requestWorkspaceFiles = useCallback((agentId: string, dirPath?: string) => {
    wsRef.current?.send({ type: 'workspace:list', agentId, dirPath: dirPath || null });
  }, []);

  const requestFileContent = useCallback((agentId: string, filePath: string) => {
    wsRef.current?.send({ type: 'workspace:read', agentId, requestId: filePath, path: filePath });
  }, []);

  return {
    theme, setTheme,
    currentUser, updateCurrentUser, updateProfile: updateCurrentUser,
    channels, agents, humans, configs, machines,
    activeChannelName, selectChannel,
    viewMode, setViewMode,
    rightPanel, setRightPanel,
    activeThreadMessage, openThread, closeRightPanel,
    settingsOpen, setSettingsOpen,
    sidebarOpen, setSidebarOpen,
    messages, threadMessages, threadedMessageIds,
    toasts, addToast,
    wsConnected, daemonConnected,
    unreadCounts,
    loadingMessages,
    sendMessage: sendMessageAction,
    createChannel: createChannelAction,
    startAgent: startAgentAction,
    stopAgent: stopAgentAction,
    deleteAgent: deleteAgentAction,
    updateAgentConfig: updateAgentConfigAction,
    saveAgentConfig: saveAgentConfigAction,
    wsSend,
    workspaceFiles, wsTreeCache, workspaceFileContent,
    requestWorkspaceFiles, requestFileContent,
    authUser, isLoggedIn, hasGoogleAuth, setHasGoogleAuth,
    isGuest: isLoggedIn && !authUser,
    loginWithGoogle, loginAsGuest, logout: logoutAction,
  };
}

export type AppStore = ReturnType<typeof useAppStore>;
