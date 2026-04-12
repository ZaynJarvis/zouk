import { useGlitch } from '../../hooks/useGlitch';
import type { ReactNode } from 'react';

interface Props {
  children: ReactNode;
  className?: string;
  as?: 'span' | 'h1' | 'h2' | 'h3' | 'p' | 'div';
  intensity?: 'low' | 'medium' | 'high';
}

export default function GlitchText({ children, className = '', as: Tag = 'span', intensity = 'medium' }: Props) {
  const isNightCity = document.documentElement.getAttribute('data-theme') === 'night-city';

  const config = intensity === 'high'
    ? { minInterval: 1000, maxInterval: 3000, minSeverity: 0.5, maxSeverity: 1.0 }
    : intensity === 'low'
    ? { minInterval: 4000, maxInterval: 8000, minSeverity: 0.1, maxSeverity: 0.4 }
    : { minInterval: 2000, maxInterval: 5000, minSeverity: 0.3, maxSeverity: 0.8 };

  const ref = useGlitch<HTMLElement>(config);

  if (!isNightCity) {
    return <Tag className={className}>{children}</Tag>;
  }

  const textContent = typeof children === 'string' ? children : undefined;

  return (
    <Tag ref={ref as never} className={`glitch-text relative ${className}`} data-text={textContent}>
      {children}
    </Tag>
  );
}
