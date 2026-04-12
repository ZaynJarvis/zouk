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
        <div className="text-center border border-cyber-border bg-cyber-surface p-8 shadow-neon-magenta max-w-sm">
          <div className="w-16 h-16 border border-cyber-magenta/30 bg-cyber-magenta/10 mx-auto mb-4 flex items-center justify-center">
            <MessageSquare size={28} className="text-cyber-magenta" />
          </div>
          <h3 className="font-display font-bold text-xl text-cyber-magenta mb-2 tracking-wider">NO THREADS</h3>
          <p className="text-sm text-cyber-chrome-400 font-mono">Threads you participate in will appear here.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="px-6 py-4">
        <h2 className="font-display font-bold text-2xl text-cyber-chrome-50 mb-4 tracking-wider">THREADS</h2>
        <div className="space-y-2">
          {threaded.map(msg => {
            const senderName = msg.sender_name || 'Unknown';
            return (
              <button
                key={msg.id}
                onClick={() => openThread(msg)}
                className="w-full text-left p-4 border border-cyber-border bg-cyber-surface hover:bg-cyber-elevated hover:border-cyber-cyan/20 hover:shadow-cyber-sm transition-all"
              >
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-6 h-6 border border-cyber-cyan/30 bg-cyber-cyan/10 font-display font-bold text-2xs flex items-center justify-center text-cyber-cyan select-none">
                    {senderName.charAt(0).toUpperCase()}
                  </div>
                  <span className="font-bold text-sm text-cyber-chrome-100">{senderName}</span>
                  {msg.timestamp && (
                    <span className="text-2xs text-cyber-chrome-500 font-mono">{formatTime(msg.timestamp)}</span>
                  )}
                </div>
                <p className="text-sm text-cyber-chrome-300 line-clamp-2">{msg.content}</p>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
