import { useState, useSyncExternalStore } from 'react';
import { Bot, MessageSquare, Paperclip } from 'lucide-react';
import { useApp } from '../store/AppContext';
import type { MessageRecord } from '../types';
import { getAttachmentUrl } from '../lib/api';
import { MENTION_TOKEN_REGEX } from '../lib/mentions';
import { highlightCode } from '../lib/highlight';
import { getStoredLinkTransforms, subscribeLinkTransforms, type LinkTransformRule } from '../store/storage';
import StatusDot from './StatusDot';
import { agentStatus } from '../lib/avatarStatus';
import ImageLightbox from './ImageLightbox';
import FailableImage from './FailableImage';

// Treat an attachment as an image if the server provided a content type (the
// canonical signal) or, as a fallback for pre-feature messages, by extension.
function isImageAttachment(att: { filename: string; contentType?: string }): boolean {
  if (att.contentType?.startsWith('image/')) return true;
  return /\.(png|jpe?g|gif|webp|avif|heic|heif|bmp|svg)$/i.test(att.filename || '');
}

function formatTime(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

// ── Inline renderer: bold, italic, inline-code, @mentions, URLs ────────────
type MentionSegment = { kind: 'mention'; start: number; end: number; handle: string };
type InlineSegment = { kind: 'inline'; start: number; end: number; raw: string };
type LinkSegment = { kind: 'link'; start: number; end: number; href: string; display: string };

// Trailing punctuation is often sentence punctuation, not part of the URL.
function stripTrailingPunct(url: string): { url: string; trail: string } {
  const m = url.match(/^(.*?)([.,;:!?)]+)$/);
  if (!m) return { url, trail: '' };
  return { url: m[1], trail: m[2] };
}

function applyLinkTransforms(url: string, rules: LinkTransformRule[]): string {
  for (const rule of rules) {
    try {
      const re = new RegExp(rule.pattern);
      if (re.test(url)) return url.replace(re, rule.replacement);
    } catch {
      // Invalid pattern — skip.
    }
  }
  return url;
}

function renderInline(text: string, keyPrefix: string, linkRules: LinkTransformRule[]): React.ReactNode[] {
  const segments: (MentionSegment | InlineSegment | LinkSegment)[] = [];
  let m: RegExpExecArray | null;

  // URLs first so subsequent inline regexes don't chew up chars inside the
  // URL (e.g. underscores, asterisks in query strings).
  const urlRegexG = /\bhttps?:\/\/[^\s<>`"]+/g;
  while ((m = urlRegexG.exec(text)) !== null) {
    const raw = m[0];
    const { url, trail } = stripTrailingPunct(raw);
    const start = m.index;
    const end = start + url.length;
    const display = applyLinkTransforms(url, linkRules);
    segments.push({ kind: 'link', start, end, href: url, display });
    urlRegexG.lastIndex = end + trail.length;
  }

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
    const end = start + 1 + handle.length;
    if (segments.some(s => start < s.end && end > s.start)) continue;
    segments.push({ kind: 'mention', start, end, handle });
  }

  // Order matters: longer/specific tokens first so `**` isn't eaten by `*`.
  const inlineRegexG = /(`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|~~[^~]+~~|\*[^*\s][^*]*\*|_[^_\s][^_]*_)/g;
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
        <span key={`${keyPrefix}-m-${seg.start}`} className="text-nc-cyan font-semibold">
          @{seg.handle}
        </span>
      );
    } else if (seg.kind === 'link') {
      nodes.push(
        <a
          key={`${keyPrefix}-l-${seg.start}`}
          href={seg.href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-nc-cyan hover:underline break-all"
        >
          {seg.display}
        </a>
      );
    } else {
      const raw = seg.raw;
      if (raw.startsWith('`')) {
        nodes.push(
          <code key={`${keyPrefix}-ic-${seg.start}`} className="bg-nc-green/10 text-nc-text-bright px-[2px] py-px font-mono text-[0.88em] rounded-sm">
            {raw.slice(1, -1)}
          </code>
        );
      } else if (raw.startsWith('**') || raw.startsWith('__')) {
        nodes.push(<strong key={`${keyPrefix}-b-${seg.start}`} className="font-extrabold text-nc-text-bright">{raw.slice(2, -2)}</strong>);
      } else if (raw.startsWith('~~')) {
        nodes.push(<span key={`${keyPrefix}-s-${seg.start}`} className="line-through text-nc-muted">{raw.slice(2, -2)}</span>);
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
function parseMarkdown(content: string, linkRules: LinkTransformRule[]): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let key = 0;

  // Split into code-block segments and prose segments
  const codeBlockRegex = /```(\w*)\n?([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = codeBlockRegex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(...parseBlocks(content.slice(lastIndex, match.index), key, linkRules));
      key += 100;
    }
    const lang = match[1] || '';
    const code = match[2].trim();
    const highlighted = highlightCode(code, lang);
    nodes.push(
      <div key={`cb-${key++}`} className="relative my-3 border border-nc-green/25 rounded-sm bg-nc-black overflow-hidden">
        {lang && (
          <div className="px-3 pt-1.5 pb-0 text-[0.7em] font-mono text-nc-green/70 border-b border-nc-green/15 uppercase tracking-widest">
            {lang}
          </div>
        )}
        <pre className="overflow-x-auto max-w-full">
          {highlighted ? (
            <code
              className="hljs block px-2.5 sm:px-3 py-2.5 font-mono text-[0.82em] sm:text-[0.88em] leading-[1.6] text-nc-text-bright whitespace-pre"
              dangerouslySetInnerHTML={{ __html: highlighted }}
            />
          ) : (
            <code className="block px-2.5 sm:px-3 py-2.5 font-mono text-[0.82em] sm:text-[0.88em] leading-[1.6] text-nc-text-bright whitespace-pre">
              {code}
            </code>
          )}
        </pre>
        <div
          aria-hidden="true"
          className="pointer-events-none absolute top-0 bottom-0 right-0 w-6"
          style={{ background: 'linear-gradient(to left, rgb(var(--nc-black)) 20%, transparent)' }}
        />
      </div>
    );
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < content.length) {
    nodes.push(...parseBlocks(content.slice(lastIndex), key, linkRules));
  }

  return nodes;
}

// ── GFM pipe-table helpers ──────────────────────────────────────────────────
// Split a pipe-table row into trimmed cells. Leading/trailing pipes are
// optional; `\|` stays literal inside a cell.
function splitPipeRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const cells: string[] = [];
  let buf = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && s[i + 1] === '|') { buf += '|'; i++; }
    else if (s[i] === '|') { cells.push(buf.trim()); buf = ''; }
    else buf += s[i];
  }
  cells.push(buf.trim());
  return cells;
}

function isDelimiterRow(line: string): boolean {
  if (!line.includes('|') && !line.includes('-')) return false;
  const cells = splitPipeRow(line);
  if (cells.length === 0) return false;
  return cells.every(c => /^:?-+:?$/.test(c));
}

type TableAlign = 'left' | 'center' | 'right' | undefined;
function alignFromCell(cell: string): TableAlign {
  const left = cell.startsWith(':');
  const right = cell.endsWith(':');
  if (left && right) return 'center';
  if (right) return 'right';
  if (left) return 'left';
  return undefined;
}

function isTableStart(lines: string[], i: number): boolean {
  return (
    i + 1 < lines.length &&
    lines[i].includes('|') &&
    isDelimiterRow(lines[i + 1])
  );
}

function parseBlocks(text: string, keyBase: number, linkRules: LinkTransformRule[]): React.ReactNode[] {
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

    // ATX headers — support h1–h6 so `####+` never leaks raw to the reader.
    // Sizes use `em` so the whole scale rides on .msg-body's font-size,
    // guaranteeing headings are always larger than body regardless of the
    // user's font-size preference (small/medium/large).
    const hMatch = line.match(/^(#{1,6})\s+(.*)/);
    if (hMatch) {
      const level = hMatch[1].length;
      const sizeByLevel = ['1.5em', '1.3em', '1.15em', '1.05em', '1em', '1em'];
      const weightByLevel = ['900', '800', '700', '700', '700', '700'];
      const marginByLevel = ['1.4em 0 0.65em', '1.25em 0 0.6em', '1.1em 0 0.6em', '0.95em 0 0.55em', '0.8em 0 0.5em', '0.8em 0 0.5em'];
      nodes.push(
        <div
          key={`h-${k++}`}
          className="font-display text-nc-text-bright tracking-wide"
          style={{
            fontSize: sizeByLevel[level - 1],
            fontWeight: weightByLevel[level - 1] as unknown as number,
            lineHeight: 1.3,
            margin: marginByLevel[level - 1],
          }}
        >
          {renderInline(hMatch[2], `h-${k}`, linkRules)}
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
        <blockquote key={`bq-${k++}`} className="border-l-[3px] border-nc-cyan/60 bg-nc-cyan/[0.04] pl-3 pr-2 py-1.5 my-2 text-nc-muted rounded-r-sm" style={{ lineHeight: 1.55 }}>
          {bqLines.map((l, idx) => (
            <p key={idx} className="my-0.5">{renderInline(l, `bq-${k}-${idx}`, linkRules)}</p>
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

    // Unordered list — supports one level of nesting via 2-space indent.
    // A single blank line between items keeps them in the same list; two
    // consecutive blank lines (or a non-list line) end the list.
    const isUlLine = (s: string) => /^[-*+] /.test(s) || /^ {2,}[-*+] /.test(s);
    if (isUlLine(line)) {
      type ListItem = { depth: 0 | 1; text: string };
      const items: ListItem[] = [];
      while (i < lines.length) {
        const cur = lines[i];
        if (isUlLine(cur)) {
          const nested = /^ {2,}[-*+] /.test(cur);
          items.push({ depth: nested ? 1 : 0, text: cur.replace(/^ {2,}[-*+] |^[-*+] /, '') });
          i++;
          continue;
        }
        if (cur.trim() === '' && i + 1 < lines.length && isUlLine(lines[i + 1])) {
          i++;
          continue;
        }
        break;
      }
      nodes.push(
        <ul key={`ul-${k++}`} className="my-1.5 pl-1" style={{ lineHeight: 1.55 }}>
          {items.map((item, idx) => (
            <li
              key={idx}
              className="flex gap-2 text-nc-text"
              style={{ paddingLeft: `${item.depth * 1.1}em` }}
            >
              <span className="text-nc-cyan flex-shrink-0 select-none" aria-hidden="true" style={{ width: '0.9em', textAlign: 'center' }}>
                {item.depth === 0 ? '•' : '▸'}
              </span>
              <span className="flex-1">{renderInline(item.text, `ul-${k}-${idx}`, linkRules)}</span>
            </li>
          ))}
        </ul>
      );
      continue;
    }

    // Ordered list — preserves authored numbering, and a single blank line
    // between items does not split the list into two <ol>s.
    if (/^\d+\. /.test(line)) {
      const items: { num: number; text: string }[] = [];
      while (i < lines.length) {
        const cur = lines[i];
        const m = cur.match(/^(\d+)\. (.*)/);
        if (m) {
          items.push({ num: parseInt(m[1], 10), text: m[2] });
          i++;
          continue;
        }
        if (cur.trim() === '' && i + 1 < lines.length && /^\d+\. /.test(lines[i + 1])) {
          i++;
          continue;
        }
        break;
      }
      nodes.push(
        <ol key={`ol-${k++}`} className="my-1.5 pl-1" style={{ lineHeight: 1.55 }}>
          {items.map((item, idx) => (
            <li key={idx} className="flex gap-2 text-nc-text">
              <span className="text-nc-cyan font-mono flex-shrink-0 tabular-nums" style={{ minWidth: '1.4em', textAlign: 'right' }}>
                {item.num}.
              </span>
              <span className="flex-1">{renderInline(item.text, `ol-${k}-${idx}`, linkRules)}</span>
            </li>
          ))}
        </ol>
      );
      continue;
    }

    // GFM pipe table — header row + delimiter row + zero or more body rows.
    // Alignment is taken from the delimiter row (`:---`, `:---:`, `---:`).
    if (isTableStart(lines, i)) {
      const headerCells = splitPipeRow(lines[i]);
      const aligns = splitPipeRow(lines[i + 1]).map(alignFromCell);
      const body: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].trim() !== '' && lines[i].includes('|')) {
        body.push(splitPipeRow(lines[i]));
        i++;
      }
      const tk = k++;
      nodes.push(
        <div key={`tbl-${tk}`} className="my-2.5 -mx-1 overflow-x-auto">
          <table className="min-w-full border-collapse border border-nc-border/70 text-[0.95em]" style={{ lineHeight: 1.5 }}>
            <thead>
              <tr className="bg-nc-elevated/40">
                {headerCells.map((h, idx) => (
                  <th
                    key={idx}
                    className="border border-nc-border/70 px-2 py-1 font-display font-bold text-nc-text-bright"
                    style={{ textAlign: aligns[idx] || 'left' }}
                  >
                    {renderInline(h, `tbl-${tk}-h-${idx}`, linkRules)}
                  </th>
                ))}
              </tr>
            </thead>
            {body.length > 0 && (
              <tbody>
                {body.map((row, rIdx) => (
                  <tr key={rIdx} className="odd:bg-nc-elevated/10">
                    {headerCells.map((_, cIdx) => (
                      <td
                        key={cIdx}
                        className="border border-nc-border/70 px-2 py-1 text-nc-text align-top"
                        style={{ textAlign: aligns[cIdx] || 'left' }}
                      >
                        {renderInline(row[cIdx] ?? '', `tbl-${tk}-${rIdx}-${cIdx}`, linkRules)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            )}
          </table>
        </div>
      );
      continue;
    }

    // Paragraph — collect consecutive non-special lines
    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !lines[i].match(/^#{1,6}\s/) &&
      !lines[i].startsWith('> ') &&
      !/^[-*+] /.test(lines[i]) &&
      !/^ {2,}[-*+] /.test(lines[i]) &&
      !/^\d+\. /.test(lines[i]) &&
      !/^(-{3,}|\*{3,}|_{3,})$/.test(lines[i].trim()) &&
      !isTableStart(lines, i)
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    if (paraLines.length > 0) {
      const paraText = paraLines.join('\n');
      nodes.push(
        <p
          key={`p-${k++}`}
          className="text-nc-text my-1 whitespace-pre-wrap break-words"
          style={{ fontFamily: 'var(--nc-font-message)', lineHeight: 1.55, overflowWrap: 'anywhere' }}
        >
          {renderInline(paraText, `p-${k}`, linkRules)}
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

// ── Inline thread preview ───────────────────────────────────────────────────
function InlineThreadBlock({ parent, replies, replyCount }: { parent: MessageRecord; replies: MessageRecord[]; replyCount: number }) {
  const { openThread, humans, agents, authUser, currentUser } = useApp();
  const totalLabel = replyCount === 1 ? '1 reply' : `${replyCount} replies`;
  return (
    <div className="mt-2 border-l-2 border-nc-cyan/40 pl-3 py-1.5 bg-nc-cyan/[0.03] rounded-r-sm">
      <ul className="space-y-1">
        {replies.map((reply) => {
          const name = reply.sender_name || 'unknown';
          const isAgentReply = reply.sender_type === 'agent';
          const human = !isAgentReply ? humans.find(h => h.name === name) : undefined;
          const agent = isAgentReply ? agents.find(a => a.name === name || a.displayName === name) : undefined;
          const isSelf = !isAgentReply && name === currentUser;
          const picture = human?.picture || human?.gravatarUrl || agent?.picture || (isSelf ? authUser?.picture || authUser?.gravatarUrl : undefined);
          const color = getSenderColor(name);
          return (
            <li key={reply.id}>
              <button
                type="button"
                onClick={() => openThread(parent)}
                className="w-full flex items-center gap-2 text-left hover:bg-nc-elevated/40 rounded-sm px-1 py-0.5 transition-colors"
              >
                <span
                  className="w-5 h-5 flex-shrink-0 font-display font-bold text-[0.65rem] flex items-center justify-center select-none overflow-hidden rounded-sm"
                  style={{ backgroundColor: `${color}20`, color }}
                  aria-hidden="true"
                >
                  {picture ? (
                    <img src={picture} alt="" className="w-full h-full object-cover" />
                  ) : isAgentReply ? (
                    <Bot size={11} />
                  ) : (
                    name.charAt(0).toUpperCase()
                  )}
                </span>
                <span className="font-bold text-xs truncate" style={{ color }}>{name}</span>
                <span className="text-xs text-nc-text truncate flex-1 min-w-0">{reply.content || ''}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <button
        type="button"
        onClick={() => openThread(parent)}
        title={`Reply in thread · ${totalLabel}`}
        className="mt-1 inline-flex items-center gap-1.5 text-xs font-mono font-bold text-nc-cyan hover:text-nc-text-bright transition-colors"
      >
        <MessageSquare size={12} />
        {totalLabel}
      </button>
    </div>
  );
}

// ── Component ────────────────────────────────────────────────────────────────
export default function MessageItem({
  message,
  isGrouped = false,
  hideInlineThread = false,
}: {
  message: MessageRecord;
  isGrouped?: boolean;
  // Suppress the inline reply preview + hover thread action. Used when the
  // caller is already rendering the full thread list next to this message
  // (e.g. the ThreadPanel header), so we don't duplicate the entry.
  hideInlineThread?: boolean;
}) {
  const { humans, agents, configs, currentUser, authUser, openAgentProfile, openThread, threadedMessageIds } = useApp();
  const linkRules = useSyncExternalStore(subscribeLinkTransforms, getStoredLinkTransforms);
  const senderName = message.sender_name || 'Unknown';
  const isAgent = message.sender_type === 'agent';
  const isSystem = message.sender_type === 'system';
  const senderHuman = !isAgent && !isSystem ? humans.find(h => h.name === senderName) : undefined;
  const senderAgent = isAgent ? agents.find(a => a.name === senderName || a.displayName === senderName) : undefined;
  const senderAgentConfig = isAgent && !senderAgent
    ? configs.find(c => c.name === senderName || c.displayName === senderName)
    : undefined;
  const agentProfileId = senderAgent?.id || senderAgentConfig?.id;
  const isSelf = !isAgent && !isSystem && senderName === currentUser;
  const selfPicture = isSelf ? authUser?.picture || authUser?.gravatarUrl : undefined;
  const senderPicture = senderHuman?.picture || senderHuman?.gravatarUrl || senderAgent?.picture || selfPicture;
  const timestamp = message.timestamp || '';
  const color = getSenderColor(senderName);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const imageAttachments = (message.attachments || []).filter(isImageAttachment);
  const fileAttachments = (message.attachments || []).filter((a) => !isImageAttachment(a));

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

  const hasInlineThread = (message.replies?.length ?? 0) > 0
    || threadedMessageIds.has(message.id.slice(0, 8));
  // Start-a-thread entry for messages that don't already surface one inline.
  // Hidden by default so 0-reply messages don't add clutter; revealed on hover
  // over the message row (and focus, for keyboard users).
  const canStartThread = !hideInlineThread
    && message.channel_type !== 'thread'
    && !hasInlineThread;

  return (
    <div className="group relative px-4 sm:px-6 hover:bg-nc-elevated/40 transition-colors duration-100 overflow-hidden">
      {canStartThread && (
        <button
          type="button"
          onClick={() => openThread(message)}
          title="Reply in thread"
          aria-label="Reply in thread"
          className="absolute top-1.5 right-2 z-10 inline-flex items-center justify-center p-1 text-nc-muted bg-nc-elevated/80 border border-nc-border rounded-sm opacity-0 group-hover:opacity-100 focus:opacity-100 [@media(pointer:coarse)]:opacity-100 hover:text-nc-cyan hover:border-nc-cyan/50 transition-opacity"
        >
          <MessageSquare size={12} />
        </button>
      )}
      <div className={`flex gap-3 sm:gap-4 ${isGrouped ? 'py-0.5' : 'pt-5 pb-1'}`}>
        {/* Avatar column */}
        {isGrouped ? (
          <div className="w-8 sm:w-9 flex-shrink-0 flex items-start justify-center">
            <span className="text-2xs text-nc-muted opacity-0 group-hover:opacity-100 transition-opacity pt-0.5 font-mono tabular-nums">
              {timestamp && formatTime(timestamp)}
            </span>
          </div>
        ) : isAgent && agentProfileId ? (
          <div className="relative w-8 h-8 sm:w-9 sm:h-9 flex-shrink-0 mt-0.5">
            <button
              type="button"
              onClick={() => openAgentProfile(agentProfileId)}
              title={`View @${senderName} profile`}
              className="w-8 h-8 sm:w-9 sm:h-9 font-display font-bold text-xs flex items-center justify-center select-none overflow-hidden transition-transform hover:scale-105 hover:ring-1 hover:ring-nc-cyan focus:outline-none focus:ring-1 focus:ring-nc-cyan"
              style={{
                backgroundColor: `${color}12`,
                color,
                boxShadow: `0 0 10px ${color}18`,
              }}
            >
              {senderPicture ? (
                <img src={senderPicture} alt="" className="w-full h-full object-cover" />
              ) : <Bot size={15} />}
            </button>
            {senderAgent && (
              <StatusDot status={agentStatus(senderAgent)} hideWhen={['offline', 'online']} />
            )}
          </div>
        ) : (
          <div className="relative w-8 h-8 sm:w-9 sm:h-9 flex-shrink-0 mt-0.5">
            <div
              className="w-8 h-8 sm:w-9 sm:h-9 font-display font-bold text-xs flex items-center justify-center select-none overflow-hidden"
              style={{
                backgroundColor: `${color}12`,
                color,
                boxShadow: isAgent ? `0 0 10px ${color}18` : undefined,
              }}
            >
              {senderPicture ? (
                <img src={senderPicture} alt="" className="w-full h-full object-cover" />
              ) : isAgent ? <Bot size={15} /> : senderName.charAt(0).toUpperCase()}
            </div>
            {isAgent && senderAgent && (
              <StatusDot status={agentStatus(senderAgent)} hideWhen={['offline', 'online']} />
            )}
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
          <div className="min-w-0 msg-body">
            {message.content ? parseMarkdown(message.content, linkRules) : null}
          </div>

          {/* Image attachments — inline thumbnails, click to open lightbox */}
          {imageAttachments.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-2">
              {imageAttachments.map((att, i) => (
                <button
                  key={att.id}
                  type="button"
                  onClick={() => setLightboxIndex(i)}
                  className="block border border-nc-border bg-nc-black overflow-hidden hover:border-nc-cyan/60 transition-colors"
                  aria-label={`Open ${att.filename}`}
                >
                  <FailableImage
                    src={getAttachmentUrl(att.id)}
                    alt={att.filename}
                    className="max-w-[260px] sm:max-w-[320px] max-h-[240px] object-cover"
                    fallbackClassName="w-40 h-28"
                    loading="lazy"
                  />
                </button>
              ))}
            </div>
          )}

          {/* Non-image attachments — keep the existing link chip */}
          {fileAttachments.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-2">
              {fileAttachments.map((att) => (
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

          {lightboxIndex !== null && imageAttachments.length > 0 && (
            <ImageLightbox
              images={imageAttachments.map((a) => ({
                id: a.id,
                src: getAttachmentUrl(a.id),
                alt: a.filename,
              }))}
              initialIndex={lightboxIndex}
              onClose={() => setLightboxIndex(null)}
            />
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

          {/* Inline thread preview — only for parents that actually have replies. */}
          {!hideInlineThread && message.channel_type !== 'thread' && (message.replies?.length ?? 0) > 0 && (
            <InlineThreadBlock
              parent={message}
              replies={message.replies!}
              replyCount={message.reply_count ?? message.replies!.length}
            />
          )}
        </div>
      </div>
    </div>
  );
}
