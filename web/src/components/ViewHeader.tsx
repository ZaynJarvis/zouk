import { ChevronDown } from 'lucide-react';
import { useState, type CSSProperties, type ReactNode } from 'react';
import { useApp } from '../store/AppContext';
import MobileMenuButton from './MobileMenuButton';

type Variant = 'canvas' | 'sidebar';
type MetaPlacement = 'inline' | 'block';

type Props = {
  title: string;
  meta?: ReactNode;
  actions?: ReactNode;
  variant?: Variant;
  showMobileMenu?: boolean;
  metaPlacement?: MetaPlacement;
};

const CANVAS_HEADER_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  paddingTop: 'calc(env(safe-area-inset-top, 0px) + 12px)',
  paddingRight: 18,
  paddingBottom: 12,
  paddingLeft: 18,
  borderBottom: '1px solid var(--zk-line)',
  flexShrink: 0,
  // Let dense action groups (e.g. MemoryView's Memory/Files + Columns/Tree +
  // Refresh) scroll horizontally on narrow viewports instead of overflowing
  // the app shell. Matches the old MemoryView header's explicit overflow:auto.
  overflowX: 'auto',
};

const SIDEBAR_HEADER_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 12,
  padding: '16px 16px 12px',
  flexShrink: 0,
};

const TITLE_BASE: CSSProperties = {
  margin: '2px 0 0',
  fontWeight: 600,
  letterSpacing: '-0.012em',
  color: 'var(--zk-ink)',
};

export default function ViewHeader({
  title,
  meta,
  actions,
  variant = 'canvas',
  showMobileMenu,
  metaPlacement,
}: Props) {
  const { workspaces, activeWorkspaceId, workspaceMenuOpen, setWorkspaceMenuOpen } = useApp();
  const activeWorkspace =
    workspaces.find((w) => w.id === activeWorkspaceId)
    || workspaces[0]
    || { id: 'default', name: 'Default', icon: 'z' };

  const placement: MetaPlacement = metaPlacement ?? (variant === 'sidebar' ? 'block' : 'inline');
  const shouldShowMobile = showMobileMenu ?? variant === 'canvas';
  const headerStyle = variant === 'canvas' ? CANVAS_HEADER_STYLE : SIDEBAR_HEADER_STYLE;
  const titleSize = variant === 'canvas' ? 19 : 17;
  const workspaceLabel = (activeWorkspace.name || 'Default').toUpperCase();

  return (
    <header style={headerStyle}>
      {shouldShowMobile && <MobileMenuButton />}
      <div className="zk-col" style={{ minWidth: 0, gap: 2, flex: 1 }}>
        <WorkspaceSwitcher
          label={workspaceLabel}
          onOpen={() => setWorkspaceMenuOpen(true)}
          ariaLabel={`Switch workspace (current: ${activeWorkspace.name})`}
          variant={variant}
          menuOpen={workspaceMenuOpen}
        />
        {placement === 'inline' ? (
          <div className="zk-row" style={{ gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
            <h1 className="zk-display" style={{ ...TITLE_BASE, fontSize: titleSize }}>
              {title}
            </h1>
            {meta != null && (
              <span
                style={{
                  fontSize: 12,
                  color: 'var(--zk-ink-mute)',
                  fontFamily: 'var(--zk-font-mono)',
                }}
              >
                · {meta}
              </span>
            )}
          </div>
        ) : (
          <>
            <h1 className="zk-display" style={{ ...TITLE_BASE, fontSize: titleSize }}>
              {title}
            </h1>
            {meta != null && (
              <div
                style={{
                  marginTop: 4,
                  fontSize: 10,
                  color: 'var(--zk-ink-mute)',
                  fontFamily: 'var(--zk-font-mono)',
                }}
              >
                {meta}
              </div>
            )}
          </>
        )}
      </div>
      {actions != null && (
        <div
          className="zk-row"
          style={{ gap: 8, alignItems: 'center', flexShrink: 0 }}
        >
          {actions}
        </div>
      )}
    </header>
  );
}

function WorkspaceSwitcher({
  label,
  onOpen,
  ariaLabel,
  variant,
  menuOpen,
}: {
  label: string;
  onOpen: () => void;
  ariaLabel: string;
  variant: Variant;
  menuOpen: boolean;
}) {
  const [hover, setHover] = useState(false);
  const eyebrowFontSize = variant === 'sidebar' ? 9 : 10;
  return (
    <>
      {/* Mobile (<lg): WorkspaceRail isn't mounted, so the switcher would
          do nothing. Render a static eyebrow instead — keeps the workspace
          identity visible without a dead interaction. */}
      <span
        className="zk-eyebrow lg:hidden"
        style={{
          alignSelf: 'flex-start',
          fontSize: eyebrowFontSize,
          color: 'var(--zk-ink-mute)',
          padding: '2px 0',
        }}
      >
        {label}
      </span>
      {/* Desktop (lg+): interactive switcher that opens the WorkspaceRail menu. */}
      <button
        type="button"
        onClick={onOpen}
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        className="hidden lg:inline-flex zk-row"
        style={{
          alignSelf: 'flex-start',
          gap: 4,
          padding: '2px 6px',
          marginLeft: -6,
          background: hover ? 'var(--zk-bg-2)' : 'transparent',
          border: `1px solid ${hover ? 'var(--zk-line)' : 'transparent'}`,
          borderRadius: 6,
          cursor: 'pointer',
          color: hover ? 'var(--zk-ink-dim)' : 'var(--zk-ink-mute)',
          transition: 'background 120ms ease, color 120ms ease, border-color 120ms ease',
        }}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onFocus={() => setHover(true)}
        onBlur={() => setHover(false)}
      >
        <span
          className="zk-eyebrow"
          style={{
            fontSize: eyebrowFontSize,
            color: 'inherit',
          }}
        >
          {label}
        </span>
        <ChevronDown size={11} style={{ color: 'var(--zk-ink-low)' }} />
      </button>
    </>
  );
}
