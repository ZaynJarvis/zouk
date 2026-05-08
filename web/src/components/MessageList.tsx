import { useRef, useEffect, useCallback, useLayoutEffect } from 'react';
import { useApp } from '../store/AppContext';
import MessageItem from './MessageItem';
import type { MessageRecord } from '../types';
import { Loader } from 'lucide-react';

const OLDER_LOAD_TRIGGER_PX = 120;

function DaySeparator({ label }: { label: string }) {
  return (
    <div
      className="zk-row"
      style={{
        gap: 12,
        padding: '10px 22px',
        alignItems: 'center',
      }}
    >
      <hr className="zk-hr zk-grow" />
      <span className="zk-eyebrow" style={{ fontSize: 10 }}>{label}</span>
      <hr className="zk-hr zk-grow" />
    </div>
  );
}

function shouldGroup(prev: MessageRecord, curr: MessageRecord): boolean {
  if (prev.sender_name !== curr.sender_name) return false;
  if (!prev.timestamp || !curr.timestamp) return false;
  const diff = new Date(curr.timestamp).getTime() - new Date(prev.timestamp).getTime();
  return diff < 300000;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return 'Today';
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}

export default function MessageList() {
  const {
    messages,
    activeChannelName,
    loadingMessages,
    hasMoreMessages,
    loadingOlderMessages,
    loadOlderMessages,
  } = useApp();
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const pendingInitialScrollRef = useRef(true);
  const preservedScrollRef = useRef<{ scrollHeight: number; scrollTop: number } | null>(null);
  const channelMessages = messages.filter((m) => m.channel_type !== 'thread');

  useEffect(() => {
    if (loadingMessages) {
      pendingInitialScrollRef.current = true;
    }
  }, [loadingMessages]);

  const scrollToBottom = useCallback((instant: boolean) => {
    if (instant) {
      const container = containerRef.current;
      if (container) container.scrollTop = container.scrollHeight;
    } else {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, []);

  useLayoutEffect(() => {
    if (loadingOlderMessages && containerRef.current && !preservedScrollRef.current) {
      preservedScrollRef.current = {
        scrollHeight: containerRef.current.scrollHeight,
        scrollTop: containerRef.current.scrollTop,
      };
    }
  }, [loadingOlderMessages]);

  useLayoutEffect(() => {
    const snap = preservedScrollRef.current;
    if (!snap) return;
    if (loadingOlderMessages) return;
    const container = containerRef.current;
    if (container) {
      const delta = container.scrollHeight - snap.scrollHeight;
      if (delta > 0) container.scrollTop = snap.scrollTop + delta;
    }
    preservedScrollRef.current = null;
  }, [channelMessages.length, loadingOlderMessages]);

  useEffect(() => {
    if (preservedScrollRef.current) return;
    if (channelMessages.length === 0) return;
    if (pendingInitialScrollRef.current) {
      scrollToBottom(true);
      pendingInitialScrollRef.current = false;

      const container = containerRef.current;
      const inner = container?.firstElementChild;
      if (!inner) return;
      const observer = new ResizeObserver(() => {
        const c = containerRef.current;
        if (c) c.scrollTop = c.scrollHeight;
      });
      observer.observe(inner);
      const timer = setTimeout(() => observer.disconnect(), 3000);
      return () => {
        clearTimeout(timer);
        observer.disconnect();
      };
    } else {
      scrollToBottom(false);
    }
  }, [channelMessages.length, scrollToBottom]);

  const handleScroll = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    if (pendingInitialScrollRef.current) return;
    if (loadingMessages || loadingOlderMessages) return;
    if (!hasMoreMessages) return;
    if (container.scrollTop <= OLDER_LOAD_TRIGGER_PX) {
      loadOlderMessages();
    }
  }, [loadingMessages, loadingOlderMessages, hasMoreMessages, loadOlderMessages]);

  if (loadingMessages) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div
          className="zk-row"
          style={{
            gap: 10,
            padding: '12px 18px',
            background: 'var(--zk-bg-1)',
            border: '1px solid var(--zk-line)',
            borderRadius: 8,
          }}
        >
          <Loader size={14} className="animate-spin" color="var(--zk-ember)" />
          <span style={{ fontSize: 12, color: 'var(--zk-ink-mute)', fontFamily: 'var(--zk-font-mono)' }}>
            Loading messages…
          </span>
        </div>
      </div>
    );
  }

  if (channelMessages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div
          className="text-center"
          style={{
            padding: 32, maxWidth: 360,
            border: '1px solid var(--zk-line)',
            background: 'var(--zk-bg-1)',
            borderRadius: 12,
          }}
        >
          <h3
            className="zk-display"
            style={{ fontSize: 17, fontWeight: 600, color: 'var(--zk-ink)', margin: 0 }}
          >
            No messages yet
          </h3>
          <p style={{ fontSize: 12, color: 'var(--zk-ink-mute)', marginTop: 8, fontFamily: 'var(--zk-font-mono)' }}>
            Be the first to say something in #{activeChannelName}
          </p>
        </div>
      </div>
    );
  }

  let lastDate = '';

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className="zk-scroll"
      style={{
        flex: 1, overflowY: 'auto', overflowX: 'hidden',
        background: 'var(--zk-bg-0)',
      }}
    >
      <div
        style={{
          maxWidth: 'var(--chat-max-width, 56rem)',
          margin: '0 auto',
          width: '100%',
          minWidth: 0,
          padding: '14px 0 6px',
        }}
      >
        {loadingOlderMessages && (
          <div className="zk-row" style={{ justifyContent: 'center', padding: '10px 0' }}>
            <Loader size={12} className="animate-spin" color="var(--zk-ember)" />
            <span
              style={{
                marginLeft: 8, fontSize: 11,
                color: 'var(--zk-ink-mute)', fontFamily: 'var(--zk-font-mono)',
              }}
            >
              Loading older messages…
            </span>
          </div>
        )}
        {!hasMoreMessages && channelMessages.length > 0 && !loadingOlderMessages && (
          <div className="zk-row" style={{ justifyContent: 'center', padding: '8px 0' }}>
            <span
              style={{
                fontSize: 11,
                color: 'var(--zk-ink-low)', fontFamily: 'var(--zk-font-mono)',
                letterSpacing: '0.06em',
              }}
            >
              — start of conversation —
            </span>
          </div>
        )}
        {channelMessages.map((msg, i) => {
          const msgDate = msg.timestamp ? formatDate(msg.timestamp) : '';
          const showDate = msgDate && msgDate !== lastDate;
          if (msgDate) lastDate = msgDate;
          const isGrouped = i > 0 && shouldGroup(channelMessages[i - 1], msg);

          return (
            <div key={msg.id}>
              {showDate && <DaySeparator label={msgDate} />}
              <MessageItem message={msg} isGrouped={!!isGrouped && !showDate} />
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
