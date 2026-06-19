export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();

  // Revoke exactly once. We keep a short timer (revoking synchronously can
  // cancel the download in some browsers) but ALSO revoke on `pagehide` so the
  // blob can't leak if the page unloads before the timer fires. Whichever wins,
  // the other is a no-op and the listener is always removed.
  let revoked = false;
  const revoke = () => {
    if (revoked) return;
    revoked = true;
    window.removeEventListener("pagehide", revoke);
    URL.revokeObjectURL(url);
  };
  window.addEventListener("pagehide", revoke);
  setTimeout(revoke, 1000);
}

/** Longest-side cap to stay within browser WebGL/canvas limits. */
export const MAX_EXPORT_SIDE = 8192;

/** Generative shaders have no source photo — export at this 16:10 canvas. */
export const GENERATIVE_EXPORT = { width: 2000, height: 1250 };

/**
 * Make a user-supplied name safe to use inside a download filename: strip path
 * separators and control/unsafe characters, collapse whitespace to single
 * underscores, and trim. Returns "file" if nothing usable remains.
 */
export function sanitizeFilename(name: string): string {
  const cleaned = name
    // path separators
    .replace(/[/\\]+/g, "-")
    // control characters (0x00–0x1F and 0x7F)
    .replace(/[\x00-\x1f\x7f]+/g, "")
    // characters illegal/unsafe on common filesystems
    .replace(/[<>:"|?*]+/g, "")
    // collapse any run of whitespace to a single underscore
    .replace(/\s+/g, "_")
    // strip leading/trailing dots, dashes, and underscores
    .replace(/^[.\-_]+|[.\-_]+$/g, "");
  return cleaned || "file";
}

export function clampToMaxSide(w: number, h: number, max = MAX_EXPORT_SIDE) {
  const longest = Math.max(w, h);
  if (longest <= max) return { width: Math.round(w), height: Math.round(h), clamped: false };
  const k = max / longest;
  return { width: Math.round(w * k), height: Math.round(h * k), clamped: true };
}
