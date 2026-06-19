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

/**
 * Gate mode for {@link awaitRenderedFrame}:
 * - `"presence"` — accept the first non-blank frame (uses `hasContent`). Correct
 *   for the off-screen PNG cores (export + batch) which mount a fresh blank GL
 *   buffer for each frame, so there is never a stale prior frame to confuse.
 * - `"change"` — accept only once the composited frame differs from the last
 *   *presented* one (uses `hasChanged` + `markPresented`). Correct for the MP4
 *   render core, whose GL buffer PERSISTS across frames.
 *
 * NOTE: the two PNG cores currently call the `"change"` gate too — on a fresh
 * blank buffer with a fresh sampler `hasChanged` degrades to a presence check on
 * the first (only) frame, identical to `hasContent`. Keeping them on the same
 * code path is the whole point of this consolidation; pass `"presence"` only if
 * you genuinely want the pure presence gate.
 */
export type ReadinessMode = "presence" | "change";

export interface AwaitRenderedFrameOptions {
  /**
   * Resolves the live paper-shaders GL mount. Called EVERY tick (not captured
   * once) so the loop picks the mount up as soon as paper-shaders attaches it to
   * the element — matching the original per-core `getPaperMount(ref.current)`
   * inside the rAF tick.
   */
  getMount: () => PaperMount | undefined;
  /** Sampler driving the readiness gate (presence or change). */
  sampler: ContentSampler;
  /** Which gate to apply (see {@link ReadinessMode}). */
  mode: ReadinessMode;
  /** Don't accept a frame before this many ms have elapsed since `start`. */
  minSettleMs: number;
  /** Give up (resolve `null`) after this many ms since `start`. */
  maxWaitMs: number;
  /**
   * Clock origin in `performance.now()` terms. The gate's `elapsed` (which feeds
   * the sampler's grace window) and the timeout are both measured from here.
   * Defaults to "now" at call time.
   */
  start?: number;
  /** Aborts the loop early; resolves `null` when it returns true. */
  isCancelled?: () => boolean;
}

/**
 * Shared readback-gate loop for the three off-screen render cores. Runs a
 * requestAnimationFrame tick loop that:
 *   1. waits for a sized GL canvas on the mount,
 *   2. freezes animation (`setSpeed(0)` / `setFrame(0)`) every tick once present,
 *   3. resolves the ready GL canvas once the readiness gate (presence/change)
 *      passes — calling `markPresented()` on accept,
 *   4. resolves `null` on timeout / cancel / missing-mount.
 *
 * Timing is intentionally identical to the previous per-core inline loops: same
 * grace window (inside the sampler), same `minSettleMs`/`maxWaitMs` gating,
 * same "sampling unavailable → don't block" behavior (handled inside the
 * sampler), same per-tick `setSpeed(0)/setFrame(0)`. The caller owns what
 * happens AFTER the frame is ready (the readback/encode + any teardown).
 */
export function awaitRenderedFrame(
  options: AwaitRenderedFrameOptions,
): Promise<HTMLCanvasElement | null> {
  const {
    getMount,
    sampler,
    mode,
    minSettleMs,
    maxWaitMs,
    start = performance.now(),
    isCancelled,
  } = options;

  return new Promise<HTMLCanvasElement | null>((resolve) => {
    const tick = () => {
      if (isCancelled?.()) {
        resolve(null);
        return;
      }
      const mount = getMount();
      const canvas = mount?.canvasElement;
      const sized = !!canvas && canvas.width > 0 && canvas.height > 0;
      const elapsed = performance.now() - start;

      if (!mount || !sized) {
        if (elapsed < maxWaitMs) requestAnimationFrame(tick);
        else resolve(null);
        return;
      }

      try {
        mount.setSpeed(0);
        mount.setFrame(0);
      } catch {
        /* noop */
      }

      const gatePassed =
        mode === "change"
          ? sampler.hasChanged(canvas, elapsed)
          : sampler.hasContent(canvas, elapsed);

      if (elapsed < minSettleMs || !gatePassed) {
        if (elapsed < maxWaitMs) requestAnimationFrame(tick);
        else resolve(null);
        return;
      }

      sampler.markPresented();
      resolve(canvas);
    };

    requestAnimationFrame(tick);
  });
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
