import type { ReactNode } from 'react';

export interface ZkSegmentItem<T extends string> {
  value: T;
  label: ReactNode;
  disabled?: boolean;
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
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          className={value === opt.value ? 'is-active' : ''}
          onClick={() => onChange(opt.value)}
          disabled={opt.disabled}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
