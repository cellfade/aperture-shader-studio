/**
 * Video-export frame source (Phase 2, Option A from docs/spike-webcodecs.md).
 *
 * Demuxes an MP4/H.264 (or HEVC) container with MP4Box.js and decodes its video
 * track with a WebCodecs `VideoDecoder`, yielding fully-decoded `VideoFrame`s in
 * PRESENTATION order within a `[inSec, outSec]` time range. This is the
 * frame-exact, pull-based path: one coded frame in, one decoded frame out, with
 * the source's real timestamps preserved.
 *
 * The caller owns every yielded frame and MUST call `frame.close()` (the
 * WebCodecs frame-buffer pool is small — leaking frames stalls the decoder).
 */

import {
  createFile,
  MultiBufferStream,
  Endianness,
  type ISOFile,
  type Movie,
  type Sample,
  type Track,
  type MP4BoxBuffer,
  type VisualSampleEntry,
} from "mp4box";

/** A decoded frame plus the presentation time (seconds) it maps to. */
export interface DecodedFrame {
  frame: VideoFrame;
  /** Presentation timestamp in seconds (from VideoFrame.timestamp / 1e6). */
  timeSec: number;
}

export interface FrameSourceInfo {
  /** Natural coded width of the video track. */
  width: number;
  /** Natural coded height of the video track. */
  height: number;
  /** Detected average frame rate (frames / track-duration). */
  fps: number;
}

/**
 * Upper bound on decoded frames allowed to be "in flight" — i.e. queued in the
 * WebCodecs decoder OR buffered awaiting reorder/consumption — before the decode
 * loop pauses. The WebCodecs frame-buffer pool is small (often ~16-24 frames);
 * decoding a 30s/60fps range in a tight loop would queue ~1800 chunks and
 * exhaust the pool before the (slower) consumer drains them. Keeping in-flight
 * work bounded lets the consumer keep up. */
const MAX_DECODE_QUEUE = 24;
/**
 * Upper bound on decoded, in-range frames buffered for presentation-order
 * reordering / awaiting the consumer. Distinct from the decoder's own queue:
 * this caps frames that have already left the decoder but not yet been handed
 * to (and closed by) the consumer, so a slow consumer can't accumulate
 * unbounded `VideoFrame`s. */
const MAX_PENDING = 24;

/** mp4box `MP4BoxBuffer` is an `ArrayBuffer` with a `fileStart` marker. */
function toMp4BoxBuffer(bytes: ArrayBuffer, fileStart: number): MP4BoxBuffer {
  const buf = bytes as MP4BoxBuffer;
  buf.fileStart = fileStart;
  return buf;
}

/**
 * Extract the WebCodecs decoder `description` (the avcC / hvcC configuration
 * record, header-stripped) from a track's sample-description box.
 *
 * The standard MP4Box idiom: locate the track's `VisualSampleEntry`, write its
 * avcC (or hvcC) box to a `DataStream`, then slice off the 8-byte box header
 * (4-byte size + 4-byte fourcc) — what remains is exactly the bytes WebCodecs
 * wants for `VideoDecoderConfig.description`.
 */
function getDecoderDescription(file: ISOFile, trackId: number): Uint8Array {
  const trak = file.getTrackById(trackId);
  const entries = trak?.mdia?.minf?.stbl?.stsd?.entries;
  const entry = entries?.[0] as VisualSampleEntry | undefined;
  if (!entry) {
    throw new Error("video track has no sample-description entry");
  }
  const configBox = entry.avcC ?? entry.hvcC;
  if (!configBox) {
    throw new Error(
      "unsupported codec: no avcC/hvcC configuration box in track",
    );
  }
  const stream = new MultiBufferStream();
  stream.endianness = Endianness.BIG_ENDIAN;
  configBox.write(stream);
  // Skip the 8-byte box header (4-byte size + 4-byte fourcc) to get the raw
  // avcC/hvcC configuration record WebCodecs wants as `description`.
  return new Uint8Array(stream.buffer, 8);
}

/** Pick the primary video track, or throw if there is none. */
function pickVideoTrack(info: Movie): Track {
  const track = info.videoTracks[0];
  if (!track) throw new Error("no video track found in file");
  return track;
}

/** Average fps from sample count over the track's real duration. */
function detectFps(track: Track): number {
  const durationSec = track.duration / track.timescale;
  if (durationSec > 0 && track.nb_samples > 0) {
    const fps = track.nb_samples / durationSec;
    if (Number.isFinite(fps) && fps > 0) return fps;
  }
  return 30;
}

/**
 * Demux + decode the given video file and invoke `onFrame` for each decoded
 * frame whose presentation time falls within `[inSec, outSec]`, in presentation
 * order. Resolves once all in-range frames have been delivered.
 *
 * `onFrame` receives ownership of the frame and MUST close it (the iterator does
 * not). Returning a promise applies backpressure: decoding is paused until it
 * resolves. The detected `width`/`height`/`fps` are returned for the caller to
 * size the encoder.
 */
export async function decodeFramesInRange(args: {
  file: File | Blob;
  inSec: number;
  outSec: number;
  /**
   * Called once, synchronously on `onReady`, with the detected track dims/fps —
   * BEFORE the first `onFrame`. Lets the caller size its encoder up-front.
   */
  onInfo?: (info: FrameSourceInfo) => void;
  onFrame: (decoded: DecodedFrame) => void | Promise<void>;
  signal?: AbortSignal;
}): Promise<FrameSourceInfo> {
  const { file, inSec, outSec, onInfo, onFrame, signal } = args;

  const mp4 = createFile();
  let info: FrameSourceInfo | null = null;

  // Frames arrive from the decoder in DECODE order; we buffer briefly and emit
  // in PRESENTATION order. Reorder within a small window keyed on timestamp.
  const pending: DecodedFrame[] = [];
  let consumerChain: Promise<void> = Promise.resolve();
  let consumerError: Error | null = null;

  // Cooperative-abort state. `aborted` stops feeding the decoder and bails the
  // decode loop; teardown then awaits the in-flight consumer chain to quiesce
  // BEFORE closing the decoder, so no `onFrame` is mid-render at close time.
  let aborted = false;

  const inUs = inSec * 1e6;
  const outUs = outSec * 1e6;

  const decoder = new VideoDecoder({
    output: (frame: VideoFrame) => {
      const timeSec = frame.timestamp / 1e6;
      // Drop frames outside the requested range; close them immediately.
      if (frame.timestamp < inUs - 1 || frame.timestamp > outUs + 1) {
        frame.close();
        return;
      }
      pending.push({ frame, timeSec });
    },
    error: (err: DOMException) => {
      consumerError = new Error(`decoder error: ${err.message}`);
    },
  });

  /** Buffered in-range coded chunks, drained by the async decode loop below. */
  const chunkQueue: EncodedVideoChunk[] = [];

  /** Flush buffered frames in presentation order, applying backpressure. */
  const drainPending = (all: boolean): void => {
    // Keep a small reorder window unless flushing everything at the end.
    pending.sort((a, b) => a.frame.timestamp - b.frame.timestamp);
    const REORDER_WINDOW = 16;
    while (pending.length > (all ? 0 : REORDER_WINDOW)) {
      const next = pending.shift();
      if (!next) break;
      const decoded = next;
      consumerChain = consumerChain.then(async () => {
        if (consumerError || aborted) {
          decoded.frame.close();
          return;
        }
        try {
          await onFrame(decoded);
        } catch (err) {
          consumerError =
            err instanceof Error ? err : new Error(String(err));
          decoded.frame.close();
        }
      });
    }
  };

  /**
   * Yield to the event loop, preferring the decoder's `dequeue` event so we wake
   * as soon as the decoder makes room. Falls back to a short timeout so we never
   * stall if no `dequeue` fires (e.g. decoder already drained / errored).
   */
  const waitForDecoderProgress = (): Promise<void> =>
    new Promise<void>((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        decoder.removeEventListener("dequeue", done);
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(done, 8);
      decoder.addEventListener("dequeue", done, { once: true });
    });

  /**
   * Drive decoding from the buffered `chunkQueue` with real backpressure so the
   * number of decoded frames in flight stays bounded. After each `decode`, pause
   * while the decoder's own queue is deep OR while too many decoded frames are
   * buffered awaiting the (slower) consumer.
   */
  const runDecodeLoop = async (): Promise<void> => {
    let i = 0;
    while (i < chunkQueue.length) {
      if (aborted || consumerError) return;
      const chunk = chunkQueue[i++];
      try {
        decoder.decode(chunk);
      } catch (err) {
        consumerError = err instanceof Error ? err : new Error(String(err));
        return;
      }
      // Move ready frames toward the consumer (keeping the reorder window).
      drainPending(false);
      // Bound in-flight work: decoder-queued chunks AND buffered decoded frames.
      while (
        !aborted &&
        !consumerError &&
        (decoder.decodeQueueSize > MAX_DECODE_QUEUE ||
          pending.length > MAX_PENDING)
      ) {
        await waitForDecoderProgress();
        drainPending(false);
      }
    }
  };

  // Settle-once guards: abort and the main IIFE can both reach for resolve/
  // reject; whichever wins, the other is a no-op.
  let settled = false;

  return await new Promise<FrameSourceInfo>((resolve, reject) => {
    const settleResolve = (value: FrameSourceInfo) => {
      if (settled) return;
      settled = true;
      if (signal) signal.removeEventListener("abort", onAbort);
      resolve(value);
    };
    const settleReject = (err: unknown) => {
      if (settled) return;
      settled = true;
      if (signal) signal.removeEventListener("abort", onAbort);
      reject(err instanceof Error ? err : new Error(String(err)));
    };

    // Cooperative abort: flip the flag and stop feeding. We do NOT close the
    // decoder or reject here — the main IIFE observes `aborted`, quiesces the
    // in-flight consumer chain, then tears everything down in its finally so no
    // `onFrame` is ever mid-render when the decoder/consumer is disposed.
    function onAbort() {
      aborted = true;
      chunkQueue.length = 0;
    }
    if (signal) {
      if (signal.aborted) {
        aborted = true;
      } else {
        signal.addEventListener("abort", onAbort, { once: true });
      }
    }

    mp4.onError = (_module: string, message: string) => {
      settleReject(new Error(`mp4box error: ${message}`));
    };

    mp4.onReady = (movie: Movie) => {
      try {
        const track = pickVideoTrack(movie);
        const width = track.video?.width ?? track.track_width;
        const height = track.video?.height ?? track.track_height;
        const fps = detectFps(track);
        info = { width, height, fps };
        onInfo?.(info);

        const description = getDecoderDescription(mp4, track.id);
        const config: VideoDecoderConfig = {
          codec: track.codec,
          codedWidth: width,
          codedHeight: height,
          description,
        };
        decoder.configure(config);

        mp4.setExtractionOptions(track.id);
        mp4.start();
      } catch (err) {
        settleReject(err instanceof Error ? err : new Error(String(err)));
      }
    };

    // Buffer in-range samples instead of decoding inline. `onSamples` is a
    // synchronous MP4Box callback, so decoding everything here would be a tight
    // loop with no backpressure; the async decode loop (runDecodeLoop) drives
    // the actual decoding once all samples are buffered.
    mp4.onSamples = (_id: number, _user: unknown, samples: Sample[]) => {
      if (consumerError || aborted) return;
      for (const sample of samples) {
        const ctsUs = (sample.cts / sample.timescale) * 1e6;
        // Skip samples entirely after the range; but we must still decode
        // earlier samples (and any sync-frame dependencies) before the range,
        // so only short-circuit on the trailing side.
        if (ctsUs > outUs + 1) continue;
        chunkQueue.push(
          new EncodedVideoChunk({
            type: sample.is_sync ? "key" : "delta",
            timestamp: ctsUs,
            duration: (sample.duration / sample.timescale) * 1e6,
            data: sample.data ?? new Uint8Array(0),
          }),
        );
      }
    };

    // Feed the whole file to mp4box, then drive decode → flush → resolve.
    void (async () => {
      try {
        const arrayBuffer = await file.arrayBuffer();
        if (!aborted) {
          mp4.appendBuffer(toMp4BoxBuffer(arrayBuffer, 0));
          mp4.flush();
        }

        if (!info) {
          // onReady never fired (not a parseable MP4, or no moov). If aborted
          // before parsing, fall through to the abort path below.
          if (aborted) throw new DOMException("Aborted", "AbortError");
          throw new Error("could not parse video container (no moov/track)");
        }

        // All in-range samples are now buffered (mp4.flush delivered them
        // synchronously). Drive decoding with backpressure.
        await runDecodeLoop();

        // Flush the decoder for tail frames only if it's still open and we
        // weren't aborted — flushing a closed/aborted decoder throws.
        if (!aborted && !consumerError && decoder.state === "configured") {
          await decoder.flush();
        }
        drainPending(true);

        // Quiesce the in-flight consumer chain BEFORE any teardown, so no
        // `onFrame` is mid-render when we close the decoder.
        await consumerChain;

        if (aborted) throw new DOMException("Aborted", "AbortError");
        if (consumerError) throw consumerError;

        if (decoder.state !== "closed") {
          try {
            decoder.close();
          } catch {
            /* noop */
          }
        }
        settleResolve(info);
      } catch (err) {
        // Quiesce any still-running consumer work before tearing down, so the
        // consumer is never disposing its render core mid-render(). (The chain
        // never rejects — its steps capture errors into `consumerError` — so
        // this await always settles.)
        try {
          await consumerChain;
        } catch {
          /* noop */
        }
        if (decoder.state !== "closed") {
          try {
            decoder.close();
          } catch {
            /* noop */
          }
        }
        for (const p of pending) p.frame.close();
        pending.length = 0;
        chunkQueue.length = 0;
        if (aborted || signal?.aborted) {
          settleReject(new DOMException("Aborted", "AbortError"));
        } else {
          settleReject(err instanceof Error ? err : new Error(String(err)));
        }
      }
    })();
  });
}
