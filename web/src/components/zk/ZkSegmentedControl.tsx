import type { ReactNode } from 'react';

export interface ZkSegmentItem<T extends string> {
  value: T;
  label: ReactNode;
  disabled?: boolean;
  tone?: 'accent' | 'ok' | 'neutral' | 'info' | 'warn' | 'err';
}

export interface ZkSegmentedControlProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: ZkSegmentItem<T>[];
  className?: string;
  style?: React.CSSProperties;
}

export default function ZkSegmentedControl<T extends string>({
  value,
  onChange,
  options,
  className = '',
  style,
}: ZkSegmentedControlProps<T>) {
  return (
    <div className={`zk-seg ${className}`} style={style}>
      {options.map((opt) => {
        const active = value === opt.value;
        const tone = opt.tone || 'accent';
        return (
          <button
            key={opt.value}
            type="button"
            className={[active ? 'is-active' : '', active ? `is-${tone}` : ''].filter(Boolean).join(' ')}
            aria-pressed={active}
            onClick={() => onChange(opt.value)}
            disabled={opt.disabled}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
