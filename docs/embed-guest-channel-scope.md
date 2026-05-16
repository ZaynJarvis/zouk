# Zouk Scoped Embed Guest Sessions

## Goal

Allow an external website such as `https://studio.zaynjarvis.com` to embed a small Zouk chat surface without requiring Google or Supabase redirect setup for that external origin.

Zouk's responsibility stops at the connection contract: permission configuration, scoped token minting, REST history/send, and websocket delivery. How an external site arranges blog content, page navigation, prompts, or product-specific message flows belongs to that external site.

The MVP success criterion is deliberately minimal:

1. A visitor can open the external page and send/read Zouk messages as a scoped guest.
2. Switching back to Zouk and opening the same workspace/channel shows those messages in normal Zouk history.
3. The conversation can continue from Zouk or from the external page because both surfaces use the same underlying channel messages.

The first version is channel-scoped, not agent-scoped. This keeps setup stable even when agents have not been created yet: the external widget can read and write only the configured Zouk channels, and agents can join those channels through the normal Zouk channel membership model.

## Non-Goals

- Do not expose machine keys to browser code.
- Do not use `/api/trigger` for the embedded frontend. It is public-channel write-only and does not provide history, websocket state, or browser identity.
- Do not grant a full Zouk user session to external visitors.
- Do not solve agent-scoped DM in v1. Agent/DM scope can be added after the channel-scoped MVP works.

## Security Model

Workspace admins configure an embed policy inside Zouk workspace settings:

- `enabled`: whether external embed guest sessions are allowed for this workspace.
- `allowedOrigins`: exact external origins allowed to request guest tokens, for example `https://studio.zaynjarvis.com`.
- `allowedChannelIds`: channel IDs the embed guest can read and write.
- `tokenTtlSeconds`: short token lifetime. Default: 3600 seconds. Recommended range: 5 minutes to 24 hours.

The browser on the external site calls:

```http
POST /api/auth/embed-guest-session
Origin: https://studio.zaynjarvis.com
Content-Type: application/json

{
  "workspaceId": "default",
  "channelId": "ch-all",
  "name": "studio visitor"
}
```

Zouk checks:

- The workspace exists.
- Embed is enabled for that workspace.
- `Origin` exactly matches one configured allowed origin.
- Requested channel, if provided, is in `allowedChannelIds`.
- The request is under rate limits.

Zouk returns a short-lived Zouk session token:

```json
{
  "token": "short-lived-zouk-session-token",
  "user": {
    "name": "embed-ab12cd",
    "guest": true,
    "embed": true
  },
  "workspaceId": "default",
  "allowedChannelIds": ["ch-all"],
  "expiresAt": "2026-05-16T13:00:00.000Z"
}
```

This is a Zouk token, not a Supabase access token. It works with the existing Zouk REST and websocket paths.

## Server Enforcement

The token stores embed metadata in `authSessions`:

```js
{
  name: "embed-ab12cd",
  email: null,
  guest: true,
  embed: {
    workspaceId: "default",
    origin: "https://studio.zaynjarvis.com",
    allowedChannelIds: ["ch-all"],
    expiresAt: "2026-05-16T13:00:00.000Z"
  }
}
```

Every server path must treat this as a restricted session:

- Workspace access is limited to `embed.workspaceId`.
- `GET /api/messages` only returns messages for allowed channels.
- `POST /api/messages` only allows `#channel` targets whose channel ID is allowed.
- DM targets are rejected in v1.
- `/ws` init sends only allowed channels and a minimal visible agent list for those channels.
- Broadcasted message events are delivered to embed sockets only if the message channel is allowed.
- Admin/settings/machine/agent-control APIs remain unavailable because embed users only have member-level access and additional embed restrictions.

Embed guest sessions should be short-lived and need not be persisted to the database. If the server restarts, the external widget can request a fresh token.

## Zouk Workspace Settings UI

Add a new `Embed` section in Settings.

The section should feel like an operational permissions panel, not a marketing page. It should include:

- A top status row:
  - Label: `External Embed`
  - Toggle: enabled / disabled
  - Current workspace name
- Allowed origins editor:
  - Multi-line or tokenized input.
  - Example placeholder: `https://studio.zaynjarvis.com`
  - Validation should normalize to URL origin only. Paths are not accepted.
- Channel scope selector:
  - Checklist of regular channels in the active workspace.
  - Show `#channel-name`, description if present, and whether any agents are subscribed.
  - At least one channel is required while enabled.
- Token lifetime:
  - Numeric select or input in minutes/hours.
  - Default 1 hour.
- Copyable integration snippet:

```html
<script type="module" src="https://zouk.zaynjarvis.com/embed/zouk-widget.js"></script>
<zouk-channel-widget
  server-url="https://zouk.zaynjarvis.com"
  workspace-id="default"
  channel="#all">
</zouk-channel-widget>
```

For the MVP, the snippet is documentation for the future micro component. The first consumer can be a normal React page in `videogen`, styled as an external blog page instead of being coupled to Studio's video-generation workflows.

## External Widget Behavior

The external widget should:

1. Request an embed guest token from Zouk.
2. Open websocket:

```text
wss://zouk.zaynjarvis.com/ws?token=<token>&workspaceId=<workspaceId>
```

3. Fetch initial history:

```http
GET /api/messages
Authorization: Bearer <token>
X-Workspace-Id: default
X-Channel: #all
X-Limit: 50
```

4. Send messages:

```http
POST /api/messages
Authorization: Bearer <token>
X-Workspace-Id: default
Content-Type: application/json

{
  "target": "#all",
  "content": "Help me create a video prompt."
}
```

5. Append live `message` websocket events for the allowed channel.

## External Blog-Style MVP

Add a dedicated page to `videogen`, served from `https://studio.zaynjarvis.com`, for example hash route `#/zouk`. This page is only an external-site harness for the MVP. It should not depend on Studio tasks, video generation state, image upload state, or Studio-specific workflow concepts.

Environment/config:

- `VITE_ZOUK_SERVER_URL=https://zouk.zaynjarvis.com`
- `VITE_ZOUK_WORKSPACE_ID=default`
- `VITE_ZOUK_CHANNEL=all`

Page layout:

- Use a blog/article layout to demonstrate how any outside site can mount Zouk.
- Left side: article or product documentation content owned by the external site.
- Right side: a Zouk conversation panel.
- The right panel is the MVP widget:
  - Header: `Zouk`
  - Subline: `#all · connected to studio`
  - Scrollable message list
  - Composer fixed at the bottom of the panel
  - Connection state: `connecting`, `connected`, `reconnecting`, `expired`, `not allowed`

The MVP does not need full Zouk UI, threads, attachments, tasks, settings, Studio tasks, video-specific integrations, article context injection, or custom message organization. It only needs scoped token minting, history, live websocket updates, sending channel messages, and proof that those messages appear in the same Zouk workspace/channel.

## Visual Spec For Luna

Please generate two static UI mockups from this section.

### Mockup 1: Blog Page With Zouk Chat On The Right

Canvas: desktop browser, 1440px wide.

Scene:

- A polished external blog page hosted at `studio.zaynjarvis.com`.
- Dark editorial UI is fine, but the page should read as a blog/article, not a video-generation tool.
- Left side: an article page with title, author/date metadata, section headings, and readable paragraphs.
- Right side: a Zouk conversation rail, roughly 360-420px wide, full height inside the page.

Zouk rail details:

- Header says `Zouk` and `#all`.
- Small status dot: connected.
- Message list with a few chat bubbles:
- Visitor asks a question about the article.
- Agent replies to the visitor's explicit channel message. The MVP must not imply automatic article context injection.
  - Another visitor message is partially typed or just sent.
- Composer at bottom with placeholder `Ask Zouk...`.
- Visual tone: operational and embedded, not a marketing card. It should look native to the studio page but still identifiable as Zouk.

### Mockup 2: Zouk Settings Embed Permissions

Canvas: Zouk settings modal or settings page.

Scene:

- Active section: `Embed`.
- Top row: `External Embed` toggle enabled.
- Workspace indicator: `default` or active workspace.
- Allowed origins field containing `https://studio.zaynjarvis.com`.
- Channel scope checklist:
  - `#all` selected.
  - At least one other channel visible but not selected.
  - Small text showing subscribed agents or `agents can be added later`.
- Token lifetime control set to `1 hour`.
- Integration snippet block with copy button.
- A small warning note: `Do not expose machine keys in browser code. Embed sessions are short-lived and channel-scoped.`

Style:

- Use Zouk's existing settings look: compact, monospaced metadata, restrained borders, no large hero treatment.
- The design should clearly communicate that this is a permissions panel.

## Phase 2 Options

After the channel-scoped MVP works:

- Add agent-scoped DM sessions.
- Add a Zouk-hosted web component bundle at `/embed/zouk-widget.js`.
- Add CAPTCHA/Turnstile for fully public sites.
- Add per-origin rate-limit controls in the settings panel.
- Add origin allowlist enforcement for normal `/ws` clients, making sure configured embed origins remain allowed.
