import { zipSync, type Zippable } from "fflate";
import { downloadBlob } from "@/lib/studio/download";

/** Zero-pad a 1-based index to at least 2 digits: 1 -> "01", 12 -> "12". */
export function frameName(index: number): string {
  return `frame-${String(index + 1).padStart(2, "0")}.png`;
}

/**
 * Pack PNG blobs into a STORE-level zip (PNGs are already compressed, so level 0
 * avoids wasted CPU) and trigger a download. Fully client-side.
 */
export async function zipAndDownloadFrames(
  blobs: Blob[],
  zipFilename: string,
): Promise<void> {
  const files: Zippable = {};
  for (let i = 0; i < blobs.length; i++) {
    const buf = new Uint8Array(await blobs[i].arrayBuffer());
    files[frameName(i)] = buf;
  }
  const zipped = zipSync(files, { level: 0 });
  // Copy into a fresh ArrayBuffer-backed view so the Blob part is unambiguous.
  const out = new Uint8Array(zipped.length);
  out.set(zipped);
  const blob = new Blob([out], { type: "application/zip" });
  downloadBlob(blob, zipFilename);
}
