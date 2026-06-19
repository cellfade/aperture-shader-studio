/**
 * Video-export orchestrator (Phase 2). Ties the three halves together:
 *
 *   decode (frame-source: MP4Box demux + WebCodecs VideoDecoder)
 *     → render (the P1 persistent shader render core, driven imperatively)
 *       → encode (encoder: WebCodecs VideoEncoder + mp4-muxer)
 *
 * The render core is the existing React `<FrameRenderer>` (components/studio/
 * video-export/frame-renderer.tsx). Rather than reimplementing its prop→uniform
 * mapping and readback gate, we drive it framework-agnostically: mount it once
 * into a detached container via a React root, capture its imperative handle, and
 * call `renderSource()` per frame. `dispose()` unmounts the root.
 *
 * Frame-buffer discipline: EVERY VideoFrame is closed — the decoder's source
 * frames (after they're drawn through the shader) and the re-wrapped render
 * frames (after they're encoded). Leaking either stalls WebCodecs.
 */

import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  FrameRenderer,
  type FrameRendererHandle,
} from "@/components/studio/video-export/frame-renderer";
import { SHADERS_BY_ID, type ParamValues } from "@/lib/studio/registry";
import { clampToMaxSide } from "@/lib/studio/download";
import { decodeFramesInRange } from "./frame-source";
import { ExportEncoder } from "./encoder";

/** Hard cap on the exported range (seconds). */
const MAX_RANGE_SEC = 30;
/** Await encoder drain when the encode queue exceeds this depth. */
const MAX_ENCODE_QUEUE = 8;

export interface EncodeFilteredVideoArgs {
  file: File | Blob;
  shaderId: string;
  values: ParamValues;
  inSec: number;
  outSec: number;
  /** Longest output side, in pixels (default 1080). */
  maxSide?: number;
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
}

export interface EncodeFilteredVideoResult {
  blob: Blob;
  frames: number;
  width: number;
  height: number;
}

function makeEven(n: number): number {
  const r = Math.round(n);
  return r % 2 === 0 ? r : r + 1;
}

/** Drive the React FrameRenderer outside React via a detached root. */
class RenderCore {
  private readonly host: HTMLDivElement;
  private readonly root: Root;
  private handle: FrameRendererHandle | null = null;

  private constructor(host: HTMLDivElement, root: Root) {
    this.host = host;
    this.root = root;
  }

  static async create(args: {
    shaderId: string;
    values: ParamValues;
    width: number;
    height: number;
  }): Promise<RenderCore> {
    const shader = SHADERS_BY_ID[args.shaderId];
    if (!shader) throw new Error(`unknown shader: ${args.shaderId}`);

    const host = document.createElement("div");
    // Off-screen but laid out (paper-shaders needs a real sized box to size GL).
    host.style.position = "fixed";
    host.style.left = "-99999px";
    host.style.top = "0";
    host.style.pointerEvents = "none";
    host.style.opacity = "0";
    document.body.appendChild(host);

    const root = createRoot(host);
    const core = new RenderCore(host, root);

    await new Promise<void>((resolve) => {
      const onRef = (h: FrameRendererHandle | null) => {
        if (h && !core.handle) {
          core.handle = h;
          resolve();
        }
      };
      root.render(
        createElement(FrameRenderer, {
          ref: onRef,
          shader,
          values: args.values,
          width: args.width,
          height: args.height,
        }),
      );
    });

    // Give the shader mount a tick to initialize its GL context + uniforms.
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    return core;
  }

  render(source: CanvasImageSource): Promise<HTMLCanvasElement> {
    if (!this.handle) throw new Error("render core not initialized");
    return this.handle.renderSource(source);
  }

  dispose(): void {
    try {
      this.root.unmount();
    } catch {
      /* noop */
    }
    this.host.remove();
  }
}

export async function encodeFilteredVideo(
  args: EncodeFilteredVideoArgs,
): Promise<EncodeFilteredVideoResult> {
  const {
    file,
    shaderId,
    values,
    inSec,
    maxSide = 1080,
    onProgress,
    signal,
  } = args;

  // Clamp the range to <= MAX_RANGE_SEC.
  const safeIn = Math.max(0, inSec);
  const outSec = Math.min(args.outSec, safeIn + MAX_RANGE_SEC);
  if (outSec <= safeIn) {
    throw new Error(`invalid range: outSec (${outSec}) <= inSec (${safeIn})`);
  }

  const throwIfAborted = () => {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  };
  throwIfAborted();

  // Dims/fps arrive via `onInfo` (synchronously on demux onReady) BEFORE the
  // first frame, so the encoder + render core are built once, up-front.
  // Held in a mutable record so TS doesn't collapse the type to `never` across
  // the onFrame callback boundary (it can't see the cross-call assignment).
  const pipeline: { encoder: ExportEncoder | null; core: RenderCore | null } = {
    encoder: null,
    core: null,
  };
  let targetW = 0;
  let targetH = 0;
  let fps = 30;
  let usPerFrame = 0;
  let framesDone = 0;

  const rangeSec = outSec - safeIn;
  let estimatedTotal = Math.max(1, Math.round(rangeSec * fps));

  const wrappedFrames: VideoFrame[] = [];

  // Built lazily on the first frame, but sized from `onInfo` dims (set first).
  let pendingInit: Promise<void> | null = null;
  let infoDims: { width: number; height: number } | null = null;

  const initPipeline = async (): Promise<void> => {
    const dims = infoDims;
    if (!dims) throw new Error("frame source did not report dimensions");
    const clamped = clampToMaxSide(dims.width, dims.height, maxSide);
    targetW = makeEven(clamped.width);
    targetH = makeEven(clamped.height);
    usPerFrame = Math.round(1e6 / fps);
    estimatedTotal = Math.max(1, Math.round(rangeSec * fps));
    // Verify the real (clamped + evened) export dims/codec are supported BEFORE
    // building the render core and decoding frames, so we fail fast and clean
    // rather than partway through the export.
    const supported = await ExportEncoder.isSupported({
      width: targetW,
      height: targetH,
      fps,
    });
    if (!supported) {
      throw new Error("Unsupported export dimensions/codec");
    }
    pipeline.core = await RenderCore.create({
      shaderId,
      values,
      width: targetW,
      height: targetH,
    });
    pipeline.encoder = new ExportEncoder({
      width: targetW,
      height: targetH,
      fps,
    });
  };

  try {
    await decodeFramesInRange({
      file,
      inSec: safeIn,
      outSec,
      signal,
      onInfo: (info) => {
        fps = info.fps > 0 ? info.fps : fps;
        infoDims = { width: info.width, height: info.height };
      },
      onFrame: async (decoded) => {
        throwIfAborted();

        // Build encoder + render core exactly once (dims/fps known via onInfo).
        if (!pendingInit) pendingInit = initPipeline();
        await pendingInit;
        const activeEncoder = pipeline.encoder;
        const activeCore = pipeline.core;
        if (!activeEncoder || !activeCore) {
          throw new Error("pipeline failed to initialize");
        }

        // Render the decoded frame through the shader. The render core converts
        // any CanvasImageSource (VideoFrame included) into an HTMLImageElement
        // and uploads it as u_image. We own the decoded source frame and MUST
        // close it once rendering has read it (the render core does not).
        try {
          const rendered = await activeCore.render(decoded.frame);

          // Preserve the source presentation timestamp (relative to start).
          const timestamp = Math.max(
            0,
            Math.round((decoded.timeSec - safeIn) * 1e6),
          );
          const out = new VideoFrame(rendered, {
            timestamp,
            duration: usPerFrame,
          });
          wrappedFrames.push(out);
          try {
            activeEncoder.add(out);
          } finally {
            out.close();
            const idx = wrappedFrames.indexOf(out);
            if (idx !== -1) wrappedFrames.splice(idx, 1);
          }
        } finally {
          decoded.frame.close();
        }

        framesDone += 1;
        onProgress?.(framesDone, Math.max(estimatedTotal, framesDone));

        // Backpressure on the encode queue.
        while (activeEncoder.queueSize > MAX_ENCODE_QUEUE) {
          throwIfAborted();
          await new Promise<void>((r) => requestAnimationFrame(() => r()));
        }
      },
    });

    throwIfAborted();

    if (!pipeline.encoder) {
      throw new Error("no frames decoded in the requested range");
    }

    const blob = await pipeline.encoder.finish();
    return {
      blob,
      frames: framesDone,
      width: targetW,
      height: targetH,
    };
  } catch (err) {
    // Ensure the encoder is torn down (finish() not reached on error/abort).
    pipeline.encoder?.dispose();
    throw err;
  } finally {
    // Close any wrapped frames still outstanding (error/abort mid-iteration).
    for (const f of wrappedFrames) {
      try {
        f.close();
      } catch {
        /* noop */
      }
    }
    wrappedFrames.length = 0;
    pipeline.core?.dispose();
  }
}
