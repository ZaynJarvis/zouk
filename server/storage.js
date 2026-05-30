// On-disk attachment storage.
//
// Shape: `<dir>/<id>` holds the blob, `<dir>/<id>.meta.json` holds
// `{ filename, contentType, size, createdAt }`. Sidecar metadata means the
// serve path never needs to consult `messages.attachments` — useful when the
// upload has been taken but its parent message has not been posted yet.
//
// The entire module is intentionally tiny: if we ever need S3 / GCS / etc,
// swap this file for an OpenDAL / @aws-sdk adapter with the same surface.
// Today that indirection is overkill, but the shape is cheap insurance.

const fs = require("fs");
const path = require("path");
const { extractImageDimensions } = require("./imageDimensions");

const DEFAULT_DIR = path.join(__dirname, "..", "uploads");

function createStorage(dir = DEFAULT_DIR) {
  fs.mkdirSync(dir, { recursive: true });

  const blobPath = (id) => path.join(dir, id);
  const metaPath = (id) => path.join(dir, `${id}.meta.json`);

  async function put(id, buffer, { filename, contentType }) {
    const meta = {
      filename,
      contentType,
      size: buffer.length,
      createdAt: new Date().toISOString(),
    };
    // Probe intrinsic dimensions so the web client can reserve aspect-ratio
    // space at render time. Failures are silently ignored — unsupported
    // formats fall back to the existing layout-shift behavior.
    if ((contentType || "").startsWith("image/")) {
      const dims = extractImageDimensions(buffer, contentType);
      if (dims) {
        meta.width = dims.width;
        meta.height = dims.height;
      }
    }
    await fs.promises.writeFile(blobPath(id), buffer);
    await fs.promises.writeFile(metaPath(id), JSON.stringify(meta));
    return meta;
  }

  function statSync(id) {
    try {
      const raw = fs.readFileSync(metaPath(id), "utf8");
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function existsSync(id) {
    try {
      fs.accessSync(blobPath(id));
      return true;
    } catch {
      return false;
    }
  }

  function stream(id) {
    return fs.createReadStream(blobPath(id));
  }

  async function remove(id) {
    await Promise.allSettled([
      fs.promises.unlink(blobPath(id)),
      fs.promises.unlink(metaPath(id)),
    ]);
  }

  // Delete blob + sidecar pairs whose meta.createdAt is older than maxAgeMs.
  // Falls back to file mtime when meta is missing/unparseable so we can still
  // sweep up orphaned blobs. Returns the count of removed attachment ids.
  async function pruneOlderThan(maxAgeMs) {
    const cutoff = Date.now() - maxAgeMs;
    let entries;
    try {
      entries = await fs.promises.readdir(dir);
    } catch {
      return 0;
    }
    const ids = entries.filter((n) => !n.endsWith(".meta.json"));
    let removed = 0;
    for (const id of ids) {
      let createdAt = null;
      const meta = statSync(id);
      if (meta?.createdAt) {
        const t = Date.parse(meta.createdAt);
        if (Number.isFinite(t)) createdAt = t;
      }
      if (createdAt === null) {
        try {
          const s = await fs.promises.stat(blobPath(id));
          createdAt = s.mtimeMs;
        } catch {
          continue;
        }
      }
      if (createdAt < cutoff) {
        await remove(id);
        removed++;
      }
    }
    return removed;
  }

  return { put, statSync, existsSync, stream, remove, pruneOlderThan, dir };
}

module.exports = { createStorage };
