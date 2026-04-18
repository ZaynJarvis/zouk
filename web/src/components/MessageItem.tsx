import { Bot, Paperclip } from 'lucide-react';
import { useApp } from '../store/AppContext';
import type { MessageRecord } from '../types';
import { getAttachmentUrl } from '../lib/api';
import { MENTION_TOKEN_REGEX } from '../lib/mentions';
import { ncStyle } from '../lib/themeUtils';

function formatTime(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

// ── Inline renderer: bold, italic, inline-code, @mentions ──────────────────
type MentionSegment = { kind: 'mention'; start: number; end: number; handle: string };
type InlineSegment = { kind: 'inline'; start: number; end: number; raw: string };

function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const segments: (MentionSegment | InlineSegment)[] = [];
  let m: RegExpExecArray | null;

  // Mentions — `new RegExp(source, flags)` replaces the pattern's flags
  // entirely, so we must re-specify `u` or `\p{L}`/`\p{N}` become invalid.
  // The token regex captures a leading boundary (group 1) to avoid matching
  // inside emails; we advance the match start past that boundary so the
  // whitespace stays as normal text.
  const mentionRegexG = new RegExp(MENTION_TOKEN_REGEX.source, 'gu');
  while ((m = mentionRegexG.exec(text)) !== null) {
    const boundary = m[1] ?? '';
    const handle = m[2] ?? '';
    const start = m.index + boundary.length;
    segments.push({ kind: 'mention', start, end: start + 1 + handle.length, handle });
  }

  const inlineRegexG = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|__[^_]+__|_[^_]+_)/g;
  while ((m = inlineRegexG.exec(text)) !== null) {
    const raw = m[0];
    const start = m.index;
    const end = start + raw.length;
    const overlaps = segments.some(s => start < s.end && end > s.start);
    if (!overlaps) segments.push({ kind: 'inline', start, end, raw });
  }
  segments.sort((a, b) => a.start - b.start);

  const nodes: React.ReactNode[] = [];
  let cursor = 0;

  for (const seg of segments) {
    if (seg.start > cursor) {
      nodes.push(<span key={`${keyPrefix}-t-${cursor}`}>{text.slice(cursor, seg.start)}</span>);
    }
    if (seg.kind === 'mention') {
      nodes.push(
        <span key={`${keyPrefix}-m-${seg.start}`} className="bg-nc-cyan/10 text-nc-cyan font-semibold border border-nc-cyan/30 px-1 py-0.5 rounded-sm">
          @{seg.handle}
        </span>
      );
    } else {
      const raw = seg.raw;
      if (raw.startsWith('`')) {
        nodes.push(
          <code key={`${keyPrefix}-ic-${seg.start}`} className="bg-nc-black border border-nc-green/40 text-nc-green px-1.5 py-0.5 font-mono text-[0.8em] rounded-sm" style={ncStyle({ textShadow: '0 0 4px rgb(var(--nc-green) / 0.25)' })}>
            {raw.slice(1, -1)}
          </code>
        );
      } else if (raw.startsWith('**') || raw.startsWith('__')) {
        nodes.push(<strong key={`${keyPrefix}-b-${seg.start}`} className="font-bold text-nc-text-bright">{raw.slice(2, -2)}</strong>);
      } else if (raw.startsWith('*') || raw.startsWith('_')) {
        nodes.push(<em key={`${keyPrefix}-i-${seg.start}`} className="italic">{raw.slice(1, -1)}</em>);
      } else {
        nodes.push(<span key={`${keyPrefix}-r-${seg.start}`}>{raw}</span>);
      }
    }
    cursor = seg.end;
  }
  if (cursor < text.length) {
    nodes.push(<span key={`${keyPrefix}-tail`}>{text.slice(cursor)}</span>);
  }
  return nodes;
}

// ── Block-level markdown parser ─────────────────────────────────────────────
function parseMarkdown(content: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let key = 0;

  // Split into code-block segments and prose segments
  const codeBlockRegex = /```(\w*)\n?([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = codeBlockRegex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(...parseBlocks(content.slice(lastIndex, match.index), key));
      key += 100;
    }
    const lang = match[1] || '';
    const code = match[2].trim();
    nodes.push(
      <pre key={`cb-${key++}`} className="relative bg-nc-black border border-nc-green/25 rounded-sm my-3 overflow-x-auto max-w-full group">
        {lang && (
          <div className="px-3 pt-1.5 pb-0 text-2xs font-mono text-nc-green/50 border-b border-nc-green/15 uppercase tracking-widest">
            {lang}
          </div>
        )}
        <code className="block px-3 py-2.5 font-mono text-xs text-nc-green leading-relaxed whitespace-pre" style={ncStyle({ textShadow: '0 0 5px rgb(var(--nc-green) / 0.25)' })}>
          {code}
        </code>
      </pre>
    );
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < content.length) {
    nodes.push(...parseBlocks(content.slice(lastIndex), key));
  }

  return nodes;
}

function parseBlocks(text: string, keyBase: number): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  // Normalise line endings, split into lines
  const lines = text.split('\n');
  let i = 0;
  let k = keyBase;

  while (i < lines.length) {
    const line = lines[i];

    // Blank line
    if (line.trim() === '') {
      i++;
      continue;
    }

    // ATX headers
    const hMatch = line.match(/^(#{1,3})\s+(.*)/);
    if (hMatch) {
      const level = hMatch[1].length;
      const cls = level === 1
        ? 'font-display font-black text-xl text-nc-text-bright mt-4 mb-2 tracking-wide'
        : level === 2
          ? 'font-display font-bold text-lg text-nc-text-bright mt-3 mb-1.5'
          : 'font-display font-semibold text-base text-nc-text-bright mt-2 mb-1';
      nodes.push(
        <div key={`h-${k++}`} className={cls}>
          {renderInline(hMatch[2], `h-${k}`)}
        </div>
      );
      i++;
      continue;
    }

    // Blockquote
    if (line.startsWith('> ')) {
      const bqLines: string[] = [];
      while (i < lines.length && lines[i].startsWith('> ')) {
        bqLines.push(lines[i].slice(2));
        i++;
      }
      nodes.push(
        <blockquote key={`bq-${k++}`} className="border-l-2 border-nc-cyan/50 pl-3 my-2 text-nc-muted italic">
          {bqLines.map((l, idx) => (
            <p key={idx} className="my-0.5">{renderInline(l, `bq-${k}-${idx}`)}</p>
          ))}
        </blockquote>
      );
      continue;
    }

    // Horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
      nodes.push(<hr key={`hr-${k++}`} className="border-t border-nc-border my-3" />);
      i++;
      continue;
    }

    // Unordered list
    if (/^[-*+] /.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*+] /.test(lines[i])) {
        items.push(lines[i].slice(2));
        i++;
      }
      nodes.push(
        <ul key={`ul-${k++}`} className="my-2 space-y-1 pl-4">
          {items.map((item, idx) => (
            <li key={idx} className="flex gap-2 text-sm text-nc-text leading-relaxed">
              <span className="text-nc-cyan flex-shrink-0 mt-0.5">·</span>
              <span>{renderInline(item, `ul-${k}-${idx}`)}</span>
            </li>
          ))}
        </ul>
      );
      continue;
    }

    // Ordered list
    if (/^\d+\. /.test(line)) {
      const items: string[] = [];
      let num = 1;
      while (i < lines.length && /^\d+\. /.test(lines[i])) {
        items.push(lines[i].replace(/^\d+\. /, ''));
        i++;
        num++;
      }
      nodes.push(
        <ol key={`ol-${k++}`} className="my-2 space-y-1 pl-4">
          {items.map((item, idx) => (
            <li key={idx} className="flex gap-2 text-sm text-nc-text leading-relaxed">
              <span className="text-nc-cyan font-mono text-xs flex-shrink-0 mt-0.5 min-w-[1.2em]">{idx + 1}.</span>
              <span>{renderInline(item, `ol-${k}-${idx}`)}</span>
            </li>
          ))}
        </ol>
      );
      continue;
    }

    // Paragraph — collect consecutive non-special lines
    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !lines[i].match(/^#{1,3}\s/) &&
      !lines[i].startsWith('> ') &&
      !/^[-*+] /.test(lines[i]) &&
      !/^\d+\. /.test(lines[i]) &&
      !/^(-{3,}|\*{3,}|_{3,})$/.test(lines[i].trim())
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    if (paraLines.length > 0) {
      const paraText = paraLines.join('\n');
      nodes.push(
        <p key={`p-${k++}`} className="text-sm text-nc-text leading-[1.75] my-1 whitespace-pre-wrap break-words" style={{ fontFamily: 'var(--nc-font-message)' }}>
          {renderInline(paraText, `p-${k}`)}
        </p>
      );
    }
  }

  return nodes;
}

// ── Task badge helpers ───────────────────────────────────────────────────────
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

// ── Sender colour ────────────────────────────────────────────────────────────
const senderColorVars = ['--nc-cyan', '--nc-red', '--nc-green', '--nc-magenta', '--nc-yellow', '--nc-indigo'];
function getSenderColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return `rgb(var(${senderColorVars[Math.abs(hash) % senderColorVars.length]}))`;
}

// ── Component ────────────────────────────────────────────────────────────────
export default function MessageItem({ message, isGrouped = false }: { message: MessageRecord; isGrouped?: boolean }) {
  const { humans, agents } = useApp();
  const senderName = message.sender_name || 'Unknown';
  const isAgent = message.sender_type === 'agent';
  const isSystem = message.sender_type === 'system';
  const senderHuman = !isAgent && !isSystem ? humans.find(h => h.name === senderName) : undefined;
  const senderAgent = isAgent ? agents.find(a => a.name === senderName || a.displayName === senderName) : undefined;
  const senderPicture = senderHuman?.picture || senderHuman?.gravatarUrl || senderAgent?.picture;
  const timestamp = message.timestamp || '';
  const color = getSenderColor(senderName);

  // System messages — compact, muted, centred
  if (isSystem) {
    return (
      <div className="flex items-center gap-3 px-5 py-1">
        <div className="flex-1 border-t border-nc-border/40" />
        <span className="text-2xs font-mono text-nc-muted/60 px-2 text-center whitespace-nowrap">
          {message.content}
        </span>
        <div className="flex-1 border-t border-nc-border/40" />
      </div>
    );
  }

  return (
    <div className="group relative px-4 sm:px-6 hover:bg-nc-elevated/40 transition-colors duration-100 overflow-hidden">
      <div className={`flex gap-3 sm:gap-4 ${isGrouped ? 'py-0.5' : 'pt-4 pb-1'}`}>
        {/* Avatar column */}
        {isGrouped ? (
          <div className="w-8 sm:w-9 flex-shrink-0 flex items-start justify-center">
            <span className="text-2xs text-nc-muted opacity-0 group-hover:opacity-100 transition-opacity pt-0.5 font-mono tabular-nums">
              {timestamp && formatTime(timestamp)}
            </span>
          </div>
        ) : (
          <div
            className="w-8 h-8 sm:w-9 sm:h-9 border font-display font-bold text-xs flex items-center justify-center select-none flex-shrink-0 mt-0.5 overflow-hidden"
            style={{
              borderColor: `${color}55`,
              backgroundColor: `${color}12`,
              color,
              boxShadow: isAgent ? `0 0 10px ${color}18` : undefined,
            }}
          >
            {senderPicture ? (
              <img src={senderPicture} alt="" className="w-full h-full object-cover" />
            ) : isAgent ? <Bot size={15} /> : senderName.charAt(0).toUpperCase()}
          </div>
        )}

        {/* Message body */}
        <div className="flex-1 min-w-0">
          {!isGrouped && (
            <div className="flex items-baseline gap-2 mb-1">
              <span className="font-display font-bold text-sm leading-none" style={{ color }}>
                {senderName}
              </span>
              {isAgent && (
                <span className="text-2xs bg-nc-green/10 text-nc-green border border-nc-green/30 px-1 py-0.5 font-bold uppercase font-mono leading-none">
                  Agent
                </span>
              )}
              {timestamp && (
                <span className="text-2xs text-nc-muted font-mono tabular-nums">
                  {formatTime(timestamp)}
                </span>
              )}
            </div>
          )}

          {/* Rendered content */}
          <div className="min-w-0">
            {message.content ? parseMarkdown(message.content) : null}
          </div>

          {/* Attachments */}
          {message.attachments && message.attachments.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-2">
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

          {/* Task badge */}
          {message.task_status && (
            <div className="mt-2 flex items-center gap-2 flex-wrap">
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
