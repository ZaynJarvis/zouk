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

export default function PinnedRail() {
  const { agents, activeChannelName, channels, tasksVersion, viewMode } = useApp();
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
  }, [tasksVersion]);

  const channel = useMemo(
    () => channels.find((c) => c.name === activeChannelName) ?? null,
    [channels, activeChannelName],
  );

  const liveAgents = useMemo(() => {
    const live = agents.filter((a) => a.activity === 'working' || a.activity === 'thinking');
    if (channel) {
      const inChannel = live.filter((a) => (a.channels || []).includes(channel.name));
      // If any agent in this channel is live, focus on them; otherwise show the
      // wider workspace activity so users still see what's happening.
      if (inChannel.length > 0) return inChannel;
    }
    return live;
  }, [agents, channel]);
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
