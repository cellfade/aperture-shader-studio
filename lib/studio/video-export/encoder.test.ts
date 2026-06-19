import { describe, expect, it } from "vitest";
import { computeBitrate, normalizeFps } from "./encoder";

describe("normalizeFps", () => {
  it("rounds NTSC fractional rates to their integer rate", () => {
    expect(normalizeFps(29.97)).toBe(30);
    expect(normalizeFps(23.976)).toBe(24);
    expect(normalizeFps(59.94)).toBe(60);
  });

  it("clamps absurdly high rates to 120", () => {
    expect(normalizeFps(454.18)).toBe(120);
    expect(normalizeFps(120)).toBe(120);
    expect(normalizeFps(121)).toBe(120);
  });

  it("clamps zero and negatives up to 1", () => {
    expect(normalizeFps(0)).toBe(1);
    expect(normalizeFps(-5)).toBe(1);
    expect(normalizeFps(0.4)).toBe(1);
  });

  it("falls back to 1 on any non-finite input (NaN/±Infinity)", () => {
    expect(normalizeFps(NaN)).toBe(1);
    expect(normalizeFps(Infinity)).toBe(1);
    expect(normalizeFps(-Infinity)).toBe(1);
  });

  it("passes a clean integer rate through", () => {
    expect(normalizeFps(30)).toBe(30);
    expect(normalizeFps(1)).toBe(1);
  });

  it("always yields a positive integer (the muxer's requirement)", () => {
    for (const n of [29.97, 23.976, 59.94, 454.18, 0, -5, NaN, 30]) {
      const out = normalizeFps(n);
      expect(Number.isInteger(out)).toBe(true);
      expect(out).toBeGreaterThanOrEqual(1);
      expect(out).toBeLessThanOrEqual(120);
    }
  });
});

describe("computeBitrate", () => {
  it("clamps tiny dimensions up to the 1Mbps floor", () => {
    expect(computeBitrate(64, 64, 30)).toBe(1_000_000);
  });

  it("clamps huge dimensions down to the 20Mbps ceiling", () => {
    expect(computeBitrate(3840, 2160, 60)).toBe(20_000_000);
  });

  it("scales with resolution inside the band", () => {
    const bitrate = computeBitrate(1280, 720, 30);
    expect(bitrate).toBeGreaterThan(1_000_000);
    expect(bitrate).toBeLessThan(20_000_000);
    expect(Number.isInteger(bitrate)).toBe(true);
  });
});
