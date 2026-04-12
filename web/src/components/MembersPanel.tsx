import { X, Search, User, Bot } from 'lucide-react';
import { useState } from 'react';
import { useApp } from '../store/AppContext';

const activityColors: Record<string, string> = {
  thinking: 'bg-cyber-yellow animate-pulse',
  working: 'bg-cyber-orange animate-pulse',
  online: 'bg-cyber-green shadow-neon-green',
  offline: 'bg-cyber-chrome-600',
  error: 'bg-cyber-red shadow-neon-red',
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
    <div className="w-[380px] h-full border-l border-cyber-border bg-cyber-surface flex flex-col animate-slide-in-right">
      <div className="h-14 border-b border-cyber-border flex items-center justify-between px-4">
        <h3 className="font-display font-bold text-base text-cyber-chrome-50 tracking-wider">MEMBERS ({totalCount})</h3>
        <button
          onClick={closeRightPanel}
          className="w-8 h-8 border border-cyber-border flex items-center justify-center text-cyber-chrome-400 hover:border-cyber-cyan/30 hover:text-cyber-cyan hover:bg-cyber-elevated transition-all"
        >
          <X size={16} />
        </button>
      </div>

      <div className="px-4 py-3 border-b border-cyber-border">
        <div className="flex items-center border border-cyber-border bg-cyber-void-mid">
          <Search size={14} className="ml-2 text-cyber-chrome-500" />
          <input
            type="text"
            value={filter}
            onChange={e => setFilter(e.target.value)}
            placeholder="Find members"
            className="w-full px-2 py-1.5 bg-transparent text-sm text-cyber-chrome-100 placeholder:text-cyber-chrome-500 focus:outline-none font-mono"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {filteredHumans.length > 0 && (
          <div className="py-2">
            <div className="px-4 py-1 text-xs font-display font-bold uppercase tracking-widest text-cyber-chrome-400">
              PEOPLE ({filteredHumans.length})
            </div>
            {filteredHumans.map(h => (
              <div
                key={h.id}
                className="w-full flex items-center gap-3 px-4 py-2 hover:bg-cyber-elevated transition-colors text-left"
              >
                <div className="w-8 h-8 border border-cyber-cyan/30 bg-cyber-cyan/10 font-display font-bold text-xs flex items-center justify-center text-cyber-cyan">
                  <User size={14} />
                </div>
                <span className="text-sm font-semibold text-cyber-chrome-100 truncate">{h.name}</span>
              </div>
            ))}
          </div>
        )}

        {filteredAgents.length > 0 && (
          <div className="py-2">
            <div className="px-4 py-1 text-xs font-display font-bold uppercase tracking-widest text-cyber-chrome-400">
              AGENTS ({filteredAgents.length})
            </div>
            {filteredAgents.map(a => (
              <div
                key={a.id}
                className="w-full flex items-center gap-3 px-4 py-2 hover:bg-cyber-elevated transition-colors text-left"
              >
                <div className="w-8 h-8 border border-cyber-green/30 bg-cyber-green/10 font-display font-bold text-xs flex items-center justify-center text-cyber-green">
                  <Bot size={14} />
                </div>
                <span className="text-sm font-semibold text-cyber-chrome-100 truncate">{a.displayName || a.name}</span>
                <span className={`ml-auto w-2 h-2 rounded-full flex-shrink-0 ${activityColors[a.activity || 'offline']}`} />
              </div>
            ))}
          </div>
        )}

        {filteredHumans.length === 0 && filteredAgents.length === 0 && (
          <div className="px-4 py-8 text-center text-sm text-cyber-chrome-500 font-mono">
            No members found
          </div>
        )}
      </div>
    </div>
  );
}
