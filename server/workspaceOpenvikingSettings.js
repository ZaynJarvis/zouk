// Per-workspace OpenViking provisioning credentials.
//
// Mirrors the layout of workspace_embed_settings: file + DB dual-write so the
// dev server (no DB) works the same as Railway. A workspace with no row falls
// back to the OPENVIKING_URL / OPENVIKING_ROOT_KEY env vars (resolution lives
// in server/index.js — this module only owns persistence).
//
// Field shape:
//   { workspaceId, enabled, url, rootApiKey, account, updatedAt, updatedBy }
// The key field mirrors the env var (OPENVIKING_ROOT_KEY): a new-format
// account-scoped root key whose account segment is decoded at use-time.
// `account` is an optional explicit override — used when the root key grants
// access to multiple accounts (pin one) or when the key is legacy hex (can't
// carry an account). When blank, the resolver decodes it from the key.
// `enabled=false` keeps a saved url/key around but treats the workspace as
// "use env fallback" — same gesture as toggling embed off.

const fs = require('fs');

function normalizeSettings(input, workspaceId, now) {
  return {
    workspaceId,
    enabled: !!input.enabled,
    url: typeof input.url === 'string' ? input.url.trim().replace(/\/+$/, '') : '',
    rootApiKey: typeof input.rootApiKey === 'string' ? input.rootApiKey : '',
    account: typeof input.account === 'string' ? input.account.trim() : '',
    // Peer memory: messages carry peer_id and commits use a peer-enabled
    // memory_policy, so each agent builds a per-peer profile. Defaults ON (only
    // an explicit `false` turns it off). Independent of `enabled` (which only
    // governs the provisioning URL/key override).
    peerEnabled: (input.peerEnabled ?? input.peer_enabled ?? true) !== false,
    updatedAt: input.updatedAt || input.updated_at || now(),
    updatedBy: input.updatedBy || input.updated_by || null,
  };
}

function createWorkspaceOpenvikingSettingsStore({
  filePath,
  db,
  defaultWorkspaceId = 'default',
  now = () => new Date().toISOString(),
}) {
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
      console.warn('[ov-ws] Failed to load workspace OV settings:', e.message);
    }
  }

  function writeFileSettings() {
    if (!filePath) return;
    fs.writeFileSync(
      filePath,
      JSON.stringify({ settings: [...settingsByWorkspace.values()] }, null, 2),
      'utf8',
    );
  }

  readFileSettings();

  return {
    normalize: (input, workspaceId, updatedBy = null) =>
      normalizeSettings({ ...input, updatedBy }, workspaceId, now),

    get(workspaceId = defaultWorkspaceId) {
      return (
        settingsByWorkspace.get(workspaceId) ||
        normalizeSettings({}, workspaceId, now)
      );
    },

    list() {
      return [...settingsByWorkspace.values()];
    },

    async save(settings) {
      const normalized = normalizeSettings(
        settings,
        settings.workspaceId || defaultWorkspaceId,
        now,
      );
      settingsByWorkspace.set(normalized.workspaceId, normalized);
      writeFileSettings();
      if (db?.saveWorkspaceOpenvikingSettings) {
        await db.saveWorkspaceOpenvikingSettings(normalized);
      }
      return normalized;
    },

    async hydrateFromDb() {
      if (!db?.loadWorkspaceOpenvikingSettings) return;
      const rows = await db.loadWorkspaceOpenvikingSettings();
      if (!rows) return;
      if (rows.length > 0) {
        settingsByWorkspace.clear();
        for (const row of rows) {
          settingsByWorkspace.set(row.workspaceId, normalizeSettings(row, row.workspaceId, now));
        }
        writeFileSettings();
      } else if (settingsByWorkspace.size > 0) {
        for (const settings of settingsByWorkspace.values()) {
          await db.saveWorkspaceOpenvikingSettings(settings);
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

module.exports = { createWorkspaceOpenvikingSettingsStore };
