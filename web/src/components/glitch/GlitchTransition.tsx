import { useState, useEffect, useCallback } from 'react';

interface Props {
  active: boolean;
  duration?: number;
  onComplete?: () => void;
  children?: React.ReactNode;
}

const GLITCH_CHARS = '!<>-_\\/[]{}#$%^&*()=+|;:\'",.<>?~`@0123456789';

export default function GlitchTransition({ active, duration = 600, onComplete, children }: Props) {
  const [phase, setPhase] = useState<'idle' | 'glitching' | 'done'>('idle');
  const [bars, setBars] = useState<Array<{ top: number; height: number; offset: number; color: string }>>([]);
  const [scrambleText, setScrambleText] = useState('');

  const generateBars = useCallback(() => {
    const count = 3 + Math.floor(Math.random() * 5);
    const colorVars = ['--nc-cyan', '--nc-red', '--nc-magenta', '--nc-yellow'];
    return Array.from({ length: count }, () => ({
      top: Math.random() * 100,
      height: 1 + Math.random() * 8,
      offset: (Math.random() - 0.5) * 40,
      colorVar: colorVars[Math.floor(Math.random() * colorVars.length)],
    }));
  }, []);

  const generateScramble = useCallback(() => {
    return Array.from({ length: 20 }, () =>
      GLITCH_CHARS[Math.floor(Math.random() * GLITCH_CHARS.length)]
    ).join('');
  }, []);

  useEffect(() => {
    if (!active) {
      setPhase('idle');
      return;
    }

    setPhase('glitching');
    const steps = Math.floor(duration / 50);
    let step = 0;

    const interval = setInterval(() => {
      setBars(generateBars());
      setScrambleText(generateScramble());
      step++;
      if (step >= steps) {
        clearInterval(interval);
        setPhase('done');
        onComplete?.();
      }
    }, 50);

    return () => clearInterval(interval);
  }, [active, duration, generateBars, generateScramble, onComplete]);

  if (phase === 'idle') return <>{children}</>;

  return (
    <>
      {children}
      <div className="fixed inset-0 z-[9999] pointer-events-none">
        <div
          className="absolute inset-0"
          style={{
            background: phase === 'glitching'
              ? 'rgb(var(--nc-black) / 0.85)'
              : 'transparent',
            transition: 'background 0.2s',
          }}
        />

        {phase === 'glitching' && bars.map((bar, i) => (
          <div
            key={i}
            className="absolute left-0 right-0"
            style={{
              top: `${bar.top}%`,
              height: `${bar.height}%`,
              transform: `translateX(${bar.offset}px)`,
              background: `rgb(var(${bar.colorVar}) / 0.13)`,
              borderTop: `1px solid rgb(var(${bar.colorVar}) / 0.4)`,
              borderBottom: `1px solid rgb(var(${bar.colorVar}) / 0.4)`,
              mixBlendMode: 'screen',
            }}
          />
        ))}

        {phase === 'glitching' && (
          <div className="absolute inset-0 flex items-center justify-center">
            <span
              className="font-mono text-nc-cyan text-sm tracking-[0.3em] opacity-40"
              style={{ textShadow: '-2px 0 rgb(var(--nc-red)), 2px 0 rgb(var(--nc-cyan))' }}
            >
              {scrambleText}
            </span>
          </div>
        )}

        {phase === 'glitching' && (
          <div
            className="absolute inset-0 opacity-[0.03]"
            style={{
              backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgb(var(--nc-cyan) / 0.1) 2px, rgb(var(--nc-cyan) / 0.1) 4px)',
            }}
          />
        )}
      </div>
    </>
  );
}
