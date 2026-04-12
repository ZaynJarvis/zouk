import { X, Hash, Bot, User } from 'lucide-react';
import { useApp } from '../store/AppContext';

const activityColors: Record<string, string> = {
  thinking: 'bg-nb-yellow animate-pulse',
  working: 'bg-nb-orange animate-pulse',
  online: 'bg-nb-green',
  offline: 'bg-nb-gray-400',
  error: 'bg-nb-red',
};

export default function DetailsPanel() {
  const { activeChannelName, closeRightPanel, humans, agents, messages, viewMode } = useApp();

  // Derive channel members from message senders
  const senderNames = new Set(messages.map(m => m.sender_name).filter(Boolean));

  const channelHumans = humans.filter(h => senderNames.has(h.name));
  const channelAgents = agents.filter(a => senderNames.has(a.name) || senderNames.has(a.displayName));

  const isDm = viewMode === 'dm';

  return (
    <div className="w-[380px] h-full border-l-3 border-nb-black dark:border-dark-border bg-nb-white dark:bg-dark-surface flex flex-col animate-slide-in-right">
      <div className="h-14 border-b-3 border-nb-black dark:border-dark-border flex items-center justify-between px-4">
        <h3 className="font-display font-extrabold text-base text-nb-black dark:text-dark-text">Details</h3>
        <button
          onClick={closeRightPanel}
          className="w-8 h-8 border-2 border-nb-gray-200 dark:border-dark-border flex items-center justify-center text-nb-gray-500 hover:border-nb-black dark:hover:border-dark-text hover:text-nb-black dark:hover:text-dark-text hover:bg-nb-gray-100 dark:hover:bg-dark-elevated transition-all"
        >
          <X size={16} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="p-4 border-b-2 border-nb-gray-200 dark:border-dark-border">
          <div className="flex items-center gap-2 mb-2">
            {isDm ? <User size={18} /> : <Hash size={18} />}
            <h4 className="font-display font-black text-xl text-nb-black dark:text-dark-text">{isDm ? `@${activeChannelName}` : activeChannelName}</h4>
          </div>
        </div>

        <div className="p-4 border-b-2 border-nb-gray-200 dark:border-dark-border">
          <h5 className="text-xs font-bold uppercase tracking-wider text-nb-gray-500 dark:text-dark-muted mb-3">
            People ({channelHumans.length})
          </h5>
          <div className="space-y-1">
            {channelHumans.map(h => (
              <div key={h.id} className="flex items-center gap-2 px-2 py-1.5 hover:bg-nb-gray-100 dark:hover:bg-dark-elevated transition-colors">
                <div className="w-7 h-7 border-2 border-nb-black dark:border-dark-border font-display font-bold text-2xs flex items-center justify-center bg-nb-blue-light">
                  <User size={12} />
                </div>
                <span className="text-sm font-medium text-nb-black dark:text-dark-text truncate">{h.name}</span>
              </div>
            ))}
            {channelHumans.length === 0 && (
              <p className="text-xs text-nb-gray-400 dark:text-dark-muted italic">No people in this {isDm ? 'conversation' : 'channel'}</p>
            )}
          </div>
        </div>

        <div className="p-4">
          <h5 className="text-xs font-bold uppercase tracking-wider text-nb-gray-500 dark:text-dark-muted mb-3">
            Agents ({channelAgents.length})
          </h5>
          <div className="space-y-1">
            {channelAgents.map(a => (
              <div key={a.id} className="flex items-center gap-2 px-2 py-1.5 hover:bg-nb-gray-100 dark:hover:bg-dark-elevated transition-colors">
                <div className="w-7 h-7 border-2 border-nb-black dark:border-dark-border font-display font-bold text-2xs flex items-center justify-center bg-nb-yellow-light">
                  <Bot size={12} />
                </div>
                <span className="text-sm font-medium text-nb-black dark:text-dark-text truncate">{a.displayName || a.name}</span>
                <span className={`ml-auto w-2 h-2 border border-nb-black dark:border-dark-border flex-shrink-0 ${activityColors[a.activity || 'offline']}`} />
              </div>
            ))}
            {channelAgents.length === 0 && (
              <p className="text-xs text-nb-gray-400 dark:text-dark-muted italic">No agents in this {isDm ? 'conversation' : 'channel'}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
