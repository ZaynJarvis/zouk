// WS connect-storm tracker — rate-limits /ws upgrades per token/IP.
// Zero internal dependencies. Standalone module.

const crypto = require("crypto");

const WS_RATE_WINDOW_MS = 60_000;
const WS_RATE_BLOCK_THRESHOLD = Number(process.env.WS_RATE_BLOCK_THRESHOLD || 24);
const WS_RATE_BLOCK_MAX_OPEN = Number(process.env.WS_RATE_BLOCK_MAX_OPEN || 1);
const WS_RATE_HARD_BLOCK_THRESHOLD = Number(process.env.WS_RATE_HARD_BLOCK_THRESHOLD || 120);
const WS_BLOCK_DURATION_MS = 5 * 60_000;
const WS_TRACKER_TTL_MS = 24 * 60 * 60 * 1000;
const WS_REVOKE_BLOCK_MS = 24 * 60 * 60 * 1000;
const WS_INVALID_TOKEN_THRESHOLD = Number(process.env.WS_INVALID_TOKEN_THRESHOLD || 10);
const WS_INVALID_BLOCK_MS = 5 * 60_000;

const wsTrackers = new Map();

function tokenFingerprint(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex").slice(0, 16);
}

function pruneRecentConnects(entry, nowMs) {
  const cutoff = nowMs - WS_RATE_WINDOW_MS;
  while (entry.recentConnects.length && entry.recentConnects[0] < cutoff) {
    entry.recentConnects.shift();
  }
}

function newEntry(key, kind, token, ip, nowMs) {
  return {
    key, kind, token: token || null, ip: ip || null,
    openCount: 0, totalConnects: 0, totalDisconnects: 0, totalRejections: 0,
    lastConnectAt: 0, lastDisconnectAt: 0, lastRejectionAt: 0,
    recentConnects: [], blockedUntil: 0, blockReason: null, manualBlock: false,
    firstSeenAt: nowMs,
  };
}

function recordWsConnectAttempt(token, ip) {
  const nowMs = Date.now();
  const kind = token ? "token" : "ip";
  const key = token ? tokenFingerprint(token) : `ip:${ip || "unknown"}`;
  let entry = wsTrackers.get(key);
  if (!entry) { entry = newEntry(key, kind, token, ip, nowMs); wsTrackers.set(key, entry); }
  if (entry.blockedUntil > nowMs) {
    entry.totalRejections += 1; entry.lastRejectionAt = nowMs;
    return { allow: false, entry, reason: entry.blockReason || "blocked" };
  }
  if (ip) entry.ip = ip;
  pruneRecentConnects(entry, nowMs);
  entry.recentConnects.push(nowMs);
  entry.totalConnects += 1; entry.lastConnectAt = nowMs;
  const recentCount = entry.recentConnects.length;
  const hardStorm = recentCount > WS_RATE_HARD_BLOCK_THRESHOLD;
  const churnStorm = recentCount > WS_RATE_BLOCK_THRESHOLD && entry.openCount <= WS_RATE_BLOCK_MAX_OPEN;
  if (hardStorm || churnStorm) {
    entry.blockedUntil = nowMs + WS_BLOCK_DURATION_MS;
    entry.blockReason = hardStorm
      ? `auto: ${recentCount} connects in ${WS_RATE_WINDOW_MS / 1000}s (hard limit ${WS_RATE_HARD_BLOCK_THRESHOLD})`
      : `auto: ${recentCount} connects in ${WS_RATE_WINDOW_MS / 1000}s with ${entry.openCount} open (limit ${WS_RATE_BLOCK_THRESHOLD}, max open ${WS_RATE_BLOCK_MAX_OPEN})`;
    console.warn(`[ws-tracker] auto-blocked ${entry.kind}=${entry.key} for ${WS_BLOCK_DURATION_MS / 1000}s — ${entry.blockReason}`);
    entry.totalRejections += 1; entry.lastRejectionAt = nowMs;
    return { allow: false, entry, reason: entry.blockReason };
  }
  entry.openCount += 1;
  return { allow: true, entry };
}

function recordInvalidTokenAttempt(token, ip) {
  const nowMs = Date.now();
  const fp = tokenFingerprint(token);
  const key = `bad:${fp}`;
  let entry = wsTrackers.get(key);
  if (!entry) { entry = newEntry(key, "invalid_token", null, ip, nowMs); wsTrackers.set(key, entry); }
  if (entry.blockedUntil > nowMs) {
    entry.totalRejections += 1; entry.lastRejectionAt = nowMs;
    return entry;
  }
  if (ip) entry.ip = ip;
  pruneRecentConnects(entry, nowMs);
  entry.recentConnects.push(nowMs);
  entry.totalRejections += 1; entry.lastRejectionAt = nowMs;
  if (!entry.manualBlock && entry.recentConnects.length > WS_INVALID_TOKEN_THRESHOLD) {
    entry.blockedUntil = nowMs + WS_INVALID_BLOCK_MS;
    entry.blockReason = `invalid token: ${entry.recentConnects.length} bad attempts in ${WS_RATE_WINDOW_MS / 1000}s`;
    console.warn(`[ws-tracker] invalid-token block ${key} for ${WS_INVALID_BLOCK_MS / 1000}s — ${entry.blockReason}`);
  }
  return entry;
}

function recordWsDisconnect(entry) {
  if (!entry) return;
  entry.totalDisconnects += 1;
  entry.lastDisconnectAt = Date.now();
  if (entry.openCount > 0) entry.openCount -= 1;
}

function pruneOldWsTrackers(nowMs = Date.now()) {
  for (const [key, entry] of wsTrackers) {
    if (entry.openCount > 0 || entry.blockedUntil > nowMs || entry.manualBlock) continue;
    const lastActivity = Math.max(entry.lastConnectAt, entry.lastDisconnectAt, entry.lastRejectionAt);
    if (lastActivity && (nowMs - lastActivity) > WS_TRACKER_TTL_MS) wsTrackers.delete(key);
  }
}

module.exports = {
  wsTrackers, tokenFingerprint,
  recordWsConnectAttempt, recordInvalidTokenAttempt,
  recordWsDisconnect, pruneOldWsTrackers,
  pruneRecentConnects,
  WS_RATE_WINDOW_MS, WS_RATE_BLOCK_THRESHOLD, WS_RATE_BLOCK_MAX_OPEN,
  WS_RATE_HARD_BLOCK_THRESHOLD, WS_BLOCK_DURATION_MS,
  WS_REVOKE_BLOCK_MS,
};
