import { describe, expect, it } from "vitest";
import { clampFrames } from "@/components/studio/video-stage";

// B7 — the sequence "Frames" stepper clamps to [MIN_FRAMES, MAX_FRAMES] = [2, 30]
// in every input path (typed, +/− stepped). The export logic is untouched; this
// guards only the count-input UI helper.
describe("clampFrames (B7 sequence frame-count stepper)", () => {
  it("clamps below the minimum up to 2", () => {
    expect(clampFrames(0)).toBe(2);
    expect(clampFrames(1)).toBe(2);
    expect(clampFrames(-5)).toBe(2);
  });

  it("clamps above the maximum down to 30", () => {
    expect(clampFrames(31)).toBe(30);
    expect(clampFrames(1000)).toBe(30);
  });

  it("passes in-range values through", () => {
    expect(clampFrames(2)).toBe(2);
    expect(clampFrames(8)).toBe(8);
    expect(clampFrames(30)).toBe(30);
  });

  it("rounds fractional values to the nearest integer", () => {
    expect(clampFrames(7.4)).toBe(7);
    expect(clampFrames(7.6)).toBe(8);
  });

  it("falls back to the minimum for non-finite input", () => {
    expect(clampFrames(NaN)).toBe(2);
    expect(clampFrames(Infinity)).toBe(2);
    expect(clampFrames(Number.NEGATIVE_INFINITY)).toBe(2);
  });
});
