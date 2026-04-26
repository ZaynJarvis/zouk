import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { Bot, User, Menu, ImagePlus, X } from 'lucide-react';
import { useApp } from '../store/AppContext';
import { isMobileViewport, isStandalonePWA } from '../lib/layout';
import { uploadAttachment } from '../lib/api';
import {
  buildMentionSearchTerms,
  filterMentionTargets,
  MENTION_QUERY_REGEX,
  toMentionHandle,
  type MentionTarget,
} from '../lib/mentions';
import StatusDot from './StatusDot';
import { agentStatus, humanStatus } from '../lib/avatarStatus';
import FailableImage from './FailableImage';

const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024; // mirrors server multer limit

interface PendingImage {
  key: string;        // stable react key + tag until upload finishes
  file: File;
  previewUrl: string; // blob URL for thumbnail preview
}

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
  const { sendMessage, activeChannelName, viewMode, agents, humans, isGuest, theme, sidebarOpen, setSidebarOpen, addToast, closeRightPanel } = useApp();
  const draftKey = threadTarget ?? `${viewMode}:${activeChannelName}`;
  const draftsRef = useRef<Map<string, string>>(new Map());
  const [text, setText] = useState(() => draftsRef.current.get(draftKey) ?? '');
  const textRef = useRef(text);
  textRef.current = text;
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [isMobileSurface, setIsMobileSurface] = useState(() => isMobileViewport() || isStandalonePWA());
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  const pendingImagesRef = useRef<PendingImage[]>([]);
  pendingImagesRef.current = pendingImages;
  const [isSending, setIsSending] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const dragCounter = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Revoke any outstanding preview blob URLs on unmount.
  useEffect(() => {
    return () => {
      for (const p of pendingImagesRef.current) URL.revokeObjectURL(p.previewUrl);
    };
  }, []);

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

  const showMobileSidebarBtn = isMobileSurface && !sidebarOpen;
  const showCloseThreadBtn = isMobileSurface && !!threadTarget && !text.trim();
  const showImageBtn = !text.trim();
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
        status: agentStatus(a),
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
        status: humanStatus(h),
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

  const addImageFiles = useCallback((files: File[]) => {
    if (isGuest || files.length === 0) return;
    const accepted: PendingImage[] = [];
    for (const file of files) {
      if (!file.type.startsWith('image/')) continue;
      if (file.size > MAX_ATTACHMENT_BYTES) {
        addToast(`${file.name || 'image'} is larger than 5MB`, 'error');
        continue;
      }
      accepted.push({
        key: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        file,
        previewUrl: URL.createObjectURL(file),
      });
    }
    if (accepted.length > 0) setPendingImages((prev) => [...prev, ...accepted]);
  }, [isGuest, addToast]);

  const removePendingImage = useCallback((key: string) => {
    setPendingImages((prev) => {
      const hit = prev.find((p) => p.key === key);
      if (hit) URL.revokeObjectURL(hit.previewUrl);
      return prev.filter((p) => p.key !== key);
    });
  }, []);

  const handleSubmit = useCallback(async () => {
    const trimmed = text.trim();
    const images = pendingImagesRef.current;
    if (!trimmed && images.length === 0) return;
    if (isSending) return;
    setIsSending(true);
    let attachmentIds: string[] | undefined;
    try {
      if (images.length > 0) {
        const uploads = await Promise.all(images.map((p) => uploadAttachment(p.file)));
        attachmentIds = uploads.map((u) => u.id);
      }
    } catch {
      addToast('Failed to upload image', 'error');
      setIsSending(false);
      return;
    }
    const ok = await sendMessage(trimmed, threadTarget, attachmentIds);
    setIsSending(false);
    if (!ok) return;
    setText('');
    for (const p of images) URL.revokeObjectURL(p.previewUrl);
    setPendingImages([]);
    draftsRef.current.delete(draftKey);
    setMentionQuery(null);
    setSuppressedAtPos(null);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [text, sendMessage, threadTarget, draftKey, isSending, addToast]);

  const handlePaste = useCallback((e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (isGuest) return;
    const items = e.clipboardData?.items;
    if (!items) return;
    const files: File[] = [];
    for (const item of Array.from(items)) {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const f = item.getAsFile();
        if (f) files.push(f);
      }
    }
    if (files.length === 0) return;
    // Keep default behavior for accompanying text (no preventDefault unless we
    // actually pulled images) — rich-text pastes with embedded images still
    // drop their caption text into the textarea.
    e.preventDefault();
    addImageFiles(files);
  }, [isGuest, addImageFiles]);

  const handleFilePick = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const list = e.target.files;
    if (!list) return;
    addImageFiles(Array.from(list));
    e.target.value = ''; // allow selecting the same file again next time
  }, [addImageFiles]);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    dragCounter.current++;
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    dragCounter.current = Math.max(0, dragCounter.current - 1);
    if (dragCounter.current === 0) setIsDragOver(false);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current = 0;
    setIsDragOver(false);
    if (isGuest) return;
    addImageFiles(Array.from(e.dataTransfer.files));
  }, [isGuest, addImageFiles]);

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
              const status = match.status ?? 'online';
              const offline = status === 'offline';
              const meta = status === 'working' ? 'working' : offline ? 'offline' : match.type;
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
                      <Bot size={14} className={offline ? 'text-nc-muted' : 'text-nc-green'} />
                    ) : (
                      <User size={14} className={offline ? 'text-nc-muted' : 'text-nc-cyan'} />
                    )}
                    <StatusDot status={status} size="sm" ringClass="border-nc-surface" />
                  </span>
                  <div className="min-w-0 flex flex-col">
                    <span className="font-bold font-mono truncate">@{match.mention}</span>
                    {match.label !== match.mention && (
                      <span className="text-xs text-nc-muted truncate">{match.label}</span>
                    )}
                  </div>
                  <span className="text-xs text-nc-muted ml-auto font-mono">
                    {meta}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {pendingImages.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-2">
            {pendingImages.map((img) => (
              <div
                key={img.key}
                className="relative w-16 h-16 border border-nc-border bg-nc-black overflow-hidden group"
              >
                <FailableImage
                  src={img.previewUrl}
                  alt={img.file.name}
                  className="w-full h-full object-cover"
                />
                <button
                  type="button"
                  onClick={() => removePendingImage(img.key)}
                  aria-label={`Remove ${img.file.name}`}
                  className="absolute top-0 right-0 w-5 h-5 flex items-center justify-center bg-nc-black/70 text-nc-text hover:bg-nc-red hover:text-white transition-colors"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
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
          <div
            className={`composer-surface flex-1 min-w-0 flex flex-col border cyber-bevel-sm cursor-text transition-[border-color,background-color] duration-150 ${
              isDragOver
                ? 'border-dashed border-nc-cyan bg-nc-cyan/[0.04]'
                : `bg-nc-black border-nc-border ${theme === 'washington-post' ? 'focus-within:border-[#7c2430]' : 'focus-within:border-nc-cyan'}`
            }`}
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            onClick={(e) => {
              if (isDragOver) return;
              // Clicking dead space around the textarea should focus the composer.
              // Skip interactive children so their native click behaviour
              // (image attach button, textarea itself) still wins.
              const target = e.target as HTMLElement;
              if (target.closest('button, a, textarea, input')) return;
              textareaRef.current?.focus();
            }}
          >
          {/* Drop zone — visible (and expands the composer) only while dragging */}
          <div
            className={`overflow-hidden transition-[height,opacity] duration-150 ease-out pointer-events-none ${
              isDragOver ? 'h-16 opacity-100' : 'h-0 opacity-0'
            }`}
          >
            <div className="h-full flex items-center justify-center gap-2 text-nc-cyan text-sm font-mono select-none">
              <ImagePlus size={16} />
              Drop to attach image
            </div>
          </div>
          <div className="flex items-end">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={handleFilePick}
            className="hidden"
          />
          <div
            className={`flex-shrink-0 self-end overflow-hidden transition-[width,opacity] duration-150 ease-out ${
              showImageBtn ? 'w-9 sm:w-10 opacity-100' : 'w-0 opacity-0'
            }`}
            aria-hidden={!showImageBtn}
          >
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isGuest}
              tabIndex={showImageBtn ? 0 : -1}
              aria-label="Attach image"
              className="w-9 h-9 sm:w-10 sm:h-10 flex items-center justify-center text-nc-muted hover:text-nc-cyan disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <ImagePlus size={18} />
            </button>
          </div>
          <textarea
            ref={textareaRef}
            value={text}
            onChange={handleChange}
            onSelect={handleSelect}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            enterKeyHint="send"
            disabled={isGuest}
            placeholder={composerPlaceholder}
            rows={1}
            className={`composer-textarea flex-1 min-w-0 py-1.5 sm:py-2 pr-3 sm:pr-3 bg-transparent font-body text-nc-text placeholder:text-nc-muted resize-none focus:outline-none min-h-[36px] sm:min-h-[40px] disabled:cursor-not-allowed transition-[padding] duration-150 ease-out ${showImageBtn ? 'pl-0' : 'pl-3'}`}
          />
          </div>
          </div>
          {showCloseThreadBtn && (
            <button
              type="button"
              onClick={closeRightPanel}
              aria-label="Close thread"
              className="lg:hidden flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center border border-nc-border text-nc-muted bg-nc-surface hover:text-nc-cyan hover:border-nc-cyan/50 transition-colors"
            >
              <X size={18} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
