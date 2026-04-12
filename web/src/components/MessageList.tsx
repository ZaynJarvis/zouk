import { useRef, useEffect } from 'react';
import { useApp } from '../store/AppContext';
import MessageItem from './MessageItem';
import type { MessageRecord } from '../types';
import { Loader } from 'lucide-react';

function DateDivider({ date }: { date: string }) {
  return (
    <div className="flex items-center gap-3 px-5 py-3">
      <div className="flex-1 border-t border-cyber-border" />
      <span className="bg-cyber-surface border border-cyber-border px-3 py-1 text-2xs font-mono text-cyber-chrome-300 tracking-wider uppercase">
        {date}
      </span>
      <div className="flex-1 border-t border-cyber-border" />
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
        <div className="flex items-center gap-3 border border-cyber-border bg-cyber-surface px-6 py-4 shadow-neon-cyan">
          <Loader size={20} className="animate-spin text-cyber-cyan" />
          <span className="font-mono font-bold text-sm text-cyber-cyan tracking-wider">LOADING MESSAGES...</span>
        </div>
      </div>
    );
  }

  if (channelMessages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center border border-cyber-border bg-cyber-surface p-8 shadow-neon-cyan max-w-sm">
          <div className="text-4xl mb-3 opacity-50">///</div>
          <h3 className="font-display font-bold text-xl text-cyber-cyan mb-2 tracking-wider">NO MESSAGES</h3>
          <p className="text-sm text-cyber-chrome-400 font-mono">Initiate first transmission in #{activeChannelName}</p>
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
