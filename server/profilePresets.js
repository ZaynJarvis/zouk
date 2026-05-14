const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

const MAX_PRESETS = 30;
const MAX_IMAGE_BYTES = 32 * 1024;
const SHARD_ROUNDS = 3;
const DEFAULT_WORKSPACE_ID = 'default';

function hashToIndex(key, size) {
  if (!size) return 0;
  const digest = crypto.createHash('sha256').update(String(key)).digest();
  const n = digest.readUInt32BE(0);
  return n % size;
}

function pickPresetForAgent(presets, usedImages, agentKey) {
  if (!presets || presets.length === 0) return undefined;
  const base = hashToIndex(agentKey, presets.length);
  for (let round = 0; round < SHARD_ROUNDS; round++) {
    const idx = (base + round) % presets.length;
    const image = presets[idx].image;
    if (!usedImages.has(image)) return image;
  }
  return presets[0].image;
}

function createStore({ filePath, db, onChange }) {
  if (!fs.existsSync(path.dirname(filePath))) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
  }

  let presets = loadFromFile();

  function loadFromFile() {
    try {
      if (fs.existsSync(filePath)) {
        const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        return Array.isArray(raw) ? raw.filter(isValidPreset) : [];
      }
    } catch (e) {
      console.error('[presets] Failed to load from file:', e.message);
    }
    return [];
  }

  function saveToFile() {
    try {
      fs.writeFileSync(filePath, JSON.stringify(presets, null, 2), 'utf8');
    } catch (e) {
      console.error('[presets] Failed to save to file:', e.message);
    }
  }

  function isValidPreset(p) {
    return p && typeof p === 'object' && typeof p.id === 'string' && typeof p.image === 'string';
  }

  function presetWorkspaceId(p) {
    return p?.workspaceId || DEFAULT_WORKSPACE_ID;
  }

  function normalizeWorkspaceId(workspaceId) {
    return workspaceId || DEFAULT_WORKSPACE_ID;
  }

  function presetsForWorkspace(workspaceId) {
    const normalized = normalizeWorkspaceId(workspaceId);
    if (normalized === DEFAULT_WORKSPACE_ID) return localPresetsForWorkspace(DEFAULT_WORKSPACE_ID);
    return [
      ...localPresetsForWorkspace(DEFAULT_WORKSPACE_ID),
      ...localPresetsForWorkspace(normalized),
    ];
  }

  function localPresetsForWorkspace(workspaceId) {
    const normalized = normalizeWorkspaceId(workspaceId);
    return presets.filter(p => presetWorkspaceId(p) === normalized);
  }

  function serializePreset(p, workspaceId) {
    const normalized = normalizeWorkspaceId(workspaceId);
    const presetScope = presetWorkspaceId(p);
    return {
      id: p.id,
      workspaceId: presetScope,
      image: p.image,
      shared: normalized !== DEFAULT_WORKSPACE_ID && presetScope === DEFAULT_WORKSPACE_ID,
    };
  }

  function isValidDataUrl(image) {
    if (typeof image !== 'string') return false;
    if (!image.startsWith('data:image/')) return false;
    if (Buffer.byteLength(image, 'utf8') > MAX_IMAGE_BYTES) return false;
    return true;
  }

  async function hydrateFromDb() {
    if (!db?.loadProfilePresets) return;
    const dbPresets = await db.loadProfilePresets();
    if (dbPresets === null) return;
    if (dbPresets.length > 0) {
      presets = dbPresets;
      saveToFile();
      console.log(`[presets] Loaded ${presets.length} preset(s) from DB`);
    } else if (presets.length > 0) {
      for (const p of presets) {
        try { await db.saveProfilePreset(p); } catch (e) { void e; }
      }
      console.log(`[presets] Seeded ${presets.length} preset(s) from file`);
    }
  }

  function list(workspaceId = DEFAULT_WORKSPACE_ID) {
    return presetsForWorkspace(workspaceId).map(p => serializePreset(p, workspaceId));
  }

  function count(workspaceId = DEFAULT_WORKSPACE_ID) {
    return localPresetsForWorkspace(workspaceId).length;
  }

  async function add(image, workspaceId = DEFAULT_WORKSPACE_ID) {
    const normalized = normalizeWorkspaceId(workspaceId);
    if (!isValidDataUrl(image)) {
      return { error: 'Invalid image — must be a data URL under 32KB' };
    }
    if (count(normalized) >= MAX_PRESETS) {
      return { error: `Preset limit reached (max ${MAX_PRESETS})` };
    }
    const preset = {
      id: `pp-${uuidv4().slice(0, 8)}`,
      workspaceId: normalized,
      image,
      createdAt: new Date().toISOString(),
    };
    presets.push(preset);
    saveToFile();
    if (db?.saveProfilePreset) {
      db.saveProfilePreset(preset).catch(e => console.warn('[presets] saveProfilePreset error:', e.message));
    }
    notifyChange(normalized);
    return { preset: serializePreset(preset, normalized) };
  }

  async function remove(id, workspaceId = DEFAULT_WORKSPACE_ID) {
    const normalized = normalizeWorkspaceId(workspaceId);
    const idx = presets.findIndex(p => p.id === id && presetWorkspaceId(p) === normalized);
    if (idx < 0) return { error: 'Preset not found' };
    presets.splice(idx, 1);
    saveToFile();
    if (db?.deleteProfilePreset) {
      db.deleteProfilePreset(id).catch(e => console.warn('[presets] deleteProfilePreset error:', e.message));
    }
    notifyChange(normalized);
    return { success: true };
  }

  function notifyChange(workspaceId = DEFAULT_WORKSPACE_ID) {
    const payload = list(workspaceId);
    if (onChange) onChange(payload, workspaceId);
  }

  function pickForAgent(agentKey, usedImages, workspaceId = DEFAULT_WORKSPACE_ID) {
    const used = usedImages instanceof Set ? usedImages : new Set(usedImages || []);
    const scoped = presetsForWorkspace(workspaceId);
    return pickPresetForAgent(scoped, used, agentKey);
  }

  return {
    hydrateFromDb,
    list,
    count,
    add,
    remove,
    pickForAgent,
  };
}

module.exports = {
  createStore,
  pickPresetForAgent,
  hashToIndex,
  MAX_PRESETS,
};
