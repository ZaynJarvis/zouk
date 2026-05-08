import { useState, useSyncExternalStore } from 'react';
import { Bot, MessageSquare, Paperclip } from 'lucide-react';
import { useApp } from '../store/AppContext';
import type { MessageRecord } from '../types';
import { getAttachmentUrl } from '../lib/api';
import { getStoredLinkTransforms, subscribeLinkTransforms, type LinkTransformRule } from '../store/storage';
import { parseMarkdown } from '../lib/markdown';
import StatusDot from './StatusDot';
import { agentStatus, avatarRadiusClass } from '../lib/avatarStatus';
import ImageLightbox from './ImageLightbox';
import FailableImage from './FailableImage';

// Treat an attachment as an image if the server provided a content type (the
// canonical signal) or, as a fallback for pre-feature messages, by extension.
function isImageAttachment(att: { filename: string; contentType?: string }): boolean {
  if (att.contentType?.startsWith('image/')) return true;
  return /\.(png|jpe?g|gif|webp|avif|heic|heif|bmp|svg)$/i.test(att.filename || '');
}

function formatTime(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

// ── Task badge helpers ───────────────────────────────────────────────────────
function taskStatusStyle(status: string): string {
  switch (status) {
    case 'todo': return 'bg-nc-elevated border-nc-border text-nc-muted';
    case 'in_progress': return 'bg-nc-cyan/10 border-nc-cyan/30 text-nc-cyan';
    case 'in_review': return 'bg-nc-yellow/10 border-nc-yellow/30 text-nc-yellow';
    case 'done': return 'bg-nc-green/10 border-nc-green/30 text-nc-green';
    default: return 'bg-nc-elevated border-nc-border text-nc-muted';
  }
}

function taskStatusIcon(status: string): string {
  switch (status) {
    case 'todo': return '\u25CB';
    case 'in_progress': return '\u25D1';
    case 'in_review': return '\u25D4';
    case 'done': return '\u25CF';
    default: return '\u25CB';
  }
}

// ── Sender colour ────────────────────────────────────────────────────────────
const senderColorVars = ['--nc-cyan', '--nc-red', '--nc-green', '--nc-magenta', '--nc-yellow', '--nc-indigo'];
function getSenderColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return `rgb(var(${senderColorVars[Math.abs(hash) % senderColorVars.length]}))`;
}

// ── Inline thread preview ───────────────────────────────────────────────────
function InlineThreadBlock({ parent, replies, replyCount }: { parent: MessageRecord; replies: MessageRecord[]; replyCount: number }) {
  const { openThread, humans, agents, authUser, currentUser } = useApp();
  const totalLabel = replyCount === 1 ? '1 reply' : `${replyCount} replies`;
  return (
    <div className="mt-2 border-l-2 border-nc-cyan/40 pl-3 py-1.5 bg-nc-cyan/[0.03] rounded-r-sm">
      <ul className="space-y-1">
        {replies.map((reply) => {
          const name = reply.sender_name || 'unknown';
          const isAgentReply = reply.sender_type === 'agent';
          const human = !isAgentReply ? humans.find(h => h.name === name) : undefined;
          const agent = isAgentReply ? agents.find(a => a.name === name || a.displayName === name) : undefined;
          const isSelf = !isAgentReply && name === currentUser;
          const picture = human?.picture || human?.gravatarUrl || agent?.picture || (isSelf ? authUser?.picture || authUser?.gravatarUrl : undefined);
          const color = getSenderColor(name);
          return (
            <li key={reply.id}>
              <button
                type="button"
                onClick={() => openThread(parent)}
                className="w-full flex items-center gap-2 text-left hover:bg-nc-elevated/40 rounded-sm px-1 py-0.5 transition-colors"
              >
                <span
                  className="w-5 h-5 flex-shrink-0 font-display font-bold text-[0.65rem] flex items-center justify-center select-none overflow-hidden rounded-sm"
                  style={{ backgroundColor: `${color}20`, color }}
                  aria-hidden="true"
                >
                  {picture ? (
                    <img src={picture} alt="" className="w-full h-full object-cover" />
                  ) : isAgentReply ? (
                    <Bot size={11} />
                  ) : (
                    name.charAt(0).toUpperCase()
                  )}
                </span>
                <span className="font-bold text-xs truncate" style={{ color }}>{name}</span>
                <span className="text-xs text-nc-text truncate flex-1 min-w-0">{reply.content || ''}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <button
        type="button"
        onClick={() => openThread(parent)}
        title={`Reply in thread · ${totalLabel}`}
        className="mt-1 inline-flex items-center gap-1.5 text-xs font-mono font-bold text-nc-cyan hover:text-nc-text-bright transition-colors"
      >
        <MessageSquare size={12} />
        {totalLabel}
      </button>
    </div>
  );
}

// ── Component ────────────────────────────────────────────────────────────────
export default function MessageItem({
  message,
  isGrouped = false,
  hideInlineThread = false,
}: {
  message: MessageRecord;
  isGrouped?: boolean;
  // Suppress the inline reply preview + hover thread action. Used when the
  // caller is already rendering the full thread list next to this message
  // (e.g. the ThreadPanel header), so we don't duplicate the entry.
  hideInlineThread?: boolean;
}) {
  const { humans, agents, configs, currentUser, authUser, openAgentProfile, openThread, threadedMessageIds, theme } = useApp();
  const avatarRadius = avatarRadiusClass(theme);
  const linkRules = useSyncExternalStore(subscribeLinkTransforms, getStoredLinkTransforms);
  const senderName = message.sender_name || 'Unknown';
  const isAgent = message.sender_type === 'agent';
  const isSystem = message.sender_type === 'system';
  const senderHuman = !isAgent && !isSystem ? humans.find(h => h.name === senderName) : undefined;
  // Trigger API messages arrive as senderType='human' + senderName='system'.
  // The name is reserved (see RESERVED_USER_NAMES on the server) so no real
  // human can match — treat them as synthetic and render an empty-frame avatar.
  const isSyntheticSystem = !isAgent && !isSystem && senderName === 'system' && !senderHuman;
  const senderAgent = isAgent ? agents.find(a => a.name === senderName || a.displayName === senderName) : undefined;
  const senderAgentConfig = isAgent && !senderAgent
    ? configs.find(c => c.name === senderName || c.displayName === senderName)
    : undefined;
  const agentProfileId = senderAgent?.id || senderAgentConfig?.id;
  const isSelf = !isAgent && !isSystem && senderName === currentUser;
  const selfPicture = isSelf ? authUser?.picture || authUser?.gravatarUrl : undefined;
  const senderPicture = senderHuman?.picture || senderHuman?.gravatarUrl || senderAgent?.picture || selfPicture;
  const timestamp = message.timestamp || '';
  const color = getSenderColor(senderName);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const imageAttachments = (message.attachments || []).filter(isImageAttachment);
  const fileAttachments = (message.attachments || []).filter((a) => !isImageAttachment(a));

  // System messages — compact, muted, centred
  if (isSystem) {
    return (
      <div className="flex items-center gap-3 px-5 py-1">
        <div className="flex-1 border-t border-nc-border/40" />
        <span className="text-2xs font-mono text-nc-muted/60 px-2 text-center whitespace-nowrap">
          {message.content}
        </span>
        <div className="flex-1 border-t border-nc-border/40" />
      </div>
    );
  }

  const hasInlineThread = (message.replies?.length ?? 0) > 0
    || threadedMessageIds.has(message.id.slice(0, 8));
  // Start-a-thread entry for messages that don't already surface one inline.
  // Hidden by default so 0-reply messages don't add clutter; revealed on hover
  // over the message row (and focus, for keyboard users).
  const canStartThread = !hideInlineThread
    && message.channel_type !== 'thread'
    && !hasInlineThread;

  return (
    <div className="group relative px-4 sm:px-6 hover:bg-nc-elevated/40 transition-colors duration-100 overflow-hidden">
      {canStartThread && (
        <button
          type="button"
          onClick={() => openThread(message)}
          title="Reply in thread"
          aria-label="Reply in thread"
          className={`absolute ${isGrouped ? 'top-1.5' : 'top-4'} right-2 z-10 inline-flex items-center justify-center p-1 text-nc-muted bg-nc-elevated/80 border border-nc-border rounded-sm opacity-0 group-hover:opacity-100 focus:opacity-100 [@media(pointer:coarse)]:opacity-100 hover:text-nc-cyan hover:border-nc-cyan/50 transition-opacity`}
        >
          <MessageSquare size={12} />
        </button>
      )}
      <div className={`flex gap-3 sm:gap-4 ${isGrouped ? 'py-0.5' : 'pt-5 pb-1'}`}>
        {/* Avatar column */}
        {isGrouped ? (
          <div className="w-8 sm:w-9 flex-shrink-0 flex items-start justify-center">
            <span className="text-2xs text-nc-muted opacity-0 group-hover:opacity-100 transition-opacity pt-0.5 font-mono tabular-nums">
              {timestamp && formatTime(timestamp)}
            </span>
          </div>
        ) : isAgent && agentProfileId ? (
          <div className="relative w-8 h-8 sm:w-9 sm:h-9 flex-shrink-0 mt-0.5">
            <button
              type="button"
              onClick={() => openAgentProfile(agentProfileId)}
              title={`View @${senderName} profile`}
              className={`w-8 h-8 sm:w-9 sm:h-9 font-display font-bold text-xs flex items-center justify-center select-none overflow-hidden transition-transform hover:scale-105 hover:ring-1 hover:ring-nc-cyan focus:outline-none focus:ring-1 focus:ring-nc-cyan ${avatarRadius}`}
              style={{
                backgroundColor: `${color}12`,
                color,
                boxShadow: `0 0 10px ${color}18`,
              }}
            >
              {senderPicture ? (
                <img src={senderPicture} alt="" className="w-full h-full object-cover" />
              ) : <Bot size={15} />}
            </button>
            {senderAgent && (
              <StatusDot status={agentStatus(senderAgent)} hideWhen={['offline', 'online']} />
            )}
          </div>
        ) : isSyntheticSystem ? (
          <div className="w-8 h-8 sm:w-9 sm:h-9 flex-shrink-0 mt-0.5">
            <div className={`w-8 h-8 sm:w-9 sm:h-9 border border-nc-border ${avatarRadius}`} />
          </div>
        ) : (
          <div className="relative w-8 h-8 sm:w-9 sm:h-9 flex-shrink-0 mt-0.5">
            <div
              className={`w-8 h-8 sm:w-9 sm:h-9 font-display font-bold text-xs flex items-center justify-center select-none overflow-hidden ${avatarRadius}`}
              style={{
                backgroundColor: `${color}12`,
                color,
                boxShadow: isAgent ? `0 0 10px ${color}18` : undefined,
              }}
            >
              {senderPicture ? (
                <img src={senderPicture} alt="" className="w-full h-full object-cover" />
              ) : isAgent ? <Bot size={15} /> : senderName.charAt(0).toUpperCase()}
            </div>
            {isAgent && senderAgent && (
              <StatusDot status={agentStatus(senderAgent)} hideWhen={['offline', 'online']} />
            )}
          </div>
        )}

        {/* Message body */}
        <div className="flex-1 min-w-0">
          {!isGrouped && (
            <div className="flex items-baseline gap-2 mb-1">
              <span className="font-display font-bold text-sm leading-none" style={{ color }}>
                {senderName}
              </span>
              {timestamp && (
                <span className="text-2xs text-nc-muted font-mono tabular-nums">
                  {formatTime(timestamp)}
                </span>
              )}
            </div>
          )}

          {/* Rendered content */}
          <div className="min-w-0 msg-body">
            {message.content ? parseMarkdown(message.content, linkRules) : null}
          </div>

          {/* Image attachments — inline thumbnails, click to open lightbox */}
          {imageAttachments.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-2">
              {imageAttachments.map((att, i) => (
                <button
                  key={att.id}
                  type="button"
                  onClick={() => setLightboxIndex(i)}
                  className="block border border-nc-border bg-nc-black overflow-hidden hover:border-nc-cyan/60 transition-colors"
                  aria-label={`Open ${att.filename}`}
                >
                  <FailableImage
                    src={getAttachmentUrl(att.id)}
                    alt={att.filename}
                    className="max-w-[260px] sm:max-w-[320px] max-h-[240px] object-cover"
                    fallbackClassName="w-40 h-28"
                    loading="lazy"
                  />
                </button>
              ))}
            </div>
          )}

          {/* Non-image attachments — keep the existing link chip */}
          {fileAttachments.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-2">
              {fileAttachments.map((att) => (
                <a
                  key={att.id}
                  href={getAttachmentUrl(att.id)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 px-2 py-1 border border-nc-cyan/30 bg-nc-cyan/5 text-xs font-medium text-nc-cyan hover:bg-nc-cyan/10 transition-colors"
                >
                  <Paperclip size={12} />
                  {att.filename}
                </a>
              ))}
            </div>
          )}

          {lightboxIndex !== null && imageAttachments.length > 0 && (
            <ImageLightbox
              images={imageAttachments.map((a) => ({
                id: a.id,
                src: getAttachmentUrl(a.id),
                alt: a.filename,
              }))}
              initialIndex={lightboxIndex}
              onClose={() => setLightboxIndex(null)}
            />
          )}

          {/* Task badge */}
          {message.task_status && (
            <div className="mt-2 flex items-center gap-2 flex-wrap">
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 border text-xs font-bold uppercase font-mono ${taskStatusStyle(message.task_status)}`}>
                {taskStatusIcon(message.task_status)} #{message.task_number} {message.task_status.replace('_', ' ')}
              </span>
              {message.task_assignee_id && (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 border border-nc-border text-2xs text-nc-muted font-mono">
                  &rarr; @{message.task_assignee_id}
                </span>
              )}
            </div>
          )}

          {/* Inline thread preview — only for parents that actually have replies. */}
          {!hideInlineThread && message.channel_type !== 'thread' && (message.replies?.length ?? 0) > 0 && (
            <InlineThreadBlock
              parent={message}
              replies={message.replies!}
              replyCount={message.reply_count ?? message.replies!.length}
            />
          )}
        </div>
      </div>
    </div>
  );
}
