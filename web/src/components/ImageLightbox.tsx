import { useEffect, useCallback, useState } from 'react';
import type { MouseEvent } from 'react';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';
import FailableImage from './FailableImage';

export interface LightboxImage {
  id: string;
  src: string;
  alt: string;
  width?: number;
  height?: number;
}

interface Props {
  images: LightboxImage[];
  initialIndex: number;
  onClose: () => void;
}

// Full-screen image viewer. Desktop: centered with letterbox backdrop.
// Phone (`<lg` ≈ <1024px): fills the viewport. On phone the close button sits
// at the top-right so it never sits under the MessageComposer that pins the
// bottom of the chat shell; desktop keeps the bottom-right placement since
// the letterbox leaves clear backdrop there.
export default function ImageLightbox({ images, initialIndex, onClose }: Props) {
  const [index, setIndex] = useState(initialIndex);
  const current = images[index];

  const next = useCallback(() => setIndex((i) => (i + 1) % images.length), [images.length]);
  const prev = useCallback(() => setIndex((i) => (i - 1 + images.length) % images.length), [images.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight' && images.length > 1) next();
      else if (e.key === 'ArrowLeft' && images.length > 1) prev();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, next, prev, images.length]);

  if (!current) return null;

  // Backdrop dismiss: any click that bubbles up to the outer div closes the
  // lightbox. Interactive children (image, nav buttons, counter, X button)
  // stopPropagation so their clicks don't bubble. The previous
  // `e.target === e.currentTarget` check failed when the click landed on a
  // descendant (e.g. the img element's whitespace from `object-contain`
  // letterboxing) — that target check would never match, leaving the only
  // working dismiss the X button.
  const stop = (e: MouseEvent) => e.stopPropagation();

  return (
    <div
      className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center animate-fade-in"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={current.alt}
    >
      <FailableImage
        src={current.src}
        alt={current.alt}
        width={current.width}
        height={current.height}
        className="max-w-full max-h-full lg:max-w-[90vw] lg:max-h-[90vh] object-contain select-none"
        fallbackClassName="w-[240px] h-[180px] border border-nc-border"
        onClick={stop}
        draggable={false}
      />

      {images.length > 1 && (
        <>
          <button
            type="button"
            onClick={(e) => { stop(e); prev(); }}
            aria-label="Previous image"
            className="absolute left-3 top-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center bg-nc-surface/70 text-nc-text hover:bg-nc-surface border border-nc-border"
          >
            <ChevronLeft size={20} />
          </button>
          <button
            type="button"
            onClick={(e) => { stop(e); next(); }}
            aria-label="Next image"
            className="absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center bg-nc-surface/70 text-nc-text hover:bg-nc-surface border border-nc-border"
          >
            <ChevronRight size={20} />
          </button>
          <div
            onClick={stop}
            className="absolute top-3 left-1/2 -translate-x-1/2 px-2 py-1 bg-nc-surface/70 border border-nc-border text-xs font-mono text-nc-muted"
          >
            {index + 1} / {images.length}
          </div>
        </>
      )}

      <button
        type="button"
        onClick={(e) => { stop(e); onClose(); }}
        aria-label="Close image viewer"
        className="absolute right-[calc(env(safe-area-inset-right,0px)+1rem)] top-[calc(env(safe-area-inset-top,0px)+1rem)] lg:top-auto lg:bottom-[calc(env(safe-area-inset-bottom,0px)+1rem)] w-10 h-10 flex items-center justify-center bg-nc-surface/70 text-nc-text hover:bg-nc-surface border border-nc-border"
      >
        <X size={20} />
      </button>
    </div>
  );
}
