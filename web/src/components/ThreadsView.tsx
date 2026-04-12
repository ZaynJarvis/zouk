import { MessageSquare } from 'lucide-react';
import { useApp } from '../store/AppContext';

function formatTime(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function ThreadsView() {
  const { messages, openThread, threadedMessageIds } = useApp();
  const threaded = messages.filter(m => {
    if (m.channel_type === 'thread') return false;
    const shortId = m.id.slice(0, 8);
    return threadedMessageIds.has(shortId);
  });

  if (threaded.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center cyber-panel p-8 max-w-sm cyber-bevel">
          <div className="w-16 h-16 border border-nc-magenta/30 bg-nc-magenta/10 mx-auto mb-4 flex items-center justify-center">
            <MessageSquare size={28} className="text-nc-magenta" />
          </div>
          <h3 className="font-display font-black text-xl text-nc-magenta neon-magenta mb-2 tracking-wider">NO_THREADS</h3>
          <p className="text-sm text-nc-muted font-mono">Threads you participate in will appear here.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto scrollbar-thin">
      <div className="px-6 py-4">
        <h2 className="font-display font-black text-2xl text-nc-text-bright mb-4 tracking-wider">THREADS</h2>
        <div className="space-y-2">
          {threaded.map(msg => {
            const senderName = msg.sender_name || 'Unknown';
            return (
              <button
                key={msg.id}
                onClick={() => openThread(msg)}
                className="w-full text-left p-4 border border-nc-border bg-nc-surface hover:border-nc-cyan/50 hover:bg-nc-elevated transition-all"
              >
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-6 h-6 border border-nc-cyan/50 bg-nc-cyan/10 font-display font-bold text-2xs flex items-center justify-center text-nc-cyan select-none">
                    {senderName.charAt(0).toUpperCase()}
                  </div>
                  <span className="font-bold text-sm text-nc-text-bright">{senderName}</span>
                  {msg.timestamp && (
                    <span className="text-2xs text-nc-muted font-mono">{formatTime(msg.timestamp)}</span>
                  )}
                </div>
                <p className="text-sm text-nc-text line-clamp-2">{msg.content}</p>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
