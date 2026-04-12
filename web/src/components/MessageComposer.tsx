import { useState, useRef, useCallback, useMemo } from 'react';
import { Send, Bot, User } from 'lucide-react';
import { useApp } from '../store/AppContext';

export default function MessageComposer({ threadTarget, placeholder }: { threadTarget?: string; placeholder?: string }) {
  const { sendMessage, activeChannelName, viewMode, agents, humans } = useApp();
  const [text, setText] = useState('');
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Build mention candidates from agents + humans
  const allMentionTargets = useMemo(() => {
    const targets: { name: string; type: 'agent' | 'human' }[] = [];
    for (const a of agents) targets.push({ name: a.displayName || a.name, type: 'agent' });
    for (const h of humans) targets.push({ name: h.name, type: 'human' });
    return targets;
  }, [agents, humans]);

  const mentionMatches = useMemo(() => {
    if (mentionQuery === null) return [];
    const q = mentionQuery.toLowerCase();
    return allMentionTargets.filter(t => t.name.toLowerCase().startsWith(q)).slice(0, 8);
  }, [mentionQuery, allMentionTargets]);

  const insertMention = useCallback((name: string) => {
    const el = textareaRef.current;
    if (!el) return;
    const cursorPos = el.selectionStart;
    // Find the @ that started this mention
    const before = text.slice(0, cursorPos);
    const atIdx = before.lastIndexOf('@');
    if (atIdx < 0) return;
    const newText = text.slice(0, atIdx) + `@${name} ` + text.slice(cursorPos);
    setText(newText);
    setMentionQuery(null);
    setMentionIndex(0);
    // Restore focus and cursor
    requestAnimationFrame(() => {
      el.focus();
      const newPos = atIdx + name.length + 2; // @name + space
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
    // Handle mention dropdown navigation
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
        insertMention(mentionMatches[mentionIndex].name);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setMentionQuery(null);
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }, [handleSubmit, mentionQuery, mentionMatches, mentionIndex, insertMention]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setText(val);

    // Auto-height
    const el = textareaRef.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = Math.min(el.scrollHeight, 200) + 'px';
    }

    // Detect @ mention query
    const cursorPos = e.target.selectionStart;
    const before = val.slice(0, cursorPos);
    const atMatch = before.match(/@([\w-]*)$/);
    if (atMatch) {
      setMentionQuery(atMatch[1]);
      setMentionIndex(0);
    } else {
      setMentionQuery(null);
    }
  }, []);

  const channelLabel = viewMode === 'dm' ? `@${activeChannelName}` : `#${activeChannelName}`;

  return (
    <div className="px-5 pb-4 pt-2 relative">
      {/* @ mention autocomplete dropdown */}
      {mentionQuery !== null && mentionMatches.length > 0 && (
        <div className="absolute bottom-full left-5 right-5 mb-1 border-2 border-nb-black dark:border-dark-border bg-nb-white dark:bg-dark-surface shadow-nb z-20 max-h-[240px] overflow-y-auto">
          {mentionMatches.map((match, i) => (
            <button
              key={match.name}
              onMouseDown={(e) => { e.preventDefault(); insertMention(match.name); }}
              className={`w-full flex items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors ${
                i === mentionIndex
                  ? 'bg-nb-yellow dark:bg-dark-elevated text-nb-black dark:text-dark-text'
                  : 'text-nb-gray-700 dark:text-dark-text hover:bg-nb-gray-50 dark:hover:bg-dark-elevated'
              }`}
            >
              {match.type === 'agent'
                ? <Bot size={14} className="flex-shrink-0 text-nb-blue" />
                : <User size={14} className="flex-shrink-0 text-nb-green" />
              }
              <span className="font-bold">@{match.name}</span>
              <span className="text-xs text-nb-gray-400 dark:text-dark-muted ml-auto">{match.type}</span>
            </button>
          ))}
        </div>
      )}

      <div className="flex items-end gap-2 border-3 border-nb-black dark:border-dark-border bg-nb-white dark:bg-dark-surface shadow-nb transition-shadow focus-within:shadow-nb-lg">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={placeholder || `Message ${channelLabel}`}
          rows={1}
          className="flex-1 px-3 py-2.5 bg-transparent text-sm font-body text-nb-black dark:text-dark-text placeholder:text-nb-gray-400 dark:placeholder:text-dark-muted resize-none focus:outline-none min-h-[40px]"
        />

        <button
          onClick={handleSubmit}
          disabled={!text.trim()}
          className={`
            flex items-center justify-center w-9 h-9 mr-1.5 mb-1.5 border-2 transition-all flex-shrink-0
            ${text.trim()
              ? 'border-nb-black bg-nb-green text-nb-black shadow-nb-sm hover:shadow-nb active:translate-x-[2px] active:translate-y-[2px] active:shadow-none'
              : 'border-nb-gray-300 dark:border-dark-border bg-nb-gray-100 dark:bg-dark-elevated text-nb-gray-400 dark:text-dark-muted cursor-not-allowed'
            }
          `}
        >
          <Send size={14} />
        </button>
      </div>
    </div>
  );
}
