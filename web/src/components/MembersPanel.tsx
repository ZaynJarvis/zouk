import { X, Search, User, Bot } from 'lucide-react';
import { useState } from 'react';
import { useApp } from '../store/AppContext';

const activityColors: Record<string, string> = {
  thinking: 'bg-nc-yellow animate-pulse',
  working: 'bg-nc-red animate-pulse',
  online: 'bg-nc-green',
  offline: 'bg-nc-muted/30',
  error: 'bg-nc-red',
};

export default function MembersPanel() {
  const { humans, agents, messages, closeRightPanel } = useApp();
  const [filter, setFilter] = useState('');

  const senderNames = new Set(messages.map(m => m.sender_name).filter(Boolean));
  const channelHumans = humans.filter(h => senderNames.has(h.name));
  const channelAgents = agents.filter(a => senderNames.has(a.name) || senderNames.has(a.displayName));

  const filteredHumans = channelHumans.filter(h =>
    h.name.toLowerCase().includes(filter.toLowerCase())
  );
  const filteredAgents = channelAgents.filter(a =>
    (a.displayName || a.name).toLowerCase().includes(filter.toLowerCase())
  );

  const totalCount = channelHumans.length + channelAgents.length;

  return (
    <div className="w-[380px] h-full border-l border-nc-border bg-nc-surface flex flex-col animate-slide-in-right">
      <div className="h-14 border-b border-nc-border flex items-center justify-between px-4">
        <h3 className="font-display font-extrabold text-base text-nc-text-bright tracking-wider">MEMBERS ({totalCount})</h3>
        <button
          onClick={closeRightPanel}
          className="w-8 h-8 border border-nc-border flex items-center justify-center text-nc-muted hover:border-nc-red hover:text-nc-red hover:bg-nc-red/10 transition-all"
        >
          <X size={16} />
        </button>
      </div>

      <div className="px-4 py-3 border-b border-nc-border">
        <div className="flex items-center border border-nc-border bg-nc-panel">
          <Search size={14} className="ml-2 text-nc-muted" />
          <input
            type="text"
            value={filter}
            onChange={e => setFilter(e.target.value)}
            placeholder="Find members"
            className="w-full px-2 py-1.5 bg-transparent text-sm text-nc-text placeholder:text-nc-muted focus:outline-none font-mono"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {filteredHumans.length > 0 && (
          <div className="py-2">
            <div className="px-4 py-1 text-xs font-bold uppercase tracking-wider text-nc-muted font-mono">
              People ({filteredHumans.length})
            </div>
            {filteredHumans.map(h => (
              <div key={h.id} className="w-full flex items-center gap-3 px-4 py-2 hover:bg-nc-elevated transition-colors text-left">
                <div className="w-8 h-8 border border-nc-cyan/30 bg-nc-cyan/10 font-display font-bold text-xs flex items-center justify-center text-nc-cyan">
                  <User size={14} />
                </div>
                <span className="text-sm font-semibold text-nc-text-bright truncate">{h.name}</span>
              </div>
            ))}
          </div>
        )}

        {filteredAgents.length > 0 && (
          <div className="py-2">
            <div className="px-4 py-1 text-xs font-bold uppercase tracking-wider text-nc-muted font-mono">
              Agents ({filteredAgents.length})
            </div>
            {filteredAgents.map(a => (
              <div key={a.id} className="w-full flex items-center gap-3 px-4 py-2 hover:bg-nc-elevated transition-colors text-left">
                <div className="w-8 h-8 border border-nc-green/30 bg-nc-green/10 font-display font-bold text-xs flex items-center justify-center text-nc-green">
                  <Bot size={14} />
                </div>
                <span className="text-sm font-semibold text-nc-text-bright truncate">{a.displayName || a.name}</span>
                <span className={`ml-auto w-2 h-2 flex-shrink-0 ${activityColors[a.activity || 'offline']}`} />
              </div>
            ))}
          </div>
        )}

        {filteredHumans.length === 0 && filteredAgents.length === 0 && (
          <div className="px-4 py-8 text-center text-sm text-nc-muted font-mono">No members found</div>
        )}
      </div>
    </div>
  );
}
