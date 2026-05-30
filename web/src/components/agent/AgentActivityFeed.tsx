import { useEffect, useRef } from 'react';
import { getActivityColor } from '../../lib/activityStatus';
import {
  contextUsageToneClass,
  formatContextUsageLine,
} from '../../lib/contextUsage';
import type { AgentEntry } from '../../types';

function formatEntryTime(timestamp?: string) {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function levelClassName(level?: AgentEntry['level']) {
  switch (level) {
    case 'error':
      return 'bg-nc-red/10 text-nc-red border-nc-red/30';
    case 'warning':
      return 'bg-nc-yellow/10 text-nc-yellow border-nc-yellow/30';
    case 'success':
      return 'bg-nc-green/10 text-nc-green border-nc-green/30';
    default:
      return 'bg-nc-elevated text-nc-muted border-nc-border';
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function truncate(text: string, max = 140) {
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function parseStructuredInput(value: unknown): Record<string, unknown> | null {
  const record = asRecord(value);
  if (record) return record;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return null;
  try {
    return asRecord(JSON.parse(trimmed));
  } catch {
    return null;
  }
}

function formatShellCommand(command: string) {
  const match = command.match(/^\/bin\/(?:zsh|bash|sh)\s+-lc\s+(['"])([\s\S]*)\1$/);
  return truncate(match?.[2] || command, 160);
}

function formatToolInput(entry: AgentEntry) {
  const structured = parseStructuredInput(entry.toolInput)
    || parseStructuredInput(entry.content)
    || parseStructuredInput(entry.toolInputSummary);
  const toolName = (entry.toolName || '').toLowerCase();
  if (structured) {
    const command = structured.command;
    if (typeof command === 'string' && (toolName === 'shell' || toolName === 'bash' || toolName.includes('command'))) {
      return formatShellCommand(command);
    }
    for (const key of ['target', 'channel', 'path', 'file_path', 'query', 'pattern', 'url']) {
      const value = structured[key];
      if (typeof value === 'string' && value) return truncate(value);
    }
    if (typeof command === 'string' && command) return formatShellCommand(command);
  }
  if (typeof entry.toolInputSummary === 'string' && entry.toolInputSummary.trim()) return truncate(entry.toolInputSummary.trim());
  if (typeof entry.content === 'string' && entry.content.trim()) return truncate(entry.content.trim());
  return '';
}

function getEntryClassName(entry: AgentEntry) {
  if (entry.kind === 'context_usage' && entry.contextUsage) {
    return contextUsageToneClass(entry.contextUsage.summary.percent);
  }
  if (entry.kind === 'status') {
    if (entry.activity === 'error') return 'bg-nc-red/10 text-nc-red border-nc-red/30';
    if (entry.activity === 'thinking') return 'bg-nc-yellow/10 text-nc-yellow border-nc-yellow/30';
    if (entry.activity === 'working') return 'bg-nc-green/10 text-nc-green border-nc-green/30';
    if (entry.activity === 'online' || entry.activity === 'idle') return 'bg-nc-green/10 text-nc-green border-nc-green/30';
    if (entry.activity === 'sleep') return 'bg-nc-muted/10 text-nc-muted border-nc-muted/30';
  }
  if (entry.kind === 'tool' || entry.kind === 'tool_start') {
    return 'bg-nc-green/10 text-nc-green border-nc-green/30';
  }
  return levelClassName(entry.level);
}

function renderLegacyEntry(entry: AgentEntry) {
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

function renderHeader(entry: AgentEntry, fallbackTitle: string) {
  const time = formatEntryTime(entry.timestamp);
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="font-semibold text-nc-text-bright">{entry.title || fallbackTitle}</div>
      {time && (
        <div className="text-[10px] uppercase tracking-wide opacity-70">{time}</div>
      )}
    </div>
  );
}

function renderStructuredEntry(entry: AgentEntry) {
  if (entry.kind === 'context_usage' && entry.contextUsage) {
    const snapshot = entry.contextUsage;
    return (
      <div className="space-y-1">
        {renderHeader(entry, 'Context usage')}
        {snapshot.summary && (
          <div className="text-[11px] text-nc-text-bright">
            {snapshot.summary.model} · {formatContextUsageLine(snapshot.summary)}
          </div>
        )}
        {snapshot.models && snapshot.models.length > 1 && (
          <div className="space-y-0.5 text-[10px] opacity-80">
            {snapshot.models.slice(1, 4).map((model) => (
              <div key={model.model}>
                {model.model} · {formatContextUsageLine(model)}
              </div>
            ))}
          </div>
        )}
        {typeof snapshot.totalCostUSD === 'number' && (
          <div className="text-[10px] opacity-70">
            Cost · ${snapshot.totalCostUSD.toFixed(4)}
          </div>
        )}
      </div>
    );
  }

  if (entry.kind === 'tool') {
    const toolInput = formatToolInput(entry);
    return (
      <div className="space-y-1">
        {renderHeader(entry, entry.toolName ? `Tool · ${entry.toolName}` : 'Tool')}
        {toolInput && (
          <div className="text-[11px] whitespace-pre-wrap break-words text-nc-text-bright">
            {toolInput}
          </div>
        )}
      </div>
    );
  }

  if (entry.kind === 'status') {
    return (
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-1.5 font-semibold">
            <span className={`w-1.5 h-1.5 ${getActivityColor(entry.activity)}`} />
            {entry.title || (entry.activity ? entry.activity.toUpperCase() : 'STATUS')}
          </div>
          {formatEntryTime(entry.timestamp) && (
            <div className="text-[10px] uppercase tracking-wide opacity-70">{formatEntryTime(entry.timestamp)}</div>
          )}
        </div>
        {entry.content && (
          <div className="text-[11px] whitespace-pre-wrap break-words text-nc-text-bright">{entry.content}</div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {renderHeader(entry, entry.kind === 'note' ? 'Note' : 'Activity')}
      {entry.content && (
        <div className="text-[11px] whitespace-pre-wrap break-words text-nc-text-bright">{entry.content}</div>
      )}
      {Boolean(entry.meta?.summary) && (
        <div className="text-[10px] opacity-70">{String(entry.meta?.summary)}</div>
      )}
    </div>
  );
}

function isStructuredEntry(entry: AgentEntry) {
  return entry.kind === 'note'
    || entry.kind === 'tool'
    || entry.kind === 'context_usage'
    || !!entry.title
    || !!entry.timestamp
    || !!entry.level;
}

function hasVisibleContent(entry: AgentEntry) {
  if (entry.kind === 'context_usage' && entry.contextUsage) return true;
  if (entry.kind === 'tool' || entry.kind === 'tool_start') return !!entry.toolName;
  if (entry.kind === 'status' && (entry.activity === 'thinking' || entry.activity === 'working') && !entry.content && !entry.text && !entry.detail) return false;
  if (entry.content || entry.text || entry.detail || entry.title) return true;
  if (entry.kind === 'status' && entry.activity && entry.activity !== 'online' && entry.activity !== 'idle') return true;
  return false;
}

export function AgentActivityFeed({
  entries,
  className,
}: {
  entries: AgentEntry[];
  className?: string;
}) {
  const endRef = useRef<HTMLDivElement>(null);
  const visible = entries.filter(hasVisibleContent);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end', behavior: 'auto' });
  }, [visible.length]);

  return (
    <div className={className}>
      {visible.map((entry, index) => (
        <div
          key={index}
          className={`text-xs font-mono px-3 py-2 border ${getEntryClassName(entry)}`}
        >
          {isStructuredEntry(entry) ? renderStructuredEntry(entry) : renderLegacyEntry(entry)}
        </div>
      ))}
      <div ref={endRef} />
    </div>
  );
}
