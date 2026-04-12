import { X, Hash } from 'lucide-react';
import { useApp } from '../store/AppContext';
import MessageItem from './MessageItem';
import MessageComposer from './MessageComposer';

export default function ThreadPanel() {
  const { activeThreadMessage, threadMessages, closeRightPanel, activeChannelName } = useApp();

  if (!activeThreadMessage) return null;

  const shortId = activeThreadMessage.id.slice(0, 8);
  const threadTarget = activeThreadMessage.channel_type === 'dm'
    ? `dm:@${activeThreadMessage.channel_name}:${shortId}`
    : `#${activeThreadMessage.channel_name}:${shortId}`;

  return (
    <div className="w-[380px] h-full border-l border-cyber-border bg-cyber-surface flex flex-col animate-slide-in-right">
      <div className="h-14 border-b border-cyber-border flex items-center justify-between px-4">
        <div className="flex items-center gap-2">
          <h3 className="font-display font-bold text-base text-cyber-chrome-50 tracking-wider">THREAD</h3>
          <span className="flex items-center gap-1 text-xs text-cyber-chrome-400 font-mono">
            <Hash size={12} />{activeChannelName}
          </span>
        </div>
        <button
          onClick={closeRightPanel}
          className="w-8 h-8 border border-cyber-border flex items-center justify-center text-cyber-chrome-400 hover:border-cyber-cyan/30 hover:text-cyber-cyan hover:bg-cyber-elevated transition-all"
        >
          <X size={16} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="border-b border-cyber-border pb-2">
          <MessageItem message={activeThreadMessage} />
        </div>

        {threadMessages.length > 0 && (
          <div className="px-3 py-2">
            <div className="flex items-center gap-2">
              <span className="text-xs font-display font-bold text-cyber-chrome-400 uppercase tracking-widest">
                {threadMessages.length} {threadMessages.length === 1 ? 'reply' : 'replies'}
              </span>
              <div className="flex-1 border-t border-cyber-border" />
            </div>
          </div>
        )}

        {threadMessages.map((msg, i) => {
          const isGrouped = i > 0 && threadMessages[i - 1].sender_name === msg.sender_name;
          return <MessageItem key={msg.id} message={msg} isGrouped={isGrouped} />;
        })}
      </div>

      <MessageComposer threadTarget={threadTarget} placeholder="Reply..." />
    </div>
  );
}
