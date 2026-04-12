import { useGlitch } from '../../hooks/useGlitch';
import type { ReactNode } from 'react';

interface Props {
  children: ReactNode;
  className?: string;
}

export default function ScanlineTear({ children, className = '' }: Props) {
  const ref = useGlitch<HTMLDivElement>({
    minInterval: 3000,
    maxInterval: 7000,
    minDuration: 150,
    maxDuration: 400,
    minSeverity: 0.3,
    maxSeverity: 1.0,
  });

  return (
    <div ref={ref} className={`scanline-tear relative overflow-hidden ${className}`}>
      {children}
      <div
        className="pointer-events-none absolute inset-0 z-10 mix-blend-screen"
        style={{
          clipPath: 'inset(var(--glitch-clip-top, 100%) 0 var(--glitch-clip-bottom, 100%) 0)',
          transform: 'translateX(var(--glitch-offset-x, 0px))',
          opacity: 'var(--glitch-active, 0)',
          background: 'linear-gradient(90deg, rgba(94, 246, 255, 0.15) 0%, transparent 50%, rgba(247, 80, 73, 0.15) 100%)',
        }}
      />
    </div>
  );
}
