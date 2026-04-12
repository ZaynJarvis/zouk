import { useRef, useEffect } from 'react';
import { useApp } from '../store/AppContext';
import MessageItem from './MessageItem';
import type { MessageRecord } from '../types';
import { Loader } from 'lucide-react';

function DateDivider({ date }: { date: string }) {
  return (
    <div className="flex items-center gap-3 px-5 py-3">
      <div className="flex-1 border-t-2 border-nb-gray-200 dark:border-dark-border" />
      <span className="bg-nb-white dark:bg-dark-surface border-2 border-nb-black dark:border-dark-border px-3 py-1 text-xs font-bold text-nb-black dark:text-dark-text shadow-nb-sm">
        {date}
      </span>
      <div className="flex-1 border-t-2 border-nb-gray-200 dark:border-dark-border" />
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
        <div className="flex items-center gap-3 border-3 border-nb-black dark:border-dark-border bg-nb-white dark:bg-dark-surface px-6 py-4 shadow-nb">
          <Loader size={20} className="animate-spin text-nb-blue" />
          <span className="font-display font-bold text-sm text-nb-black dark:text-dark-text">Loading messages...</span>
        </div>
      </div>
    );
  }

  if (channelMessages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center border-3 border-nb-black dark:border-dark-border bg-nb-white dark:bg-dark-surface p-8 shadow-nb max-w-sm">
          <div className="text-4xl mb-3">💬</div>
          <h3 className="font-display font-black text-xl text-nb-black dark:text-dark-text mb-2">No messages yet</h3>
          <p className="text-sm text-nb-gray-500 dark:text-dark-muted">Be the first to say something in #{activeChannelName}</p>
        </div>
      </div>
    );
  }

  let lastDate = '';

  return (
    <div className="flex-1 overflow-y-auto">
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
