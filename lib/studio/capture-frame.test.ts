import { afterEach, describe, expect, it, vi } from "vitest";
import { captureVideoFrame } from "@/lib/studio/capture-frame";

/**
 * `captureVideoFrame` is the photo-from-video ingest path. jsdom has no real 2D
 * canvas backend, so we stub the canvas surface it touches (getContext +
 * toBlob) and feed it a minimal fake <video> with controllable
 * videoWidth/videoHeight. We assert the dims math, the no-track guard, and the
 * null-context / null-blob failure paths.
 */

/** A minimal stand-in for the HTMLVideoElement fields captureVideoFrame reads. */
function fakeVideo(w: number, h: number): HTMLVideoElement {
  return { videoWidth: w, videoHeight: h } as unknown as HTMLVideoElement;
}

afterEach(() => {
  vi.restoreAllMocks();
});

/** Stub getContext to a drawImage-capturing fake 2D ctx (or null), and toBlob. */
function stubCanvas(opts: { ctx: boolean; blob: Blob | null }) {
  const drawImage = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    () =>
      opts.ctx
        ? ({ drawImage } as unknown as CanvasRenderingContext2D)
        : null,
  );
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (
    this: HTMLCanvasElement,
    cb: BlobCallback,
  ) {
    cb(opts.blob);
  });
  return { drawImage };
}

describe("captureVideoFrame", () => {
  it("throws when the video frame is not ready (0x0)", async () => {
    await expect(captureVideoFrame(fakeVideo(0, 0))).rejects.toThrow(
      /frame not ready/i,
    );
  });

  it("throws when only one dimension is zero", async () => {
    await expect(captureVideoFrame(fakeVideo(640, 0))).rejects.toThrow(
      /frame not ready/i,
    );
  });

  it("captures at the video's native resolution", async () => {
    stubCanvas({ ctx: true, blob: new Blob(["x"], { type: "image/png" }) });
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:fake");

    const result = await captureVideoFrame(fakeVideo(1280, 720));
    expect(result).toEqual({ url: "blob:fake", w: 1280, h: 720 });
  });

  it("draws the frame at full size into the canvas", async () => {
    const { drawImage } = stubCanvas({
      ctx: true,
      blob: new Blob(["x"], { type: "image/png" }),
    });
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:fake");

    const video = fakeVideo(800, 450);
    await captureVideoFrame(video);
    expect(drawImage).toHaveBeenCalledWith(video, 0, 0, 800, 450);
  });

  it("throws a clear error when the 2D context is unavailable (#18)", async () => {
    stubCanvas({ ctx: false, blob: null });
    await expect(captureVideoFrame(fakeVideo(640, 480))).rejects.toThrow(
      /2D context unavailable/i,
    );
  });

  it("throws when the PNG encode yields a null blob", async () => {
    stubCanvas({ ctx: true, blob: null });
    await expect(captureVideoFrame(fakeVideo(640, 480))).rejects.toThrow(
      /could not encode frame/i,
    );
  });
});
