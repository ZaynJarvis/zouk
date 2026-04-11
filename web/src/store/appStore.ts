import { useState, useCallback, useEffect, useRef } from 'react';
import type {
  MessageRecord, ServerChannel, ServerAgent, ServerHuman,
  AgentConfig, ServerMachine, ViewMode, RightPanel, Theme, Toast,
} from '../types';
import { SlockWebSocket } from '../lib/ws';
import type { WsEvent } from '../lib/ws';
import * as api from '../lib/api';
import { normalizeMessage } from '../lib/api';

const CURRENT_USER_KEY = 'zouk_current_user';

function getStoredUser(): string {
  const stored = localStorage.getItem(CURRENT_USER_KEY);
  if (stored) return stored;
  const name = 'user-' + Math.random().toString(36).slice(2, 6);
  localStorage.setItem(CURRENT_USER_KEY, name);
  return name;
}

export function useAppStore() {
  const [theme, setTheme] = useState<Theme>(() => {
    const stored = localStorage.getItem('zouk_theme');
    return (stored === 'dark' ? 'dark' : 'light') as Theme;
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
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [messages, setMessages] = useState<MessageRecord[]>([]);
  const [threadMessages, setThreadMessages] = useState<MessageRecord[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [wsConnected, setWsConnected] = useState(false);
  const [daemonConnected, setDaemonConnected] = useState(false);
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [threadedMessageIds, setThreadedMessageIds] = useState<Set<string>>(new Set());

  const wsRef = useRef<SlockWebSocket | null>(null);
  const activeChannelRef = useRef(activeChannelName);
  activeChannelRef.current = activeChannelName;
  const viewModeRef = useRef(viewMode);
  viewModeRef.current = viewMode;

  const serverUrl = import.meta.env.VITE_SLOCK_SERVER_URL || '';

  useEffect(() => {
    localStorage.setItem('zouk_theme', theme);
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
          // For DM messages, the channel_name is the DM peer name
          // For channel messages, it's the channel name
          const isDmMessage = msg.channel_type === 'dm';
          const conversationKey = msg.channel_name;

          // Only add to current view if it matches the active conversation
          const isActiveConversation = conversationKey === activeChannelRef.current
            && ((isDmMessage && viewModeRef.current === 'dm')
                || (!isDmMessage && viewModeRef.current !== 'dm'));

          if (isActiveConversation) {
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
        const e = event as { agentId: string; status: 'active' | 'inactive' };
        setAgents(prev => prev.map(a =>
          a.id === e.agentId ? { ...a, status: e.status } : a
        ));
        break;
      }
      case 'agent_activity': {
        const e = event as { agentId: string; activity: string; detail?: string; entries?: unknown[] };
        setAgents(prev => prev.map(a =>
          a.id === e.agentId
            ? { ...a, activity: e.activity as ServerAgent['activity'], activityDetail: e.detail, entries: e.entries as ServerAgent['entries'] }
            : a
        ));
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
            copy[idx] = e.agent;
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
      case 'machine:disconnected': {
        const e = event as { machineId: string };
        setMachines(prev => prev.filter(m => m.id !== e.machineId));
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
    setLoadingMessages(true);
    const isDm = viewModeRef.current === 'dm';
    api.fetchMessages(activeChannelName, isDm).then(msgs => {
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
      if (!cancelled) setLoadingMessages(false);
    });
    return () => { cancelled = true; };
  }, [activeChannelName, viewMode]);

  const selectChannel = useCallback((name: string, isDm = false) => {
    setActiveChannelName(name);
    setViewMode(isDm ? 'dm' : 'channel');
    setThreadMessages([]);
    setActiveThreadMessage(null);
    if (rightPanel === 'thread') setRightPanel(null);
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
    api.fetchThreadMessages(message.channel_name, message.id, isDm).then(msgs => {
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
    name: string; displayName?: string; description?: string;
    runtime: string; model?: string; channels?: string[];
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

  const updateAgentConfigAction = useCallback(async (agentId: string, updates: Partial<import('../types').AgentConfig>) => {
    try {
      await api.updateAgentConfig(agentId, updates);
      addToast('Agent config updated', 'info');
    } catch {
      addToast('Failed to update agent config', 'error');
    }
  }, [addToast]);

  const updateCurrentUser = useCallback((name: string) => {
    localStorage.setItem(CURRENT_USER_KEY, name);
    setCurrentUser(name);
  }, []);

  const wsSend = useCallback((data: Record<string, unknown>) => {
    wsRef.current?.send(data);
  }, []);

  return {
    theme, setTheme,
    currentUser, updateCurrentUser,
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
    wsSend,
  };
}

export type AppStore = ReturnType<typeof useAppStore>;
