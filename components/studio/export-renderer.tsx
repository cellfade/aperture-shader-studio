"use client";

import { useEffect, useRef } from "react";
import {
  getComponent,
  type Shader,
  type ParamValues,
} from "@/lib/studio/registry";
import { downloadBlob } from "@/lib/studio/download";
import {
  awaitRenderedFrame,
  createContentSampler,
  getPaperMount,
  preloadImage,
} from "@/lib/studio/render-readiness";

interface ExportRendererProps {
  shader: Shader;
  values: ParamValues;
  imageUrl?: string | null;
  width: number;
  height: number;
  filename: string;
  onDone: (success: boolean) => void;
}

/**
 * Mounts a dedicated full-resolution shader instance off-screen, waits until the
 * canvas has actually drawn content (readback gate, not just a timer), then reads
 * it into a 2D canvas of exact target dimensions and downloads a PNG.
 */
export function ExportRenderer({
  shader,
  values,
  imageUrl,
  width,
  height,
  filename,
  onDone,
}: ExportRendererProps) {
  const ref = useRef<HTMLElement>(null);

  // One-shot mount contract: a fresh ExportRenderer is mounted per export (it is
  // conditionally rendered from `exportReq`, which studio.tsx snapshots at click
  // time), then unmounted when the export resolves. Every prop (onDone, imageUrl,
  // shader, values, width, height, filename) is therefore FIXED for this
  // instance's lifetime — the effect runs exactly once and never reads a stale
  // value. Hence the intentionally-empty dep array below.
  useEffect(() => {
    let settled = false;
    let reading = false;
    const start = performance.now();
    const MIN_SETTLE = 200;
    const MAX_WAIT = 5000;

    const sampler = createContentSampler();

    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      onDone(ok);
    };

    const readback = (canvas: HTMLCanvasElement) => {
      if (settled || reading) return;
      reading = true;
      requestAnimationFrame(() => {
        if (settled) return;
        try {
          const out = document.createElement("canvas");
          out.width = width;
          out.height = height;
          const ctx = out.getContext("2d");
          if (!ctx) return finish(false);
          ctx.drawImage(canvas, 0, 0, width, height);
          out.toBlob((blob) => {
            if (blob) {
              downloadBlob(blob, filename);
              finish(true);
            } else {
              finish(false);
            }
          }, "image/png");
        } catch {
          finish(false);
        }
      });
    };

    // Preload/decode the source so the texture upload is ready before we read.
    const begin = () => {
      if (settled) return;
      // Single-frame export: a fresh off-screen mount + fresh sampler, so there
      // is no prior presented signature — the change gate degrades to a presence
      // check on this first frame (identical to the old hasContent gate). Using
      // the consolidated gate keeps all three cores on one code path.
      awaitRenderedFrame({
        getMount: () => getPaperMount(ref.current),
        sampler,
        mode: "change",
        minSettleMs: MIN_SETTLE,
        maxWaitMs: MAX_WAIT,
        start,
        isCancelled: () => settled,
      }).then((canvas) => {
        if (canvas) readback(canvas);
        else finish(false);
      });
    };
    if (imageUrl) preloadImage(imageUrl, begin);
    else begin();

    return () => {
      settled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const Comp = getComponent(shader.component);
  if (!Comp) return null;

  const props: Record<string, unknown> = {
    ...values,
    fit: "cover",
    minPixelRatio: 1,
    maxPixelCount: width * height,
    webGlContextAttributes: { preserveDrawingBuffer: true },
    style: { width: `${width}px`, height: `${height}px`, display: "block" },
  };
  if (shader.takesImage && imageUrl) props.image = imageUrl;

  return (
    <div
      aria-hidden
      style={{
        position: "fixed",
        left: -99999,
        top: 0,
        width,
        height,
        pointerEvents: "none",
        opacity: 0,
      }}
    >
      {/* `Comp` is a stable module-level registry lookup (getComponent), not a
          component created during render, so it is referentially stable. */}
      {/* eslint-disable-next-line react-hooks/static-components */}
      <Comp ref={ref} {...props} />
    </div>
  );
}
