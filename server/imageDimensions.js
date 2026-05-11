// Read intrinsic pixel dimensions from the first bytes of an image buffer
// without decoding pixels. Supports PNG, JPEG, GIF, WEBP. Returns null for
// other formats so callers can fall back to the existing layout-shift
// behavior on render.
//
// Used at upload time to populate attachment metadata so the web client can
// reserve aspect-ratio space and avoid the page jumping when the <img> loads.

function readPngDims(buf) {
  if (buf.length < 24) return null;
  // PNG signature.
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < 8; i++) if (buf[i] !== sig[i]) return null;
  // IHDR is always the first chunk: length(4) + "IHDR"(4) + width(4) + height(4)
  if (buf.toString("ascii", 12, 16) !== "IHDR") return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function readJpegDims(buf) {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i + 8 < buf.length) {
    // Some encoders emit fill 0xFF bytes before a marker; skip them.
    while (i < buf.length && buf[i] !== 0xff) i++;
    while (i < buf.length && buf[i] === 0xff) i++;
    if (i >= buf.length) return null;
    const marker = buf[i];
    i++;
    // SOI/EOI/RSTn have no payload.
    if (marker === 0xd8 || marker === 0xd9) continue;
    if (marker >= 0xd0 && marker <= 0xd7) continue;
    if (i + 2 > buf.length) return null;
    const segLen = buf.readUInt16BE(i);
    // SOFn markers (C0..CF) carry dims, except C4 (DHT), C8 (JPG), CC (DAC).
    const isSof =
      marker >= 0xc0 && marker <= 0xcf &&
      marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      // payload: precision(1) height(2 BE) width(2 BE)
      if (i + 2 + 5 > buf.length) return null;
      const h = buf.readUInt16BE(i + 3);
      const w = buf.readUInt16BE(i + 5);
      return { width: w, height: h };
    }
    i += segLen;
  }
  return null;
}

function readGifDims(buf) {
  if (buf.length < 10) return null;
  const sig = buf.toString("ascii", 0, 6);
  if (sig !== "GIF87a" && sig !== "GIF89a") return null;
  return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
}

function readWebpDims(buf) {
  if (buf.length < 30) return null;
  if (buf.toString("ascii", 0, 4) !== "RIFF") return null;
  if (buf.toString("ascii", 8, 12) !== "WEBP") return null;
  const fourcc = buf.toString("ascii", 12, 16);
  if (fourcc === "VP8 ") {
    // Lossy: skip 6 byte tag, then 0x9d 0x01 0x2a, then 14-bit LE w + h.
    const w = buf.readUInt16LE(26) & 0x3fff;
    const h = buf.readUInt16LE(28) & 0x3fff;
    return { width: w, height: h };
  }
  if (fourcc === "VP8L") {
    // Lossless: 1-byte signature 0x2f then packed 14-bit width-1, 14-bit height-1.
    if (buf[20] !== 0x2f) return null;
    const b0 = buf[21], b1 = buf[22], b2 = buf[23], b3 = buf[24];
    const w = 1 + (b0 | ((b1 & 0x3f) << 8));
    const h = 1 + ((b1 >> 6) | (b2 << 2) | ((b3 & 0x0f) << 10));
    return { width: w, height: h };
  }
  if (fourcc === "VP8X") {
    // Extended: 24-bit LE canvas width-1 at byte 24 and height-1 at byte 27.
    const w = 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16));
    const h = 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16));
    return { width: w, height: h };
  }
  return null;
}

function extractImageDimensions(buffer, contentType) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 16) return null;
  const ct = (contentType || "").toLowerCase();
  // Use content-type as a hint, but always probe by magic so a misnamed
  // upload (e.g. .jpg containing PNG bytes) still works.
  if (ct.includes("png")) {
    const d = readPngDims(buffer); if (d) return d;
  }
  if (ct.includes("jpeg") || ct.includes("jpg")) {
    const d = readJpegDims(buffer); if (d) return d;
  }
  if (ct.includes("gif")) {
    const d = readGifDims(buffer); if (d) return d;
  }
  if (ct.includes("webp")) {
    const d = readWebpDims(buffer); if (d) return d;
  }
  return (
    readPngDims(buffer) ||
    readJpegDims(buffer) ||
    readGifDims(buffer) ||
    readWebpDims(buffer)
  );
}

module.exports = { extractImageDimensions };
