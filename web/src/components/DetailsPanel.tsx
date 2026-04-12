import { X, Hash, Bot, User } from 'lucide-react';
import { useApp } from '../store/AppContext';

const activityColors: Record<string, string> = {
  thinking: 'bg-cyber-yellow animate-pulse',
  working: 'bg-cyber-orange animate-pulse',
  online: 'bg-cyber-green shadow-neon-green',
  offline: 'bg-cyber-chrome-600',
  error: 'bg-cyber-red shadow-neon-red',
};

export default function DetailsPanel() {
  const { activeChannelName, closeRightPanel, humans, agents, messages, viewMode } = useApp();

  const senderNames = new Set(messages.map(m => m.sender_name).filter(Boolean));
  const channelHumans = humans.filter(h => senderNames.has(h.name));
  const channelAgents = agents.filter(a => senderNames.has(a.name) || senderNames.has(a.displayName));
  const isDm = viewMode === 'dm';

  return (
    <div className="w-[380px] h-full border-l border-cyber-border bg-cyber-surface flex flex-col animate-slide-in-right">
      <div className="h-14 border-b border-cyber-border flex items-center justify-between px-4">
        <h3 className="font-display font-bold text-base text-cyber-chrome-50 tracking-wider">DETAILS</h3>
        <button
          onClick={closeRightPanel}
          className="w-8 h-8 border border-cyber-border flex items-center justify-center text-cyber-chrome-400 hover:border-cyber-cyan/30 hover:text-cyber-cyan hover:bg-cyber-elevated transition-all"
        >
          <X size={16} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="p-4 border-b border-cyber-border">
          <div className="flex items-center gap-2 mb-2">
            {isDm ? <User size={18} className="text-cyber-magenta" /> : <Hash size={18} className="text-cyber-cyan" />}
            <h4 className="font-display font-bold text-xl text-cyber-chrome-50 tracking-wide">{isDm ? `@${activeChannelName}` : activeChannelName}</h4>
          </div>
        </div>

        <div className="p-4 border-b border-cyber-border">
          <h5 className="text-xs font-display font-bold uppercase tracking-widest text-cyber-chrome-400 mb-3">
            PEOPLE ({channelHumans.length})
          </h5>
          <div className="space-y-1">
            {channelHumans.map(h => (
              <div key={h.id} className="flex items-center gap-2 px-2 py-1.5 hover:bg-cyber-elevated transition-colors">
                <div className="w-7 h-7 border border-cyber-cyan/30 bg-cyber-cyan/10 font-display font-bold text-2xs flex items-center justify-center text-cyber-cyan">
                  <User size={12} />
                </div>
                <span className="text-sm font-medium text-cyber-chrome-100 truncate">{h.name}</span>
              </div>
            ))}
            {channelHumans.length === 0 && (
              <p className="text-xs text-cyber-chrome-500 italic font-mono">No people in this {isDm ? 'conversation' : 'channel'}</p>
            )}
          </div>
        </div>

        <div className="p-4">
          <h5 className="text-xs font-display font-bold uppercase tracking-widest text-cyber-chrome-400 mb-3">
            AGENTS ({channelAgents.length})
          </h5>
          <div className="space-y-1">
            {channelAgents.map(a => (
              <div key={a.id} className="flex items-center gap-2 px-2 py-1.5 hover:bg-cyber-elevated transition-colors">
                <div className="w-7 h-7 border border-cyber-green/30 bg-cyber-green/10 font-display font-bold text-2xs flex items-center justify-center text-cyber-green">
                  <Bot size={12} />
                </div>
                <span className="text-sm font-medium text-cyber-chrome-100 truncate">{a.displayName || a.name}</span>
                <span className={`ml-auto w-2 h-2 rounded-full flex-shrink-0 ${activityColors[a.activity || 'offline']}`} />
              </div>
            ))}
            {channelAgents.length === 0 && (
              <p className="text-xs text-cyber-chrome-500 italic font-mono">No agents in this {isDm ? 'conversation' : 'channel'}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
