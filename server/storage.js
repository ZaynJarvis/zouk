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

  return { put, statSync, existsSync, stream, remove, dir };
}

module.exports = { createStorage };
