import { useLayoutEffect, useRef } from 'react';
import { Hash } from 'lucide-react';
import { useApp } from '../store/AppContext';
import MessageItem from './MessageItem';
import MessageComposer from './MessageComposer';
import PanelShell from './panel/PanelShell';
import PanelHeader from './panel/PanelHeader';

export default function ThreadPanel() {
  const { activeThreadMessage, threadMessages, closeRightPanel, activeChannelName } = useApp();
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastThreadIdRef = useRef<string | null>(null);

  // On thread open and on every reply that arrives, jump to the bottom
  // without animation so the latest message lands in view immediately.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || !activeThreadMessage) return;
    const isNewThread = lastThreadIdRef.current !== activeThreadMessage.id;
    el.scrollTop = el.scrollHeight;
    if (isNewThread) lastThreadIdRef.current = activeThreadMessage.id;
  }, [activeThreadMessage?.id, threadMessages.length]);

  if (!activeThreadMessage) return null;

  const shortId = activeThreadMessage.id.slice(0, 8);
  const threadTarget = activeThreadMessage.channel_type === 'dm'
    ? `dm:@${activeThreadMessage.channel_name}:${shortId}`
    : `#${activeThreadMessage.channel_name}:${shortId}`;

  return (
    <PanelShell animated widthClassName="w-screen lg:w-[760px] lg:max-w-[46vw]">
      <PanelHeader onClose={closeRightPanel} leftClassName="flex items-center gap-2">
        <>
          <h3 className="font-display font-extrabold text-base text-nc-text-bright tracking-wider">THREAD</h3>
          <span className="flex items-center gap-1 text-xs text-nc-muted font-mono">
            <Hash size={12} />{activeChannelName}
          </span>
        </>
      </PanelHeader>

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
