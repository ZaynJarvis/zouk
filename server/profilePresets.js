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

function createStore({ filePath, db, broadcast, onChange }) {
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

  function list(workspaceId = null) {
    return presets
      .filter(p => !workspaceId || presetWorkspaceId(p) === workspaceId)
      .map(p => ({ id: p.id, workspaceId: presetWorkspaceId(p), image: p.image }));
  }

  function count(workspaceId = null) {
    return workspaceId
      ? presets.filter(p => presetWorkspaceId(p) === workspaceId).length
      : presets.length;
  }

  async function add(image, workspaceId = DEFAULT_WORKSPACE_ID) {
    if (!isValidDataUrl(image)) {
      return { error: 'Invalid image — must be a data URL under 32KB' };
    }
    if (count(workspaceId) >= MAX_PRESETS) {
      return { error: `Preset limit reached (max ${MAX_PRESETS})` };
    }
    const preset = {
      id: `pp-${uuidv4().slice(0, 8)}`,
      workspaceId: workspaceId || DEFAULT_WORKSPACE_ID,
      image,
      createdAt: new Date().toISOString(),
    };
    presets.push(preset);
    saveToFile();
    if (db?.saveProfilePreset) {
      db.saveProfilePreset(preset).catch(e => console.warn('[presets] saveProfilePreset error:', e.message));
    }
    broadcastAndNotify(preset.workspaceId);
    return { preset: { id: preset.id, workspaceId: preset.workspaceId, image: preset.image } };
  }

  async function remove(id, workspaceId = null) {
    const idx = presets.findIndex(p => p.id === id && (!workspaceId || presetWorkspaceId(p) === workspaceId));
    if (idx < 0) return { error: 'Preset not found' };
    const removedWorkspaceId = presetWorkspaceId(presets[idx]);
    presets.splice(idx, 1);
    saveToFile();
    if (db?.deleteProfilePreset) {
      db.deleteProfilePreset(id).catch(e => console.warn('[presets] deleteProfilePreset error:', e.message));
    }
    broadcastAndNotify(removedWorkspaceId);
    return { success: true };
  }

  function broadcastAndNotify(workspaceId = DEFAULT_WORKSPACE_ID) {
    const payload = list(workspaceId);
    if (broadcast) broadcast({ type: 'agent_profile_presets_updated', workspaceId, presets: payload });
    if (onChange) onChange(payload);
  }

  function pickForAgent(agentKey, usedImages, workspaceId = null) {
    const used = usedImages instanceof Set ? usedImages : new Set(usedImages || []);
    const scoped = workspaceId ? presets.filter(p => presetWorkspaceId(p) === workspaceId) : presets;
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
