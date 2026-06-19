/**
 * Video-export encoder (Phase 2). Wraps a WebCodecs `VideoEncoder` (H.264
 * Baseline, `avc1.42001f`) plus mp4-muxer, reusing the exact pattern proven in
 * app/spike/page.tsx. `add(frame)` encodes one frame; `finish()` flushes and
 * returns a playable `video/mp4` Blob.
 *
 * The caller owns the frames it passes to `add()` and must close them; this
 * wrapper only references them synchronously during `encode()`.
 */

import { Muxer, ArrayBufferTarget } from "mp4-muxer";

// avc1.42001f = H.264 Baseline profile, level 3.1 — broadly supported by
// hardware/software encoders and playable in <video>.
const CODEC = "avc1.42001f";

/** Bitrate heuristic: width*height*fps*0.07, clamped to [1Mbps, 20Mbps]. */
export function computeBitrate(
  width: number,
  height: number,
  fps: number,
): number {
  const raw = width * height * fps * 0.07;
  return Math.round(Math.min(Math.max(raw, 1_000_000), 20_000_000));
}

export interface ExportEncoderOptions {
  /** Target width — MUST be even (caller is responsible). */
  width: number;
  /** Target height — MUST be even (caller is responsible). */
  height: number;
  fps: number;
  /** Optional explicit bitrate; defaults to `computeBitrate`. */
  bitrate?: number;
}

export class ExportEncoder {
  private readonly target: ArrayBufferTarget;
  private readonly muxer: Muxer<ArrayBufferTarget>;
  private readonly encoder: VideoEncoder;
  private encoderError: Error | null = null;
  private finished = false;

  constructor(opts: ExportEncoderOptions) {
    const { width, height, fps } = opts;
    if (width % 2 !== 0 || height % 2 !== 0) {
      throw new Error(
        `encoder dimensions must be even, got ${width}x${height}`,
      );
    }
    const bitrate = opts.bitrate ?? computeBitrate(width, height, fps);

    this.target = new ArrayBufferTarget();
    this.muxer = new Muxer({
      target: this.target,
      video: {
        codec: "avc",
        width,
        height,
        frameRate: fps,
      },
      fastStart: "in-memory",
      // first in-range frame may sit slightly after inSec; offset so DTS starts at 0
      firstTimestampBehavior: "offset",
    });

    this.encoder = new VideoEncoder({
      output: (
        chunk: EncodedVideoChunk,
        meta: EncodedVideoChunkMetadata | undefined,
      ) => {
        this.muxer.addVideoChunk(chunk, meta);
      },
      error: (err: DOMException) => {
        this.encoderError = new Error(`encoder error: ${err.message}`);
      },
    });

    const config: VideoEncoderConfig = {
      codec: CODEC,
      width,
      height,
      bitrate,
      framerate: fps,
    };
    this.encoder.configure(config);
  }

  /** Verify the configuration is supported before constructing the encoder. */
  static async isSupported(opts: ExportEncoderOptions): Promise<boolean> {
    if (typeof VideoEncoder === "undefined") return false;
    const bitrate = opts.bitrate ?? computeBitrate(opts.width, opts.height, opts.fps);
    const support = await VideoEncoder.isConfigSupported({
      codec: CODEC,
      width: opts.width,
      height: opts.height,
      bitrate,
      framerate: opts.fps,
    });
    return support.supported === true;
  }

  /** Current encode queue depth — caller awaits drain when this grows. */
  get queueSize(): number {
    return this.encoder.encodeQueueSize;
  }

  /** Encode one frame. Throws if the encoder has reported an error. */
  add(frame: VideoFrame): void {
    if (this.encoderError) throw this.encoderError;
    this.encoder.encode(frame);
    if (this.encoderError) throw this.encoderError;
  }

  /** Flush, finalize the container, and return the playable MP4 blob. */
  async finish(): Promise<Blob> {
    if (this.finished) throw new Error("encoder already finished");
    this.finished = true;
    await this.encoder.flush();
    if (this.encoderError) throw this.encoderError;
    this.encoder.close();
    this.muxer.finalize();
    return new Blob([this.target.buffer], { type: "video/mp4" });
  }

  /** Tear down without producing output (abort/error paths). Idempotent. */
  dispose(): void {
    if (this.finished) return;
    this.finished = true;
    try {
      if (this.encoder.state !== "closed") this.encoder.close();
    } catch {
      /* noop */
    }
  }
}
