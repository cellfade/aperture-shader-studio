export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // revoke after the click has been handled
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Longest-side cap to stay within browser WebGL/canvas limits. */
export const MAX_EXPORT_SIDE = 8192;

/** Generative shaders have no source photo — export at this 16:10 canvas. */
export const GENERATIVE_EXPORT = { width: 2000, height: 1250 };

export function clampToMaxSide(w: number, h: number, max = MAX_EXPORT_SIDE) {
  const longest = Math.max(w, h);
  if (longest <= max) return { width: Math.round(w), height: Math.round(h), clamped: false };
  const k = max / longest;
  return { width: Math.round(w * k), height: Math.round(h * k), clamped: true };
}
