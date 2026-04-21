import { useState } from 'react';
import type { ImgHTMLAttributes } from 'react';

interface Props extends ImgHTMLAttributes<HTMLImageElement> {
  // Classes for the fallback empty box. Defaults to `className` so the
  // placeholder keeps the same shape as the image would have had. Callers
  // should supply explicit dimensions when the image itself only sets
  // `max-w-*` / `max-h-*` (an intrinsically-sized image collapses to 0x0
  // once the src fails and we render a div instead).
  fallbackClassName?: string;
}

// <img> that swaps to a border-only empty box on load error. Used uniformly
// for every image render in the app (message thumbnails, lightbox, composer
// preview) so a broken attachment always looks like an empty framed box —
// no icon, no filename, no broken-image glyph.
export default function FailableImage({
  fallbackClassName,
  onError,
  className,
  alt,
  ...rest
}: Props) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return <div className={fallbackClassName ?? className} role="img" aria-label={alt} />;
  }
  return (
    <img
      {...rest}
      alt={alt}
      className={className}
      onError={(e) => {
        setFailed(true);
        onError?.(e);
      }}
    />
  );
}
