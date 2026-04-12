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
      <pre key={`code-${parts.length}`} className="bg-cyber-void border border-cyber-border text-cyber-green p-3 my-2 font-mono text-xs overflow-x-auto shadow-cyber-sm">
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
      <span key={`m-${keyOffset}-${m.index}`} className="bg-cyber-cyan/10 text-cyber-cyan font-semibold border border-cyber-cyan/20 px-1 py-0.5 rounded-sm">
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
    case 'todo': return 'bg-cyber-chrome-700 text-cyber-chrome-200';
    case 'in_progress': return 'bg-cyber-cyan/10 text-cyber-cyan';
    case 'in_review': return 'bg-cyber-yellow/10 text-cyber-yellow';
    case 'done': return 'bg-cyber-green/10 text-cyber-green';
    default: return 'bg-cyber-chrome-700 text-cyber-chrome-300';
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

const senderColors = ['#00f0ff', '#ff2e97', '#39ff14', '#f0e040', '#ff6b00', '#ff1744'];
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
      className={`relative group px-5 transition-colors duration-100 ${hovered ? 'bg-cyber-elevated/40' : ''}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {hovered && (
        <div className="absolute -top-3 right-5 flex items-center border border-cyber-border bg-cyber-surface shadow-cyber-sm z-10 animate-fade-in">
          <button
            onClick={() => openThread(message)}
            className="w-7 h-7 flex items-center justify-center text-cyber-chrome-400 hover:bg-cyber-cyan/10 hover:text-cyber-cyan transition-colors"
            title="Reply in thread"
          >
            <MessageSquare size={14} />
          </button>
        </div>
      )}

      <div className={`flex gap-3 ${isGrouped ? 'py-0.5' : 'pt-3 pb-1'}`}>
        {isGrouped ? (
          <div className="w-8 flex-shrink-0 flex items-start justify-center">
            <span className="text-2xs text-cyber-chrome-500 opacity-0 group-hover:opacity-100 transition-opacity pt-0.5 font-mono">
              {timestamp && formatTime(timestamp)}
            </span>
          </div>
        ) : (
          <div
            className="w-8 h-8 border font-display font-bold text-xs flex items-center justify-center select-none flex-shrink-0"
            style={{
              backgroundColor: `${getSenderColor(senderName)}10`,
              borderColor: `${getSenderColor(senderName)}40`,
              color: getSenderColor(senderName),
            }}
          >
            {isAgent ? <Bot size={14} /> : senderName.charAt(0).toUpperCase()}
          </div>
        )}

        <div className="flex-1 min-w-0">
          {!isGrouped && (
            <div className="flex items-baseline gap-2 mb-0.5">
              <span className="font-display font-bold text-sm" style={{ color: getSenderColor(senderName) }}>
                {senderName}
              </span>
              {isAgent && (
                <span className="text-2xs bg-cyber-cyan/10 text-cyber-cyan border border-cyber-cyan/20 px-1 font-bold uppercase tracking-wider font-mono">
                  AGENT
                </span>
              )}
              {timestamp && (
                <span className="text-2xs text-cyber-chrome-500 font-mono">
                  {formatTime(timestamp)}
                </span>
              )}
            </div>
          )}

          <div className="text-sm text-cyber-chrome-200 leading-relaxed whitespace-pre-wrap break-words">
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
                  className="flex items-center gap-1.5 px-2 py-1 border border-cyber-border bg-cyber-elevated text-xs font-mono text-cyber-cyan hover:shadow-cyber-sm transition-shadow"
                >
                  <Paperclip size={12} />
                  {att.filename}
                </a>
              ))}
            </div>
          )}

          {message.task_status && (
            <div className="mt-1.5 flex items-center gap-2 flex-wrap">
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 border border-cyber-border text-xs font-bold uppercase font-mono tracking-wider ${taskStatusStyle(message.task_status)}`}>
                {taskStatusIcon(message.task_status)} #{message.task_number} {message.task_status.replace('_', ' ')}
              </span>
              {message.task_assignee_id && (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 border border-cyber-border text-2xs text-cyber-chrome-400 font-mono">
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
