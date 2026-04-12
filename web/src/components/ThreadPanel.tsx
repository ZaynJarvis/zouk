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
    <div className="w-full lg:w-[380px] h-full border-l-0 lg:border-l-3 border-nb-black dark:border-dark-border bg-nb-white dark:bg-dark-surface flex flex-col animate-slide-in-right fixed inset-0 z-30 lg:relative lg:z-auto">
      <div className="h-14 border-b-3 border-nb-black dark:border-dark-border flex items-center justify-between px-4">
        <div className="flex items-center gap-2">
          <h3 className="font-display font-extrabold text-base text-nb-black dark:text-dark-text">Thread</h3>
          <span className="flex items-center gap-1 text-xs text-nb-gray-500 dark:text-dark-muted">
            <Hash size={12} />{activeChannelName}
          </span>
        </div>
        <button
          onClick={closeRightPanel}
          className="w-8 h-8 border-2 border-nb-gray-200 dark:border-dark-border flex items-center justify-center text-nb-gray-500 hover:border-nb-black dark:hover:border-dark-text hover:text-nb-black dark:hover:text-dark-text hover:bg-nb-gray-100 dark:hover:bg-dark-elevated transition-all"
        >
          <X size={16} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="border-b-2 border-nb-gray-200 dark:border-dark-border pb-2">
          <MessageItem message={activeThreadMessage} />
        </div>

        {threadMessages.length > 0 && (
          <div className="px-3 py-2">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-nb-gray-500 dark:text-dark-muted uppercase tracking-wider">
                {threadMessages.length} {threadMessages.length === 1 ? 'reply' : 'replies'}
              </span>
              <div className="flex-1 border-t border-nb-gray-200 dark:border-dark-border" />
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
