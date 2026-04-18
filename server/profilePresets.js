/**
 * Agent profile presets — a standalone pool of reusable avatars.
 *
 * When a new agent is created the server hashes its id into the preset
 * pool and assigns the matching image. If that picture is already in use,
 * we reshard to the next slot for up to three rounds before falling back
 * to index 0. Presets are persisted to Supabase when available and to a
 * JSON file otherwise — mirroring how agent configs and machine keys work.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

const MAX_PRESETS = 30;
const MAX_IMAGE_BYTES = 32 * 1024; // 32KB ceiling on the base64 blob
const SHARD_ROUNDS = 3;

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

  function isValidDataUrl(image) {
    if (typeof image !== 'string') return false;
    if (!image.startsWith('data:image/')) return false;
    if (Buffer.byteLength(image, 'utf8') > MAX_IMAGE_BYTES) return false;
    return true;
  }

  async function hydrateFromDb() {
    if (!db?.loadProfilePresets) return;
    const dbPresets = await db.loadProfilePresets();
    if (dbPresets === null) return; // DB disabled
    if (dbPresets.length > 0) {
      presets = dbPresets;
      saveToFile();
      console.log(`[presets] Loaded ${presets.length} preset(s) from DB`);
    } else if (presets.length > 0) {
      for (const p of presets) {
        try { await db.saveProfilePreset(p); } catch (e) { /* best effort */ void e; }
      }
      console.log(`[presets] Seeded ${presets.length} preset(s) from file`);
    }
  }

  function list() {
    return presets.map(p => ({ id: p.id, image: p.image }));
  }

  function count() {
    return presets.length;
  }

  async function add(image) {
    if (!isValidDataUrl(image)) {
      return { error: 'Invalid image — must be a data URL under 32KB' };
    }
    if (presets.length >= MAX_PRESETS) {
      return { error: `Preset limit reached (max ${MAX_PRESETS})` };
    }
    const preset = {
      id: `pp-${uuidv4().slice(0, 8)}`,
      image,
      createdAt: new Date().toISOString(),
    };
    presets.push(preset);
    saveToFile();
    if (db?.saveProfilePreset) {
      db.saveProfilePreset(preset).catch(e => console.warn('[presets] saveProfilePreset error:', e.message));
    }
    broadcastAndNotify();
    return { preset: { id: preset.id, image: preset.image } };
  }

  async function remove(id) {
    const idx = presets.findIndex(p => p.id === id);
    if (idx < 0) return { error: 'Preset not found' };
    presets.splice(idx, 1);
    saveToFile();
    if (db?.deleteProfilePreset) {
      db.deleteProfilePreset(id).catch(e => console.warn('[presets] deleteProfilePreset error:', e.message));
    }
    broadcastAndNotify();
    return { success: true };
  }

  function broadcastAndNotify() {
    const payload = list();
    if (broadcast) broadcast({ type: 'agent_profile_presets_updated', presets: payload });
    if (onChange) onChange(payload);
  }

  function pickForAgent(agentKey, usedImages) {
    const used = usedImages instanceof Set ? usedImages : new Set(usedImages || []);
    return pickPresetForAgent(presets, used, agentKey);
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
