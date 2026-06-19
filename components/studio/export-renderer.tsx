"use client";

/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useRef } from "react";
import {
  getComponent,
  type Shader,
  type ParamValues,
} from "@/lib/studio/registry";
import { downloadBlob } from "@/lib/studio/download";
import {
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

    const tick = () => {
      if (settled) return;
      const el = ref.current;
      const mount = getPaperMount(el);
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

      // Single-frame export: a fresh off-screen mount + fresh sampler, so there
      // is no prior presented signature — hasChanged degrades to a presence
      // check on this first frame (identical to the old hasContent gate). Using
      // the consolidated change-detecting gate keeps all three cores in step.
      if (elapsed < MIN_SETTLE || !sampler.hasChanged(canvas!, elapsed)) {
        if (elapsed < MAX_WAIT) requestAnimationFrame(tick);
        else finish(false);
        return;
      }
      sampler.markPresented();

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
    if (imageUrl) preloadImage(imageUrl, begin);
    else begin();

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
