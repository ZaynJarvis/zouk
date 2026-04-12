import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { Send, Bot, User } from 'lucide-react';
import { useApp } from '../store/AppContext';

export default function MessageComposer({ threadTarget, placeholder }: { threadTarget?: string; placeholder?: string }) {
  const { sendMessage, activeChannelName, viewMode, agents, humans } = useApp();
  const [text, setText] = useState('');
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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
    const before = text.slice(0, cursorPos);
    const atIdx = before.lastIndexOf('@');
    if (atIdx < 0) return;
    const newText = text.slice(0, atIdx) + `@${name} ` + text.slice(cursorPos);
    setText(newText);
    setMentionQuery(null);
    setMentionIndex(0);
    requestAnimationFrame(() => {
      el.focus();
      const newPos = atIdx + name.length + 2;
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

    const el = textareaRef.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = Math.min(el.scrollHeight, 200) + 'px';
    }

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

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    const onBlur = () => setTimeout(() => setMentionQuery(null), 150);
    el.addEventListener('blur', onBlur);
    return () => el.removeEventListener('blur', onBlur);
  }, []);

  const channelLabel = viewMode === 'dm' ? `@${activeChannelName}` : `#${activeChannelName}`;

  return (
    <div className="px-5 pb-4 pt-2 relative">
      {mentionQuery !== null && mentionMatches.length > 0 && (
        <div className="absolute bottom-full left-5 right-5 mb-1 border border-cyber-border bg-cyber-surface shadow-neon-cyan z-20 max-h-[240px] overflow-y-auto">
          {mentionMatches.map((match, i) => (
            <button
              key={match.name}
              onMouseDown={(e) => { e.preventDefault(); insertMention(match.name); }}
              className={`w-full flex items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors ${
                i === mentionIndex
                  ? 'bg-cyber-cyan/10 text-cyber-cyan'
                  : 'text-cyber-chrome-200 hover:bg-cyber-elevated'
              }`}
            >
              {match.type === 'agent'
                ? <Bot size={14} className="flex-shrink-0 text-cyber-green" />
                : <User size={14} className="flex-shrink-0 text-cyber-cyan" />
              }
              <span className="font-bold font-mono">@{match.name}</span>
              <span className="text-xs text-cyber-chrome-500 ml-auto font-mono uppercase">{match.type}</span>
            </button>
          ))}
        </div>
      )}

      <div className="flex items-end gap-2 border border-cyber-border bg-cyber-surface transition-all focus-within:border-cyber-cyan/40 focus-within:shadow-cyber-sm">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={placeholder || `Message ${channelLabel}`}
          rows={1}
          className="flex-1 px-3 py-2.5 bg-transparent text-sm font-body text-cyber-chrome-100 placeholder:text-cyber-chrome-500 resize-none focus:outline-none min-h-[40px]"
        />

        <button
          onClick={handleSubmit}
          disabled={!text.trim()}
          className={`
            flex items-center justify-center w-9 h-9 mr-1.5 mb-1.5 border transition-all flex-shrink-0
            ${text.trim()
              ? 'border-cyber-cyan/40 bg-cyber-cyan/10 text-cyber-cyan hover:bg-cyber-cyan/20 hover:shadow-neon-cyan'
              : 'border-cyber-border bg-cyber-elevated text-cyber-chrome-600 cursor-not-allowed'
            }
          `}
        >
          <Send size={14} />
        </button>
      </div>
    </div>
  );
}
