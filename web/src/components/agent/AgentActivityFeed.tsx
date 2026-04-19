import { getActivityColor } from '../../lib/activityStatus';
import type { AgentEntry } from '../../types';

function getEntryClassName(entry: AgentEntry) {
  if (entry.kind === 'status') {
    return 'bg-nc-cyan/5 text-nc-cyan border-nc-cyan/20';
  }
  if (entry.kind === 'thinking') {
    return 'bg-nc-yellow/5 text-nc-yellow border-nc-yellow/20';
  }
  if (entry.kind === 'tool_start') {
    return 'bg-nc-green/5 text-nc-green border-nc-green/20';
  }
  return 'bg-nc-elevated text-nc-muted border-nc-border';
}

function renderEntry(entry: AgentEntry) {
  if (entry.kind === 'status') {
    return (
      <span className="flex items-center gap-1.5">
        <span className={`w-1.5 h-1.5 ${getActivityColor(entry.activity)}`} />
        [{entry.activity}] {entry.detail || ''}
      </span>
    );
  }
  if (entry.kind === 'thinking') {
    return <span>THINKING: {entry.text || ''}</span>;
  }
  if (entry.kind === 'tool_start') {
    return <span>TOOL: {entry.toolName}</span>;
  }
  return <span>{entry.text}</span>;
}

export function AgentActivityFeed({
  entries,
  className,
}: {
  entries: AgentEntry[];
  className?: string;
}) {
  return (
    <div className={className}>
      {entries.map((entry, index) => (
        <div
          key={index}
          className={`text-xs font-mono px-3 py-1.5 border ${getEntryClassName(entry)}`}
        >
          {renderEntry(entry)}
        </div>
      ))}
    </div>
  );
}
