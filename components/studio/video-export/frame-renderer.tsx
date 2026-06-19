"use client";

/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import {
  getComponent,
  type Shader,
  type ParamValues,
} from "@/lib/studio/registry";
import {
  createContentSampler,
  getPaperMount,
  type PaperMount,
} from "@/lib/studio/render-readiness";
import type { ShaderMountUniforms } from "@paper-design/shaders";

/**
 * render-readiness's PaperMount intentionally exposes only the readback-gate
 * surface (canvasElement/setSpeed/setFrame). The persistent render core also
 * needs setUniforms — which the real ShaderMount provides — so we widen the
 * type locally rather than altering the shared helper.
 */
interface PaperMountWithUniforms extends PaperMount {
  setUniforms: (uniforms: ShaderMountUniforms) => void;
}

/**
 * Imperative handle for driving successive source frames through ONE persistent
 * off-screen shader instance (video export's render core).
 */
export interface FrameRendererHandle {
  /**
   * Sets the shader's source image to `source`, waits for a non-blank composited
   * draw, then returns a fresh width×height 2D canvas containing the rendered
   * frame. Safe to call repeatedly in sequence.
   */
  renderSource: (source: CanvasImageSource) => Promise<HTMLCanvasElement>;
  /** The live GL canvas backing the mount — identity is stable across frames. */
  getGlCanvas: () => HTMLCanvasElement | null;
}

interface FrameRendererProps {
  shader: Shader;
  values: ParamValues;
  width: number;
  height: number;
}

/* ===========================================================================
 * KEY DESIGN DECISION — image-update strategy: (b) direct mount.setUniforms.
 *
 * Two options were investigated against the real paper-shaders source
 * (node_modules/@paper-design/shaders{,-react}/dist/*.js):
 *
 *  (a) Update the React `image` prop per frame and let <ImageDithering> diff →
 *      setUniforms internally. REJECTED. The react wrapper's uniform-update
 *      effect is ASYNC (`await processUniforms(...)`, which itself loads strings
 *      as images and runs `setMinImageSize`) and is gated on React's render
 *      cycle. There is no deterministic signal for "this specific frame has been
 *      uploaded and drawn", so a per-frame readback gate cannot reliably know
 *      which frame it is sampling. It is also slower (extra render + decode per
 *      frame on top of ours).
 *
 *  (b) Grab the vanilla ShaderMount via getPaperMount(ref) and call
 *      `mount.setUniforms({ u_image })` directly each frame. CHOSEN.
 *      - setUniforms() is SYNCHRONOUS and calls render() immediately, so the GL
 *        canvas reflects the new frame right away; we then readback-gate.
 *      - The GL context / canvasElement is created once in the ShaderMount
 *        constructor (only on mount, keyed on fragmentShader) and is NEVER
 *        recreated by setUniforms — the context persists across every frame.
 *
 * Two non-obvious facts from the source that constrain (b):
 *
 *  1. The GL uniform KEY is `u_image`, NOT `image`. The react component maps the
 *     `image` prop → `u_image` uniform (see shaders/image-dithering.js). Calling
 *     setUniforms directly must use the raw uniform name.
 *
 *  2. setUniformValues() only treats a value as a texture when it is
 *     `instanceof HTMLImageElement` (and setTextureUniform requires
 *     `img.complete && img.naturalWidth > 0`). A bare canvas / ImageBitmap /
 *     VideoFrame would fall through to the numeric/array branches and corrupt
 *     state. So every CanvasImageSource is first drawn to a 2D canvas, encoded,
 *     and decoded into a fully-loaded HTMLImageElement before upload.
 *
 * The component mounts with the default `image=""` prop, which the react wrapper
 * resolves to the library's `emptyPixel` image — so the `u_image` (and
 * `u_imageAspectRatio`) uniform locations already exist by the time we drive
 * frames, and our direct setUniforms uploads land correctly.
 * =========================================================================== */

const MAX_WAIT_MS = 4000;
const MIN_SETTLE_MS = 50;

/**
 * Draw any CanvasImageSource into a fully-decoded HTMLImageElement of WxH.
 * Returns the object URL too so the caller can revoke it after the synchronous
 * texture upload (mount.setUniforms) has read the image.
 */
async function sourceToImageWithUrl(
  source: CanvasImageSource,
  width: number,
  height: number,
  scratch: HTMLCanvasElement,
): Promise<{ img: HTMLImageElement; url: string }> {
  scratch.width = width;
  scratch.height = height;
  const ctx = scratch.getContext("2d");
  if (!ctx) throw new Error("2D context unavailable for frame conversion");
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(source, 0, 0, width, height);

  const blob = await new Promise<Blob | null>((resolve) => {
    scratch.toBlob((b) => resolve(b), "image/png");
  });
  if (!blob) throw new Error("failed to encode source frame");

  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.src = url;
  if (img.decode) {
    await img.decode();
  } else {
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("source image failed to load"));
    });
  }
  return { img, url };
}

function FrameRendererImpl(
  { shader, values, width, height }: FrameRendererProps,
  ref: React.Ref<FrameRendererHandle>,
) {
  const elRef = useRef<HTMLElement>(null);
  const samplerRef = useRef<ReturnType<typeof createContentSampler> | null>(
    null,
  );
  const scratchRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    samplerRef.current = createContentSampler();
    scratchRef.current = document.createElement("canvas");
  }, []);

  useImperativeHandle(
    ref,
    (): FrameRendererHandle => ({
      getGlCanvas: () => getPaperMount(elRef.current)?.canvasElement ?? null,
      renderSource: async (source) => {
        const scratch = scratchRef.current;
        const sampler = samplerRef.current;
        if (!scratch || !sampler) {
          throw new Error("FrameRenderer not initialized");
        }

        // Wait for the persistent mount + a sized GL canvas.
        const start = performance.now();
        let mount = getPaperMount(elRef.current) as
          | PaperMountWithUniforms
          | undefined;
        while (
          (!mount ||
            !(
              mount.canvasElement.width > 0 && mount.canvasElement.height > 0
            )) &&
          performance.now() - start < MAX_WAIT_MS
        ) {
          await new Promise<void>((r) => requestAnimationFrame(() => r()));
          mount = getPaperMount(elRef.current) as
            | PaperMountWithUniforms
            | undefined;
        }
        if (!mount) throw new Error("shader mount unavailable");
        const canvas = mount.canvasElement;
        if (!(canvas.width > 0 && canvas.height > 0)) {
          throw new Error("shader GL canvas never sized");
        }

        // Freeze animation for deterministic, time-independent frames.
        try {
          mount.setSpeed(0);
          mount.setFrame(0);
        } catch {
          /* noop */
        }

        // Convert the source to a fully-loaded HTMLImageElement and upload it as
        // the raw `u_image` uniform (strategy b). setUniforms() synchronously
        // re-renders, so the GL canvas now holds this frame.
        const blobUrlImg = await sourceToImageWithUrl(
          source,
          width,
          height,
          scratch,
        );
        try {
          mount.setUniforms({ u_image: blobUrlImg.img });

          // Readback-gate: wait until the composited canvas is non-blank.
          await new Promise<void>((resolve, reject) => {
            const gateStart = performance.now();
            const tick = () => {
              const elapsed = performance.now() - gateStart;
              if (
                elapsed >= MIN_SETTLE_MS &&
                sampler.hasContent(canvas, elapsed)
              ) {
                resolve();
                return;
              }
              if (elapsed >= MAX_WAIT_MS) {
                reject(new Error("frame never produced non-blank content"));
                return;
              }
              requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
          });
        } finally {
          URL.revokeObjectURL(blobUrlImg.url);
        }

        // Copy the composited GL canvas into a fresh WxH 2D canvas.
        const out = document.createElement("canvas");
        out.width = width;
        out.height = height;
        const octx = out.getContext("2d");
        if (!octx) throw new Error("output 2D context unavailable");
        octx.drawImage(canvas, 0, 0, width, height);
        return out;
      },
    }),
    [width, height],
  );

  const Comp = getComponent(shader.component) as any;
  if (!Comp) return null;

  const props: Record<string, unknown> = {
    ...values,
    fit: "cover",
    speed: 0,
    minPixelRatio: 1,
    maxPixelCount: width * height,
    webGlContextAttributes: { preserveDrawingBuffer: true },
    style: { width: `${width}px`, height: `${height}px`, display: "block" },
  };

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
      <Comp ref={elRef} {...props} />
    </div>
  );
}

export const FrameRenderer = forwardRef<
  FrameRendererHandle,
  FrameRendererProps
>(FrameRendererImpl);
FrameRenderer.displayName = "FrameRenderer";
