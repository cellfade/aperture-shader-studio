"use client";

/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useRef, useState } from "react";
import {
  getComponent,
  type Shader,
  type ParamValues,
} from "@/lib/studio/registry";
import {
  createContentSampler,
  getPaperMount,
  preloadImage,
} from "@/lib/studio/render-readiness";

export interface BatchFrame {
  /** object URL of the source frame image (already PNG) */
  imageUrl: string;
  width: number;
  height: number;
}

interface BatchExportRendererProps {
  shader: Shader;
  values: ParamValues;
  frames: BatchFrame[];
  /** Fired as each frame begins rendering (1-based index). */
  onProgress?: (index: number, total: number) => void;
  /** All shader-applied PNG blobs, in order. Empty array on failure. */
  onDone: (blobs: Blob[] | null) => void;
}

/**
 * Mounts ONE off-screen full-resolution shader instance and renders a list of
 * frame images through it sequentially: set image i → readback-gate until the
 * canvas has non-blank content → toBlob → advance to i+1. Reuses the readiness
 * logic shared with export-renderer.
 *
 * Because every frame can have different native dimensions, the shader element
 * is re-keyed per frame so paper-shaders fully re-mounts at the new size and the
 * blank-canvas content gate stays meaningful (a fresh GL buffer starts blank).
 */
export function BatchExportRenderer({
  shader,
  values,
  frames,
  onProgress,
  onDone,
}: BatchExportRendererProps) {
  const ref = useRef<HTMLElement>(null);
  const [index, setIndex] = useState(0);
  const blobsRef = useRef<Blob[]>([]);
  const doneRef = useRef(false);

  const frame = frames[index];

  useEffect(() => {
    if (doneRef.current) return;
    if (!frame) {
      // ran past the end — emit collected blobs
      doneRef.current = true;
      onDone(blobsRef.current);
      return;
    }

    onProgress?.(index + 1, frames.length);

    let cancelled = false;
    let reading = false;
    const start = performance.now();
    const MIN_SETTLE = 200;
    const MAX_WAIT = 5000;
    const sampler = createContentSampler();

    const fail = () => {
      if (cancelled || doneRef.current) return;
      doneRef.current = true;
      onDone(null);
    };

    const advance = (blob: Blob) => {
      if (cancelled || doneRef.current) return;
      // key by index so a stray double-fire is idempotent (no dup/skip)
      blobsRef.current[index] = blob;
      setIndex((i) => i + 1);
    };

    const tick = () => {
      if (cancelled || doneRef.current) return;
      const el = ref.current;
      const mount = getPaperMount(el);
      const canvas = mount?.canvasElement;
      const sized = !!canvas && canvas.width > 0 && canvas.height > 0;
      const elapsed = performance.now() - start;

      if (!mount || !sized) {
        if (elapsed < MAX_WAIT) requestAnimationFrame(tick);
        else fail();
        return;
      }

      try {
        mount.setSpeed(0);
        mount.setFrame(0);
      } catch {
        /* noop */
      }

      // Each frame re-keys the shader element (fresh blank GL buffer) AND uses a
      // fresh per-index sampler, so there is never a stale prior frame in this
      // buffer — hasChanged sees no prior presented signature and degrades to a
      // presence check, identical to the old hasContent gate. Kept on the
      // consolidated API so the readback gate lives in one place.
      if (elapsed < MIN_SETTLE || !sampler.hasChanged(canvas!, elapsed)) {
        if (elapsed < MAX_WAIT) requestAnimationFrame(tick);
        else fail();
        return;
      }
      sampler.markPresented();

      if (reading) return;
      reading = true;
      requestAnimationFrame(() => {
        if (cancelled || doneRef.current) return;
        try {
          const out = document.createElement("canvas");
          out.width = frame.width;
          out.height = frame.height;
          const ctx = out.getContext("2d");
          if (!ctx) return fail();
          ctx.drawImage(canvas!, 0, 0, frame.width, frame.height);
          out.toBlob((blob) => {
            if (blob) advance(blob);
            else fail();
          }, "image/png");
        } catch {
          fail();
        }
      });
    };

    const begin = () => {
      if (!cancelled && !doneRef.current) requestAnimationFrame(tick);
    };
    preloadImage(frame.imageUrl, begin);

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  if (!frame) return null;

  const Comp = getComponent(shader.component) as any;
  if (!Comp) return null;

  const props: Record<string, unknown> = {
    ...values,
    fit: "cover",
    minPixelRatio: 1,
    maxPixelCount: frame.width * frame.height,
    webGlContextAttributes: { preserveDrawingBuffer: true },
    style: {
      width: `${frame.width}px`,
      height: `${frame.height}px`,
      display: "block",
    },
  };
  if (shader.takesImage) props.image = frame.imageUrl;

  return (
    <div
      aria-hidden
      style={{
        position: "fixed",
        left: -99999,
        top: 0,
        width: frame.width,
        height: frame.height,
        pointerEvents: "none",
        opacity: 0,
      }}
    >
      {/* Re-key per frame so paper-shaders re-mounts at the new size / source. */}
      <Comp key={index} ref={ref} {...props} />
    </div>
  );
}
