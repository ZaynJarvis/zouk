import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { Send, Bot, User } from 'lucide-react';
import { useApp } from '../store/AppContext';
import { buildMentionSearchTerms, MENTION_QUERY_REGEX, toMentionHandle } from '../lib/mentions';

export default function MessageComposer({ threadTarget, placeholder }: { threadTarget?: string; placeholder?: string }) {
  const { sendMessage, activeChannelName, viewMode, agents, humans, isGuest } = useApp();
  const [text, setText] = useState('');
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isComposingRef = useRef(false);

  const allMentionTargets = useMemo(() => {
    const targets: { label: string; mention: string; type: 'agent' | 'human'; searchTerms: string[] }[] = [];
    for (const a of agents) {
      const label = a.displayName || a.name;
      targets.push({
        label,
        mention: a.name,
        type: 'agent',
        searchTerms: buildMentionSearchTerms(a.name, a.displayName),
      });
    }
    for (const h of humans) {
      const label = h.name;
      targets.push({
        label,
        mention: toMentionHandle(h.name),
        type: 'human',
        searchTerms: buildMentionSearchTerms(h.name),
      });
    }
    return targets;
  }, [agents, humans]);

  const mentionMatches = useMemo(() => {
    if (mentionQuery === null) return [];
    const q = mentionQuery.toLowerCase();
    return allMentionTargets.filter(t => t.searchTerms.some(term => term.startsWith(q))).slice(0, 8);
  }, [mentionQuery, allMentionTargets]);

  const insertMention = useCallback((mention: string) => {
    const el = textareaRef.current;
    if (!el) return;
    const cursorPos = el.selectionStart;
    const before = text.slice(0, cursorPos);
    const atIdx = before.lastIndexOf('@');
    if (atIdx < 0) return;
    const newText = text.slice(0, atIdx) + `@${mention} ` + text.slice(cursorPos);
    setText(newText);
    setMentionQuery(null);
    setMentionIndex(0);
    requestAnimationFrame(() => {
      el.focus();
      const newPos = atIdx + mention.length + 2;
      el.setSelectionRange(newPos, newPos);
    });
  }, [text]);

  const handleSubmit = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed) return;
    sendMessage(trimmed, threadTarget);
    setText('');
    setMentionQuery(null);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [text, sendMessage, threadTarget]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (mentionQuery !== null && mentionMatches.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setMentionIndex(i => (i + 1) % mentionMatches.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setMentionIndex(i => (i - 1 + mentionMatches.length) % mentionMatches.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        insertMention(mentionMatches[mentionIndex].mention);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setMentionQuery(null);
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      // Don't send while IME composition is active (e.g. Chinese/Japanese input)
      if (isComposingRef.current) return;
      e.preventDefault();
      handleSubmit();
    }
  }, [handleSubmit, mentionQuery, mentionMatches, mentionIndex, insertMention]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setText(val);

    const el = textareaRef.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = Math.min(el.scrollHeight, 200) + 'px';
    }

    const cursorPos = e.target.selectionStart;
    const before = val.slice(0, cursorPos);
    const atMatch = before.match(MENTION_QUERY_REGEX);
    if (atMatch) {
      setMentionQuery(atMatch[1]);
      setMentionIndex(0);
    } else {
      setMentionQuery(null);
    }
  }, []);

  // Auto-focus textarea when switching channels/views
  useEffect(() => {
    textareaRef.current?.focus();
  }, [activeChannelName, viewMode]);

  // Close mention dropdown on blur (with delay to allow click)
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    const onBlur = () => setTimeout(() => setMentionQuery(null), 150);
    el.addEventListener('blur', onBlur);
    return () => el.removeEventListener('blur', onBlur);
  }, []);

  const channelLabel = viewMode === 'dm' ? `@${activeChannelName}` : `#${activeChannelName}`;

  if (isGuest) {
    return (
      <div className="px-5 pb-4 pt-2">
        <div className="flex items-center justify-center gap-2 px-4 py-3 border border-nc-border bg-nc-elevated text-sm text-nc-muted">
          Sign in with Google to send messages
        </div>
      </div>
    );
  }

  return (
    <div className="px-5 pb-4 pt-2 relative">
      {mentionQuery !== null && mentionMatches.length > 0 && (
        <div className="absolute bottom-full left-5 right-5 mb-1 border border-nc-border bg-nc-surface z-20 max-h-[240px] overflow-y-auto shadow-nc-panel">
          {mentionMatches.map((match, i) => (
            <button
              key={`${match.type}:${match.mention}`}
              onMouseDown={(e) => { e.preventDefault(); insertMention(match.mention); }}
              className={`w-full flex items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors ${
                i === mentionIndex
                  ? 'bg-nc-cyan/10 text-nc-cyan'
                  : 'text-nc-text hover:bg-nc-elevated'
              }`}
            >
              {match.type === 'agent'
                ? <Bot size={14} className="flex-shrink-0 text-nc-green" />
                : <User size={14} className="flex-shrink-0 text-nc-cyan" />
              }
              <div className="min-w-0 flex flex-col">
                <span className="font-bold font-mono truncate">@{match.mention}</span>
                {match.label !== match.mention && (
                  <span className="text-xs text-nc-muted truncate">{match.label}</span>
                )}
              </div>
              <span className="text-xs text-nc-muted ml-auto font-mono">{match.type}</span>
            </button>
          ))}
        </div>
      )}

      <div className="flex items-stretch border border-nc-border bg-nc-surface focus-within:border-nc-cyan focus-within:shadow-nc-cyan cyber-bevel-sm">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onCompositionStart={() => { isComposingRef.current = true; }}
          onCompositionEnd={() => { isComposingRef.current = false; }}
          placeholder={placeholder || `Message ${channelLabel}`}
          rows={1}
          className="flex-1 px-3 py-2.5 bg-transparent text-base sm:text-sm font-body text-nc-text placeholder:text-nc-muted resize-none focus:outline-none min-h-[46px]"
        />

        <button
          onClick={handleSubmit}
          disabled={!text.trim()}
          className={`
            cyber-btn flex items-center justify-center w-11 border-l border-nc-border flex-shrink-0 self-stretch glitch-text
            ${text.trim()
              ? 'bg-nc-cyan/15 text-nc-cyan hover:bg-nc-cyan/25'
              : 'bg-nc-elevated text-nc-muted cursor-not-allowed'
            }
          `}
        >
          <Send size={14} />
        </button>
      </div>
    </div>
  );
}
