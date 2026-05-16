const fs = require('fs');

const DEFAULT_TTL_SECONDS = 60 * 60;
const MIN_TTL_SECONDS = 5 * 60;
const MAX_TTL_SECONDS = 24 * 60 * 60;
const MAX_ORIGINS = 20;
const MAX_CHANNELS = 50;

function clampInt(value, min, max, fallback) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function normalizeOrigin(raw) {
  const value = String(raw || '').trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return url.origin;
  } catch {
    return null;
  }
}

function uniq(values) {
  return [...new Set(values)];
}

function normalizeStringList(values, max) {
  const list = Array.isArray(values) ? values : [];
  return uniq(list.map((v) => String(v || '').trim()).filter(Boolean)).slice(0, max);
}

function normalizeSettings(input = {}, workspaceId, now = () => new Date().toISOString()) {
  const origins = normalizeStringList(input.allowedOrigins || input.allowed_origins, MAX_ORIGINS)
    .map(normalizeOrigin)
    .filter(Boolean);
  const channelIds = normalizeStringList(input.allowedChannelIds || input.allowed_channel_ids, MAX_CHANNELS);
  return {
    workspaceId,
    enabled: !!input.enabled,
    allowedOrigins: uniq(origins),
    allowedChannelIds: channelIds,
    tokenTtlSeconds: clampInt(
      input.tokenTtlSeconds ?? input.token_ttl_seconds,
      MIN_TTL_SECONDS,
      MAX_TTL_SECONDS,
      DEFAULT_TTL_SECONDS,
    ),
    updatedAt: input.updatedAt || input.updated_at || now(),
    updatedBy: input.updatedBy || input.updated_by || null,
  };
}

function createEmbedSettingsStore({ filePath, db, defaultWorkspaceId = 'default', now = () => new Date().toISOString() }) {
  const settingsByWorkspace = new Map();

  function readFileSettings() {
    if (!filePath || !fs.existsSync(filePath)) return;
    try {
      const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      const rows = Array.isArray(raw?.settings) ? raw.settings : Array.isArray(raw) ? raw : [];
      settingsByWorkspace.clear();
      for (const row of rows) {
        const workspaceId = row.workspaceId || row.workspace_id || defaultWorkspaceId;
        settingsByWorkspace.set(workspaceId, normalizeSettings(row, workspaceId, now));
      }
    } catch (e) {
      console.warn('[embed] Failed to load embed settings:', e.message);
    }
  }

  function writeFileSettings() {
    if (!filePath) return;
    fs.writeFileSync(filePath, JSON.stringify({ settings: [...settingsByWorkspace.values()] }, null, 2), 'utf8');
  }

  readFileSettings();

  return {
    normalize: (input, workspaceId, updatedBy = null) => normalizeSettings({ ...input, updatedBy }, workspaceId, now),

    get(workspaceId = defaultWorkspaceId) {
      return settingsByWorkspace.get(workspaceId) || normalizeSettings({}, workspaceId, now);
    },

    list() {
      return [...settingsByWorkspace.values()];
    },

    async save(settings) {
      const normalized = normalizeSettings(settings, settings.workspaceId || defaultWorkspaceId, now);
      settingsByWorkspace.set(normalized.workspaceId, normalized);
      writeFileSettings();
      if (db?.saveWorkspaceEmbedSettings) await db.saveWorkspaceEmbedSettings(normalized);
      return normalized;
    },

    async hydrateFromDb() {
      if (!db?.loadWorkspaceEmbedSettings) return;
      const rows = await db.loadWorkspaceEmbedSettings();
      if (!rows) return;
      if (rows.length > 0) {
        settingsByWorkspace.clear();
        for (const row of rows) {
          settingsByWorkspace.set(row.workspaceId, normalizeSettings(row, row.workspaceId, now));
        }
        writeFileSettings();
      } else if (settingsByWorkspace.size > 0) {
        for (const settings of settingsByWorkspace.values()) {
          await db.saveWorkspaceEmbedSettings(settings);
        }
      }
    },

    removeWorkspace(workspaceId) {
      const removed = settingsByWorkspace.delete(workspaceId);
      if (removed) writeFileSettings();
      return removed;
    },
  };
}

function createEmbedRateLimiter({ windowMs = 60_000, max = 30 } = {}) {
  const buckets = new Map();
  return {
    check(key) {
      const nowMs = Date.now();
      const bucketKey = String(key || 'unknown');
      const bucket = buckets.get(bucketKey) || [];
      const fresh = bucket.filter((t) => nowMs - t < windowMs);
      fresh.push(nowMs);
      buckets.set(bucketKey, fresh);
      return {
        allowed: fresh.length <= max,
        count: fresh.length,
        retryAfterSeconds: Math.ceil(windowMs / 1000),
      };
    },
  };
}

function sanitizeEmbedGuestName(raw) {
  const base = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
  return base || 'guest';
}

module.exports = {
  DEFAULT_TTL_SECONDS,
  MIN_TTL_SECONDS,
  MAX_TTL_SECONDS,
  normalizeOrigin,
  createEmbedSettingsStore,
  createEmbedRateLimiter,
  sanitizeEmbedGuestName,
};
