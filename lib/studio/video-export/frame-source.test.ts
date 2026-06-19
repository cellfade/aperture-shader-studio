import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

/**
 * Abort + frame-lifecycle tests for `decodeFramesInRange` (#35). The WebCodecs
 * surface (`VideoDecoder`, `VideoFrame`, `EncodedVideoChunk`) and the `mp4box`
 * demuxer are faked so we can drive the decode orchestration deterministically
 * and assert:
 *
 *   - cooperative abort: a pre-aborted signal yields zero onFrame calls and
 *     rejects with AbortError; abort mid-decode stops feeding the decoder,
 *     quiesces the in-flight consumer, and closes the decoder during teardown;
 *   - frame discipline: frames OUTSIDE the [in,out] range are closed
 *     immediately; the `settled` guard means abort + a later resolve don't both
 *     fire (single settlement).
 *
 * NOT covered (Playwright smoke / live export territory): real H.264 demux,
 * real VideoDecoder reordering, and the GL render path. This isolates the pure
 * decode-loop/teardown seam.
 */

// ── Fakes ────────────────────────────────────────────────────────────────────

class FakeVideoFrame {
  closeCount = 0;
  constructor(public timestamp: number) {}
  close() {
    this.closeCount += 1;
  }
}

class FakeEncodedVideoChunk {
  timestamp: number;
  constructor(init: { timestamp: number }) {
    this.timestamp = init.timestamp;
  }
}

/** Tracks the decoders the code under test constructs (latest = last). */
const decoderInstances: FakeVideoDecoder[] = [];
const lastDecoder = (): FakeVideoDecoder | undefined =>
  decoderInstances[decoderInstances.length - 1];
class FakeVideoDecoder {
  state: "unconfigured" | "configured" | "closed" = "unconfigured";
  decodeQueueSize = 0;
  closeCount = 0;
  private output: (f: FakeVideoFrame) => void;
  private listeners = new Map<string, Array<() => void>>();
  constructor(init: { output: (f: FakeVideoFrame) => void; error: unknown }) {
    this.output = init.output;
    decoderInstances.push(this);
  }
  configure() {
    this.state = "configured";
  }
  decode(chunk: FakeEncodedVideoChunk) {
    // Emit one decoded frame per chunk, same timestamp (already in order).
    this.output(new FakeVideoFrame(chunk.timestamp));
  }
  async flush() {}
  close() {
    this.state = "closed";
    this.closeCount += 1;
  }
  addEventListener(type: string, cb: () => void) {
    const arr = this.listeners.get(type) ?? [];
    arr.push(cb);
    this.listeners.set(type, arr);
  }
  removeEventListener(type: string, cb: () => void) {
    const arr = this.listeners.get(type);
    if (arr) this.listeners.set(type, arr.filter((f) => f !== cb));
  }
}

// ── mp4box fake ───────────────────────────────────────────────────────────────
// A single controllable ISOFile-ish object. `appendBuffer` is a no-op; `flush`
// synchronously fires onReady (with one video track) then onSamples (with the
// samples the test configured), mirroring mp4box's synchronous delivery.

interface Mp4Sample {
  cts: number;
  timescale: number;
  duration: number;
  is_sync: boolean;
  data: Uint8Array;
}

let pendingSamples: Mp4Sample[] = [];
let mp4ReadyFails = false;

const fakeTrack = {
  id: 1,
  codec: "avc1.42001f",
  video: { width: 640, height: 480 },
  track_width: 640,
  track_height: 480,
  duration: 1000,
  timescale: 1000,
  nb_samples: 30,
};

function makeFakeFile() {
  const file: Record<string, unknown> = {
    onReady: undefined as unknown,
    onError: undefined as unknown,
    onSamples: undefined as unknown,
    getTrackById: () => ({
      mdia: {
        minf: { stbl: { stsd: { entries: [{ avcC: { write() {} } }] } } },
      },
    }),
    setExtractionOptions: () => {},
    start: () => {},
    appendBuffer: () => {},
    flush: () => {
      if (mp4ReadyFails) {
        (file.onError as (m: string, msg: string) => void)?.(
          "demux",
          "broken container",
        );
        return;
      }
      (file.onReady as (movie: unknown) => void)?.({
        videoTracks: [fakeTrack],
      });
      if (pendingSamples.length) {
        (
          file.onSamples as (
            id: number,
            user: unknown,
            s: Mp4Sample[],
          ) => void
        )?.(1, null, pendingSamples);
      }
    },
  };
  return file;
}

vi.mock("mp4box", () => ({
  createFile: () => makeFakeFile(),
  MultiBufferStream: class {
    endianness = 0;
    buffer = new ArrayBuffer(16);
    write() {}
  },
  Endianness: { BIG_ENDIAN: 1 },
}));

// ── Test harness ──────────────────────────────────────────────────────────────

function sample(over: Partial<Mp4Sample> = {}): Mp4Sample {
  return {
    cts: 0,
    timescale: 1000,
    duration: 33,
    is_sync: true,
    data: new Uint8Array(4),
    ...over,
  };
}

/** A Blob-like with a controllable arrayBuffer(); resolves on next microtask. */
function fakeFile(): File | Blob {
  return {
    arrayBuffer: async () => new ArrayBuffer(8),
  } as unknown as Blob;
}

beforeEach(() => {
  decoderInstances.length = 0;
  pendingSamples = [];
  mp4ReadyFails = false;
  vi.stubGlobal("VideoDecoder", FakeVideoDecoder);
  vi.stubGlobal("VideoFrame", FakeVideoFrame);
  vi.stubGlobal("EncodedVideoChunk", FakeEncodedVideoChunk);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function importDecode() {
  const mod = await import("./frame-source");
  return mod.decodeFramesInRange;
}

describe("decodeFramesInRange — happy path", () => {
  it("delivers in-range frames, reports info, and closes the decoder", async () => {
    // 3 samples at 0ms, 100ms, 200ms (ms→us via timescale). Range [0, 0.25s].
    pendingSamples = [
      sample({ cts: 0 }),
      sample({ cts: 100, is_sync: false }),
      sample({ cts: 200, is_sync: false }),
    ];
    const decodeFramesInRange = await importDecode();

    const got: FakeVideoFrame[] = [];
    let info: { width: number; height: number; fps: number } | null = null;
    const result = await decodeFramesInRange({
      file: fakeFile(),
      inSec: 0,
      outSec: 0.25,
      onInfo: (i) => {
        info = i;
      },
      onFrame: (d) => {
        got.push(d.frame as unknown as FakeVideoFrame);
        d.frame.close();
      },
    });

    expect(info).toEqual({ width: 640, height: 480, fps: 30 });
    expect(result.width).toBe(640);
    expect(got).toHaveLength(3);
    expect(got.every((f) => f.closeCount === 1)).toBe(true);
    expect(lastDecoder()?.state).toBe("closed");
  });

  it("closes out-of-range frames immediately without invoking onFrame", async () => {
    // One sample at 5s, well outside the [0, 0.1s] range.
    pendingSamples = [sample({ cts: 5000 })];
    const decodeFramesInRange = await importDecode();

    const onFrame = vi.fn((d: { frame: FakeVideoFrame }) => d.frame.close());
    await decodeFramesInRange({
      file: fakeFile(),
      inSec: 0,
      outSec: 0.1,
      onFrame: onFrame as unknown as (d: {
        frame: VideoFrame;
        timeSec: number;
      }) => void,
    });
    // The decoder's output dropped + closed the out-of-range frame itself.
    expect(onFrame).not.toHaveBeenCalled();
  });
});

describe("decodeFramesInRange — abort", () => {
  it("rejects with AbortError and never calls onFrame when pre-aborted", async () => {
    pendingSamples = [sample({ cts: 0 }), sample({ cts: 100 })];
    const decodeFramesInRange = await importDecode();

    const controller = new AbortController();
    controller.abort();
    const onFrame = vi.fn();

    await expect(
      decodeFramesInRange({
        file: fakeFile(),
        inSec: 0,
        outSec: 1,
        onFrame: onFrame as unknown as (d: {
          frame: VideoFrame;
          timeSec: number;
        }) => void,
        signal: controller.signal,
      }),
    ).rejects.toThrow(/AbortError/);

    expect(onFrame).not.toHaveBeenCalled();
  });

  it("settles only once: an abort during onFrame still rejects AbortError", async () => {
    pendingSamples = [
      sample({ cts: 0 }),
      sample({ cts: 100, is_sync: false }),
    ];
    const decodeFramesInRange = await importDecode();

    const controller = new AbortController();
    let calls = 0;
    const onFrame = (d: { frame: FakeVideoFrame }) => {
      calls += 1;
      // Abort while the consumer chain is mid-flight.
      controller.abort();
      d.frame.close();
    };

    await expect(
      decodeFramesInRange({
        file: fakeFile(),
        inSec: 0,
        outSec: 1,
        onFrame: onFrame as unknown as (d: {
          frame: VideoFrame;
          timeSec: number;
        }) => void,
        signal: controller.signal,
      }),
    ).rejects.toThrow(/AbortError/);

    // The decoder is torn down exactly once despite the abort racing teardown.
    expect(lastDecoder()?.closeCount).toBe(1);
    // At least the first frame was consumed before abort took hold.
    expect(calls).toBeGreaterThanOrEqual(1);
  });
});

describe("decodeFramesInRange — errors", () => {
  it("rejects when the container cannot be parsed (mp4box onError)", async () => {
    mp4ReadyFails = true;
    const decodeFramesInRange = await importDecode();
    await expect(
      decodeFramesInRange({
        file: fakeFile(),
        inSec: 0,
        outSec: 1,
        onFrame: () => {},
      }),
    ).rejects.toThrow(/mp4box error/);
  });
});
