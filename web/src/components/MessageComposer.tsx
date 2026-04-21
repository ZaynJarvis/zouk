import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { Bot, User, Menu } from 'lucide-react';
import { useApp } from '../store/AppContext';
import { isMobileViewport, isStandalonePWA } from '../lib/layout';
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
  const { sendMessage, activeChannelName, viewMode, agents, humans, isGuest, theme, sidebarOpen, setSidebarOpen } = useApp();
  const draftKey = threadTarget ?? `${viewMode}:${activeChannelName}`;
  const draftsRef = useRef<Map<string, string>>(new Map());
  const [text, setText] = useState(() => draftsRef.current.get(draftKey) ?? '');
  const textRef = useRef(text);
  textRef.current = text;
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [focused, setFocused] = useState(false);
  const [isMobileSurface, setIsMobileSurface] = useState(() => isMobileViewport() || isStandalonePWA());

  useEffect(() => {
    const update = () => setIsMobileSurface(isMobileViewport() || isStandalonePWA());
    window.addEventListener('resize', update);
    const mql = window.matchMedia?.('(display-mode: standalone)');
    mql?.addEventListener?.('change', update);
    return () => {
      window.removeEventListener('resize', update);
      mql?.removeEventListener?.('change', update);
    };
  }, []);

  const showMobileSidebarBtn = isMobileSurface && !sidebarOpen && !focused && !text.trim();
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
        picture: a.picture || undefined,
      });
    }
    // Online humans first so the most useful targets surface at the top of the
    // dropdown; offline (logged-in-before but not currently connected) humans
    // are still selectable.
    const onlineH = humans.filter((h) => h.online !== false);
    const offlineH = humans.filter((h) => h.online === false);
    for (const h of [...onlineH, ...offlineH]) {
      targets.push({
        label: h.name,
        mention: toMentionHandle(h.name),
        type: 'human',
        searchTerms: buildMentionSearchTerms(h.name),
        picture: h.picture || h.gravatarUrl || undefined,
        online: h.online !== false,
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

  const handleSubmit = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const ok = await sendMessage(trimmed, threadTarget);
    if (!ok) return;
    setText('');
    draftsRef.current.delete(draftKey);
    setMentionQuery(null);
    setSuppressedAtPos(null);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [text, sendMessage, threadTarget, draftKey]);

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

  // Swap drafts when the active channel/thread changes: save outgoing text
  // under the previous key, restore any stored draft for the new key.
  useEffect(() => {
    const drafts = draftsRef.current;
    setText(drafts.get(draftKey) ?? '');
    return () => {
      const pending = textRef.current;
      if (pending) {
        drafts.set(draftKey, pending);
      } else {
        drafts.delete(draftKey);
      }
    };
  }, [draftKey]);

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
  const composerPlaceholder = isGuest
    ? 'Sign in to send messages'
    : (placeholder || `Message ${channelLabel}`);

  return (
    <div className="flex-shrink-0 composer-outer safe-bottom">
      <div className="composer-inner-pad px-4 sm:px-6 pt-1 sm:pt-2 pb-0 sm:pb-4 relative max-w-[var(--chat-max-width)] mx-auto w-full">
        {mentionQuery !== null && mentionMatches.length > 0 && (
          <div className="absolute bottom-full left-4 right-4 sm:left-6 sm:right-6 mb-1 border border-nc-border bg-nc-surface z-20 max-h-[240px] overflow-y-auto shadow-nc-panel">
            {mentionMatches.map((match, i) => {
              const offline = match.type === 'human' && match.online === false;
              return (
                <button
                  key={`${match.type}:${match.mention}`}
                  onMouseDown={(e) => { e.preventDefault(); insertMention(match.mention); }}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors ${
                    i === mentionIndex
                      ? 'bg-nc-cyan/10 text-nc-cyan'
                      : 'text-nc-text hover:bg-nc-elevated'
                  } ${offline ? 'opacity-60' : ''}`}
                >
                  <span className="relative w-5 h-5 flex-shrink-0 flex items-center justify-center">
                    {match.picture ? (
                      <img src={match.picture} alt="" className={`w-5 h-5 object-cover ${offline ? 'grayscale' : ''}`} />
                    ) : match.type === 'agent' ? (
                      <Bot size={14} className="text-nc-green" />
                    ) : (
                      <User size={14} className="text-nc-cyan" />
                    )}
                    {match.type === 'human' && (
                      <span
                        className={`absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full border border-nc-surface ${offline ? 'bg-nc-muted' : 'bg-nc-green'}`}
                      />
                    )}
                  </span>
                  <div className="min-w-0 flex flex-col">
                    <span className="font-bold font-mono truncate">@{match.mention}</span>
                    {match.label !== match.mention && (
                      <span className="text-xs text-nc-muted truncate">{match.label}</span>
                    )}
                  </div>
                  <span className="text-xs text-nc-muted ml-auto font-mono">
                    {offline ? 'offline' : match.type}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        <div className="flex items-end gap-2">
          {showMobileSidebarBtn && (
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              aria-label="Open sidebar"
              className="lg:hidden flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center border border-nc-border text-nc-muted bg-nc-surface hover:text-nc-cyan hover:border-nc-cyan/50 transition-colors"
            >
              <Menu size={18} />
            </button>
          )}
          <div className={`composer-surface flex-1 min-w-0 flex items-end gap-2 border border-nc-border bg-nc-black cyber-bevel-sm ${theme === 'washington-post' ? 'focus-within:border-[#7c2430]' : 'focus-within:border-nc-cyan'}`}>
          <textarea
            ref={textareaRef}
            value={text}
            onChange={handleChange}
            onSelect={handleSelect}
            onKeyDown={handleKeyDown}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            enterKeyHint="send"
            disabled={isGuest}
            placeholder={composerPlaceholder}
            rows={1}
            className="composer-textarea flex-1 min-w-0 px-4 py-1.5 sm:px-3 sm:py-2 bg-transparent font-body text-nc-text placeholder:text-nc-muted resize-none focus:outline-none min-h-[36px] sm:min-h-[40px] disabled:cursor-not-allowed"
          />

          {!text.trim() && !isGuest && (
            <span
              aria-hidden="true"
              className="text-2xs text-nc-muted/50 font-mono hidden sm:block pointer-events-none select-none self-center pr-3 flex-shrink-0"
            >
              Enter to send · Shift+Enter for newline
            </span>
          )}
          </div>
        </div>
      </div>
    </div>
  );
}
