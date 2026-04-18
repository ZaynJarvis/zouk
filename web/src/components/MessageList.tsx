import { useRef, useEffect, useCallback, useLayoutEffect } from 'react';
import { useApp } from '../store/AppContext';
import MessageItem from './MessageItem';
import type { MessageRecord } from '../types';
import { Loader } from 'lucide-react';
import { isNightCity } from '../lib/themeUtils';

const OLDER_LOAD_TRIGGER_PX = 120;

function DateDivider({ date }: { date: string }) {
  const nc = isNightCity();
  return (
    <div className="flex items-center gap-3 px-5 py-3">
      <div className={`flex-1 ${nc ? 'cyber-divider' : 'border-t-2 border-nc-border'}`} />
      <span className={nc
        ? 'bg-nc-elevated border border-nc-border px-3 py-1 text-xs font-bold text-nc-cyan font-mono tracking-wider'
        : 'bg-nc-surface border-2 border-nc-border-bright px-3 py-1 text-xs font-bold text-nc-text-bright shadow-[2px_2px_0px_0px_#1A1A1A]'
      }>
        {date}
      </span>
      <div className={`flex-1 ${nc ? 'cyber-divider' : 'border-t-2 border-nc-border'}`} />
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
  // true after a loading transition — signals we need an instant scroll
  const pendingInitialScrollRef = useRef(true);
  // Snapshot scrollHeight right before an older-page prepends, so we can
  // preserve the user's visual position after React rerenders with taller content.
  const preservedScrollRef = useRef<{ scrollHeight: number; scrollTop: number } | null>(null);
  const channelMessages = messages.filter(m => m.channel_type !== 'thread');

  // When loading starts (channel switch or page load), mark pending initial scroll
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

  // Snapshot scroll position just before an older-page prepend, then
  // restore visual position after the new content lays out.
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
    // Wait for the older-page fetch to finish before restoring — if length
    // changes mid-flight we'd clear the snapshot too early.
    if (loadingOlderMessages) return;
    const container = containerRef.current;
    if (container) {
      const delta = container.scrollHeight - snap.scrollHeight;
      if (delta > 0) container.scrollTop = snap.scrollTop + delta;
    }
    // Clear regardless of delta so an empty-result load doesn't strand the ref
    // and block the next snapshot attempt.
    preservedScrollRef.current = null;
  }, [channelMessages.length, loadingOlderMessages]);

  useEffect(() => {
    // Skip bottom-scroll when the length change was from an older-page prepend —
    // the snapshot restore effect above handles position preservation instead.
    if (preservedScrollRef.current) return;
    if (channelMessages.length === 0) return;
    if (pendingInitialScrollRef.current) {
      // Initial load or channel switch — scroll instantly so users land at the bottom
      scrollToBottom(true);
      pendingInitialScrollRef.current = false;
    } else {
      // New message arrived after initial load — smooth scroll
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
        <div className="flex items-center gap-3 cyber-panel px-6 py-4">
          <Loader size={20} className="animate-spin text-nc-cyan" />
          <span className="font-display font-bold text-sm text-nc-cyan tracking-wider">Loading messages...</span>
        </div>
      </div>
    );
  }

  if (channelMessages.length === 0) {
    const nc = isNightCity();
    return (
      <div className="flex-1 flex items-center justify-center">
        {nc ? (
          <div className="text-center cyber-panel p-8 max-w-sm cyber-bevel">
            <div className="text-4xl mb-3 opacity-50"><span className="neon-cyan">&gt;_</span></div>
            <h3 className="font-display font-black text-xl text-nc-cyan neon-cyan mb-2 tracking-wider">NO_DATA</h3>
            <p className="text-sm text-nc-muted font-mono">Initialize comms in #{activeChannelName}</p>
          </div>
        ) : (
          <div className="text-center cyber-panel p-8 max-w-sm">
            <div className="text-4xl mb-3">&#x1F4AC;</div>
            <h3 className="font-display font-black text-xl text-nc-text-bright mb-2">No messages yet</h3>
            <p className="text-sm text-nc-muted">Be the first to say something in #{activeChannelName}</p>
          </div>
        )}
      </div>
    );
  }

  let lastDate = '';

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className="flex-1 overflow-y-auto overflow-x-hidden scrollbar-thin"
    >
      <div className="pt-4 pb-2 max-w-4xl mx-auto w-full min-w-0">
        {loadingOlderMessages && (
          <div className="flex items-center justify-center py-3">
            <Loader size={16} className="animate-spin text-nc-cyan" />
            <span className="ml-2 text-xs font-mono text-nc-muted tracking-wider">Loading older messages…</span>
          </div>
        )}
        {!hasMoreMessages && channelMessages.length > 0 && !loadingOlderMessages && (
          <div className="flex items-center justify-center py-3">
            <span className="text-xs font-mono text-nc-muted tracking-wider opacity-60">— start of conversation —</span>
          </div>
        )}
        {channelMessages.map((msg, i) => {
          const msgDate = msg.timestamp ? formatDate(msg.timestamp) : '';
          const showDate = msgDate && msgDate !== lastDate;
          if (msgDate) lastDate = msgDate;
          const isGrouped = i > 0 && shouldGroup(channelMessages[i - 1], msg);

          return (
            <div key={msg.id}>
              {showDate && <DateDivider date={msgDate} />}
              <MessageItem message={msg} isGrouped={!!isGrouped && !showDate} />
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
