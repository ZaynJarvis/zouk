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
      // Right panels render fixed inset-0 on phone (App.tsx), so their content
      // would otherwise sit under the iOS notch / home indicator. Pad with
      // env() insets directly so the standalone-PWA `.safe-bottom { 0 }`
      // override doesn't disable the bottom inset for these full-screen panels.
      // On desktop env() returns 0 so this is a no-op.
      style={{
        paddingTop: 'env(safe-area-inset-top, 0px)',
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
      }}
    >
      {children}
    </div>
  );
}
