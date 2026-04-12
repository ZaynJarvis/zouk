import { useGlitch } from '../../hooks/useGlitch';
import type { GlitchConfig } from '../../hooks/useGlitch';
import type { ReactNode } from 'react';

interface ScanlineTearProps {
  children: ReactNode;
  className?: string;
  config?: GlitchConfig;
  tearContent?: ReactNode;
}

export default function ScanlineTear({ children, className = '', config, tearContent }: ScanlineTearProps) {
  const ref = useGlitch<HTMLDivElement>({
    minInterval: 2000,
    maxInterval: 5000,
    minSeverity: 0.4,
    maxSeverity: 1.0,
    ...config,
  });

  return (
    <div ref={ref} className={`scanline-tear ${className}`}>
      <div className="scanline-tear__base">{children}</div>
      <div
        className="scanline-tear__overlay"
        style={{
          clipPath: 'inset(var(--glitch-clip-top, 100%) 0 var(--glitch-clip-bottom, 100%) 0)',
          transform: 'translateX(var(--glitch-offset-x, 0px))',
          visibility: 'var(--glitch-visibility, hidden)' as React.CSSProperties['visibility'],
        }}
      >
        {tearContent || children}
      </div>
    </div>
  );
}
