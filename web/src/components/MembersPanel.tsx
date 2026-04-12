import { X, Search, User, Bot } from 'lucide-react';
import { useState } from 'react';
import { useApp } from '../store/AppContext';

const activityColors: Record<string, string> = {
  thinking: 'bg-nb-yellow animate-pulse',
  working: 'bg-nb-orange animate-pulse',
  online: 'bg-nb-green',
  offline: 'bg-nb-gray-400',
  error: 'bg-nb-red',
};

export default function MembersPanel() {
  const { humans, agents, messages, closeRightPanel } = useApp();
  const [filter, setFilter] = useState('');

  // Derive channel members from message senders
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
    <div className="w-full lg:w-[380px] h-full border-l-0 lg:border-l-3 border-nb-black dark:border-dark-border bg-nb-white dark:bg-dark-surface flex flex-col animate-slide-in-right fixed inset-0 z-30 lg:relative lg:z-auto">
      <div className="h-14 border-b-3 border-nb-black dark:border-dark-border flex items-center justify-between px-4">
        <h3 className="font-display font-extrabold text-base text-nb-black dark:text-dark-text">Members ({totalCount})</h3>
        <button
          onClick={closeRightPanel}
          className="w-8 h-8 border-2 border-nb-gray-200 dark:border-dark-border flex items-center justify-center text-nb-gray-500 hover:border-nb-black dark:hover:border-dark-text hover:text-nb-black dark:hover:text-dark-text hover:bg-nb-gray-100 dark:hover:bg-dark-elevated transition-all"
        >
          <X size={16} />
        </button>
      </div>

      <div className="px-4 py-3 border-b-2 border-nb-gray-200 dark:border-dark-border">
        <div className="flex items-center border-2 border-nb-black dark:border-dark-border bg-nb-white dark:bg-dark-elevated">
          <Search size={14} className="ml-2 text-nb-gray-400" />
          <input
            type="text"
            value={filter}
            onChange={e => setFilter(e.target.value)}
            placeholder="Find members"
            className="w-full px-2 py-1.5 bg-transparent text-sm text-nb-black dark:text-dark-text placeholder:text-nb-gray-400 dark:placeholder:text-dark-muted focus:outline-none"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {filteredHumans.length > 0 && (
          <div className="py-2">
            <div className="px-4 py-1 text-xs font-bold uppercase tracking-wider text-nb-gray-500 dark:text-dark-muted">
              People ({filteredHumans.length})
            </div>
            {filteredHumans.map(h => (
              <div
                key={h.id}
                className="w-full flex items-center gap-3 px-4 py-2 hover:bg-nb-gray-100 dark:hover:bg-dark-elevated transition-colors text-left"
              >
                <div className="w-8 h-8 border-2 border-nb-black dark:border-dark-border font-display font-bold text-xs flex items-center justify-center bg-nb-blue-light">
                  <User size={14} />
                </div>
                <span className="text-sm font-semibold text-nb-black dark:text-dark-text truncate">{h.name}</span>
              </div>
            ))}
          </div>
        )}

        {filteredAgents.length > 0 && (
          <div className="py-2">
            <div className="px-4 py-1 text-xs font-bold uppercase tracking-wider text-nb-gray-500 dark:text-dark-muted">
              Agents ({filteredAgents.length})
            </div>
            {filteredAgents.map(a => (
              <div
                key={a.id}
                className="w-full flex items-center gap-3 px-4 py-2 hover:bg-nb-gray-100 dark:hover:bg-dark-elevated transition-colors text-left"
              >
                <div className="w-8 h-8 border-2 border-nb-black dark:border-dark-border font-display font-bold text-xs flex items-center justify-center bg-nb-yellow-light">
                  <Bot size={14} />
                </div>
                <span className="text-sm font-semibold text-nb-black dark:text-dark-text truncate">{a.displayName || a.name}</span>
                <span className={`ml-auto w-2 h-2 border border-nb-black dark:border-dark-border flex-shrink-0 ${activityColors[a.activity || 'offline']}`} />
              </div>
            ))}
          </div>
        )}

        {filteredHumans.length === 0 && filteredAgents.length === 0 && (
          <div className="px-4 py-8 text-center text-sm text-nb-gray-400 dark:text-dark-muted">
            No members found
          </div>
        )}
      </div>
    </div>
  );
}
