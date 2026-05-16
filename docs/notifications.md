# Notifications

Zouk supports two notification paths:

- Foreground/local browser notifications while the web app is open in a tab or installed PWA.
- Web Push notifications for background delivery when VAPID keys are configured.

## Platform Notes

- macOS: works in normal browsers and installed PWAs through the browser Notification API. Web Push also works in Safari 16+ on macOS 13+.
- iOS/iPadOS: requires Zouk to be added to the Home Screen. iOS 16.4+ supports standards-based Web Push for Home Screen web apps.
- The user must tap Settings -> Alerts -> Enable. Browsers only allow permission prompts from a user gesture.

## Server Configuration

Generate VAPID keys once:

```sh
npx web-push generate-vapid-keys
```

Set these environment variables on the Zouk server:

```sh
WEB_PUSH_VAPID_PUBLIC_KEY=...
WEB_PUSH_VAPID_PRIVATE_KEY=...
WEB_PUSH_VAPID_SUBJECT=mailto:you@example.com
PUBLIC_URL=https://zouki.zaynjarvis.com
```

Optional:

```sh
WEB_PUSH_NOTIFY_ALL_CHANNEL_MESSAGES=true
```

By default, server-side Web Push sends DMs and explicit `@user` mentions only. The optional flag makes channel messages push to all subscribed users in that workspace, which is noisier.

## Storage

Push subscriptions are stored in `push_subscriptions`. `schema.sql` is idempotent and runs on server startup, so no manual SQL step is needed for normal deployments. In local no-`DATABASE_URL` mode, subscriptions fall back to `data/push-subscriptions.json`.
