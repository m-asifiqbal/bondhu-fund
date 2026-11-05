/**
 * Reads an image File and returns a compact data URL (resized, re-encoded) suitable for storing in SQLite.
 * Photos → square-cropped JPEG/WEBP; logos keep aspect ratio and transparency (PNG).
 */
export async function imageFileToDataUrl(
  file: File,
  opts: { maxSize?: number; square?: boolean; keepTransparency?: boolean; quality?: number } = {},
): Promise<string> {
  const { maxSize = 320, square = false, keepTransparency = false, quality = 0.86 } = opts;
  if (!/^image\/(png|jpe?g|webp|svg\+xml|gif|bmp)$/.test(file.type)) throw new Error('Please choose a PNG, JPG, WEBP or SVG image.');
  if (file.size > 10 * 1024 * 1024) throw new Error('Image is larger than 10 MB.');

  // SVG logos are small and scale perfectly; store as-is if reasonably sized.
  if (file.type === 'image/svg+xml' && file.size < 200 * 1024) return readAsDataUrl(file);

  const src = await readAsDataUrl(file);
  const img = await loadImage(src);
  let sx = 0, sy = 0, sw = img.naturalWidth, sh = img.naturalHeight;
  if (square) {
    const s = Math.min(sw, sh);
    sx = (sw - s) / 2; sy = (sh - s) / 2; sw = sh = s;
  }
  const scale = Math.min(1, maxSize / Math.max(sw, sh));
  const w = Math.max(1, Math.round(sw * scale)), h = Math.max(1, Math.round(sh * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  if (!keepTransparency) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); }
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
  const out = keepTransparency ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', quality);
  if (out.length > 780_000) throw new Error('Image is still too large after resizing. Try a simpler image.');
  return out;
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('Could not read the image file.'));
    r.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error('This image could not be opened.'));
    i.src = src;
  });
}
