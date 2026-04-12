import { useState } from 'react';
import { MessageSquare, Bot, Paperclip } from 'lucide-react';
import { useApp } from '../store/AppContext';
import type { MessageRecord } from '../types';
import { getAttachmentUrl } from '../lib/api';

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
      <pre key={`code-${parts.length}`} className="bg-nb-gray-800 dark:bg-dark-bg text-nb-green border-2 border-nb-black dark:border-dark-border p-3 my-2 font-mono text-xs overflow-x-auto shadow-nb-sm">
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
      <span key={`m-${keyOffset}-${m.index}`} className="bg-nb-blue/10 dark:bg-nb-blue/20 text-nb-blue dark:text-nb-blue font-semibold border border-nb-blue/30 px-1 py-0.5 rounded">
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
    case 'todo': return 'bg-nb-gray-100 dark:bg-dark-elevated text-nb-gray-700 dark:text-dark-muted';
    case 'in_progress': return 'bg-nb-blue-light text-nb-blue';
    case 'in_review': return 'bg-nb-yellow-light text-nb-black';
    case 'done': return 'bg-nb-green/20 text-nb-green-dark';
    default: return 'bg-nb-gray-100 text-nb-gray-700';
  }
}

function taskStatusIcon(status: string): string {
  switch (status) {
    case 'todo': return '○';
    case 'in_progress': return '◑';
    case 'in_review': return '◔';
    case 'done': return '●';
    default: return '○';
  }
}

const senderColors = ['#FFD700', '#0066FF', '#00CC66', '#FF3366', '#FF6B00', '#E53E3E'];
function getSenderColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return senderColors[Math.abs(hash) % senderColors.length];
}

export default function MessageItem({ message, isGrouped = false }: { message: MessageRecord; isGrouped?: boolean }) {
  const { openThread } = useApp();
  const [hovered, setHovered] = useState(false);
  const senderName = message.sender_name || 'Unknown';
  const isAgent = message.sender_type === 'agent';
  const timestamp = message.timestamp || '';

  return (
    <div
      data-component="message-item"
      className={`relative group px-5 transition-colors duration-75 ${hovered ? 'bg-nb-yellow-light/30 dark:bg-dark-elevated/50' : ''}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {hovered && (
        <div className="absolute -top-3 right-5 flex items-center border-2 border-nb-black dark:border-dark-border bg-nb-white dark:bg-dark-surface shadow-nb-sm z-10 animate-fade-in">
          <button
            onClick={() => openThread(message)}
            className="w-7 h-7 flex items-center justify-center text-nb-gray-500 hover:bg-nb-blue hover:text-nb-white transition-colors"
            title="Reply in thread"
          >
            <MessageSquare size={14} />
          </button>
        </div>
      )}

      <div className={`flex gap-3 ${isGrouped ? 'py-0.5' : 'pt-3 pb-1'}`}>
        {isGrouped ? (
          <div className="w-8 flex-shrink-0 flex items-start justify-center">
            <span className="text-2xs text-nb-gray-400 dark:text-dark-muted opacity-0 group-hover:opacity-100 transition-opacity pt-0.5">
              {timestamp && formatTime(timestamp)}
            </span>
          </div>
        ) : (
          <div
            className="w-8 h-8 border-2 border-nb-black dark:border-dark-border font-display font-bold text-xs flex items-center justify-center select-none flex-shrink-0"
            style={{ backgroundColor: getSenderColor(senderName) }}
          >
            {isAgent ? <Bot size={14} /> : senderName.charAt(0).toUpperCase()}
          </div>
        )}

        <div className="flex-1 min-w-0">
          {!isGrouped && (
            <div className="flex items-baseline gap-2 mb-0.5">
              <span className="font-display font-bold text-sm text-nb-black dark:text-dark-text">
                {senderName}
              </span>
              {isAgent && (
                <span className="text-2xs bg-nb-blue-light dark:bg-dark-elevated text-nb-blue border border-nb-blue/30 px-1 font-bold uppercase">
                  Agent
                </span>
              )}
              {timestamp && (
                <span className="text-2xs text-nb-gray-400 dark:text-dark-muted">
                  {formatTime(timestamp)}
                </span>
              )}
            </div>
          )}

          <div className="text-sm text-nb-gray-700 dark:text-dark-text leading-relaxed whitespace-pre-wrap break-words">
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
                  className="flex items-center gap-1.5 px-2 py-1 border-2 border-nb-black dark:border-dark-border bg-nb-gray-100 dark:bg-dark-elevated text-xs font-medium text-nb-blue hover:shadow-nb-sm transition-shadow"
                >
                  <Paperclip size={12} />
                  {att.filename}
                </a>
              ))}
            </div>
          )}

          {message.task_status && (
            <div className="mt-1.5 flex items-center gap-2 flex-wrap">
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 border-2 border-nb-black dark:border-dark-border text-xs font-bold uppercase ${taskStatusStyle(message.task_status)}`}>
                {taskStatusIcon(message.task_status)} #{message.task_number} {message.task_status.replace('_', ' ')}
              </span>
              {message.task_assignee_id && (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 border border-nb-gray-300 dark:border-dark-border text-2xs text-nb-gray-600 dark:text-dark-muted font-medium">
                  → @{message.task_assignee_id}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
