"use client";

import { useEffect, useRef, useState } from "react";
import {
  getComponent,
  type Shader,
  type ParamValues,
} from "@/lib/studio/registry";
import {
  awaitRenderedFrame,
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

    const readback = (canvas: HTMLCanvasElement) => {
      if (cancelled || doneRef.current || reading) return;
      reading = true;
      requestAnimationFrame(() => {
        if (cancelled || doneRef.current) return;
        try {
          const out = document.createElement("canvas");
          out.width = frame.width;
          out.height = frame.height;
          const ctx = out.getContext("2d");
          if (!ctx) return fail();
          ctx.drawImage(canvas, 0, 0, frame.width, frame.height);
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
      if (cancelled || doneRef.current) return;
      // Each frame re-keys the shader element (fresh blank GL buffer) AND uses a
      // fresh per-index sampler, so there is never a stale prior frame in this
      // buffer — the change gate sees no prior presented signature and degrades
      // to a presence check, identical to the old hasContent gate. Kept on the
      // consolidated gate so the readback loop lives in one place.
      awaitRenderedFrame({
        getMount: () => getPaperMount(ref.current),
        sampler,
        mode: "change",
        minSettleMs: MIN_SETTLE,
        maxWaitMs: MAX_WAIT,
        start,
        isCancelled: () => cancelled || doneRef.current,
      }).then((canvas) => {
        if (canvas) readback(canvas);
        else fail();
      });
    };
    preloadImage(frame.imageUrl, begin);

    return () => {
      cancelled = true;
    };
    // The render loop runs once per `index`; every other captured value
    // (shader, values, frames, onProgress, onDone) is fixed for this
    // BatchExportRenderer's keyed lifetime — studio.tsx snapshots `batchReq` at
    // click time and mounts a fresh renderer per export, so an `index`-only dep
    // never reads a stale prop. The disable documents that intentional contract.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  if (!frame) return null;

  const Comp = getComponent(shader.component);
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
      {/* `Comp` is a stable module-level registry lookup (getComponent), not a
          component created during render, so it is referentially stable. */}
      {/* eslint-disable-next-line react-hooks/static-components */}
      <Comp key={index} ref={ref} {...props} />
    </div>
  );
}
