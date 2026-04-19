import type { ReactNode } from 'react';
import { X } from 'lucide-react';

type PanelHeaderProps = {
  children: ReactNode;
  onClose: () => void;
  className?: string;
  leftClassName?: string;
  closeButtonClassName?: string;
  closeTitle?: string;
};

function joinClasses(...classNames: Array<string | false | null | undefined>) {
  return classNames.filter(Boolean).join(' ');
}

export default function PanelHeader({
  children,
  onClose,
  className,
  leftClassName,
  closeButtonClassName,
  closeTitle,
}: PanelHeaderProps) {
  return (
    <div className={joinClasses('h-14 border-b border-nc-border flex items-center justify-between px-4', className)}>
      <div className={joinClasses('min-w-0', leftClassName)}>
        {children}
      </div>
      <button
        type="button"
        onClick={onClose}
        title={closeTitle}
        aria-label={closeTitle || 'Close panel'}
        className={joinClasses(
          'w-8 h-8 border border-nc-border flex items-center justify-center text-nc-muted hover:border-nc-red hover:text-nc-red hover:bg-nc-red/10 transition-all shrink-0',
          closeButtonClassName,
        )}
      >
        <X size={16} />
      </button>
    </div>
  );
}
