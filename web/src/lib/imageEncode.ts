// Shared avatar encode helper. Crops to a center square, scales to
// `size`, then retries quality levels to keep the base64 payload small.
export function resizeAndEncode(file: File, size = 128, maxBytes = 14000): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Canvas 2D unavailable'));
        return;
      }
      const min = Math.min(img.width, img.height);
      const sx = (img.width - min) / 2;
      const sy = (img.height - min) / 2;
      ctx.drawImage(img, sx, sy, min, min, 0, 0, size, size);
      for (const q of [0.8, 0.6, 0.4, 0.2]) {
        const dataUrl = canvas.toDataURL('image/webp', q);
        if (dataUrl.length <= maxBytes) {
          resolve(dataUrl);
          return;
        }
      }
      reject(new Error('Image too large even after compression'));
    };
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = URL.createObjectURL(file);
  });
}
