import { useRef, useEffect } from 'react';
import { useApp } from '../store/AppContext';
import MessageItem from './MessageItem';
import type { MessageRecord } from '../types';
import { Loader } from 'lucide-react';
import { isNightCity } from '../lib/themeUtils';

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
  const { messages, activeChannelName, loadingMessages } = useApp();
  const bottomRef = useRef<HTMLDivElement>(null);
  const channelMessages = messages.filter(m => m.channel_type !== 'thread');

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [channelMessages.length]);

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
    <div className="flex-1 overflow-y-auto scrollbar-thin">
      <div className="pt-4 pb-2">
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
