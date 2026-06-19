import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";

/**
 * Orchestration tests for `encodeFilteredVideo` — the video-export frame
 * lifecycle (#35). The three real halves are mocked at their module seams so we
 * can drive `onFrame` deterministically and assert the buffer discipline the
 * orchestrator is responsible for:
 *
 *   - the decoded SOURCE frame is closed after each render (in `finally`),
 *   - every re-wrapped output VideoFrame is closed EXACTLY once (no leak, no
 *     double-close) — on the happy path AND when the encoder throws,
 *   - the encoder is disposed and the render core disposed on an onFrame error,
 *   - a mid-decode abort still tears the encoder + core down.
 *
 * What is NOT covered here (and remains the Playwright smoke's job): the real
 * WebCodecs decode/encode, the paper-shaders GL render core, and mp4box demux.
 * Those need a real GL/codec context jsdom can't provide; this test isolates the
 * pure orchestration seam around them.
 */

// ── Mock the WebCodecs VideoFrame the orchestrator re-wraps for the encoder. ──
// It tracks close() calls so we can assert exactly-once closing.
const allWrapped: FakeVideoFrame[] = [];
class FakeVideoFrame {
  closeCount = 0;
  src: unknown;
  timestamp: number;
  duration: number;
  constructor(src: unknown, init: { timestamp: number; duration: number }) {
    this.src = src;
    this.timestamp = init.timestamp;
    this.duration = init.duration;
    allWrapped.push(this);
  }
  close() {
    this.closeCount += 1;
  }
}

// ── Mock the decoded SOURCE frames (what frame-source hands to onFrame). ──
class FakeSourceFrame {
  closeCount = 0;
  close() {
    this.closeCount += 1;
  }
}

// ── Mock encoder: records add()/dispose()/finish(); can be told to throw. ──
interface FakeEncoderControls {
  addImpl: Mock;
  disposeCount: number;
  finishCount: number;
}
const encoderControls: FakeEncoderControls = {
  addImpl: vi.fn(),
  disposeCount: 0,
  finishCount: 0,
};
class FakeEncoder {
  queueSize = 0;
  add(frame: unknown) {
    encoderControls.addImpl(frame);
  }
  async finish(): Promise<Blob> {
    encoderControls.finishCount += 1;
    return new Blob(["mp4"], { type: "video/mp4" });
  }
  dispose() {
    encoderControls.disposeCount += 1;
  }
  static isSupported = vi.fn(async () => true);
}

// ── Mock the render core's React/GL machinery. ──
// RenderCore.create() mounts a React root + FrameRenderer; we stub both so no
// real GL/DOM is needed. createRoot().render() synchronously invokes the ref
// callback with a handle whose renderSource returns a throwaway canvas.
let coreDisposeCount = 0;
const renderSourceImpl = vi.fn(
  async (): Promise<HTMLCanvasElement> =>
    ({ tag: "rendered-canvas" }) as unknown as HTMLCanvasElement,
);

vi.mock("react-dom/client", () => ({
  createRoot: () => ({
    render: (element: { props: { ref: (h: unknown) => void } }) => {
      // Invoke the ref with a fake FrameRendererHandle so create() resolves.
      element.props.ref({
        renderSource: renderSourceImpl,
        getGlCanvas: () => null,
      });
    },
    unmount: () => {
      coreDisposeCount += 1;
    },
  }),
}));

vi.mock("@/components/studio/video-export/frame-renderer", () => ({
  // createElement(FrameRenderer, props) just needs to carry props.ref through
  // to our fake root.render above; the identity is irrelevant.
  FrameRenderer: "FrameRenderer",
}));

// Drive a controllable decode loop: the test supplies the onFrame sequence.
type DecodeDriver = (args: {
  onInfo?: (info: { width: number; height: number; fps: number }) => void;
  onFrame: (decoded: {
    frame: FakeSourceFrame;
    timeSec: number;
  }) => void | Promise<void>;
  signal?: AbortSignal;
}) => Promise<unknown>;
let decodeDriver: DecodeDriver;

vi.mock("./frame-source", () => ({
  decodeFramesInRange: (args: Parameters<DecodeDriver>[0]) =>
    decodeDriver(args),
}));

vi.mock("./encoder", () => ({
  ExportEncoder: FakeEncoder,
  normalizeFps: (n: number) => Math.round(n),
}));

// Wire the fake VideoFrame into the global the orchestrator constructs.
beforeEach(() => {
  allWrapped.length = 0;
  encoderControls.addImpl = vi.fn();
  encoderControls.disposeCount = 0;
  encoderControls.finishCount = 0;
  coreDisposeCount = 0;
  renderSourceImpl.mockClear();
  renderSourceImpl.mockImplementation(
    async () => ({ tag: "rendered-canvas" }) as unknown as HTMLCanvasElement,
  );
  vi.stubGlobal("VideoFrame", FakeVideoFrame);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Import fresh each test so the mocks above are wired before module eval. */
async function importEncode() {
  const mod = await import("./encode-filtered-video");
  return mod.encodeFilteredVideo;
}

const baseArgs = {
  file: new Blob(["x"]),
  shaderId: "image-dithering",
  values: {},
  inSec: 0,
  outSec: 1,
};

describe("encodeFilteredVideo — happy path frame lifecycle", () => {
  it("closes each source + wrapped frame exactly once and finishes", async () => {
    const sources = [new FakeSourceFrame(), new FakeSourceFrame()];
    decodeDriver = async ({ onInfo, onFrame }) => {
      onInfo?.({ width: 640, height: 480, fps: 30 });
      await onFrame({ frame: sources[0], timeSec: 0 });
      await onFrame({ frame: sources[1], timeSec: 0.033 });
      return { width: 640, height: 480, fps: 30 };
    };

    const encodeFilteredVideo = await importEncode();
    const result = await encodeFilteredVideo(baseArgs);

    expect(result.frames).toBe(2);
    expect(encoderControls.finishCount).toBe(1);
    // Source frames closed once each.
    expect(sources.map((s) => s.closeCount)).toEqual([1, 1]);
    // Each wrapped output frame closed exactly once.
    expect(allWrapped).toHaveLength(2);
    expect(allWrapped.every((f) => f.closeCount === 1)).toBe(true);
    // Render core disposed once at the end.
    expect(coreDisposeCount).toBe(1);
  });
});

describe("encodeFilteredVideo — encoder.add throws", () => {
  it("still closes the wrapped frame once and disposes encoder + core", async () => {
    const source = new FakeSourceFrame();
    decodeDriver = async ({ onInfo, onFrame }) => {
      onInfo?.({ width: 640, height: 480, fps: 30 });
      await onFrame({ frame: source, timeSec: 0 });
      return { width: 640, height: 480, fps: 30 };
    };
    encoderControls.addImpl = vi.fn(() => {
      throw new Error("encode boom");
    });

    const encodeFilteredVideo = await importEncode();
    await expect(encodeFilteredVideo(baseArgs)).rejects.toThrow(/encode boom/);

    // add() threw, but the wrapped frame's finally still closed it once.
    expect(allWrapped).toHaveLength(1);
    expect(allWrapped[0].closeCount).toBe(1);
    // Source frame closed in its finally too.
    expect(source.closeCount).toBe(1);
    // Encoder disposed (finish never reached) and core disposed.
    expect(encoderControls.disposeCount).toBe(1);
    expect(encoderControls.finishCount).toBe(0);
    expect(coreDisposeCount).toBe(1);
  });
});

describe("encodeFilteredVideo — onFrame render throws", () => {
  it("closes the source frame and disposes the pipeline", async () => {
    const source = new FakeSourceFrame();
    renderSourceImpl.mockImplementation(async () => {
      throw new Error("render boom");
    });
    decodeDriver = async ({ onInfo, onFrame }) => {
      onInfo?.({ width: 640, height: 480, fps: 30 });
      await onFrame({ frame: source, timeSec: 0 });
      return { width: 640, height: 480, fps: 30 };
    };

    const encodeFilteredVideo = await importEncode();
    await expect(encodeFilteredVideo(baseArgs)).rejects.toThrow(/render boom/);

    // The render threw before a VideoFrame was wrapped, so none leaked.
    expect(allWrapped).toHaveLength(0);
    // The source frame is still closed in the onFrame finally.
    expect(source.closeCount).toBe(1);
    expect(encoderControls.disposeCount).toBe(1);
    expect(coreDisposeCount).toBe(1);
  });
});

describe("encodeFilteredVideo — abort", () => {
  it("rejects with AbortError and tears down the pipeline when pre-aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    decodeDriver = async ({ signal }) => {
      // Mirror frame-source: a pre-aborted signal yields no frames and the
      // orchestrator's own throwIfAborted should fire.
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      return { width: 640, height: 480, fps: 30 };
    };

    const encodeFilteredVideo = await importEncode();
    await expect(
      encodeFilteredVideo({ ...baseArgs, signal: controller.signal }),
    ).rejects.toThrow(/Aborted/);

    // No frames decoded → encoder never built → nothing to dispose/leak.
    expect(allWrapped).toHaveLength(0);
  });

  it("tears down encoder + core when aborted mid-decode after init", async () => {
    const source = new FakeSourceFrame();
    const controller = new AbortController();
    decodeDriver = async ({ onInfo, onFrame, signal }) => {
      onInfo?.({ width: 640, height: 480, fps: 30 });
      // First frame builds the pipeline successfully.
      await onFrame({ frame: source, timeSec: 0 });
      // Now abort; the orchestrator's throwIfAborted (next onFrame or the
      // post-loop check) should propagate.
      controller.abort();
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      return { width: 640, height: 480, fps: 30 };
    };

    const encodeFilteredVideo = await importEncode();
    await expect(
      encodeFilteredVideo({ ...baseArgs, signal: controller.signal }),
    ).rejects.toThrow(/Aborted/);

    // The one wrapped frame from the first (pre-abort) onFrame was closed once.
    expect(allWrapped).toHaveLength(1);
    expect(allWrapped[0].closeCount).toBe(1);
    expect(source.closeCount).toBe(1);
    // Encoder disposed (finish not reached) and render core disposed.
    expect(encoderControls.disposeCount).toBe(1);
    expect(coreDisposeCount).toBe(1);
  });
});
