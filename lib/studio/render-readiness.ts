import { isPaperShaderElement } from "@paper-design/shaders-react";

/**
 * Shared readiness helpers for the off-screen full-resolution shader renderers
 * (export-renderer + batch-export-renderer). A freshly mounted GL canvas starts
 * blank (fully transparent); we must wait until it has actually painted a frame
 * before reading it back — a timer alone is unreliable.
 */

/** The live paper-shaders WebGL mount for an element, if it is a shader element. */
export interface PaperMount {
  canvasElement: HTMLCanvasElement;
  setSpeed: (n: number) => void;
  setFrame: (n: number) => void;
}

export function getPaperMount(el: HTMLElement | null): PaperMount | undefined {
  if (!el || !isPaperShaderElement(el)) return undefined;
  return el.paperShaderMount as unknown as PaperMount | undefined;
}

/** A small scratch canvas used to sample whether the GL canvas has content. */
export interface ContentSampler {
  /**
   * True once the source has painted (non-zero alpha; varied, or past the grace
   * window). A pure *presence* gate — correct for a freshly-mounted (blank) GL
   * buffer, but it cannot tell a newly-drawn frame from a stale identical one.
   */
  hasContent: (src: CanvasImageSource, elapsed: number) => boolean;
  /**
   * Change-detecting gate for a PERSISTENT GL buffer that is reused across many
   * frames (the MP4 render core). Resolves true only once the sampled signature
   * is non-blank AND differs from the previously *presented* frame's signature.
   *
   * For the first frame there is no prior signature, so it degrades to the same
   * presence check as `hasContent` (non-blank). On every successive frame it
   * requires the pixels to have actually changed since the last `markPresented`,
   * which is what catches a silent upload failure duplicating the prior frame or
   * a re-run grabbing the stale previous frame. The `elapsed` grace-window
   * fallback (a legitimately solid/unchanged frame past the window) is preserved.
   */
  hasChanged: (src: CanvasImageSource, elapsed: number) => boolean;
  /**
   * Record the current signature as the "presented" baseline. Call this exactly
   * once per accepted frame (after the readback gate resolves) so the next
   * frame's `hasChanged` compares against it.
   */
  markPresented: () => void;
}

export function createContentSampler(): ContentSampler {
  const SAMPLE = 24; // 24×24 = 576 sampled pixels — cheap, not a full readback
  const scratch = document.createElement("canvas");
  scratch.width = SAMPLE;
  scratch.height = SAMPLE;
  const sctx = scratch.getContext("2d", { willReadFrequently: true });

  /** Cheap signature of the current draw: max alpha, "varied" flag, and an FNV
   * hash over the sampled RGBA bytes. Returns null if sampling failed. */
  const sample = (
    src: CanvasImageSource,
  ): { maxAlpha: number; varied: boolean; hash: number } | null => {
    if (!sctx) return null;
    try {
      sctx.clearRect(0, 0, SAMPLE, SAMPLE);
      sctx.drawImage(src, 0, 0, SAMPLE, SAMPLE);
      const data = sctx.getImageData(0, 0, SAMPLE, SAMPLE).data;
      let maxAlpha = 0;
      let varied = false;
      const first = data[0];
      let hash = 0x811c9dc5; // FNV-1a 32-bit offset basis
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] > maxAlpha) maxAlpha = data[i + 3];
        if (data[i] !== first) varied = true;
        // fold R,G,B,A into the running hash
        hash ^= data[i];
        hash = Math.imul(hash, 0x01000193);
        hash ^= data[i + 1];
        hash = Math.imul(hash, 0x01000193);
        hash ^= data[i + 2];
        hash = Math.imul(hash, 0x01000193);
        hash ^= data[i + 3];
        hash = Math.imul(hash, 0x01000193);
      }
      return { maxAlpha, varied, hash: hash >>> 0 };
    } catch {
      return null;
    }
  };

  let lastPresented: number | null = null;
  let lastSeen: { maxAlpha: number; varied: boolean; hash: number } | null =
    null;

  return {
    hasContent(src, elapsed) {
      const s = sample(src);
      if (!s) return true; // sampling unavailable (no 2D ctx / tainted) — don't block
      lastSeen = s;
      // accept once something is painted; allow a solid frame only after a grace window
      return s.maxAlpha > 4 && (s.varied || elapsed > 1400);
    },
    hasChanged(src, elapsed) {
      const s = sample(src);
      if (!s) return true; // sampling unavailable — don't block (same as hasContent)
      lastSeen = s;
      const present = s.maxAlpha > 4 && (s.varied || elapsed > 1400);
      if (!present) return false;
      // First frame (no prior presented signature): presence is enough.
      if (lastPresented === null) return true;
      // Successive frames: require the pixels to have actually changed. If they
      // haven't yet, keep waiting until the grace window expires, then accept
      // (a frame that is legitimately identical to its predecessor).
      if (s.hash !== lastPresented) return true;
      return elapsed > 1400;
    },
    markPresented() {
      if (lastSeen) lastPresented = lastSeen.hash;
    },
  };
}

/** Decode-preload an image URL so the texture upload is ready before we read back. */
export function preloadImage(url: string, then: () => void): void {
  const pre = new Image();
  pre.src = url;
  if (pre.decode) pre.decode().then(then, then);
  else {
    pre.onload = then;
    pre.onerror = then;
  }
}
