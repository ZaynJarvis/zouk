import { MessageSquare } from 'lucide-react';
import { useApp } from '../store/AppContext';

function formatTime(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function ThreadsView() {
  const { messages, openThread, threadedMessageIds } = useApp();
  // Only show messages that actually have thread replies
  const threaded = messages.filter(m => {
    if (m.channel_type === 'thread') return false;
    // Check if this message's short ID appears in threadedMessageIds
    const shortId = m.id.slice(0, 8);
    return threadedMessageIds.has(shortId);
  });

  if (threaded.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center border-3 border-nb-black dark:border-dark-border bg-nb-white dark:bg-dark-surface p-8 shadow-nb max-w-sm">
          <div className="w-16 h-16 border-3 border-nb-black dark:border-dark-border bg-nb-blue-light dark:bg-dark-elevated mx-auto mb-4 flex items-center justify-center shadow-nb-sm">
            <MessageSquare size={28} className="text-nb-blue" />
          </div>
          <h3 className="font-display font-black text-xl text-nb-black dark:text-dark-text mb-2">No Threads</h3>
          <p className="text-sm text-nb-gray-500 dark:text-dark-muted">Threads you participate in will appear here.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="px-6 py-4">
        <h2 className="font-display font-black text-2xl text-nb-black dark:text-dark-text mb-4">Threads</h2>
        <div className="space-y-2">
          {threaded.map(msg => {
            const senderName = msg.sender_name || 'Unknown';
            return (
              <button
                key={msg.id}
                onClick={() => openThread(msg)}
                className="w-full text-left p-4 border-3 border-nb-black dark:border-dark-border bg-nb-white dark:bg-dark-surface hover:shadow-nb hover:bg-nb-yellow-light/30 dark:hover:bg-dark-elevated transition-all"
              >
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-6 h-6 border-2 border-nb-black dark:border-dark-border font-display font-bold text-2xs flex items-center justify-center bg-nb-yellow select-none">
                    {senderName.charAt(0).toUpperCase()}
                  </div>
                  <span className="font-bold text-sm text-nb-black dark:text-dark-text">{senderName}</span>
                  {msg.timestamp && (
                    <span className="text-2xs text-nb-gray-400 dark:text-dark-muted">{formatTime(msg.timestamp)}</span>
                  )}
                </div>
                <p className="text-sm text-nb-gray-600 dark:text-dark-text line-clamp-2">{msg.content}</p>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
