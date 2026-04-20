import { useState, useRef, useCallback, useMemo, useEffect, type PointerEvent } from 'react';
import { Send, Bot, User } from 'lucide-react';
import { useApp } from '../store/AppContext';
import {
  buildMentionSearchTerms,
  filterMentionTargets,
  MENTION_QUERY_REGEX,
  toMentionHandle,
  type MentionTarget,
} from '../lib/mentions';

// Locate the @ that anchors the current mention query. Mirrors the lookbehind
// in MENTION_QUERY_REGEX (start-of-string or whitespace) so we don't confuse
// an email address for a mention anchor.
function findAnchorAt(text: string, cursorPos: number): number {
  for (let i = cursorPos - 1; i >= 0; i--) {
    const ch = text[i];
    if (ch === '@') {
      if (i === 0 || /\s/.test(text[i - 1])) return i;
      return -1;
    }
    if (/\s/.test(ch)) return -1;
  }
  return -1;
}

export default function MessageComposer({ threadTarget, placeholder }: { threadTarget?: string; placeholder?: string }) {
  const { sendMessage, activeChannelName, viewMode, agents, humans, isGuest, theme } = useApp();
  const [text, setText] = useState('');
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  // After the user presses Escape we stash the anchor @ index so we can
  // suppress the dropdown until they move past it or start a fresh @.
  const [suppressedAtPos, setSuppressedAtPos] = useState<number | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const allMentionTargets = useMemo<MentionTarget[]>(() => {
    const targets: MentionTarget[] = [];
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
    return filterMentionTargets(allMentionTargets, mentionQuery);
  }, [mentionQuery, allMentionTargets]);

  const insertMention = useCallback((mention: string) => {
    const el = textareaRef.current;
    if (!el) return;
    const cursorPos = el.selectionStart;
    const atIdx = findAnchorAt(text, cursorPos);
    if (atIdx < 0) return;
    const newText = text.slice(0, atIdx) + `@${mention} ` + text.slice(cursorPos);
    setText(newText);
    setMentionQuery(null);
    setMentionIndex(0);
    setSuppressedAtPos(null);
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
    setSuppressedAtPos(null);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [text, sendMessage, threadTarget]);

  // Mobile has no Shift+Enter; long-press Send to insert a newline instead.
  const longPressTimer = useRef<number | null>(null);
  const longPressedRef = useRef(false);

  const insertNewlineAtCursor = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const next = text.slice(0, start) + '\n' + text.slice(end);
    setText(next);
    requestAnimationFrame(() => {
      el.focus();
      const caret = start + 1;
      el.setSelectionRange(caret, caret);
      el.style.height = 'auto';
      el.style.height = Math.min(el.scrollHeight, 200) + 'px';
    });
  }, [text]);

  const handleSendPointerDown = useCallback((e: PointerEvent<HTMLButtonElement>) => {
    if (e.pointerType === 'mouse') return;
    if (!text.trim()) return;
    longPressedRef.current = false;
    longPressTimer.current = window.setTimeout(() => {
      longPressedRef.current = true;
      insertNewlineAtCursor();
    }, 450);
  }, [insertNewlineAtCursor, text]);

  const cancelLongPress = useCallback(() => {
    if (longPressTimer.current !== null) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  const handleSendClick = useCallback(() => {
    if (longPressedRef.current) {
      longPressedRef.current = false;
      return;
    }
    handleSubmit();
  }, [handleSubmit]);

  useEffect(() => () => {
    if (longPressTimer.current !== null) {
      window.clearTimeout(longPressTimer.current);
    }
  }, []);

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
      if ((e.key === 'Enter' || e.key === 'Tab') && !e.nativeEvent.isComposing) {
        e.preventDefault();
        insertMention(mentionMatches[mentionIndex].mention);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        const el = textareaRef.current;
        if (el) {
          const atIdx = findAnchorAt(text, el.selectionStart);
          if (atIdx >= 0) setSuppressedAtPos(atIdx);
        }
        setMentionQuery(null);
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      handleSubmit();
    }
  }, [handleSubmit, mentionQuery, mentionMatches, mentionIndex, insertMention, text]);

  const recomputeMentionState = useCallback((val: string, cursorPos: number) => {
    const atIdx = findAnchorAt(val, cursorPos);
    if (atIdx < 0) {
      setMentionQuery(null);
      setSuppressedAtPos(null);
      return;
    }
    // Escape earlier → keep the dropdown closed while the user is still
    // inside the same @-token. Only reopen once they escape that word.
    if (suppressedAtPos !== null && atIdx === suppressedAtPos) {
      setMentionQuery(null);
      return;
    }
    if (suppressedAtPos !== null && atIdx !== suppressedAtPos) {
      setSuppressedAtPos(null);
    }
    const query = val.slice(atIdx + 1, cursorPos);
    // Final safety check — the regex anchors at cursor, so `findAnchorAt`
    // shouldn't return anything MENTION_QUERY_REGEX wouldn't also match,
    // but keep it honest in case future edits diverge.
    const before = val.slice(0, cursorPos);
    if (!MENTION_QUERY_REGEX.test(before)) {
      setMentionQuery(null);
      return;
    }
    setMentionQuery(query);
    setMentionIndex(0);
  }, [suppressedAtPos]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setText(val);

    const el = textareaRef.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = Math.min(el.scrollHeight, 200) + 'px';
    }

    recomputeMentionState(val, e.target.selectionStart);
  }, [recomputeMentionState]);

  const handleSelect = useCallback((e: React.SyntheticEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget;
    recomputeMentionState(el.value, el.selectionStart);
  }, [recomputeMentionState]);

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
      <div className="flex-shrink-0 composer-outer safe-bottom">
        <div className="composer-inner-pad px-5 pt-2 pb-0 sm:pb-4">
          <div className="flex items-center justify-center gap-2 px-4 py-3 border border-nc-border bg-nc-elevated text-sm text-nc-muted">
            Sign in with Google to send messages
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-shrink-0 composer-outer safe-bottom">
      <div className="composer-inner-pad px-4 sm:px-6 pt-1 sm:pt-2 pb-0 sm:pb-4 relative max-w-[var(--chat-max-width)] mx-auto w-full">
        {mentionQuery !== null && mentionMatches.length > 0 && (
          <div className="absolute bottom-full left-4 right-4 sm:left-6 sm:right-6 mb-1 border border-nc-border bg-nc-surface z-20 max-h-[240px] overflow-y-auto shadow-nc-panel">
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

        <div className={`composer-surface flex items-end border border-nc-border bg-nc-surface cyber-bevel-sm ${theme === 'washington-post' ? 'focus-within:border-[#7c2430]' : 'focus-within:border-nc-cyan'}`}>
          <textarea
            ref={textareaRef}
            value={text}
            onChange={handleChange}
            onSelect={handleSelect}
            onKeyDown={handleKeyDown}
            enterKeyHint="send"
            placeholder={placeholder || `Message ${channelLabel}`}
            rows={1}
            className="composer-textarea flex-1 min-w-0 px-4 py-1.5 sm:px-3 sm:py-2 bg-transparent font-body text-nc-text placeholder:text-nc-muted resize-none focus:outline-none min-h-[36px] sm:min-h-[40px]"
          />

          <div className="flex items-center gap-2 px-1.5 pb-1 sm:px-2 sm:pb-1.5 flex-shrink-0">
            {!text.trim() && (
              <span
                aria-hidden="true"
                className="text-2xs text-nc-muted/50 font-mono hidden sm:block pointer-events-none select-none"
              >
                Enter to send · Shift+Enter for newline
              </span>
            )}

            <button
              onClick={handleSendClick}
              onPointerDown={handleSendPointerDown}
              onPointerUp={cancelLongPress}
              onPointerLeave={cancelLongPress}
              onPointerCancel={cancelLongPress}
              disabled={!text.trim()}
              title="Tap to send · Hold for newline"
              aria-label="Send message. Hold to insert newline."
              className={`
                cyber-btn flex items-center justify-center h-7 px-2.5 sm:px-3 gap-1.5 border border-nc-border flex-shrink-0 text-xs font-mono glitch-text transition-colors
                ${text.trim()
                  ? 'bg-nc-cyan/15 text-nc-cyan border-nc-cyan/50 hover:bg-nc-cyan/25'
                  : 'bg-nc-elevated text-nc-muted cursor-not-allowed'
                }
              `}
            >
              <Send size={12} />
              <span className="hidden sm:inline">Send</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
