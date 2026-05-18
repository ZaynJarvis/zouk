import { MENTION_TOKEN_REGEX } from './mentions';
import { highlightCode } from './highlight';
import type { LinkTransformRule } from '../store/storage';

type MentionSegment = { kind: 'mention'; start: number; end: number; handle: string };
type InlineSegment = { kind: 'inline'; start: number; end: number; raw: string };
type LinkSegment = { kind: 'link'; start: number; end: number; href: string; display: string };
type InlineRenderOptions = { compactLinks?: boolean };

const TRAILING_URL_PUNCT = '.,;:!?)，。！？；：、）】》」』';
const CJK_URL_BOUNDARY_PUNCT = '，。！？；：、）】》」』';

function stripTrailingPunct(url: string, prefix: string): { url: string; trail: string } {
  let body = url;
  let trail = '';
  let prefixView = prefix;
  while (body.length > 0) {
    const last = body[body.length - 1];
    if (TRAILING_URL_PUNCT.includes(last)) {
      body = body.slice(0, -1);
      trail = last + trail;
      continue;
    }
    if ('*_~`'.includes(last) && prefixView.length > 0 && prefixView[prefixView.length - 1] === last) {
      body = body.slice(0, -1);
      prefixView = prefixView.slice(0, -1);
      trail = last + trail;
      continue;
    }
    break;
  }
  return { url: body, trail };
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

function compactLongLinkDisplay(display: string): string {
  if (display.length <= 72) return display;

  try {
    const url = new URL(display);
    const parts = url.pathname.split('/').filter(Boolean);
    const head = parts.slice(0, 2).join('/');
    const tail = parts[parts.length - 1];
    const candidate = tail
      ? `${url.hostname}${head ? `/${head}` : ''}/.../${tail}`
      : `${url.hostname}/...`;
    if (candidate.length <= 72) return candidate;
    return `${candidate.slice(0, 34)}...${candidate.slice(-30)}`;
  } catch {
    return `${display.slice(0, 34)}...${display.slice(-30)}`;
  }
}

export function renderInline(
  text: string,
  keyPrefix: string,
  linkRules: LinkTransformRule[],
  options: InlineRenderOptions = {},
): React.ReactNode[] {
  const segments: (MentionSegment | InlineSegment | LinkSegment)[] = [];
  let m: RegExpExecArray | null;

  const urlRegexG = new RegExp(`\\bhttps?:\\/\\/[^\\s<>\\\`"${CJK_URL_BOUNDARY_PUNCT}]+`, 'g');
  while ((m = urlRegexG.exec(text)) !== null) {
    const raw = m[0];
    const { url, trail } = stripTrailingPunct(raw, text.slice(0, m.index));
    const start = m.index;
    const end = start + url.length;
    const display = applyLinkTransforms(url, linkRules);
    segments.push({ kind: 'link', start, end, href: url, display });
    urlRegexG.lastIndex = end + trail.length;
  }

  const mentionRegexG = new RegExp(MENTION_TOKEN_REGEX.source, 'gu');
  while ((m = mentionRegexG.exec(text)) !== null) {
    const boundary = m[1] ?? '';
    const handle = m[2] ?? '';
    const start = m.index + boundary.length;
    const end = start + 1 + handle.length;
    if (segments.some(s => start < s.end && end > s.start)) continue;
    segments.push({ kind: 'mention', start, end, handle });
  }

  const inlineRegexG = /(`[^`]+`|\*\*[^*]+\*\*|(?<![a-zA-Z0-9])__[^_]+__(?![a-zA-Z0-9])|~~[^~]+~~|\*[^*\s][^*]*\*|(?<![a-zA-Z0-9])_[^_\s][^_]*_(?![a-zA-Z0-9]))/g;
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
      const display = options.compactLinks ? compactLongLinkDisplay(seg.display) : seg.display;
      nodes.push(
        <a
          key={`${keyPrefix}-l-${seg.start}`}
          href={seg.href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-nc-cyan hover:underline break-all"
          title={display !== seg.href ? seg.href : undefined}
        >
          {display}
        </a>
      );
    } else {
      const raw = seg.raw;
      if (raw.startsWith('`')) {
        nodes.push(
          <code key={`${keyPrefix}-ic-${seg.start}`} className="bg-nc-green/10 text-nc-text-bright px-[2px] py-px font-mono text-[0.88em] rounded-sm" style={{ overflowWrap: 'anywhere' }}>
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

// ── GFM pipe-table helpers ──────────────────────────────────────────────────
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
  const lines = text.split('\n');
  let i = 0;
  let k = keyBase;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === '') {
      i++;
      continue;
    }

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

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
      nodes.push(<hr key={`hr-${k++}`} className="border-t border-nc-border my-3" />);
      i++;
      continue;
    }

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
          style={{ lineHeight: 1.55, overflowWrap: 'anywhere' }}
        >
          {renderInline(paraText, `p-${k}`, linkRules)}
        </p>
      );
    }
  }

  return nodes;
}

export function parseMarkdown(content: string, linkRules: LinkTransformRule[]): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let key = 0;

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
        <pre className="overflow-x-auto max-w-full bg-nc-black">
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
      </div>
    );
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < content.length) {
    nodes.push(...parseBlocks(content.slice(lastIndex), key, linkRules));
  }

  return nodes;
}
