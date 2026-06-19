"use client";

/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useRef } from "react";
import { isPaperShaderElement } from "@paper-design/shaders-react";
import {
  getComponent,
  type Shader,
  type ParamValues,
} from "@/lib/studio/registry";
import { downloadBlob } from "@/lib/studio/download";

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

  useEffect(() => {
    let settled = false;
    let reading = false;
    const start = performance.now();
    const MIN_SETTLE = 200;
    const MAX_WAIT = 5000;

    const scratch = document.createElement("canvas");
    scratch.width = 24;
    scratch.height = 24;
    const sctx = scratch.getContext("2d", { willReadFrequently: true });

    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      onDone(ok);
    };

    // Content gate: a drawn frame has non-zero alpha; a blank GL buffer is fully transparent.
    const hasContent = (src: CanvasImageSource): boolean => {
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
        return maxAlpha > 4 && (varied || performance.now() - start > 1400);
      } catch {
        return false;
      }
    };

    const tick = () => {
      if (settled) return;
      const el = ref.current;
      const mount = el && isPaperShaderElement(el) ? el.paperShaderMount : undefined;
      const canvas = mount?.canvasElement;
      const sized = !!canvas && canvas.width > 0 && canvas.height > 0;
      const elapsed = performance.now() - start;

      if (!mount || !sized) {
        if (elapsed < MAX_WAIT) requestAnimationFrame(tick);
        else finish(false);
        return;
      }

      try {
        mount.setSpeed(0);
        mount.setFrame(0);
      } catch {
        /* noop */
      }

      if (elapsed < MIN_SETTLE || !hasContent(canvas!)) {
        if (elapsed < MAX_WAIT) requestAnimationFrame(tick);
        else finish(false);
        return;
      }

      if (reading) return;
      reading = true;
      requestAnimationFrame(() => {
        if (settled) return;
        try {
          const out = document.createElement("canvas");
          out.width = width;
          out.height = height;
          const ctx = out.getContext("2d");
          if (!ctx) return finish(false);
          ctx.drawImage(canvas!, 0, 0, width, height);
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
      if (!settled) requestAnimationFrame(tick);
    };
    if (imageUrl) {
      const pre = new Image();
      pre.src = imageUrl;
      if (pre.decode) pre.decode().then(begin, begin);
      else {
        pre.onload = begin;
        pre.onerror = begin;
      }
    } else {
      begin();
    }

    return () => {
      settled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const Comp = getComponent(shader.component) as any;
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
      <Comp ref={ref} {...props} />
    </div>
  );
}
