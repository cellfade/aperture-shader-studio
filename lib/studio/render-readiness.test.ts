import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  awaitRenderedFrame,
  createContentSampler,
  type PaperMount,
} from "@/lib/studio/render-readiness";

/**
 * jsdom has no real 2D canvas backend, so `createContentSampler` would get a
 * null context and short-circuit. We stub HTMLCanvasElement.getContext to return
 * a fake 2D context whose getImageData yields bytes WE control, letting us drive
 * the presence/change/grace-window logic deterministically. `src` (the GL canvas
 * passed to drawImage) is irrelevant — only the bytes the sampler reads matter.
 */

const SAMPLE = 24;
const PX = SAMPLE * SAMPLE;

/** Build an RGBA buffer for the 24×24 scratch sample. */
function buffer(opts: {
  alpha: number;
  /** When true, pixel 0 differs from the rest so the "varied" flag trips. */
  varied: boolean;
  /** Base value for the R channel; bump it to force a different FNV hash. */
  seed?: number;
}): Uint8ClampedArray {
  const { alpha, varied, seed = 100 } = opts;
  const data = new Uint8ClampedArray(PX * 4);
  for (let i = 0; i < PX; i++) {
    const o = i * 4;
    data[o] = i === 0 && varied ? seed + 50 : seed; // R
    data[o + 1] = seed;
    data[o + 2] = seed;
    data[o + 3] = alpha;
  }
  return data;
}

let current: Uint8ClampedArray;

beforeEach(() => {
  current = buffer({ alpha: 0, varied: false });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    () =>
      ({
        clearRect: () => {},
        drawImage: () => {},
        getImageData: () => ({ data: current }),
      }) as unknown as CanvasRenderingContext2D,
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

const fakeSrc = {} as unknown as CanvasImageSource;

describe("createContentSampler.hasChanged", () => {
  it("returns false for a blank (transparent) source", () => {
    const s = createContentSampler();
    current = buffer({ alpha: 0, varied: false });
    expect(s.hasChanged(fakeSrc, 0)).toBe(false);
  });

  it("returns true for the first non-blank frame", () => {
    const s = createContentSampler();
    current = buffer({ alpha: 255, varied: true, seed: 100 });
    expect(s.hasChanged(fakeSrc, 0)).toBe(true);
  });

  it("returns false for a frame identical to the last presented one until the grace window elapses", () => {
    const s = createContentSampler();
    current = buffer({ alpha: 255, varied: true, seed: 100 });
    expect(s.hasChanged(fakeSrc, 0)).toBe(true);
    s.markPresented();

    // Same bytes again -> not changed, still inside grace window.
    expect(s.hasChanged(fakeSrc, 0)).toBe(false);
    expect(s.hasChanged(fakeSrc, 1400)).toBe(false);
    // Past the 1400ms grace window the legitimately-identical frame is accepted.
    expect(s.hasChanged(fakeSrc, 1401)).toBe(true);
  });

  it("returns true once the pixels actually change after a presented frame", () => {
    const s = createContentSampler();
    current = buffer({ alpha: 255, varied: true, seed: 100 });
    expect(s.hasChanged(fakeSrc, 0)).toBe(true);
    s.markPresented();

    current = buffer({ alpha: 255, varied: true, seed: 180 });
    expect(s.hasChanged(fakeSrc, 0)).toBe(true);
  });

  it("treats a solid (non-varied) frame as present only after the grace window", () => {
    const s = createContentSampler();
    current = buffer({ alpha: 255, varied: false, seed: 90 });
    expect(s.hasChanged(fakeSrc, 0)).toBe(false);
    expect(s.hasChanged(fakeSrc, 1401)).toBe(true);
  });
});

describe("createContentSampler.hasContent", () => {
  it("is false while blank and true once a varied frame is painted", () => {
    const s = createContentSampler();
    current = buffer({ alpha: 0, varied: false });
    expect(s.hasContent(fakeSrc, 0)).toBe(false);

    current = buffer({ alpha: 255, varied: true });
    expect(s.hasContent(fakeSrc, 0)).toBe(true);
  });

  it("does not block when sampling is unavailable (no 2D context)", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    const s = createContentSampler();
    expect(s.hasContent(fakeSrc, 0)).toBe(true);
    expect(s.hasChanged(fakeSrc, 0)).toBe(true);
  });
});

describe("awaitRenderedFrame", () => {
  /** A fake mount whose GL canvas is sized so the mount-wait passes immediately. */
  function makeMount(): PaperMount {
    const canvas = document.createElement("canvas");
    canvas.width = 8;
    canvas.height = 8;
    return { canvasElement: canvas, setSpeed: () => {}, setFrame: () => {} };
  }

  it("resolves the GL canvas once the gate passes and marks it presented", async () => {
    const mount = makeMount();
    const sampler = createContentSampler();
    current = buffer({ alpha: 255, varied: true, seed: 100 });
    const markSpy = vi.spyOn(sampler, "markPresented");

    const ready = await awaitRenderedFrame({
      getMount: () => mount,
      sampler,
      mode: "change",
      minSettleMs: 0,
      maxWaitMs: 2000,
    });

    expect(ready).toBe(mount.canvasElement);
    expect(markSpy).toHaveBeenCalledTimes(1);
  });

  it("resolves null when cancelled before the frame is ready", async () => {
    const mount = makeMount();
    const sampler = createContentSampler();
    current = buffer({ alpha: 255, varied: true, seed: 100 });

    const ready = await awaitRenderedFrame({
      getMount: () => mount,
      sampler,
      mode: "presence",
      minSettleMs: 0,
      maxWaitMs: 2000,
      isCancelled: () => true,
    });

    expect(ready).toBeNull();
  });

  it("resolves null when no mount appears before the timeout", async () => {
    const sampler = createContentSampler();
    const ready = await awaitRenderedFrame({
      getMount: () => undefined,
      sampler,
      mode: "presence",
      minSettleMs: 0,
      // Negative budget => the very first tick is already past the deadline.
      maxWaitMs: -1,
    });
    expect(ready).toBeNull();
  });
});
