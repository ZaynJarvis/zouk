import { useLayoutEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { useApp } from '../store/AppContext';
import MessageItem from './MessageItem';
import MessageComposer from './MessageComposer';
import PanelShell from './panel/PanelShell';

export default function ThreadPanel() {
  const { activeThreadMessage, threadMessages, closeRightPanel } = useApp();
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastThreadIdRef = useRef<string | null>(null);
  const activeThreadId = activeThreadMessage?.id ?? null;

  // On thread open and on every reply that arrives, jump to the bottom
  // without animation so the latest message lands in view immediately.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || !activeThreadId) return;
    const isNewThread = lastThreadIdRef.current !== activeThreadId;
    el.scrollTop = el.scrollHeight;
    if (isNewThread) lastThreadIdRef.current = activeThreadId;
  }, [activeThreadId, threadMessages.length]);

  if (!activeThreadMessage) return null;

  const shortId = activeThreadMessage.id.slice(0, 8);
  const threadTarget = activeThreadMessage.channel_type === 'dm'
    ? `dm:@${activeThreadMessage.channel_name}:${shortId}`
    : `#${activeThreadMessage.channel_name}:${shortId}`;
  const parentChannelType = activeThreadMessage.parent_channel_type ?? activeThreadMessage.channel_type;
  const parentChannelName = activeThreadMessage.parent_channel_name ?? activeThreadMessage.channel_name;
  const parentLabel = parentChannelType === 'dm' ? `@${parentChannelName}` : `#${parentChannelName}`;

  return (
    <PanelShell
      animated
      widthClassName="w-screen lg:w-[760px] lg:max-w-[46vw]"
      bgClassName="bg-nc-black"
      safeArea="none"
    >
      <div
        className="lg:hidden flex-shrink-0 border-b border-nc-border"
        style={{
          paddingTop: 'env(safe-area-inset-top, 0px)',
          background: 'var(--zk-bg-0)',
        }}
      >
        <div className="h-12 px-3 flex items-center gap-3">
          <h2 className="flex-1 min-w-0 truncate font-display text-[15px] font-semibold text-nc-text-bright">
            {parentLabel} - Threads
          </h2>
          <button
            type="button"
            onClick={closeRightPanel}
            aria-label="Close thread"
            title="Close thread"
            className="zk-btn zk-btn--ghost zk-btn--icon flex-shrink-0"
            style={{ width: 32, height: 32 }}
          >
            <X size={16} />
          </button>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto scrollbar-thin">
        <div className="border-b border-nc-border pb-2">
          <MessageItem message={activeThreadMessage} hideInlineThread />
        </div>

        {threadMessages.length > 0 && (
          <div className="px-3 py-2">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-nc-cyan uppercase tracking-wider font-mono">
                {threadMessages.length} {threadMessages.length === 1 ? 'reply' : 'replies'}
              </span>
              <div className="flex-1 cyber-divider" />
            </div>
          </div>
        )}

        {threadMessages.map((msg, i) => {
          const isGrouped = i > 0 && threadMessages[i - 1].sender_name === msg.sender_name;
          return <MessageItem key={msg.id} message={msg} isGrouped={isGrouped} />;
        })}
      </div>

      <MessageComposer threadTarget={threadTarget} placeholder="Reply..." />
    </PanelShell>
  );
}
