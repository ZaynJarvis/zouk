import { SlockWebSocket } from './ws';

// One process-wide WebSocket that starts handshaking as soon as the JS bundle
// is parsed — before React mounts, before <AppProvider> waits on the auth-config
// fetch in App.tsx. On iOS PWA cold opens that fetch can take 10–30s, and
// gating the WS on it pushes the first message round-trip behind the same
// network warmup window. Eager init means the upgrade is well underway (or
// already complete) by the time the UI is ready to send.
//
// Events emitted before any consumer subscribes (e.g. the `init` payload that
// fires within ~1s of `onopen`) are buffered inside SlockWebSocket and replayed
// to the first handler registered via .on() — see ws.ts.

const serverUrl = import.meta.env.VITE_SLOCK_SERVER_URL || '';
export const ws = new SlockWebSocket(serverUrl);
ws.connect();
