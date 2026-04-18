import { X, Hash, Bot, User } from 'lucide-react';
import { useApp } from '../store/AppContext';

const activityColors: Record<string, string> = {
  thinking: 'bg-nc-yellow animate-pulse',
  working: 'bg-nc-red animate-pulse',
  online: 'bg-nc-green',
  offline: 'bg-nc-muted/30',
  error: 'bg-nc-red',
};

export default function DetailsPanel() {
  const { activeChannelName, closeRightPanel, humans, agents, viewMode } = useApp();
  const onlineHumans = humans;
  const onlineAgents = agents.filter(a => a.status === 'active');
  const isDm = viewMode === 'dm';

  return (
    <div className="w-[380px] h-full border-l border-nc-border bg-nc-surface flex flex-col animate-slide-in-right">
      <div className="h-14 border-b border-nc-border flex items-center justify-between px-4">
        <h3 className="font-display font-extrabold text-base text-nc-text-bright tracking-wider">DETAILS</h3>
        <button
          onClick={closeRightPanel}
          className="w-8 h-8 border border-nc-border flex items-center justify-center text-nc-muted hover:border-nc-red hover:text-nc-red hover:bg-nc-red/10 transition-all"
        >
          <X size={16} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin">
        <div className="p-4 border-b border-nc-border">
          <div className="flex items-center gap-2 mb-2">
            {isDm ? <User size={18} className="text-nc-magenta" /> : <Hash size={18} className="text-nc-cyan" />}
            <h4 className="font-display font-black text-xl text-nc-text-bright tracking-wider">{isDm ? `@${activeChannelName}` : activeChannelName}</h4>
          </div>
        </div>

        <div className="p-4 border-b border-nc-border">
          <h5 className="text-xs font-bold uppercase tracking-wider text-nc-muted mb-3 font-mono">People Online ({onlineHumans.length})</h5>
          <div className="space-y-1">
            {onlineHumans.map(h => (
              <div key={h.id} className="flex items-center gap-2 px-2 py-1.5 hover:bg-nc-elevated transition-colors">
                <div className="w-7 h-7 border border-nc-cyan/30 bg-nc-cyan/10 font-display font-bold text-2xs flex items-center justify-center text-nc-cyan overflow-hidden">
                  {h.picture || h.gravatarUrl ? (
                    <img src={h.picture || h.gravatarUrl} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <User size={12} />
                  )}
                </div>
                <span className="text-sm font-medium text-nc-text-bright truncate">{h.name}</span>
              </div>
            ))}
            {onlineHumans.length === 0 && (
              <p className="text-xs text-nc-muted italic font-mono">No people online</p>
            )}
          </div>
        </div>

        <div className="p-4">
          <h5 className="text-xs font-bold uppercase tracking-wider text-nc-muted mb-3 font-mono">Agents Online ({onlineAgents.length})</h5>
          <div className="space-y-1">
            {onlineAgents.map(a => (
              <div key={a.id} className="flex items-center gap-2 px-2 py-1.5 hover:bg-nc-elevated transition-colors">
                <div className="w-7 h-7 border border-nc-green/30 bg-nc-green/10 font-display font-bold text-2xs flex items-center justify-center text-nc-green overflow-hidden">
                  {a.picture ? (
                    <img src={a.picture} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <Bot size={12} />
                  )}
                </div>
                <span className="text-sm font-medium text-nc-text-bright truncate">{a.displayName || a.name}</span>
                <span className={`ml-auto w-2 h-2 flex-shrink-0 ${activityColors[a.activity || 'offline']}`} />
              </div>
            ))}
            {onlineAgents.length === 0 && (
              <p className="text-xs text-nc-muted italic font-mono">No agents online</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
