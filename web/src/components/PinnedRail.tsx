/* PinnedRail — context-that-survives-scroll strip below the channel header.
   Direct port of PinnedRail() in tmp/.../zouk-rethink/v1-conservative.jsx,
   with OV tier counts and Files button intentionally left out (no backend
   parity). LIVE agents inline + TASKS in_flight/review counts only. */

import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../store/AppContext';
import { isMobileViewport, isStandalonePWA } from '../lib/layout';
import { Avatar, Eyebrow } from './zk/primitives';
import * as api from '../lib/api';
import type { TaskRecord } from '../types';
import { agentIsLive } from '../lib/avatarStatus';

export default function PinnedRail() {
  const { agents, activeChannelName, activeWorkspaceId, channels, tasksVersion, viewMode, agentLastChannel } = useApp();
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [isMobileSurface, setIsMobileSurface] = useState(() => isMobileViewport() || isStandalonePWA());

  useEffect(() => {
    const update = () => setIsMobileSurface(isMobileViewport() || isStandalonePWA());
    window.addEventListener('resize', update);
    const mql = window.matchMedia?.('(display-mode: standalone)');
    mql?.addEventListener?.('change', update);
    return () => {
      window.removeEventListener('resize', update);
      mql?.removeEventListener?.('change', update);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    api.fetchTasks()
      .then((rows) => { if (!cancelled) setTasks(rows); })
      .catch(() => { if (!cancelled) setTasks([]); });
    return () => { cancelled = true; };
  }, [activeWorkspaceId, tasksVersion]);

  const channel = useMemo(
    () => channels.find((c) => c.name === activeChannelName) ?? null,
    [channels, activeChannelName],
  );

  // LIVE only shows agents whose most recent participation is in this
  // channel / DM. Previously this fell back to the wider workspace when
  // no agent was active here, which made LIVE feel decoupled from "what's
  // happening in this room".
  const liveAgents = useMemo(() => {
    const live = agents.filter(agentIsLive);
    if (!activeChannelName) return [];
    return live.filter((a) => agentLastChannel[a.name]?.channel === activeChannelName);
  }, [agents, activeChannelName, agentLastChannel]);
  const headline = liveAgents[0];

  const channelTasks = useMemo(() => {
    if (!channel) return tasks;
    return tasks.filter((t) => t.channelName === channel.name || t.channelId === channel.id);
  }, [tasks, channel]);
  const inFlight = useMemo(
    () => channelTasks.filter((t) => t.status === 'in_progress').length,
    [channelTasks],
  );
  const inReview = useMemo(
    () => channelTasks.filter((t) => t.status === 'in_review').length,
    [channelTasks],
  );

  if (viewMode !== 'channel' && viewMode !== 'dm') return null;
  // Hide the LIVE strip entirely on mobile / PWA — the agents list, tasks
  // counts, and STREAMING dot all eat scarce vertical space and the equivalent
  // signal lives in the dedicated panels for a focused phone reader.
  if (isMobileSurface) return null;

  return (
    <div
      style={{
        padding: '8px 22px',
        borderBottom: '1px solid var(--zk-line)',
        background: 'var(--zk-bg-0)',
        display: 'flex',
        gap: 16,
        alignItems: 'center',
        flexWrap: 'wrap',
        flexShrink: 0,
      }}
    >
      {/* LIVE — inline avatars + headline activity detail */}
      <div className="zk-row" style={{ gap: 8 }}>
        <Eyebrow>LIVE</Eyebrow>
        {liveAgents.length === 0 ? (
          <span style={{ fontSize: 11, color: 'var(--zk-ink-low)' }}>idle</span>
        ) : (
          <span className="zk-row" style={{ marginLeft: -4 }}>
            {liveAgents.slice(0, 4).map((a, i) => (
              <span
                key={a.id}
                style={{
                  marginLeft: -4,
                  position: 'relative',
                  zIndex: 4 - i,
                  border: '1.5px solid var(--zk-bg-0)',
                  borderRadius: 6,
                }}
              >
                <Avatar
                  src={a.picture}
                  name={a.displayName || a.name}
                  size="sm"
                  kind="agent"
                  activity={a.activity}
                />
              </span>
            ))}
            {liveAgents.length > 4 && (
              <span
                style={{
                  marginLeft: -4,
                  width: 20,
                  height: 20,
                  borderRadius: 6,
                  background: 'var(--zk-bg-2)',
                  border: '1.5px solid var(--zk-bg-0)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 9,
                  color: 'var(--zk-ink-mute)',
                  fontFamily: 'var(--zk-font-mono)',
                }}
              >
                +{liveAgents.length - 4}
              </span>
            )}
          </span>
        )}
        {/* Headline description (agent name · activity detail) takes a non-trivial
            slice of vertical / horizontal real estate on mobile. Hide on
            mobile + standalone PWA so the LIVE rail stays compact and the
            message stream reclaims the height. The avatars + STREAMING dot
            still convey "something is active". */}
        {headline && !isMobileSurface && (
          <span
            className="zk-truncate"
            style={{
              fontSize: 11,
              color: 'var(--zk-ink-dim)',
              maxWidth: 280,
            }}
          >
            <span style={{ color: 'var(--zk-ink-mute)' }}>{headline.displayName || headline.name}</span>
            {' · '}
            {headline.activityDetail || headline.activity || 'working…'}
          </span>
        )}
      </div>

      <span style={{ width: 1, height: 14, background: 'var(--zk-line)' }} />

      {/* TASKS — compact pip row */}
      <div className="zk-row" style={{ gap: 8 }}>
        <Eyebrow>TASKS</Eyebrow>
        <span style={{ fontSize: 11, color: 'var(--zk-ink-dim)', fontFamily: 'var(--zk-font-mono)' }}>
          <span style={{ color: 'var(--zk-info)' }}>{inFlight}</span>
          <span style={{ color: 'var(--zk-ink-low)' }}> in flight</span>
          {inReview > 0 && (
            <>
              <span style={{ color: 'var(--zk-ink-low)' }}> · </span>
              <span style={{ color: 'var(--zk-warn)' }}>{inReview}</span>
              <span style={{ color: 'var(--zk-ink-low)' }}> review</span>
            </>
          )}
        </span>
      </div>

      <span className="zk-grow" />

      {/* Streaming pulse on the right when anything is live */}
      {liveAgents.length > 0 && (
        <span
          className="zk-row"
          style={{ gap: 6, fontSize: 10, color: 'var(--zk-ink-mute)', fontFamily: 'var(--zk-font-mono)' }}
        >
          <span className="zk-dot zk-dot--working" style={{ animation: 'zkBlink 1.5s infinite' }} />
          <span>STREAMING</span>
        </span>
      )}
    </div>
  );
}
