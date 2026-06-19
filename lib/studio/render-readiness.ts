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
  /** True once the source has painted (non-zero alpha; varied, or past the grace window). */
  hasContent: (src: CanvasImageSource, elapsed: number) => boolean;
}

export function createContentSampler(): ContentSampler {
  const scratch = document.createElement("canvas");
  scratch.width = 24;
  scratch.height = 24;
  const sctx = scratch.getContext("2d", { willReadFrequently: true });

  return {
    hasContent(src, elapsed) {
      if (!sctx) return true;
      try {
        sctx.clearRect(0, 0, 24, 24);
        sctx.drawImage(src, 0, 0, 24, 24);
        const data = sctx.getImageData(0, 0, 24, 24).data;
        let maxAlpha = 0;
        let varied = false;
        const first = data[0];
        for (let i = 0; i < data.length; i += 4) {
          if (data[i + 3] > maxAlpha) maxAlpha = data[i + 3];
          if (data[i] !== first) varied = true;
        }
        // accept once something is painted; allow a solid frame only after a grace window
        return maxAlpha > 4 && (varied || elapsed > 1400);
      } catch {
        return false;
      }
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
