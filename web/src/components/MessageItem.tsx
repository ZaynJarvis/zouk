import { useState } from 'react';
import { MessageSquare, Bot, Paperclip } from 'lucide-react';
import { useApp } from '../store/AppContext';
import type { MessageRecord } from '../types';
import { getAttachmentUrl } from '../lib/api';
import { ncStyle } from '../lib/themeUtils';

function formatTime(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

function parseMessageContent(content: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const codeBlockRegex = /```([\s\S]*?)```/g;
  let lastIndex = 0;
  let match;

  while ((match = codeBlockRegex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      parts.push(...parseInlineContent(content.slice(lastIndex, match.index), parts.length));
    }
    parts.push(
      <pre key={`code-${parts.length}`} className="bg-nc-black border border-nc-green/30 text-nc-green p-3 my-2 font-mono text-xs overflow-x-auto" style={ncStyle({ textShadow: '0 0 5px rgb(var(--nc-green) / 0.3)' })}>
        <code>{match[1].trim()}</code>
      </pre>
    );
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < content.length) {
    parts.push(...parseInlineContent(content.slice(lastIndex), parts.length));
  }

  return parts;
}

function parseInlineContent(text: string, keyOffset: number): React.ReactNode[] {
  const mentionRegex = /@([\w-]+)/g;
  const parts: React.ReactNode[] = [];
  let lastIdx = 0;
  let m;

  while ((m = mentionRegex.exec(text)) !== null) {
    if (m.index > lastIdx) {
      parts.push(<span key={`t-${keyOffset}-${lastIdx}`}>{text.slice(lastIdx, m.index)}</span>);
    }
    parts.push(
      <span key={`m-${keyOffset}-${m.index}`} className="bg-nc-cyan/10 text-nc-cyan font-semibold border border-nc-cyan/30 px-1 py-0.5">
        @{m[1]}
      </span>
    );
    lastIdx = m.index + m[0].length;
  }

  if (lastIdx < text.length) {
    parts.push(<span key={`t-${keyOffset}-${lastIdx}`}>{text.slice(lastIdx)}</span>);
  }

  return parts;
}

function taskStatusStyle(status: string): string {
  switch (status) {
    case 'todo': return 'bg-nc-elevated border-nc-border text-nc-muted';
    case 'in_progress': return 'bg-nc-cyan/10 border-nc-cyan/30 text-nc-cyan';
    case 'in_review': return 'bg-nc-yellow/10 border-nc-yellow/30 text-nc-yellow';
    case 'done': return 'bg-nc-green/10 border-nc-green/30 text-nc-green';
    default: return 'bg-nc-elevated border-nc-border text-nc-muted';
  }
}

function taskStatusIcon(status: string): string {
  switch (status) {
    case 'todo': return '\u25CB';
    case 'in_progress': return '\u25D1';
    case 'in_review': return '\u25D4';
    case 'done': return '\u25CF';
    default: return '\u25CB';
  }
}

const senderColorVars = ['--nc-cyan', '--nc-red', '--nc-green', '--nc-magenta', '--nc-yellow', '--nc-indigo'];
function getSenderColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return `rgb(var(${senderColorVars[Math.abs(hash) % senderColorVars.length]}))`;
}

export default function MessageItem({ message, isGrouped = false }: { message: MessageRecord; isGrouped?: boolean }) {
  const { openThread } = useApp();
  const [hovered, setHovered] = useState(false);
  const senderName = message.sender_name || 'Unknown';
  const isAgent = message.sender_type === 'agent';
  const timestamp = message.timestamp || '';
  const color = getSenderColor(senderName);

  return (
    <div
      className={`relative group px-5 transition-colors duration-100 ${hovered ? 'bg-nc-elevated/50' : ''}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {hovered && (
        <div className="absolute -top-3 right-5 flex items-center border border-nc-border bg-nc-surface z-10 animate-fade-in">
          <button
            onClick={() => openThread(message)}
            className="w-7 h-7 flex items-center justify-center text-nc-muted hover:bg-nc-cyan/15 hover:text-nc-cyan transition-colors"
            title="Reply in thread"
          >
            <MessageSquare size={14} />
          </button>
        </div>
      )}

      <div className={`flex gap-3 ${isGrouped ? 'py-0.5' : 'pt-3 pb-1'}`}>
        {isGrouped ? (
          <div className="w-8 flex-shrink-0 flex items-start justify-center">
            <span className="text-2xs text-nc-muted opacity-0 group-hover:opacity-100 transition-opacity pt-0.5 font-mono">
              {timestamp && formatTime(timestamp)}
            </span>
          </div>
        ) : (
          <div
            className="w-8 h-8 border font-display font-bold text-xs flex items-center justify-center select-none flex-shrink-0"
            style={{
              borderColor: `${color}66`,
              backgroundColor: `${color}15`,
              color: color,
              boxShadow: `0 0 8px ${color}20`,
            }}
          >
            {isAgent ? <Bot size={14} /> : senderName.charAt(0).toUpperCase()}
          </div>
        )}

        <div className="flex-1 min-w-0">
          {!isGrouped && (
            <div className="flex items-baseline gap-2 mb-0.5">
              <span className="font-display font-bold text-sm" style={{ color }}>
                {senderName}
              </span>
              {isAgent && (
                <span className="text-2xs bg-nc-green/10 text-nc-green border border-nc-green/30 px-1 font-bold uppercase font-mono">
                  Agent
                </span>
              )}
              {timestamp && (
                <span className="text-2xs text-nc-muted font-mono">
                  {formatTime(timestamp)}
                </span>
              )}
            </div>
          )}

          <div className="text-sm text-nc-text leading-relaxed whitespace-pre-wrap break-words">
            {message.content ? parseMessageContent(message.content) : ''}
          </div>

          {message.attachments && message.attachments.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-1.5">
              {message.attachments.map(att => (
                <a
                  key={att.id}
                  href={getAttachmentUrl(att.id)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 px-2 py-1 border border-nc-cyan/30 bg-nc-cyan/5 text-xs font-medium text-nc-cyan hover:bg-nc-cyan/10 transition-colors"
                >
                  <Paperclip size={12} />
                  {att.filename}
                </a>
              ))}
            </div>
          )}

          {message.task_status && (
            <div className="mt-1.5 flex items-center gap-2 flex-wrap">
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 border text-xs font-bold uppercase font-mono ${taskStatusStyle(message.task_status)}`}>
                {taskStatusIcon(message.task_status)} #{message.task_number} {message.task_status.replace('_', ' ')}
              </span>
              {message.task_assignee_id && (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 border border-nc-border text-2xs text-nc-muted font-mono">
                  &rarr; @{message.task_assignee_id}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
