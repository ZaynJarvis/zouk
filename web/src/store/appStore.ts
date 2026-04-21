import { useState, useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import type {
  MessageRecord, ServerChannel, ServerAgent, ServerHuman,
  AgentConfig, ServerMachine, ViewMode, RightPanel, Theme, Toast,
  WorkspaceFile, MemoryEntry, AgentProfilePreset,
} from '../types';
import { SlockWebSocket } from '../lib/ws';
import type { WsEvent } from '../lib/ws';
import * as api from '../lib/api';
import { normalizeMessage } from '../lib/api';
import type { AuthUser } from '../lib/api';
import { isMobileViewport } from '../lib/layout';
import {
  clearStoredAuth,
  clearStoredAuthUser,
  clearStoredCurrentUser,
  clearStoredLastView,
  createGuestUserName,
  getStoredAuth,
  getStoredAuthToken,
  getStoredCurrentUser,
  getStoredLastView,
  getStoredTheme,
  setStoredAuth,
  setStoredAuthUser,
  setStoredAuthToken,
  setStoredCurrentUser,
  setStoredLastView,
  setStoredTheme,
} from './storage';
import { applyTheme } from '../themes';

function isKnownChannel(channels: ServerChannel[], name: string) {
  return channels.some(channel => channel.name === name);
}

function isKnownDmTarget(
  agents: ServerAgent[],
  humans: ServerHuman[],
  currentUser: string,
  name: string,
) {
  if (!name) return false;
  if (name === currentUser) return true;
  return agents.some(agent => agent.name === name) || humans.some(human => human.name === name);
}

function resolveDefaultChannelName(channels: ServerChannel[]) {
  if (isKnownChannel(channels, 'all')) return 'all';
  return channels[0]?.name || 'all';
}

function getValidStoredLastView(
  channels: ServerChannel[],
  agents: ServerAgent[],
  humans: ServerHuman[],
  currentUser: string,
) {
  const stored = getStoredLastView();
  if (!stored) return null;
  if (stored.mode === 'channel' && isKnownChannel(channels, stored.name)) return stored;
  if (stored.mode === 'dm' && isKnownDmTarget(agents, humans, currentUser, stored.name)) return stored;
  return null;
}

function isValidSelection(
  mode: ViewMode,
  name: string,
  channels: ServerChannel[],
  agents: ServerAgent[],
  humans: ServerHuman[],
  currentUser: string,
) {
  if (mode === 'agents') return false;
  if (mode === 'channel') return isKnownChannel(channels, name);
  if (mode === 'dm') return isKnownDmTarget(agents, humans, currentUser, name);
  return false;
}

export function useAppStore() {
  const [theme, setTheme] = useState<Theme>(getStoredTheme);
  const [currentUser, setCurrentUser] = useState(getStoredCurrentUser);
  const [channels, setChannels] = useState<ServerChannel[]>([]);
  const [agents, setAgents] = useState<ServerAgent[]>([]);
  const [humans, setHumans] = useState<ServerHuman[]>([]);
  const [configs, setConfigs] = useState<AgentConfig[]>([]);
  const [machines, setMachines] = useState<ServerMachine[]>([]);
  const [activeChannelName, setActiveChannelName] = useState<string>('all');
  const [viewMode, setViewMode] = useState<ViewMode>('channel');
  const [rightPanel, setRightPanel] = useState<RightPanel>(null);
  const [agentDetailTab, setAgentDetailTab] = useState<'instructions' | 'workspace' | 'activity' | 'settings'>('instructions');
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [agentSettingsId, setAgentSettingsId] = useState<string | null>(null);
  const [agentProfileId, setAgentProfileId] = useState<string | null>(null);
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
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [loadingOlderMessages, setLoadingOlderMessages] = useState(false);
  const [threadedMessageIds, setThreadedMessageIds] = useState<Set<string>>(new Set());
  // Workspace file trees per agent: agentId -> { dirPath, files }
  const [workspaceFiles, setWorkspaceFiles] = useState<Record<string, { dirPath: string; files: WorkspaceFile[] }>>({});
  // Tree cache: agentId -> dirPath -> files (for recursive tree rendering)
  const [wsTreeCache, setWsTreeCache] = useState<Record<string, Record<string, WorkspaceFile[]>>>({});
  const [workspaceFileContent, setWorkspaceFileContent] = useState<{ agentId: string; path: string; content: string } | null>(null);
  // Memory trees per agent: agentId -> uri -> entries (for recursive tree rendering)
  const [memoryTreeCache, setMemoryTreeCache] = useState<Record<string, Record<string, MemoryEntry[]>>>({});
  const [memoryFileContent, setMemoryFileContent] = useState<{ agentId: string; uri: string; content: string } | null>(null);
  const [profilePresets, setProfilePresets] = useState<AgentProfilePreset[]>([]);
  const [authUser, setAuthUser] = useState<AuthUser | null>(() => getStoredAuth()?.user || null);
  const [authToken, setAuthToken] = useState<string | null>(() => getStoredAuth()?.token || null);
  const [isLoggedIn, setIsLoggedIn] = useState(() => !!getStoredAuth());
  const [hasGoogleAuth, setHasGoogleAuth] = useState(false);
  const [allowlistActive, setAllowlistActive] = useState(false);

  const wsRef = useRef<SlockWebSocket | null>(null);
  const activeChannelRef = useRef(activeChannelName);
  activeChannelRef.current = activeChannelName;
  const viewModeRef = useRef(viewMode);
  viewModeRef.current = viewMode;
  const currentUserRef = useRef(currentUser);
  currentUserRef.current = currentUser;
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const agentsRef = useRef(agents);
  agentsRef.current = agents;
  const channelsRef = useRef(channels);
  channelsRef.current = channels;
  const humansRef = useRef(humans);
  humansRef.current = humans;
  const activeThreadMessageRef = useRef(activeThreadMessage);
  activeThreadMessageRef.current = activeThreadMessage;
  const hasResolvedInitialViewRef = useRef(false);
  const channelListReady = channels.length > 0;

  const serverUrl = import.meta.env.VITE_SLOCK_SERVER_URL || '';

  useLayoutEffect(() => {
    setStoredTheme(theme);
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
        const e = event as { channels: ServerChannel[]; agents: ServerAgent[]; humans: ServerHuman[]; configs: AgentConfig[]; machines: ServerMachine[]; profilePresets?: AgentProfilePreset[] };
        const nextChannels = e.channels || [];
        const nextAgents = e.agents || [];
        const nextHumans = e.humans || [];
        setChannels(nextChannels);
        setAgents(nextAgents);
        setHumans(nextHumans);
        setConfigs(e.configs || []);
        setMachines(e.machines || []);
        setProfilePresets(e.profilePresets || []);
        if (!hasResolvedInitialViewRef.current) {
          hasResolvedInitialViewRef.current = true;
          const stored = getValidStoredLastView(nextChannels, nextAgents, nextHumans, currentUserRef.current);
          if (stored) {
            setViewMode(stored.mode);
            setActiveChannelName(stored.name);
          } else {
            setViewMode('channel');
            setActiveChannelName(resolveDefaultChannelName(nextChannels));
          }
          break;
        }

        if (viewModeRef.current === 'channel') {
          if (!isKnownChannel(nextChannels, activeChannelRef.current)) {
            setActiveChannelName(resolveDefaultChannelName(nextChannels));
          }
          break;
        }

        if (viewModeRef.current === 'dm' && !isKnownDmTarget(nextAgents, nextHumans, currentUserRef.current, activeChannelRef.current)) {
          setViewMode('channel');
          setActiveChannelName(resolveDefaultChannelName(nextChannels));
        }
        break;
      }
      case 'message':
      case 'new_message': {
        const e = event as { message: MessageRecord };
        if (!e.message) break;
        const msg = normalizeMessage(e.message);

        if (msg.channel_type === 'thread') {
          const parentId = msg.parent_message_id;
          const threadShortId = msg.channel_name;
          const parentChannel = msg.parent_channel_name;

          // Only append to the right-side ThreadPanel's list when the open thread matches.
          const open = activeThreadMessageRef.current;
          const threadIsOpen = !!open && (
            (parentId && open.id === parentId)
            || open.id.slice(0, 8) === threadShortId
          );
          if (threadIsOpen) {
            setThreadMessages(prev => [...prev, msg]);
          }

          // Append the reply onto its parent's inline preview so the channel list
          // reflects the new activity without needing the side panel open. Cap the
          // preview window at 3 entries to stay compact.
          setMessages(prev => prev.map(m => {
            const matches = parentId ? m.id === parentId : m.id.slice(0, 8) === threadShortId;
            if (!matches) return m;
            const nextReplies = [...(m.replies ?? []), msg].slice(-3);
            return { ...m, replies: nextReplies, reply_count: (m.reply_count ?? 0) + 1 };
          }));

          // Keep a set of shortIds so components can render a "has thread" badge
          // even for historical messages we already had in state.
          setThreadedMessageIds(prev => {
            if (prev.has(threadShortId)) return prev;
            const next = new Set(prev);
            next.add(threadShortId);
            return next;
          });

          // If the parent channel isn't currently focused, bump the unread badge
          // on its sidebar entry so the user notices thread activity elsewhere.
          if (parentChannel && parentChannel !== activeChannelRef.current) {
            setUnreadCounts(prev => ({
              ...prev,
              [parentChannel]: (prev[parentChannel] || 0) + 1,
            }));
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
          setSelectedAgentId(prev => (prev === e.agentId ? null : prev));
        } else {
          setAgents(prev => prev.map(a =>
            a.id === e.agentId ? { ...a, status: e.status as 'active' | 'inactive' } : a
          ));
        }
        break;
      }
      case 'agent_activity': {
        const e = event as { agentId: string; activity: string; detail?: string; entries?: unknown[]; contextUsage?: ServerAgent['contextUsage'] };
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
            contextUsage: e.contextUsage ?? a.contextUsage,
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
      case 'channel_deleted': {
        const e = event as unknown as { channelId: string; channelName: string };
        setChannels(prev => {
          const next = prev.filter(c => c.id !== e.channelId);
          if (viewModeRef.current === 'channel' && activeChannelRef.current === e.channelName) {
            const fallback = resolveDefaultChannelName(next);
            setActiveChannelName(fallback);
            setMessages([]);
            setThreadMessages([]);
            setActiveThreadMessage(null);
            setRightPanel(prevPanel => (prevPanel === 'thread' ? null : prevPanel));
          }
          return next;
        });
        setUnreadCounts(prev => {
          const next = { ...prev };
          delete next[e.channelName];
          return next;
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
      case 'humans_updated': {
        const e = event as { humans: ServerHuman[] };
        setHumans(e.humans || []);
        break;
      }
      case 'agent_profile_presets_updated': {
        const e = event as { presets: AgentProfilePreset[] };
        setProfilePresets(e.presets || []);
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
        const e = event as { agentId: string; dirPath: string; workDir?: string; files: WorkspaceFile[] };
        setWorkspaceFiles(prev => ({ ...prev, [e.agentId]: { dirPath: e.dirPath, files: e.files } }));
        setWsTreeCache(prev => ({
          ...prev,
          [e.agentId]: { ...(prev[e.agentId] || {}), [e.dirPath || '']: e.files },
        }));
        if (e.workDir) {
          setAgents(prev => prev.map(a => (
            a.id === e.agentId && a.workDir !== e.workDir
              ? { ...a, workDir: e.workDir }
              : a
          )));
          setConfigs(prev => prev.map(c => (
            c.id === e.agentId && c.workDir !== e.workDir
              ? { ...c, workDir: e.workDir }
              : c
          )));
        }
        break;
      }
      case 'workspace:file_content': {
        const e = event as { agentId: string; requestId: string; content: string };
        setWorkspaceFileContent({ agentId: e.agentId, path: e.requestId, content: e.content });
        break;
      }
      case 'memory:list_result': {
        const e = event as { agentId: string; uri: string; entries: MemoryEntry[] };
        setMemoryTreeCache(prev => ({
          ...prev,
          [e.agentId]: { ...(prev[e.agentId] || {}), [e.uri || 'viking:///']: e.entries },
        }));
        break;
      }
      case 'memory:content': {
        const e = event as { agentId: string; requestId: string; uri: string; content: string };
        setMemoryFileContent({ agentId: e.agentId, uri: e.uri || e.requestId, content: e.content });
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
    if (!wsConnected) return;
    if (!isLoggedIn) {
      wsRef.current?.send({ type: 'presence:clear' });
      return;
    }
    wsRef.current?.send({
      type: 'presence:update',
      token: authToken,
      name: currentUser,
      picture: authUser?.picture,
      gravatarUrl: authUser?.gravatarUrl,
    });
  }, [wsConnected, isLoggedIn, authToken, authUser, currentUser]);

  // Register guest users on the server so presence lists see them.
  // Authenticated users are pushed into store.humans by /api/auth/google; guests
  // need a separate hook since requireAuth blocks them from other writes.
  useEffect(() => {
    if (!wsConnected) return;
    if (!isLoggedIn) return;
    if (authToken) return;
    api.registerGuestSession(currentUser).catch(() => {});
  }, [wsConnected, isLoggedIn, authToken, currentUser]);

  useEffect(() => {
    // Keep the active conversation valid for the current mode. A reconnect
    // replays `init`, so channel-only validation would incorrectly coerce DMs
    // to the first public channel ("all"), which then gets fetched as `dm:@all`.
    if (viewMode === 'channel') {
      if (channels.length > 0 && !isKnownChannel(channels, activeChannelName)) {
        setActiveChannelName(resolveDefaultChannelName(channels));
      }
      return;
    }

    if (viewMode !== 'dm') return;
    if (isKnownDmTarget(agents, humans, currentUser, activeChannelName)) return;
    if (channels.length === 0) return;

    setViewMode('channel');
    setActiveChannelName(resolveDefaultChannelName(channels));
  }, [activeChannelName, agents, channels, currentUser, humans, viewMode]);

  useEffect(() => {
    if (viewMode === 'channel') {
      if (!isKnownChannel(channels, activeChannelName)) return;
      setStoredLastView({ mode: 'channel', name: activeChannelName });
      return;
    }

    if (viewMode !== 'dm') return;
    if (!isKnownDmTarget(agents, humans, currentUser, activeChannelName)) return;
    setStoredLastView({ mode: 'dm', name: activeChannelName });
  }, [activeChannelName, agents, channels, currentUser, humans, viewMode]);

  useEffect(() => {
    if (!isValidSelection(
      viewMode,
      activeChannelName,
      channelsRef.current,
      agentsRef.current,
      humansRef.current,
      currentUserRef.current,
    )) return;

    let cancelled = false;
    // Clear immediately so that if the fetch fails (e.g. an intermediate proxy
    // returns a cached 304 for a different URL), the previous channel's
    // messages don't linger while the new title is already shown.
    setMessages([]);
    setHasMoreMessages(false);
    setLoadingMessages(true);
    const isDm = viewModeRef.current === 'dm';
    api.fetchMessages(activeChannelName, isDm, 50, isDm ? currentUserRef.current : undefined).then(res => {
      if (!cancelled) {
        setMessages(res.messages);
        setHasMoreMessages(res.hasMore);
        setLoadingMessages(false);
        setUnreadCounts(prev => {
          const copy = { ...prev };
          delete copy[activeChannelName];
          return copy;
        });
        // Seed threadedMessageIds from any replies already attached to the
        // fetched messages — lets the "has thread" badge survive page reloads
        // and channel switches.
        setThreadedMessageIds(prev => {
          const next = new Set(prev);
          for (const m of res.messages) {
            if (m.replies && m.replies.length > 0) next.add(m.id.slice(0, 8));
          }
          return next;
        });
      }
    }).catch(() => {
      if (!cancelled) {
        setMessages([]);
        setHasMoreMessages(false);
        setLoadingMessages(false);
      }
    });
    return () => { cancelled = true; };
  }, [activeChannelName, viewMode, channelListReady]);

  const loadOlderMessages = useCallback(async () => {
    if (loadingOlderMessages) return;
    if (!hasMoreMessages) return;
    const oldest = messagesRef.current[0];
    if (!oldest) return;
    setLoadingOlderMessages(true);
    try {
      const isDm = viewModeRef.current === 'dm';
      const sender = isDm ? currentUserRef.current : undefined;
      const res = await api.fetchMessages(activeChannelRef.current, isDm, 50, sender, oldest.id);
      setMessages(prev => {
        const known = new Set(prev.map(m => m.id));
        const fresh = res.messages.filter(m => !known.has(m.id));
        return [...fresh, ...prev];
      });
      setHasMoreMessages(res.hasMore);
    } catch {
      // surface nothing — user can scroll again to retry
    } finally {
      setLoadingOlderMessages(false);
    }
  }, [loadingOlderMessages, hasMoreMessages]);

  const closeSidebarOnMobile = useCallback(() => {
    if (isMobileViewport()) setSidebarOpen(false);
  }, []);

  const selectChannel = useCallback((name: string, isDm = false) => {
    setActiveChannelName(name);
    setViewMode(isDm ? 'dm' : 'channel');
    setThreadMessages([]);
    setActiveThreadMessage(null);
    if (rightPanel === 'thread') setRightPanel(null);
    closeSidebarOnMobile();
  }, [closeSidebarOnMobile, rightPanel]);

  const sendMessageAction = useCallback(async (
    content: string,
    threadTarget?: string,
    attachmentIds?: string[],
  ): Promise<boolean> => {
    const isDm = viewModeRef.current === 'dm';
    const target = threadTarget || (isDm ? `dm:@${activeChannelRef.current}` : `#${activeChannelRef.current}`);
    try {
      await api.sendMessage(content, target, currentUser, attachmentIds);
      return true;
    } catch {
      addToast('Failed to send message', 'error');
      return false;
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
    setAgentSettingsId(null);
    setAgentProfileId(null);
  }, []);

  const openAgentProfile = useCallback((agentId: string) => {
    setAgentProfileId(agentId);
    setRightPanel('agent_profile');
    closeSidebarOnMobile();
  }, [closeSidebarOnMobile]);

  const openAgentSettings = useCallback((agentId: string) => {
    setAgentSettingsId(agentId);
    setRightPanel('agent_settings');
    closeSidebarOnMobile();
  }, [closeSidebarOnMobile]);

  const createChannelAction = useCallback(async (name: string) => {
    try {
      await api.createChannel(name);
      addToast(`Channel #${name} created`, 'success');
    } catch {
      addToast('Failed to create channel', 'error');
    }
  }, [addToast]);

  const deleteChannelAction = useCallback(async (channelId: string, channelName: string) => {
    try {
      await api.deleteChannel(channelId);
      addToast(`Channel #${channelName} deleted`, 'info');
    } catch {
      addToast('Failed to delete channel', 'error');
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

  const resetAgentContextAction = useCallback(async (agentId: string) => {
    try {
      await api.resetAgentContext(agentId);
      addToast('Context reset', 'info');
    } catch {
      addToast('Failed to reset context', 'error');
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

  const addProfilePresetAction = useCallback(async (image: string, opts?: { silent?: boolean }) => {
    try {
      const { preset } = await api.createProfilePreset(image);
      setProfilePresets(prev => (prev.find(p => p.id === preset.id) ? prev : [...prev, preset]));
      if (!opts?.silent) addToast('Avatar preset added', 'success');
      return { ok: true as const };
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to add preset';
      if (!opts?.silent) addToast(msg, 'error');
      return { ok: false as const, error: msg };
    }
  }, [addToast]);

  const removeProfilePresetAction = useCallback(async (id: string) => {
    try {
      await api.deleteProfilePreset(id);
      setProfilePresets(prev => prev.filter(p => p.id !== id));
    } catch {
      addToast('Failed to remove preset', 'error');
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

  const loadAgentActivitiesAction = useCallback(async (agentId: string) => {
    // Snapshot the live-entries count BEFORE the fetch. The server persists
    // each entry before broadcasting the corresponding WS frame (save-then-
    // broadcast, per-agent queue), so every live entry received up to this
    // point is also visible to the fetch query on the server. After the fetch
    // returns, any live entries at index >= baseLen arrived during the fetch
    // window and must be appended to the fetched history.
    const baseLen = agentsRef.current.find(a => a.id === agentId)?.entries?.length || 0;
    try {
      const fetched = await api.fetchAgentActivities(agentId, 100);
      if (fetched.length === 0) return;
      setAgents(prev => prev.map(a => {
        if (a.id !== agentId) return a;
        const live = a.entries || [];
        const liveAfterBase = live.slice(baseLen);
        return { ...a, entries: [...fetched, ...liveAfterBase] };
      }));
    } catch {
      // Silent — Activity tab simply stays empty.
    }
  }, []);

  const updateCurrentUser = useCallback((name: string, picture?: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;

    const previousUser = currentUserRef.current;
    const previousAuthUser = authUser;

    setStoredCurrentUser(trimmed);
    setCurrentUser(trimmed);

    const token = getStoredAuthToken();
    if (!token) return;

    const optimisticUser = previousAuthUser
      ? {
          ...previousAuthUser,
          name: trimmed,
          picture: picture !== undefined ? picture : previousAuthUser.picture,
        }
      : null;

    if (optimisticUser) {
      setStoredAuthUser(optimisticUser);
      setAuthUser(optimisticUser);
    }

    api.updateUserProfile(trimmed, picture).then(({ user }) => {
      setStoredAuthUser(user);
      setStoredCurrentUser(user.name);
      setAuthUser(user);
      setCurrentUser(user.name);
    }).catch(() => {
      setStoredCurrentUser(previousUser);
      setCurrentUser(previousUser);
      if (previousAuthUser) {
        setStoredAuthUser(previousAuthUser);
        setAuthUser(previousAuthUser);
      } else {
        clearStoredAuthUser();
        setAuthUser(null);
      }
      addToast('Failed to update profile', 'error');
    });
  }, [authUser, addToast]);

  const loginWithGoogle = useCallback(async (credential: string) => {
    const { token, user } = await api.googleLogin(credential);
    // Server already uses email prefix as name; use it as display name
    setStoredAuth(token, user);
    setStoredCurrentUser(user.name);
    setAuthToken(token);
    setAuthUser(user);
    setIsLoggedIn(true);
    setCurrentUser(user.name);
  }, []);

  const loginAsGuest = useCallback(() => {
    // Clear any existing auth and use the random name
    clearStoredAuth();
    setAuthToken(null);
    setAuthUser(null);
    setIsLoggedIn(true);
    // currentUser already has a random name from getStoredCurrentUser()
    // In open/dev mode the server mints a real session token so guests can
    // post messages (requireAuth won't block them).  Store it if returned.
    api.registerGuestSession(currentUserRef.current).then(({ token, user }) => {
      if (token) {
        setStoredAuthToken(token);
        setAuthToken(token);
        if (user) {
          setStoredAuthUser(user);
          setAuthUser(user);
        }
      }
    }).catch(() => {});
  }, []);

  const logoutAction = useCallback(async () => {
    if (authToken) {
      await api.logout(authToken).catch(() => {});
    }
    clearStoredAuth();
    clearStoredCurrentUser();
    clearStoredLastView();
    hasResolvedInitialViewRef.current = false;
    setAuthToken(null);
    setAuthUser(null);
    setIsLoggedIn(false);
    setViewMode('channel');
    setActiveChannelName('all');
    setMessages([]);
    setThreadMessages([]);
    setActiveThreadMessage(null);
    setRightPanel(null);
    // Generate new random name for next guest session
    const name = createGuestUserName();
    setStoredCurrentUser(name);
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

  const requestMemoryList = useCallback((agentId: string, uri?: string) => {
    wsRef.current?.send({ type: 'memory:list', agentId, uri: uri || 'viking:///' });
  }, []);

  const requestMemoryContent = useCallback((agentId: string, uri: string) => {
    wsRef.current?.send({ type: 'memory:read', agentId, requestId: uri, uri });
  }, []);

  return {
    theme, setTheme,
    currentUser, updateCurrentUser, updateProfile: updateCurrentUser,
    channels, agents, humans, configs, machines,
    activeChannelName, selectChannel,
    viewMode, setViewMode,
    rightPanel, setRightPanel,
    agentDetailTab, setAgentDetailTab,
    selectedAgentId, setSelectedAgentId,
    agentSettingsId, setAgentSettingsId,
    agentProfileId, setAgentProfileId, openAgentProfile, openAgentSettings,
    activeThreadMessage, openThread, closeRightPanel,
    settingsOpen, setSettingsOpen,
    sidebarOpen, setSidebarOpen,
    messages, threadMessages, threadedMessageIds,
    toasts, addToast,
    wsConnected, daemonConnected,
    unreadCounts,
    loadingMessages,
    hasMoreMessages,
    loadingOlderMessages,
    loadOlderMessages,
    sendMessage: sendMessageAction,
    createChannel: createChannelAction,
    deleteChannel: deleteChannelAction,
    startAgent: startAgentAction,
    stopAgent: stopAgentAction,
    resetAgentContext: resetAgentContextAction,
    deleteAgent: deleteAgentAction,
    updateAgentConfig: updateAgentConfigAction,
    saveAgentConfig: saveAgentConfigAction,
    loadAgentActivities: loadAgentActivitiesAction,
    wsSend,
    workspaceFiles, wsTreeCache, workspaceFileContent,
    requestWorkspaceFiles, requestFileContent,
    memoryTreeCache, memoryFileContent,
    requestMemoryList, requestMemoryContent,
    profilePresets,
    addProfilePreset: addProfilePresetAction,
    removeProfilePreset: removeProfilePresetAction,
    authUser, isLoggedIn, hasGoogleAuth, setHasGoogleAuth,
    allowlistActive, setAllowlistActive,
    isGuest: isLoggedIn && !authUser,
    loginWithGoogle, loginAsGuest, logout: logoutAction,
  };
}

export type AppStore = ReturnType<typeof useAppStore>;
