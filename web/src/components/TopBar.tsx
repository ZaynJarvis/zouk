/* TopBar — channel/dm/tasks/memory header.
   On channel/dm view this matches the V1Channel header from
   tmp/.../zouk-rethink/v1-conservative.jsx (CHANNEL eyebrow + Hash glyph +
   name + counts + actions). On other views it shows a simpler title. */

import { Settings, Menu } from 'lucide-react';
import { useApp } from '../store/AppContext';
import { Hash } from './zk/primitives';

export default function TopBar() {
  const {
    activeChannelName, viewMode,
    channels, agents, humans, openChannelSettings, isGuest,
    activeThreadMessage, setSidebarOpen,
  } = useApp();

  const inHomeView = viewMode === 'channel' || viewMode === 'dm';
  const activeChannel = viewMode === 'channel'
    ? channels.find((c) => c.name === activeChannelName) ?? null
    : null;

  const channelAgents = activeChannel
    ? agents.filter((a) => (a.channels || []).includes(activeChannel.name))
    : [];

  if (!inHomeView) {
    return (
      <button
        type="button"
        onClick={() => setSidebarOpen(true)}
        className="zk-btn zk-btn--ghost zk-btn--icon top-bar-mobile-fab lg:!hidden"
        aria-label="Open menu"
        title="Open menu"
        style={{
          background: 'var(--zk-bg-1)',
          border: '1px solid var(--zk-line)',
          boxShadow: '0 10px 28px rgba(15, 23, 42, 0.14)',
        }}
      >
        <Menu size={16} />
      </button>
    );
  }

  return (
    <header
      className="safe-top top-bar-mobile-fixed"
      style={{
        background: 'var(--zk-bg-0)',
        borderBottom: '1px solid var(--zk-line)',
        flexShrink: 0,
      }}
    >
      <div
        className="zk-row"
        style={{
          padding: '14px 22px 12px',
          gap: 16,
          minHeight: 56,
        }}
      >
        {/* Mobile drawer toggle (lg-). `lg:!hidden` carries `!important` so it
            beats `.zk-btn { display: inline-flex }` from zk-tokens — without
            it the button leaked onto desktop. */}
        <button
          type="button"
          onClick={() => setSidebarOpen(true)}
          className="zk-btn zk-btn--ghost zk-btn--icon lg:!hidden"
          aria-label="Open menu"
          title="Open menu"
        >
          <Menu size={16} />
        </button>

        {/* Title block — only on channel/dm. Full-canvas views (memory/tasks/agents)
            render their own header, so we suppress here to avoid a duplicate. */}
        {inHomeView ? (
          <div className="zk-col zk-grow" style={{ minWidth: 0 }}>
            <span className="zk-eyebrow hidden lg:block" style={{ fontSize: 9 }}>CHANNEL</span>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginTop: 2 }}>
              <h1
                className="zk-display zk-truncate"
                style={{ margin: 0, fontWeight: 600, fontSize: 19, letterSpacing: '-0.012em', color: 'var(--zk-ink)' }}
              >
                <Hash name={activeChannelName} dim />
              </h1>
              {activeChannel && (
                <span
                  className="hidden lg:inline"
                  style={{
                    color: 'var(--zk-ink-mute)', fontSize: 12,
                    fontFamily: 'var(--zk-font-mono)',
                  }}
                >
                  {channelAgents.length} agents · {humans.length} humans
                </span>
              )}
              {activeThreadMessage && (
                <span
                  style={{
                    fontFamily: 'var(--zk-font-display)',
                    fontSize: 18, fontWeight: 500,
                    color: 'var(--zk-ink-mute)',
                  }}
                >
                  · Thread
                </span>
              )}
            </div>
          </div>
        ) : (
          <div className="zk-grow" />
        )}
        {activeChannel && !isGuest && (
          <div className="zk-row" style={{ gap: 4 }}>
            <button
              type="button"
              onClick={() => openChannelSettings(activeChannel.id)}
              className="zk-btn zk-btn--ghost zk-btn--icon hidden lg:inline-flex"
              title={`Configure #${activeChannel.name}`}
              aria-label={`Configure channel ${activeChannel.name}`}
            >
              <Settings size={14} />
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
