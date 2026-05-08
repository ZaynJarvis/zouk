import { useState, useSyncExternalStore } from 'react';
import { MessageSquare, Paperclip } from 'lucide-react';
import { useApp } from '../store/AppContext';
import type { MessageRecord } from '../types';
import { getAttachmentUrl } from '../lib/api';
import { getStoredLinkTransforms, subscribeLinkTransforms } from '../store/storage';
import { parseMarkdown } from '../lib/markdown';
import StatusDot from './StatusDot';
import { agentStatus } from '../lib/avatarStatus';
import ImageLightbox from './ImageLightbox';
import FailableImage from './FailableImage';
import { Avatar } from './zk/primitives';

function isImageAttachment(att: { filename: string; contentType?: string }): boolean {
  if (att.contentType?.startsWith('image/')) return true;
  return /\.(png|jpe?g|gif|webp|avif|heic|heif|bmp|svg)$/i.test(att.filename || '');
}

function formatTime(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/* ── Task badge tone ────────────────────────────────────────────────── */

function taskPillCls(status: string): string {
  switch (status) {
    case 'todo': return 'zk-pill';
    case 'in_progress': return 'zk-pill zk-pill--info';
    case 'in_review': return 'zk-pill zk-pill--warn';
    case 'done': return 'zk-pill zk-pill--ok';
    default: return 'zk-pill';
  }
}

function taskStatusIcon(status: string): string {
  switch (status) {
    case 'todo': return '○';
    case 'in_progress': return '◑';
    case 'in_review': return '◔';
    case 'done': return '●';
    default: return '○';
  }
}

/* ── Inline thread preview (kept) ───────────────────────────────────── */

function InlineThreadBlock({
  parent, replies, replyCount,
}: { parent: MessageRecord; replies: MessageRecord[]; replyCount: number }) {
  const { openThread, humans, agents, authUser, currentUser } = useApp();
  const totalLabel = replyCount === 1 ? '1 reply' : `${replyCount} replies`;

  return (
    <div
      style={{
        marginTop: 6,
        // Subtle left rule + indent — no full-width ember-soft band.
        borderLeft: '2px solid var(--zk-ember-line)',
        paddingLeft: 10,
        display: 'flex',
        flexDirection: 'column',
        gap: 3,
        // Cap the visual span so the preview doesn't stretch to the full
        // message column when content is short.
        maxWidth: 640,
      }}
    >
      {replies.slice(0, 3).map((reply) => {
        const name = reply.sender_name || 'unknown';
        const isAgentReply = reply.sender_type === 'agent';
        const human = !isAgentReply ? humans.find((h) => h.name === name) : undefined;
        const agent = isAgentReply ? agents.find((a) => a.name === name || a.displayName === name) : undefined;
        const isSelf = !isAgentReply && name === currentUser;
        const picture = human?.picture || human?.gravatarUrl || agent?.picture
          || (isSelf ? authUser?.picture || authUser?.gravatarUrl : undefined);
        const content = (reply.content || '').replace(/\s+/g, ' ').trim();

        return (
          <button
            key={reply.id}
            type="button"
            onClick={() => openThread(parent)}
            className="zk-row"
            style={{
              alignSelf: 'flex-start',
              maxWidth: '100%',
              gap: 6,
              padding: '2px 6px 2px 2px',
              background: 'transparent',
              border: 0,
              borderRadius: 4,
              cursor: 'pointer',
              color: 'inherit',
              textAlign: 'left',
              transition: 'background 140ms var(--zk-ease-out)',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--zk-bg-2)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
          >
            <Avatar src={picture} name={name} kind={isAgentReply ? 'agent' : 'human'} size="sm" />
            <span
              style={{
                fontSize: 12, fontWeight: 600,
                color: isAgentReply ? 'var(--zk-ink)' : 'var(--zk-info)',
                flexShrink: 0,
              }}
            >
              {name}
            </span>
            {content && (
              <span
                className="zk-truncate"
                style={{ fontSize: 12, color: 'var(--zk-ink-dim)', minWidth: 0 }}
              >
                {content}
              </span>
            )}
          </button>
        );
      })}

      {/* Compact "N replies" pill — alignSelf:flex-start so it doesn't stretch. */}
      <button
        type="button"
        onClick={() => openThread(parent)}
        title={`Reply in thread · ${totalLabel}`}
        style={{
          alignSelf: 'flex-start',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          marginTop: 2,
          padding: '2px 8px 2px 6px',
          fontSize: 11,
          background: 'transparent',
          border: '1px solid var(--zk-ember-line)',
          borderRadius: 999,
          color: 'var(--zk-ember)',
          fontWeight: 500,
          cursor: 'pointer',
          lineHeight: 1.3,
        }}
      >
        <MessageSquare size={11} />
        {totalLabel}
      </button>
    </div>
  );
}

/* ── Component ──────────────────────────────────────────────────────── */

export default function MessageItem({
  message,
  isGrouped = false,
  hideInlineThread = false,
}: {
  message: MessageRecord;
  isGrouped?: boolean;
  hideInlineThread?: boolean;
}) {
  const { humans, agents, configs, currentUser, authUser, openAgentProfile, openThread, threadedMessageIds } = useApp();
  const linkRules = useSyncExternalStore(subscribeLinkTransforms, getStoredLinkTransforms);
  const senderName = message.sender_name || 'Unknown';
  const isAgent = message.sender_type === 'agent';
  const isSystem = message.sender_type === 'system';
  const senderHuman = !isAgent && !isSystem ? humans.find((h) => h.name === senderName) : undefined;
  const isSyntheticSystem = !isAgent && !isSystem && senderName === 'system' && !senderHuman;
  const senderAgent = isAgent ? agents.find((a) => a.name === senderName || a.displayName === senderName) : undefined;
  const senderAgentConfig = isAgent && !senderAgent
    ? configs.find((c) => c.name === senderName || c.displayName === senderName)
    : undefined;
  const agentProfileId = senderAgent?.id || senderAgentConfig?.id;
  const isSelf = !isAgent && !isSystem && senderName === currentUser;
  const selfPicture = isSelf ? authUser?.picture || authUser?.gravatarUrl : undefined;
  const senderPicture = senderHuman?.picture || senderHuman?.gravatarUrl || senderAgent?.picture || selfPicture;
  const timestamp = message.timestamp || '';
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const imageAttachments = (message.attachments || []).filter(isImageAttachment);
  const fileAttachments = (message.attachments || []).filter((a) => !isImageAttachment(a));

  // System messages — compact, muted, centred
  if (isSystem) {
    return (
      <div className="zk-row" style={{ gap: 12, padding: '4px 22px' }}>
        <div className="zk-grow" style={{ borderTop: '1px solid var(--zk-line)' }} />
        <span
          style={{
            fontSize: 10, color: 'var(--zk-ink-low)',
            fontFamily: 'var(--zk-font-mono)', textAlign: 'center', padding: '0 8px',
          }}
        >
          {message.content}
        </span>
        <div className="zk-grow" style={{ borderTop: '1px solid var(--zk-line)' }} />
      </div>
    );
  }

  const hasInlineThread = (message.replies?.length ?? 0) > 0
    || threadedMessageIds.has(message.id.slice(0, 8));
  const canStartThread = !hideInlineThread
    && message.channel_type !== 'thread'
    && !hasInlineThread;
  const senderColor = isAgent ? 'var(--zk-ink)' : 'var(--zk-info)';

  return (
    <div
      className="group"
      style={{
        position: 'relative',
        padding: isGrouped ? '0 22px' : '8px 22px 0',
        transition: 'background 140ms var(--zk-ease-out)',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--zk-bg-1)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
    >
      {canStartThread && (
        <button
          type="button"
          onClick={() => openThread(message)}
          title="Reply in thread"
          aria-label="Reply in thread"
          className="zk-btn zk-btn--ghost zk-btn--icon"
          style={{
            position: 'absolute',
            top: isGrouped ? 4 : 10,
            right: 12, zIndex: 5,
            opacity: 0,
            transition: 'opacity 140ms var(--zk-ease-out)',
            padding: 4,
          }}
          onFocus={(e) => { e.currentTarget.style.opacity = '1'; }}
          onBlur={(e) => { e.currentTarget.style.opacity = ''; }}
        >
          <MessageSquare size={11} />
        </button>
      )}

      <div
        className="zk-row"
        style={{
          alignItems: 'flex-start',
          gap: 12,
          padding: isGrouped ? '2px 0' : '8px 0 4px',
        }}
      >
        {/* Avatar column */}
        {isGrouped ? (
          <div
            style={{ width: 28, flexShrink: 0, display: 'flex', justifyContent: 'center' }}
          >
            <span
              style={{
                fontSize: 10, color: 'var(--zk-ink-low)',
                fontFamily: 'var(--zk-font-mono)',
                opacity: 0,
                transition: 'opacity 140ms var(--zk-ease-out)',
                paddingTop: 2,
              }}
              className="group-hover:opacity-100"
            >
              {timestamp && formatTime(timestamp)}
            </span>
          </div>
        ) : isSyntheticSystem ? (
          <div
            style={{
              width: 28, height: 28, flexShrink: 0,
              border: '1px solid var(--zk-line)',
              borderRadius: 6,
            }}
          />
        ) : isAgent && agentProfileId ? (
          <button
            type="button"
            onClick={() => openAgentProfile(agentProfileId)}
            title={`View @${senderName} profile`}
            style={{
              position: 'relative',
              padding: 0, border: 0, background: 'transparent',
              cursor: 'pointer',
            }}
          >
            <Avatar
              src={senderPicture}
              name={senderName}
              kind="agent"
            />
            {senderAgent && (
              <StatusDot status={agentStatus(senderAgent)} hideWhen={['offline', 'online']} />
            )}
          </button>
        ) : (
          <div style={{ position: 'relative' }}>
            <Avatar
              src={senderPicture}
              name={senderName}
              kind={isAgent ? 'agent' : 'human'}
            />
            {isAgent && senderAgent && (
              <StatusDot status={agentStatus(senderAgent)} hideWhen={['offline', 'online']} />
            )}
          </div>
        )}

        {/* Body */}
        <div className="zk-grow zk-col" style={{ minWidth: 0 }}>
          {!isGrouped && (
            <div
              className="zk-row"
              style={{ gap: 8, alignItems: 'baseline', marginBottom: 2 }}
            >
              <span style={{ fontWeight: 600, fontSize: 13, color: senderColor }}>
                {senderName}
              </span>
              {isAgent && (
                <span
                  className="zk-pill"
                  style={{ fontSize: 9, padding: '1px 5px', color: 'var(--zk-ink-mute)' }}
                >
                  AGENT
                </span>
              )}
              {timestamp && (
                <span
                  style={{
                    fontSize: 11, color: 'var(--zk-ink-mute)',
                    fontFamily: 'var(--zk-font-mono)',
                  }}
                  className="zk-tabular"
                >
                  {formatTime(timestamp)}
                </span>
              )}
            </div>
          )}

          {/* Markdown body */}
          <div className="zk-prose msg-body" style={{ minWidth: 0 }}>
            {message.content ? parseMarkdown(message.content, linkRules) : null}
          </div>

          {/* Image attachments */}
          {imageAttachments.length > 0 && (
            <div className="zk-row" style={{ gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
              {imageAttachments.map((att, i) => (
                <button
                  key={att.id}
                  type="button"
                  onClick={() => setLightboxIndex(i)}
                  style={{
                    display: 'block',
                    border: '1px solid var(--zk-line)',
                    background: 'var(--zk-bg-1)',
                    borderRadius: 8,
                    padding: 0,
                    cursor: 'pointer', overflow: 'hidden',
                    transition: 'border-color 140ms var(--zk-ease-out)',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--zk-line-bright)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--zk-line)'; }}
                  aria-label={`Open ${att.filename}`}
                >
                  <FailableImage
                    src={getAttachmentUrl(att.id)}
                    alt={att.filename}
                    className="block"
                    style={{ maxWidth: 320, maxHeight: 240, objectFit: 'cover' }}
                    fallbackClassName="w-40 h-28"
                    loading="lazy"
                  />
                </button>
              ))}
            </div>
          )}

          {/* Non-image attachments — V1-style file chip */}
          {fileAttachments.length > 0 && (
            <div className="zk-row" style={{ gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
              {fileAttachments.map((att) => (
                <a
                  key={att.id}
                  href={getAttachmentUrl(att.id)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="zk-row"
                  style={{
                    gap: 8,
                    padding: '8px 12px',
                    background: 'var(--zk-bg-2)',
                    border: '1px solid var(--zk-line)',
                    borderRadius: 6,
                    color: 'var(--zk-ink)',
                    textDecoration: 'none',
                    fontSize: 12,
                  }}
                >
                  <Paperclip size={12} color="var(--zk-ember)" />
                  <span style={{ fontFamily: 'var(--zk-font-mono)' }}>{att.filename}</span>
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
            <div className="zk-row" style={{ gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
              <span className={taskPillCls(message.task_status)}>
                {taskStatusIcon(message.task_status)} #{message.task_number} {message.task_status.replace('_', ' ')}
              </span>
              {message.task_assignee_id && (
                <span className="zk-pill">
                  &rarr; @{message.task_assignee_id}
                </span>
              )}
            </div>
          )}

          {/* Inline thread preview */}
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
