// Form photos are compressed on the device (SPEC 6.8 item 4): longest side 1600 px, JPEG,
// so 3 days of campaign photos fit in browser storage.

export const MAX_SIDE = 1600;
export const JPEG_QUALITY = 0.75;

/** Target size keeping the aspect ratio; never upscales. */
export function fitWithin(width: number, height: number, max = MAX_SIDE): { width: number; height: number } {
  if (width <= 0 || height <= 0) return { width: 0, height: 0 };
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** "formato-01.svg" -> "formato-01.jpg" (the name lets the demo reading find its sample). */
export function jpegName(name: string): string {
  const base = name.replace(/\.[^.]+$/, "") || "formato";
  return `${base}.jpg`;
}

function loadImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("image"));
    };
    img.src = url;
  });
}

/** Draws the photo on a canvas at most MAX_SIDE px and returns a JPEG blob. */
export async function compressImage(file: Blob): Promise<Blob> {
  const img = await loadImage(file);
  const { width, height } = fitWithin(img.naturalWidth || img.width, img.naturalHeight || img.height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas");
  ctx.fillStyle = "#ffffff"; // Transparent PNG/SVG areas become white, not black.
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("toBlob"))), "image/jpeg", JPEG_QUALITY),
  );
}
