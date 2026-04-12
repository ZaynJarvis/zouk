import { useState, useRef, useCallback } from 'react';
import { Send } from 'lucide-react';
import { useApp } from '../store/AppContext';

export default function MessageComposer({ threadTarget, placeholder }: { threadTarget?: string; placeholder?: string }) {
  const { sendMessage, activeChannelName, viewMode } = useApp();
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSubmit = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed) return;
    sendMessage(trimmed, threadTarget);
    setText('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [text, sendMessage, threadTarget]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }, [handleSubmit]);

  const handleInput = useCallback(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = Math.min(el.scrollHeight, 200) + 'px';
    }
  }, []);

  const channelLabel = viewMode === 'dm' ? `@${activeChannelName}` : `#${activeChannelName}`;

  return (
    <div className="px-5 pb-4 pt-2">
      <div className="flex items-end gap-2 border-3 border-nb-black dark:border-dark-border bg-nb-white dark:bg-dark-surface shadow-nb transition-shadow focus-within:shadow-nb-lg">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={e => { setText(e.target.value); handleInput(); }}
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
