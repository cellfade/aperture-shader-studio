import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  useVideoExport,
  VideoExporterLoadError,
  type UseVideoExportArgs,
} from "@/components/studio/use-video-export";
import { SHADERS_BY_ID } from "@/lib/studio/registry";

/**
 * Unit tests for the export-orchestration hook extracted from studio.tsx (#45).
 * Covers the frames-sequence snapshot + abort/progress wiring (#32) and the
 * MP4 dynamic-import chunk-load vs encode-failure branching (#24). The real
 * WebGL render cores and WebCodecs encode stay with the Playwright smoke; the
 * heavy encode module is mocked at its dynamic-import seam.
 */

// ── Mock the heavy encode module so the dynamic import resolves synchronously
//    (or rejects, to exercise the chunk-load branch). ─────────────────────────
const encodeMock = vi.fn();
let importShouldReject = false;
vi.mock("@/lib/studio/video-export/encode-filtered-video", () => ({
  // A getter lets each test flip importShouldReject before the dynamic import.
  get encodeFilteredVideo() {
    if (importShouldReject) throw new Error("forced module init failure");
    return encodeMock;
  },
}));

// ── Mock downloadBlob so the success path doesn't touch the DOM. ──────────────
const downloadSpy = vi.fn();
vi.mock("@/lib/studio/download", async (orig) => {
  const actual = await orig<typeof import("@/lib/studio/download")>();
  return { ...actual, downloadBlob: (...a: unknown[]) => downloadSpy(...a) };
});

const ACTIVE_ID = "image-dithering";

function makeArgs(overrides: Partial<UseVideoExportArgs> = {}): UseVideoExportArgs {
  return {
    activeId: ACTIVE_ID,
    values: { foo: 1 },
    shader: SHADERS_BY_ID[ACTIVE_ID],
    image: { url: "blob:img", isBlob: true, w: 100, h: 80, name: "p.png" },
    videoName: "clip.mp4",
    videoFileRef: { current: new File(["x"], "clip.mp4", { type: "video/mp4" }) },
    flashNotice: vi.fn(),
    announceMsg: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  importShouldReject = false;
  encodeMock.mockReset();
  downloadSpy.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("PNG export snapshot", () => {
  it("startExport freezes shaderId/values/image into exportReq", () => {
    const { result } = renderHook(() => useVideoExport(makeArgs()));
    act(() => result.current.startExport());
    expect(result.current.exportStatus).toBe("working");
    expect(result.current.exportReq).toMatchObject({
      shaderId: ACTIVE_ID,
      imageUrl: "blob:img",
      filename: `${ACTIVE_ID}-p.png`,
    });
  });

  it("is re-entrancy guarded while working", () => {
    const { result } = renderHook((a: UseVideoExportArgs) => useVideoExport(a), {
      initialProps: makeArgs(),
    });
    act(() => result.current.startExport());
    const first = result.current.exportReq;
    act(() => result.current.startExport());
    expect(result.current.exportReq).toBe(first);
  });

  it("onExportDone clears the request and reports success/failure", () => {
    vi.useFakeTimers();
    const args = makeArgs();
    const { result } = renderHook(() => useVideoExport(args));
    act(() => result.current.startExport());
    act(() => result.current.onExportDone(true));
    expect(result.current.exportReq).toBeNull();
    expect(result.current.exportStatus).toBe("done");
    expect(args.announceMsg).toHaveBeenCalledWith("Export saved");

    act(() => result.current.onExportDone(false));
    expect(result.current.exportStatus).toBe("error");
    expect(args.flashNotice).toHaveBeenCalled();
    act(() => vi.runAllTimers());
    expect(result.current.exportStatus).toBe("idle");
    vi.useRealTimers();
  });
});

describe("frames-sequence (#32 snapshot + progress wiring)", () => {
  it("snapshots activeId/values into batchReq at start, not live state", () => {
    const { result, rerender } = renderHook(
      (a: UseVideoExportArgs) => useVideoExport(a),
      { initialProps: makeArgs({ activeId: ACTIVE_ID, values: { foo: 1 } }) },
    );

    const controller = new AbortController();
    act(() => {
      void result.current.renderSequence([], () => {}, controller.signal);
    });
    expect(result.current.batchReq).toMatchObject({
      shaderId: ACTIVE_ID,
      values: { foo: 1 },
    });

    // Mid-batch, the parent re-renders with a DIFFERENT active shader/values.
    const snapshot = result.current.batchReq;
    rerender(makeArgs({ activeId: "halftone-dots", values: { foo: 99 } }));
    // The in-flight batch's snapshot is unchanged by the live-state churn.
    expect(result.current.batchReq).toEqual(snapshot);
  });

  it("routes onBatchProgress to the active sequence's onProgress callback", () => {
    const { result } = renderHook(() => useVideoExport(makeArgs()));
    const onProgress = vi.fn();
    const controller = new AbortController();
    act(() => {
      void result.current.renderSequence([], onProgress, controller.signal);
    });
    act(() => result.current.onBatchProgress(2, 5));
    expect(onProgress).toHaveBeenCalledWith(2, 5);
  });

  it("onBatchDone resolves the sequence promise with the blobs and clears batchReq", async () => {
    const { result } = renderHook(() => useVideoExport(makeArgs()));
    const controller = new AbortController();
    let p!: Promise<Blob[] | null>;
    act(() => {
      p = result.current.renderSequence([], () => {}, controller.signal);
    });
    const blobs = [new Blob(["a"]), new Blob(["b"])];
    act(() => result.current.onBatchDone(blobs));
    await expect(p).resolves.toBe(blobs);
    expect(result.current.batchReq).toBeNull();
  });

  it("aborting the signal settles the sequence with null and clears batchReq", async () => {
    const { result } = renderHook(() => useVideoExport(makeArgs()));
    const controller = new AbortController();
    let p!: Promise<Blob[] | null>;
    act(() => {
      p = result.current.renderSequence([], () => {}, controller.signal);
    });
    act(() => controller.abort());
    await expect(p).resolves.toBeNull();
    expect(result.current.batchReq).toBeNull();
  });

  it("a late onBatchProgress after settle is a no-op (no throw)", async () => {
    const { result } = renderHook(() => useVideoExport(makeArgs()));
    const onProgress = vi.fn();
    const controller = new AbortController();
    let p!: Promise<Blob[] | null>;
    act(() => {
      p = result.current.renderSequence([], onProgress, controller.signal);
    });
    act(() => result.current.onBatchDone([new Blob(["x"])]));
    await p;
    // sequenceProgressRef was cleared on settle — a stray progress tick is dropped
    expect(() => act(() => result.current.onBatchProgress(9, 9))).not.toThrow();
    expect(onProgress).not.toHaveBeenCalled();
  });
});

describe("filtered MP4 export (#24 chunk-load vs encode)", () => {
  it("no-ops when there is no loaded video file", async () => {
    const { result } = renderHook(() =>
      useVideoExport(makeArgs({ videoFileRef: { current: null } })),
    );
    await act(async () => {
      await result.current.runVideoExport(0, 1, () => {}, new AbortController().signal);
    });
    expect(encodeMock).not.toHaveBeenCalled();
  });

  it("happy path: encodes the snapshot and downloads with a sanitized name", async () => {
    encodeMock.mockResolvedValue({ blob: new Blob(["mp4"]), frames: 3, width: 2, height: 2 });
    const { result } = renderHook(() => useVideoExport(makeArgs()));
    await act(async () => {
      await result.current.runVideoExport(0.5, 2.5, () => {}, new AbortController().signal);
    });
    expect(encodeMock).toHaveBeenCalledWith(
      expect.objectContaining({ shaderId: ACTIVE_ID, inSec: 0.5, outSec: 2.5 }),
    );
    expect(downloadSpy).toHaveBeenCalledWith(
      expect.any(Blob),
      `${ACTIVE_ID}-clip.mp4`,
    );
  });

  it("surfaces a VideoExporterLoadError when the dynamic import fails", async () => {
    importShouldReject = true;
    const { result } = renderHook(() => useVideoExport(makeArgs()));
    let caught: unknown;
    await act(async () => {
      try {
        await result.current.runVideoExport(0, 1, () => {}, new AbortController().signal);
      } catch (e) {
        caught = e;
      }
    });
    expect(caught).toBeInstanceOf(VideoExporterLoadError);
    expect((caught as Error).message).toMatch(/Couldn't load the video exporter/);
    expect(encodeMock).not.toHaveBeenCalled();
  });

  it("propagates a real encode failure unchanged (NOT a load error)", async () => {
    const encodeErr = new Error("encoder blew up");
    encodeMock.mockRejectedValue(encodeErr);
    const { result } = renderHook(() => useVideoExport(makeArgs()));
    let caught: unknown;
    await act(async () => {
      try {
        await result.current.runVideoExport(0, 1, () => {}, new AbortController().signal);
      } catch (e) {
        caught = e;
      }
    });
    expect(caught).toBe(encodeErr);
    expect(caught).not.toBeInstanceOf(VideoExporterLoadError);
    expect(downloadSpy).not.toHaveBeenCalled();
  });
});
