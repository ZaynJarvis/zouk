/* eslint-disable react-refresh/only-export-components */
import React, { type ReactNode } from 'react';

// ---------- Types ----------

export interface AtlasEntry {
  path: string;
  name: string;
  type: 'file' | 'directory' | 'symlink';
  size?: number;
  mtime?: number;
  language?: string;
  mime?: string;
}

export interface AtlasSelection {
  trail: string[];
  file: string | null;
  dir: string;
  focus: string | null;
  sortBy: string;
  sortDir: string;
}

// ---------- Formatters ----------

export function formatBytes(n: number | null | undefined): string {
  if (n == null) return '—';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB';
  return (n / 1024 / 1024 / 1024).toFixed(2) + ' GB';
}

export function formatRelTime(ts: number | null): string {
  if (!ts) return '—';
  const diff = Date.now() - ts;
  const s = Math.floor(diff / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return m + 'm ago';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h ago';
  const d = Math.floor(h / 24);
  if (d < 30) return d + 'd ago';
  const mo = Math.floor(d / 30);
  if (mo < 12) return mo + 'mo ago';
  return Math.floor(mo / 12) + 'y ago';
}

export function formatAbsTime(ts: number | null): string {
  if (!ts) return '—';
  const d = new Date(ts + 8 * 3600000);
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const y = d.getUTCFullYear(), mo = d.getUTCMonth(), day = d.getUTCDate();
  const h = d.getUTCHours(), m = d.getUTCMinutes();
  const date = `${months[mo]} ${day} ${y}`;
  if (h === 0 && m === 0) return date;
  return `${date}, ${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
}

// ---------- Icons ----------

interface FolderIconProps {
  open?: boolean;
  accent?: boolean;
}

export function FolderIcon({ open = false, accent = false }: FolderIconProps) {
  const fill = accent ? 'var(--accent)' : 'var(--faint)';
  const stroke = accent ? 'var(--accent)' : 'var(--muted)';
  return (
    <span className="ficon">
      {open ? (
        <svg viewBox="0 0 16 16" fill="none">
          <path d="M1.5 4.5 A1 1 0 0 1 2.5 3.5 H6 L7.5 5 H13.5 A1 1 0 0 1 14.5 6 V12.5 A1 1 0 0 1 13.5 13.5 H2.5 A1 1 0 0 1 1.5 12.5 Z" fill={fill} fillOpacity="0.15" stroke={stroke}/>
        </svg>
      ) : (
        <svg viewBox="0 0 16 16" fill="none">
          <path d="M1.5 4.5 A1 1 0 0 1 2.5 3.5 H6 L7.5 5 H13.5 A1 1 0 0 1 14.5 6 V12.5 A1 1 0 0 1 13.5 13.5 H2.5 A1 1 0 0 1 1.5 12.5 Z" fill={fill} fillOpacity="0.18" stroke={stroke}/>
        </svg>
      )}
    </span>
  );
}

export const LANG_COLORS: Record<string, string> = {
  typescript: '#3178c6', tsx: '#3178c6',
  javascript: '#e6b91e', jsx: '#e6b91e',
  json: '#888',
  markdown: '#555',
  css: '#264de4', scss: '#cd6799',
  python: '#4b8bbe',
  rust: '#b7410e',
  go: '#00add8',
  bash: '#3e474a',
  yaml: '#888',
  html: '#e34c26',
  svg: '#b8482e',
};

interface FileIconProps {
  entry: AtlasEntry;
}

export function FileIcon({ entry }: FileIconProps) {
  const lang = entry.language;
  const color = LANG_COLORS[lang || ''] || 'var(--muted)';
  return (
    <span className="ficon">
      <svg viewBox="0 0 16 16" fill="none">
        <path d="M3 1.5 H9.5 L13 5 V13.5 A1 1 0 0 1 12 14.5 H3 A1 1 0 0 1 2 13.5 V2.5 A1 1 0 0 1 3 1.5 Z" fill="var(--surface)" stroke="var(--line-2)"/>
        <path d="M9.5 1.5 V5 H13" stroke="var(--line-2)" fill="none"/>
        <rect x="3.5" y="9" width="6" height="3.5" rx="0.5" fill={color} fillOpacity="0.85"/>
      </svg>
    </span>
  );
}

interface EntryIconProps {
  entry: AtlasEntry;
  open?: boolean;
}

export function EntryIcon({ entry, open = false }: EntryIconProps) {
  if (entry.type === 'directory') return <FolderIcon open={open} />;
  if (entry.type === 'symlink') return (
    <span className="ficon"><svg viewBox="0 0 16 16"><path d="M5 3 H11 V9" stroke="var(--accent)" fill="none" strokeWidth="1.5"/><path d="M11 3 L5 9" stroke="var(--accent)" fill="none" strokeWidth="1.5"/></svg></span>
  );
  return <FileIcon entry={entry} />;
}

// ---------- Code highlighter ----------

const HIGHLIGHT_LANGS = ['javascript','typescript','tsx','jsx','json','python','bash','rust','go','css','scss'] as const;

const KEYWORDS: Record<string, string[]> = {
  javascript: ['const','let','var','function','return','if','else','for','while','import','export','from','default','new','class','async','await','of','in','this'],
  typescript: ['const','let','var','function','return','if','else','for','while','import','export','from','default','new','class','async','await','of','in','this','interface','type','as','public','private','readonly'],
  tsx: ['const','let','var','function','return','if','else','for','while','import','export','from','default','new','class','async','await','of','in','this','interface','type','as'],
  jsx: ['const','let','var','function','return','if','else','for','while','import','export','from','default','new','class','async','await'],
  python: ['def','class','import','from','return','if','elif','else','for','while','in','not','and','or','None','True','False','as','with','try','except','raise','yield','lambda','async','await'],
  bash: ['if','then','fi','else','elif','for','do','done','while','case','esac','set','export','function','return','in'],
  rust: ['fn','let','mut','use','pub','struct','enum','impl','trait','match','if','else','for','while','return','self','mod','as','where','async','await'],
  go: ['func','var','const','type','struct','interface','if','else','for','range','return','package','import','go','defer','chan','map'],
  json: ['true','false','null'],
  css: [],
  scss: [],
};

function inString(s: string, idx: number): boolean {
  let q: string | null = null;
  let esc = false;
  for (let k = 0; k < idx; k++) {
    if (esc) { esc = false; continue; }
    if (s[k] === '\\') { esc = true; continue; }
    if (q) { if (s[k] === q) q = null; }
    else if (s[k] === '"' || s[k] === "'" || s[k] === '`') q = s[k];
  }
  return !!q;
}

export function highlightCode(text: string, lang: string): ReactNode {
  if (!text) return text;
  if (!(HIGHLIGHT_LANGS as readonly string[]).includes(lang)) return text;

  const kws = KEYWORDS[lang] || [];
  const kwRe = kws.length ? new RegExp('\\b(' + kws.join('|') + ')\\b', 'g') : null;

  return text.split('\n').map((line, i) => {
    let rest = line;
    // comments
    let comment = '';
    if (lang === 'python' || lang === 'bash') {
      const m = rest.match(/(^|[^\\])(#.*)$/);
      if (m) { const idx = rest.indexOf(m[2]); comment = rest.slice(idx); rest = rest.slice(0, idx); }
    } else if (lang !== 'json' && lang !== 'css' && lang !== 'scss') {
      const m = rest.indexOf('//');
      if (m >= 0 && !inString(rest, m)) { comment = rest.slice(m); rest = rest.slice(0, m); }
    }

    // Tokenize: strings, numbers, keywords, rest
    const tokens: Array<[string, string]> = [];
    const re = /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)|(\b\d+(?:\.\d+)?\b)/g;
    let last = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(rest)) !== null) {
      if (match.index > last) tokens.push(['text', rest.slice(last, match.index)]);
      if (match[1]) tokens.push(['s', match[1]]);
      else if (match[2]) tokens.push(['n', match[2]]);
      last = re.lastIndex;
    }
    if (last < rest.length) tokens.push(['text', rest.slice(last)]);

    const rendered = tokens.map((t, ti) => {
      if (t[0] === 's') return <span key={ti} className="tok-s">{t[1]}</span>;
      if (t[0] === 'n') return <span key={ti} className="tok-n">{t[1]}</span>;
      if (kwRe) {
        const parts = t[1].split(kwRe);
        return parts.map((p, pi) => kws.includes(p)
          ? <span key={ti + ':' + pi} className="tok-k">{p}</span>
          : <React.Fragment key={ti + ':' + pi}>{p}</React.Fragment>);
      }
      return <React.Fragment key={ti}>{t[1]}</React.Fragment>;
    });

    return (
      <div key={i}>
        {rendered}
        {comment && <span className="tok-c">{comment}</span>}
        {'\n'}
      </div>
    );
  });
}

// ---------- Level metadata ----------

export const LEVEL_META: Record<string, { name: string; label: string; desc: string }> = {
  l0: { name: 'L0', label: 'Abstract', desc: '~100 token summary' },
  l1: { name: 'L1', label: 'Overview', desc: 'Structure & key points' },
  l2: { name: 'L2', label: 'Content',  desc: 'Full content' },
};

// ---------- Breadcrumbs ----------

interface BreadcrumbsProps {
  path: string;
  onPick: (path: string) => void;
}

export function Breadcrumbs({ path, onPick }: BreadcrumbsProps) {
  // Split path into segments and compute ancestor paths
  const clean = path.replace(/\/+$/, '') || '/';
  const segs = clean === '/' ? [] : clean.split('/').filter(Boolean);
  const ancestors: string[] = ['/'];
  for (let i = 0; i < segs.length; i++) {
    ancestors.push('/' + segs.slice(0, i + 1).join('/'));
  }

  return (
    <nav className="crumbs" aria-label="path">
      <button className="crumb root" onClick={() => onPick('/')}>~</button>
      {segs.map((s, i) => (
        <React.Fragment key={i}>
          <span className="crumb-sep">/</span>
          <button className="crumb" onClick={() => onPick(ancestors[i + 1])}>{s}</button>
        </React.Fragment>
      ))}
    </nav>
  );
}
