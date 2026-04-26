import type { ReactNode } from 'react';

type PanelShellProps = {
  children: ReactNode;
  widthClassName?: string;
  className?: string;
  bgClassName?: string;
  animated?: boolean;
  centered?: boolean;
};

function joinClasses(...classNames: Array<string | false | null | undefined>) {
  return classNames.filter(Boolean).join(' ');
}

export default function PanelShell({
  children,
  widthClassName = 'w-screen lg:w-[380px]',
  className,
  bgClassName = 'bg-nc-surface',
  animated = false,
  centered = false,
}: PanelShellProps) {
  return (
    <div
      className={joinClasses(
        widthClassName,
        'h-full border-l border-nc-border flex flex-col',
        bgClassName,
        animated && 'animate-slide-in-right',
        centered && 'items-center justify-center',
        className,
      )}
    >
      {children}
    </div>
  );
}
