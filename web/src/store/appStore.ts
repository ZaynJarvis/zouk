import { useState, useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import type {
  MessageRecord, ServerChannel, ServerAgent, ServerHuman,
  AgentConfig, ServerMachine, ViewMode, RightPanel, Theme, ColorMode, Toast,
  WorkspaceFile, MemoryEntry, AgentProfilePreset, AgentAvailableSkill,
  Workspace, WorkspaceMember, WorkspaceRole,
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
  getStoredColorMode,
  getStoredNowRailHidden,
  getStoredActiveWorkspaceId,
  setStoredAuth,
  setStoredAuthUser,
  setStoredAuthToken,
  setStoredCurrentUser,
  setStoredLastView,
  setStoredTheme,
  setStoredColorMode,
  setStoredNowRailHidden,
  setStoredActiveWorkspaceId,
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

/**
 * Resolve the channel key an agent message should be attributed to for the
 * sidebar / LIVE rail. Mirrors the conversation key the rest of the store
 * uses: plain channel name for channels, peer name (from currentUser's POV)
 * for DMs. Thread replies bubble up to their parent channel so an agent that
 * is mid-thread still shows up on the channel they're working in.
 */
function resolveAgentMessageChannel(msg: MessageRecord, currentUser: string): string | null {
  if (!msg.sender_name) return null;
  const isThread = msg.channel_type === 'thread';
  const parentType = isThread ? (msg.parent_channel_type || 'channel') : msg.channel_type;
  const parentName = isThread ? (msg.parent_channel_name || '') : msg.channel_name;
  if (!parentName) return null;
  if (parentType === 'dm') {
    if (msg.dm_parties && msg.dm_parties.length >= 2) {
      return msg.dm_parties.find(p => p !== currentUser) || msg.dm_parties[0];
    }
    if (parentName.startsWith('dm:')) {
      const parties = parentName.substring(3).split(',');
      return parties.find(p => p !== currentUser) || parties[0];
    }
    return parentName;
  }
  return parentName;
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
  const [colorMode, setColorMode] = useState<ColorMode>(getStoredColorMode);
  const [nowRailHidden, setNowRailHiddenState] = useState<boolean>(getStoredNowRailHidden);
  const setNowRailHidden = useCallback((hidden: boolean) => {
    setNowRailHiddenState(hidden);
    setStoredNowRailHidden(hidden);
  }, []);
  const [currentUser, setCurrentUser] = useState(getStoredCurrentUser);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([
    { id: 'default', name: 'Default', icon: 'z' },
  ]);
  const [activeWorkspaceId, setActiveWorkspaceIdState] = useState<string>(getStoredActiveWorkspaceId);
  // Members of the current workspace + caller's role + superuser flag. Driven
  // by WS init and `workspace:members` broadcasts; mutations go through API
  // helpers which trigger a server-side broadcast.
  const [workspaceMembers, setWorkspaceMembers] = useState<WorkspaceMember[]>([]);
  const [viewerRole, setViewerRole] = useState<WorkspaceRole | null>(null);
  const [isSuperuser, setIsSuperuser] = useState<boolean>(false);
  const [channels, setChannels] = useState<ServerChannel[]>([]);
  const [agents, setAgents] = useState<ServerAgent[]>([]);
  const [humans, setHumans] = useState<ServerHuman[]>([]);
  const [configs, setConfigs] = useState<AgentConfig[]>([]);
  const [machines, setMachines] = useState<ServerMachine[]>([]);
  const [activeChannelName, setActiveChannelName] = useState<string>('all');
  const [viewMode, setViewMode] = useState<ViewMode>('channel');
  const [rightPanel, setRightPanel] = useState<RightPanel>(null);
  const [agentDetailTab, setAgentDetailTab] = useState<'settings' | 'skills' | 'workspace' | 'activity'>('settings');
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [agentSettingsId, setAgentSettingsId] = useState<string | null>(null);
  const [agentProfileId, setAgentProfileId] = useState<string | null>(null);
  const [agentProfileTab, setAgentProfileTab] = useState<'profile' | 'workspace' | 'config'>('profile');
  const [channelSettingsId, setChannelSettingsId] = useState<string | null>(null);
  const [activeThreadMessage, setActiveThreadMessage] = useState<MessageRecord | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);
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
  // agentName -> { channel, ts } of the most recent conversation we've observed
  // the agent participating in. Used to scope the live status dot in the
  // channel sidebar + LIVE rail to the channel where the agent is actually
  // working, instead of every channel they have membership in. Channel value
  // is the same key the sidebar selects with: plain channel name for channels,
  // peer name (current-user perspective) for DMs.
  const [agentLastChannel, setAgentLastChannel] = useState<Record<string, { channel: string; ts: string }>>({});
  // Workspace file trees per agent: agentId -> { dirPath, files }
  const [workspaceFiles, setWorkspaceFiles] = useState<Record<string, { dirPath: string; files: WorkspaceFile[] }>>({});
  // Tree cache: agentId -> dirPath -> files (for recursive tree rendering)
  const [wsTreeCache, setWsTreeCache] = useState<Record<string, Record<string, WorkspaceFile[]>>>({});
  const [workspaceFileContent, setWorkspaceFileContent] = useState<{ agentId: string; path: string; content: string } | null>(null);
  // Memory trees per agent: agentId -> uri -> entries (for recursive tree rendering)
  const [memoryTreeCache, setMemoryTreeCache] = useState<Record<string, Record<string, MemoryEntry[]>>>({});
  // Per-(agentId, uri, level) content cache. L0=abstract, L1=overview, L2=full read.
  // For legacy single-level (no `level` requested) reads, content is stashed under
  // `__legacy__` so callers that don't care about levels still see it.
  const [memoryContentCache, setMemoryContentCache] = useState<Record<string, Record<string, Partial<Record<'l0' | 'l1' | 'l2' | '__legacy__', string | null>>>>>({});
  // Skill discovery per agent: agentId -> { global, workspace } as surfaced by
  // the daemon's listSkills. Separate cache (not mixed into ServerAgent) because
  // it is lazy-loaded per detail-tab open, not pushed with agent state.
  const [skillsCache, setSkillsCache] = useState<Record<string, { global: AgentAvailableSkill[]; workspace: AgentAvailableSkill[] }>>({});
  const [profilePresets, setProfilePresets] = useState<AgentProfilePreset[]>([]);
  const [authUser, setAuthUser] = useState<AuthUser | null>(() => getStoredAuth()?.user || null);
  const [authToken, setAuthToken] = useState<string | null>(() => getStoredAuth()?.token || null);
  const [isLoggedIn, setIsLoggedIn] = useState(() => !!getStoredAuth());
  const [hasGoogleAuth, setHasGoogleAuth] = useState(false);
  const [allowlistActive, setAllowlistActive] = useState(false);
  const [supabaseConfig, setSupabaseConfig] = useState<{ url: string; anonKey: string } | null>(null);
  const [ovRuntimeWhitelist, setOvRuntimeWhitelist] = useState<string[]>(['claude']);
  // Bumps whenever we see a task-bearing system message arrive. TasksView
  // watches this as a "something changed, refetch" signal so the kanban stays
  // live without dedicated polling.
  const [tasksVersion, setTasksVersion] = useState(0);

  const wsRef = useRef<SlockWebSocket | null>(null);
  const activeWorkspaceRef = useRef(activeWorkspaceId);
  activeWorkspaceRef.current = activeWorkspaceId;
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
  const hasConnectedOnceRef = useRef(false);
  const channelListReady = channels.length > 0;

  const serverUrl = import.meta.env.VITE_SLOCK_SERVER_URL || '';

  const recordAgentLastChannel = useCallback((msg: MessageRecord) => {
    if (msg.sender_type !== 'agent' || !msg.sender_name) return;
    const channelKey = resolveAgentMessageChannel(msg, currentUserRef.current);
    if (!channelKey) return;
    const ts = msg.timestamp || '';
    setAgentLastChannel(prev => {
      const existing = prev[msg.sender_name!];
      if (existing && existing.ts && ts && existing.ts >= ts) return prev;
      return { ...prev, [msg.sender_name!]: { channel: channelKey, ts } };
    });
  }, []);

  useLayoutEffect(() => {
    setStoredTheme(theme);
    setStoredColorMode(colorMode);
    applyTheme(theme, colorMode);
  }, [theme, colorMode]);

  const addToast = useCallback((message: string, type: Toast['type'] = 'info') => {
    const id = `toast-${Date.now()}`;
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 4000);
  }, []);

  const handleWsEvent = useCallback((event: WsEvent) => {
    switch (event.type) {
      case 'ws:connected' as string: {
        setWsConnected(true);
        const isReconnect = hasConnectedOnceRef.current;
        hasConnectedOnceRef.current = true;
        if (isReconnect) {
          // Gap-fill: fetch any messages that arrived while the WS was down.
          // Use the last visible message as the cursor; merge results in without
          // wiping the existing list so scroll position is preserved.
          const lastMsg = messagesRef.current[messagesRef.current.length - 1];
          if (lastMsg) {
            const isDm = viewModeRef.current === 'dm';
            const sender = isDm ? currentUserRef.current : undefined;
            const workspaceId = activeWorkspaceRef.current;
            api.fetchMessages(activeChannelRef.current, isDm, 200, sender, undefined, lastMsg.id)
              .then(res => {
                if (activeWorkspaceRef.current !== workspaceId) return;
                if (res.messages.length === 0) return;
                setMessages(prev => {
                  const known = new Set(prev.map(m => m.id));
                  const fresh = res.messages.filter(m => !known.has(m.id));
                  return fresh.length > 0 ? [...prev, ...fresh] : prev;
                });
              })
              .catch(() => { /* silent — WS stream will cover new messages going forward */ });
          }

          // Thread gap-fill: if a thread panel is open, re-fetch its replies so
          // any messages that arrived while WS was down are not silently missing.
          const openThread = activeThreadMessageRef.current;
          if (openThread) {
            const isThreadDm = openThread.channel_type === 'dm';
            const threadSender = isThreadDm ? currentUserRef.current : undefined;
            const workspaceId = activeWorkspaceRef.current;
            api.fetchThreadMessages(openThread.channel_name, openThread.id, isThreadDm, 200, threadSender)
              .then(msgs => {
                if (activeWorkspaceRef.current !== workspaceId) return;
                setThreadMessages(prev => {
                  const known = new Set(prev.map(m => m.id));
                  const fresh = msgs.filter(m => !known.has(m.id));
                  return fresh.length > 0 ? [...prev, ...fresh] : prev;
                });
              })
              .catch(() => {});
          }
        }
        break;
      }
      case 'ws:disconnected' as string:
        setWsConnected(false);
        break;
      case 'init': {
        const e = event as { workspaceId?: string; workspaces?: Workspace[]; workspaceMembers?: WorkspaceMember[]; viewerRole?: WorkspaceRole | null; isSuperuser?: boolean; channels: ServerChannel[]; agents: ServerAgent[]; humans: ServerHuman[]; configs: AgentConfig[]; machines: ServerMachine[] };
        const nextChannels = e.channels || [];
        const nextAgents = e.agents || [];
        const nextHumans = e.humans || [];
        if (e.workspaces && e.workspaces.length > 0) setWorkspaces(e.workspaces);
        setWorkspaceMembers(e.workspaceMembers || []);
        setViewerRole(e.viewerRole ?? null);
        setIsSuperuser(!!e.isSuperuser);
        const workspaceChanged = !!(e.workspaceId && e.workspaceId !== activeWorkspaceId);
        if (workspaceChanged && e.workspaceId) {
          activeWorkspaceRef.current = e.workspaceId;
          setActiveWorkspaceIdState(e.workspaceId);
          setStoredActiveWorkspaceId(e.workspaceId);
          setMessages([]);
          setThreadMessages([]);
          setUnreadCounts({});
          setAgentLastChannel({});
          setWorkspaceFiles({});
          setWsTreeCache({});
          setWorkspaceFileContent(null);
          setMemoryTreeCache({});
          setMemoryContentCache({});
          setSkillsCache({});
        }
        setChannels(nextChannels);
        // `init` replays on every WS reconnect. The server payload doesn't carry
        // trajectory entries (those live in DB, not in the runtime store), so
        // preserve any activity log already accumulated locally — otherwise the
        // Activity tab silently goes empty after an idle reconnect.
        setAgents(prev => {
          if (prev.length === 0) return nextAgents;
          const prevById = new Map(prev.map(a => [a.id, a]));
          return nextAgents.map(a => {
            const existing = prevById.get(a.id);
            if (!existing) return a;
            return {
              ...a,
              entries: a.entries ?? existing.entries,
            };
          });
        });
        setHumans(nextHumans);
        setConfigs(e.configs || []);
        setMachines(e.machines || []);
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
      case 'workspace_updated': {
        const e = event as { workspace?: Workspace };
        if (e.workspace?.id) {
          setWorkspaces(prev => prev.map(w => (w.id === e.workspace!.id ? e.workspace! : w)));
        }
        break;
      }
      case 'message':
      case 'new_message': {
        const e = event as { message: MessageRecord };
        if (!e.message) break;
        const msg = normalizeMessage(e.message);
        const currentName = currentUserRef.current;
        const isSelfMessage = !!currentName && msg.sender_name === currentName;

        // Defense-in-depth for stray DM broadcasts: if the server ever lets a
        // DM through to a non-party (legacy payload, future multi-tab edge
        // case), drop it so we don't bump unread for a conversation we aren't
        // part of.
        const dmContext = msg.channel_type === 'dm'
          || (msg.channel_type === 'thread' && msg.parent_channel_type === 'dm');
        if (dmContext && msg.dm_parties && msg.dm_parties.length > 0
            && currentName && !msg.dm_parties.includes(currentName)) {
          break;
        }

        if (msg.task_number) {
          setTasksVersion(v => v + 1);
        }

        recordAgentLastChannel(msg);

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
          // Skip for self-replies — a user's own thread reply isn't a notification.
          if (parentChannel && parentChannel !== activeChannelRef.current && !isSelfMessage) {
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
          } else if (!isSelfMessage) {
            // Don't bump unread for our own echo — sending from another channel
            // or another tab shouldn't light up the destination we sent to.
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
        // Server omits base64 `picture` from this broadcast to keep the WS
        // frame small. Preserve any picture we already had for known humans;
        // unknown humans will show initials until they reload (their `init`
        // payload carries pictures).
        setHumans(prev => {
          const prevByName = new Map(prev.map(h => [h.name, h]));
          return (e.humans || []).map(h => {
            if (h.picture) return h;
            const existing = prevByName.get(h.name);
            return existing?.picture ? { ...h, picture: existing.picture } : h;
          });
        });
        break;
      }
      case 'workspace:members': {
        const e = event as { workspaceId?: string; members?: WorkspaceMember[] };
        // Ignore broadcasts for workspaces we aren't viewing — the server scopes
        // these per workspace, but a stale event from a workspace switch could
        // race in just before init re-fires.
        if (e.workspaceId && e.workspaceId !== activeWorkspaceRef.current) break;
        setWorkspaceMembers(e.members || []);
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
          [e.agentId]: { ...(prev[e.agentId] || {}), [e.uri || 'viking://']: e.entries },
        }));
        break;
      }
      case 'memory:content': {
        const e = event as { agentId: string; requestId: string; uri: string; level: 'l0' | 'l1' | 'l2' | null; content: string | null };
        const uri = e.uri || e.requestId;
        const slot = e.level || '__legacy__';
        setMemoryContentCache(prev => {
          const agentBucket = { ...(prev[e.agentId] || {}) };
          agentBucket[uri] = { ...(agentBucket[uri] || {}), [slot]: e.content };
          return { ...prev, [e.agentId]: agentBucket };
        });
        break;
      }
      case 'skills:list_result': {
        const e = event as { agentId: string; global?: AgentAvailableSkill[]; workspace?: AgentAvailableSkill[] };
        setSkillsCache(prev => ({
          ...prev,
          [e.agentId]: { global: e.global || [], workspace: e.workspace || [] },
        }));
        break;
      }
    }
  }, [activeWorkspaceId, recordAgentLastChannel]);

  const setActiveWorkspaceId = useCallback((workspaceId: string) => {
    const next = workspaceId || 'default';
    if (next === activeWorkspaceId) return;
    setStoredActiveWorkspaceId(next);
    activeWorkspaceRef.current = next;
    setActiveWorkspaceIdState(next);
    hasResolvedInitialViewRef.current = false;
    setChannels([]);
    setAgents([]);
    setConfigs([]);
    setMachines([]);
    setProfilePresets([]);
    setWorkspaceMembers([]);
    setViewerRole(null);
    setMessages([]);
    setThreadMessages([]);
    setUnreadCounts({});
    setAgentLastChannel({});
    setWorkspaceFiles({});
    setWsTreeCache({});
    setWorkspaceFileContent(null);
    setMemoryTreeCache({});
    setMemoryContentCache({});
    setSkillsCache({});
    setActiveThreadMessage(null);
    setRightPanel(prev => (prev === 'thread' || prev === 'channel_settings' ? null : prev));
    setViewMode('channel');
    setActiveChannelName('all');
    setTasksVersion(v => v + 1);
  }, [activeWorkspaceId]);

  const createWorkspace = useCallback(async (input: { name: string; icon?: string }) => {
    const res = await api.createWorkspace(input);
    setWorkspaces(res.workspaces);
    setActiveWorkspaceId(res.workspace.id);
    addToast(`Server ${res.workspace.name} created`, 'success');
    return res.workspace;
  }, [addToast, setActiveWorkspaceId]);

  const updateWorkspace = useCallback(async (workspaceId: string, input: { name?: string; icon?: string }) => {
    const res = await api.updateWorkspace(workspaceId, input);
    setWorkspaces(res.workspaces);
    return res.workspace;
  }, []);

  const inviteWorkspaceMember = useCallback(async (input: { email: string; role: 'admin' | 'member'; name?: string }) => {
    try {
      const member = await api.inviteWorkspaceMember(activeWorkspaceRef.current, input);
      // Optimistic — the server also broadcasts `workspace:members` which
      // re-syncs the list authoritatively.
      setWorkspaceMembers(prev => {
        if (prev.some(m => m.email === member.email)) return prev;
        return [...prev, member];
      });
      addToast(`${member.email} invited`, 'success');
      return member;
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to invite member';
      addToast(msg, 'error');
      throw e;
    }
  }, [addToast]);

  const updateWorkspaceMemberRole = useCallback(async (email: string, role: WorkspaceRole) => {
    try {
      const member = await api.updateWorkspaceMemberRole(activeWorkspaceRef.current, email, role);
      setWorkspaceMembers(prev => prev.map(m => m.email === email ? { ...m, role: member.role } : m));
      addToast(`${email} → ${role}`, 'info');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to update role';
      addToast(msg, 'error');
    }
  }, [addToast]);

  const removeWorkspaceMember = useCallback(async (email: string) => {
    try {
      await api.removeWorkspaceMember(activeWorkspaceRef.current, email);
      setWorkspaceMembers(prev => prev.filter(m => m.email !== email));
      addToast(`${email} removed`, 'info');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to remove member';
      addToast(msg, 'error');
    }
  }, [addToast]);

  useEffect(() => {
    const ws = new SlockWebSocket(serverUrl);
    wsRef.current = ws;
    const unsub = ws.on(handleWsEvent);
    ws.connect();
    return () => {
      unsub();
      ws.disconnect();
    };
  }, [serverUrl, activeWorkspaceId, handleWsEvent]);

  useEffect(() => {
    if (!isLoggedIn) {
      setProfilePresets([]);
      return;
    }
    let cancelled = false;
    api.listProfilePresets()
      .then((res) => {
        if (!cancelled) setProfilePresets(res.presets || []);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [isLoggedIn, authToken]);

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

  useEffect(() => {
    if (!isLoggedIn || !authToken) return;
    let cancelled = false;
    const workspaceId = activeWorkspaceRef.current;
    api.fetchWorkspaces()
      .then((res) => {
        if (cancelled || activeWorkspaceRef.current !== workspaceId) return;
        if (res.workspaces?.length) setWorkspaces(res.workspaces);
        if (res.activeWorkspaceId) {
          activeWorkspaceRef.current = res.activeWorkspaceId;
          setActiveWorkspaceIdState(res.activeWorkspaceId);
          setStoredActiveWorkspaceId(res.activeWorkspaceId);
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [isLoggedIn, authToken, activeWorkspaceId]);

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
    const workspaceId = activeWorkspaceRef.current;
    // Clear immediately so that if the fetch fails (e.g. an intermediate proxy
    // returns a cached 304 for a different URL), the previous channel's
    // messages don't linger while the new title is already shown.
    setMessages([]);
    setHasMoreMessages(false);
    setLoadingMessages(true);
    const isDm = viewModeRef.current === 'dm';
    api.fetchMessages(activeChannelName, isDm, 50, isDm ? currentUserRef.current : undefined).then(res => {
      if (!cancelled && activeWorkspaceRef.current === workspaceId) {
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
        // Seed agent→last-channel so the sidebar status dot has data on first
        // paint after a reload, not only after the next WS message arrives.
        for (const m of res.messages) {
          recordAgentLastChannel(m);
          if (m.replies) {
            for (const r of m.replies) recordAgentLastChannel(r);
          }
        }
      }
    }).catch(() => {
      if (!cancelled && activeWorkspaceRef.current === workspaceId) {
        setMessages([]);
        setHasMoreMessages(false);
        setLoadingMessages(false);
      }
    });
    return () => { cancelled = true; };
  }, [activeChannelName, activeWorkspaceId, viewMode, channelListReady, recordAgentLastChannel]);

  const loadOlderMessages = useCallback(async () => {
    if (loadingOlderMessages) return;
    if (!hasMoreMessages) return;
    const oldest = messagesRef.current[0];
    if (!oldest) return;
    setLoadingOlderMessages(true);
    const workspaceId = activeWorkspaceRef.current;
    try {
      const isDm = viewModeRef.current === 'dm';
      const sender = isDm ? currentUserRef.current : undefined;
      const res = await api.fetchMessages(activeChannelRef.current, isDm, 50, sender, oldest.id);
      if (activeWorkspaceRef.current !== workspaceId) return;
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
    // Mobile has no concept of a parallel "sidebar" — a new conversation fully
    // replaces whatever was open (profile/settings/thread/etc.). Desktop keeps
    // other panels but still drops thread so replies don't orphan.
    if (isMobileViewport()) {
      setRightPanel(null);
      setAgentSettingsId(null);
      setAgentProfileId(null);
      setAgentProfileTab('profile');
      setChannelSettingsId(null);
    } else if (rightPanel === 'thread') {
      setRightPanel(null);
    }
    closeSidebarOnMobile();
  }, [closeSidebarOnMobile, rightPanel]);

  const navigateToView = useCallback((mode: ViewMode) => {
    setViewMode(mode);
    if (isMobileViewport()) {
      setRightPanel(null);
      setActiveThreadMessage(null);
      setThreadMessages([]);
      setAgentSettingsId(null);
      setAgentProfileId(null);
      setAgentProfileTab('profile');
      setChannelSettingsId(null);
    }
  }, []);

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
    const workspaceId = activeWorkspaceRef.current;
    api.fetchThreadMessages(message.channel_name, message.id, isDm, 200, sender).then(msgs => {
      if (activeWorkspaceRef.current !== workspaceId) return;
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
    setChannelSettingsId(null);
    // `agentProfileId` is intentionally NOT cleared here: on desktop the
    // AGENT view lives in the right rail independently of `rightPanel`, so
    // closing a thread/workspace/settings panel must not also collapse the
    // rail back to LIVE. Mobile + inline X both go through
    // `closeAgentProfileRail` which clears it explicitly.
  }, []);

  const closeAgentProfileRail = useCallback(() => {
    setAgentProfileId(null);
    setAgentProfileTab('profile');
    // Mobile route uses `rightPanel='agent_profile'`. Clear it so the modal
    // unmounts. No-op on desktop where rightPanel was already null.
    setRightPanel((current) => current === 'agent_profile' ? null : current);
  }, []);

  const openAgentProfile = useCallback((agentId: string) => {
    setAgentProfileId(agentId);
    setAgentProfileTab('profile');
    // On desktop the right rail morphs into the AGENT view by reacting to
    // `agentProfileId`; close any other right panel so the rail can claim
    // the space, and expand the rail if it was collapsed to the peek strip
    // so the agent is actually visible. On mobile we keep the legacy
    // full-screen modal path via `rightPanel='agent_profile'`.
    if (isMobileViewport()) {
      setRightPanel('agent_profile');
    } else {
      setRightPanel(null);
      setActiveThreadMessage(null);
      setThreadMessages([]);
      setAgentSettingsId(null);
      setChannelSettingsId(null);
      setNowRailHidden(false);
    }
    closeSidebarOnMobile();
  }, [closeSidebarOnMobile, setNowRailHidden]);

  const openAgentSettings = useCallback((agentId: string) => {
    setAgentProfileId(agentId);
    setAgentProfileTab('config');
    setAgentSettingsId(null);
    if (isMobileViewport()) {
      setRightPanel('agent_profile');
    } else {
      setRightPanel(null);
      setActiveThreadMessage(null);
      setThreadMessages([]);
      setChannelSettingsId(null);
      setNowRailHidden(false);
    }
    closeSidebarOnMobile();
  }, [closeSidebarOnMobile, setNowRailHidden]);

  const openChannelSettings = useCallback((channelId: string) => {
    setChannelSettingsId(channelId);
    setRightPanel('channel_settings');
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
    lifecycle?: 'persistent' | 'ephemeral';
    openvikingEnabled?: boolean;
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
    const workspaceId = activeWorkspaceRef.current;
    try {
      const { preset } = await api.createProfilePreset(image);
      if (activeWorkspaceRef.current !== workspaceId) return { ok: false as const, error: 'Workspace changed' };
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
    const workspaceId = activeWorkspaceRef.current;
    try {
      await api.deleteProfilePreset(id);
      if (activeWorkspaceRef.current !== workspaceId) return;
      setProfilePresets(prev => prev.filter(p => p.id !== id));
      addToast('Avatar preset removed', 'info');
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
    const workspaceId = activeWorkspaceRef.current;
    try {
      const fetched = await api.fetchAgentActivities(agentId, 100);
      if (activeWorkspaceRef.current !== workspaceId) return;
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
    let previousHumans: ServerHuman[] | null = null;

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

    // Optimistically patch the self entry in `humans[]` so MessageItem /
    // ChannelSidebar / PinnedRail flip to the new avatar instantly instead of
    // waiting for the HTTP PUT + `humans_updated` WS round-trip.
    setHumans(prev => {
      previousHumans = prev;
      const nextPicture = picture !== undefined
        ? (picture || undefined)
        : optimisticUser?.picture ?? undefined;
      const idx = prev.findIndex(h => h.name === previousUser);
      if (idx === -1) return prev;
      const updated = { ...prev[idx], name: trimmed, picture: nextPicture };
      const next = prev.slice();
      next[idx] = updated;
      return next;
    });

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
      if (previousHumans) setHumans(previousHumans);
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
    wsRef.current?.send({ type: 'memory:list', agentId, uri: uri || 'viking://' });
  }, []);

  const requestMemoryContent = useCallback((agentId: string, uri: string, level?: 'l0' | 'l1' | 'l2') => {
    const slot = level || '__legacy__';
    setMemoryContentCache(prev => {
      const existing = prev[agentId]?.[uri];
      if (!existing || !(slot in existing)) return prev;
      const { [slot]: _drop, ...rest } = existing;
      void _drop;
      const agentBucket = { ...(prev[agentId] || {}) };
      agentBucket[uri] = rest;
      return { ...prev, [agentId]: agentBucket };
    });
    wsRef.current?.send({ type: 'memory:read', agentId, requestId: uri, uri, level: level || null });
  }, []);

  const requestSkills = useCallback((agentId: string, runtime?: string | null) => {
    wsRef.current?.send({ type: 'skills:list', agentId, runtime: runtime || null });
  }, []);

  return {
    theme, setTheme,
    colorMode, setColorMode,
    nowRailHidden, setNowRailHidden,
    currentUser, updateCurrentUser, updateProfile: updateCurrentUser,
    workspaces, activeWorkspaceId, setActiveWorkspaceId, createWorkspace, updateWorkspace,
    workspaceMembers, viewerRole, isSuperuser,
    canAdminWorkspace: viewerRole === 'root' || viewerRole === 'owner' || viewerRole === 'admin' || isSuperuser,
    inviteWorkspaceMember, updateWorkspaceMemberRole, removeWorkspaceMember,
    channels, agents, humans, configs, machines,
    activeChannelName, selectChannel,
    viewMode, setViewMode, navigateToView,
    rightPanel, setRightPanel,
    agentDetailTab, setAgentDetailTab,
    selectedAgentId, setSelectedAgentId,
    agentSettingsId, setAgentSettingsId,
    agentProfileId, setAgentProfileId, agentProfileTab, setAgentProfileTab, openAgentProfile, openAgentSettings,
    channelSettingsId, openChannelSettings,
    activeThreadMessage, openThread, closeRightPanel, closeAgentProfileRail,
    settingsOpen, setSettingsOpen,
    workspaceMenuOpen, setWorkspaceMenuOpen,
    sidebarOpen, setSidebarOpen,
    messages, threadMessages, threadedMessageIds,
    agentLastChannel,
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
    memoryTreeCache, memoryContentCache,
    requestMemoryList, requestMemoryContent,
    skillsCache, requestSkills,
    profilePresets,
    addProfilePreset: addProfilePresetAction,
    removeProfilePreset: removeProfilePresetAction,
    authUser, isLoggedIn, hasGoogleAuth, setHasGoogleAuth,
    allowlistActive, setAllowlistActive,
    supabaseConfig, setSupabaseConfig, hasMagicLinkAuth: !!supabaseConfig,
    ovRuntimeWhitelist, setOvRuntimeWhitelist,
    isGuest: isLoggedIn && !authUser,
    loginWithGoogle, loginAsGuest, logout: logoutAction,
    tasksVersion,
  };
}

export type AppStore = ReturnType<typeof useAppStore>;
