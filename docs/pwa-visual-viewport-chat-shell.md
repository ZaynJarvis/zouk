# PWA Visual Viewport Chat Shell

This note documents the mobile/PWA keyboard layout used by the Zouk chat view.
It exists because mobile virtual keyboards can move or resize the visual
viewport while leaving layout-viewport `position: fixed` behavior unreliable.

## Goal

In the phone/PWA conversation view:

- The header stays visually pinned to the top of the visible viewport.
- The composer stays at the lowest visible point above the virtual keyboard.
- The message list is the only scrolling surface.
- Opening the keyboard from a mid-scroll position preserves the text just above
  the composer instead of jumping to the latest message.
- Closing the keyboard does not fight the browser animation with repeated
  `scrollTop` writes.

## Accepted Model

The whole chat column follows the visual viewport as one shell:

```text
visual shell
├─ TopBar
├─ message scroller
└─ composer
```

The shell is fixed and uses two CSS variables:

- `--zouk-vv-height = visualViewport.height`
- `--zouk-vv-top = visualViewport.offsetTop`

CSS applies those variables like this:

```css
.zouk-vv-chat-shell {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: var(--zouk-vv-height, 100dvh);
  transform: translate3d(0, var(--zouk-vv-top, 0px), 0);
}
```

Inside this shell, the mobile `TopBar` is no longer separately fixed. It becomes
a normal shell row, and the old fixed-header spacer is hidden. This keeps the
header, content, and composer in one coordinate system during keyboard
animation.

## Scroll Anchor

When the textarea is about to focus, capture the message scroller bottom offset:

```text
bottomOffset = scrollHeight - scrollTop - clientHeight
```

While the keyboard opens and the scroller gets shorter, preserve that offset:

```text
scrollTop = scrollHeight - clientHeight - bottomOffset
```

This gives the desired behavior in both cases:

- Already at bottom: `bottomOffset = 0`, so the latest message stays pinned.
- Mid-scroll: the content above the composer is pushed up with the composer
  instead of snapping to the latest message.

On blur/keyboard close, Zouk does not preserve the anchor. The close path only
syncs the shell to `visualViewport`; it intentionally avoids `scrollTop` writes
so browser keyboard animation stays smoother.

## Files

- `web/index.html`
  - viewport meta uses `interactive-widget=resizes-visual`
- `web/src/hooks/useVisualViewportChatShell.ts`
  - visual viewport sync
  - focus with `preventScroll`
  - bottom-anchor preservation during open
  - outside-composer blur
  - stale animation-loop cancellation
  - no scroll writes during close
- `web/src/App.tsx`
  - enables the shell only for mobile conversation views
  - adds `.zouk-vv-chat-shell` to the chat column
- `web/src/components/MessageList.tsx`
  - marks the message scroll element with `.zouk-vv-chat-scroller`
- `web/src/components/MessageComposer.tsx`
  - marks the top-level composer with `.zouk-vv-chat-composer`
- `web/src/index.css`
  - body fixed while the visual viewport shell is active
  - shell transform/height CSS
  - TopBar becomes relative inside the shell
  - mobile TopBar spacer is hidden inside the shell

## Do Not Do

- Do not keep the header as a separate fixed element while the composer follows
  the visual viewport. Mixed coordinate systems cause visible jitter.
- Do not call `scrollToBottom()` when the textarea focuses. It breaks mid-scroll
  reading position.
- Do not write `scrollTop` repeatedly during keyboard close. It can make the
  close animation feel stuck or stepped.
- Do not rely on `100vh` for this interaction in PWA mode. Use
  `visualViewport.height`.

## Validation

The synthetic mobile check should verify:

- viewport meta contains `interactive-widget=resizes-visual`
- `.zouk-vv-chat-shell` exists on mobile conversation view
- `html.visual-viewport-active` is set while active
- mobile `TopBar` computes to `position: relative` inside the shell
- `.top-bar-mobile-spacer` is hidden inside the shell
- simulated `offsetTop=80,height=520` maps to shell top `80` and height `520`
- mid-scroll `bottomOffset` remains stable while opening the keyboard
- message scroller bottom does not pass composer top
- tapping outside the composer blurs the textarea
- closing keyboard does not write `scrollTop`
