import { useEffect, useCallback, useState } from 'react';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';

export interface LightboxImage {
  id: string;
  src: string;
  alt: string;
}

interface Props {
  images: LightboxImage[];
  initialIndex: number;
  onClose: () => void;
}

// Full-screen image viewer. Desktop: centered with letterbox backdrop.
// Phone (`<lg` ≈ <1024px): fills the viewport; close button pinned to the
// bottom-right inside safe-area.
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

  return (
    <div
      className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center animate-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label={current.alt}
    >
      <img
        src={current.src}
        alt={current.alt}
        className="max-w-full max-h-full lg:max-w-[90vw] lg:max-h-[90vh] object-contain select-none"
        onClick={(e) => e.stopPropagation()}
        draggable={false}
      />

      {images.length > 1 && (
        <>
          <button
            type="button"
            onClick={prev}
            aria-label="Previous image"
            className="absolute left-3 top-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center bg-nc-surface/70 text-nc-text hover:bg-nc-surface border border-nc-border"
          >
            <ChevronLeft size={20} />
          </button>
          <button
            type="button"
            onClick={next}
            aria-label="Next image"
            className="absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center bg-nc-surface/70 text-nc-text hover:bg-nc-surface border border-nc-border"
          >
            <ChevronRight size={20} />
          </button>
          <div className="absolute top-3 left-1/2 -translate-x-1/2 px-2 py-1 bg-nc-surface/70 border border-nc-border text-xs font-mono text-nc-muted">
            {index + 1} / {images.length}
          </div>
        </>
      )}

      <button
        type="button"
        onClick={onClose}
        aria-label="Close image viewer"
        className="absolute right-4 bottom-4 safe-bottom safe-right w-10 h-10 flex items-center justify-center bg-nc-surface/70 text-nc-text hover:bg-nc-surface border border-nc-border"
      >
        <X size={20} />
      </button>
    </div>
  );
}
