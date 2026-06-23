import { describe, expect, it } from "vitest";
import {
  DISTANCES,
  DURATIONS,
  EASINGS,
  STAGGER,
  fade,
  fadeRise,
  fadeRiseVariants,
  reducedFade,
} from "./motion";

describe("motion tokens", () => {
  it("orders durations from instant to hero with the spec values", () => {
    expect(DURATIONS.instant).toBe(0);
    expect(DURATIONS.fast).toBe(0.12);
    expect(DURATIONS.base).toBe(0.18);
    expect(DURATIONS.slow).toBe(0.28);
    expect(DURATIONS.hero).toBeLessThanOrEqual(0.6);
    // monotonic non-decreasing
    const seq = [
      DURATIONS.instant,
      DURATIONS.fast,
      DURATIONS.base,
      DURATIONS.slow,
      DURATIONS.hero,
    ];
    for (let i = 1; i < seq.length; i++) {
      expect(seq[i]).toBeGreaterThan(seq[i - 1]);
    }
  });

  it("exposes the spec ease-out curve", () => {
    expect(EASINGS.easeOut).toEqual([0.22, 1, 0.36, 1]);
  });

  it("uses a non-overshooting settle spring (bounce 0)", () => {
    expect(EASINGS.settle).toMatchObject({ type: "spring", bounce: 0 });
  });

  it("keeps reveal distances small (4–10px) and on the cap", () => {
    expect(DISTANCES.xs).toBe(4);
    expect(DISTANCES.md).toBe(10);
    for (const d of Object.values(DISTANCES)) {
      expect(d).toBeGreaterThanOrEqual(4);
      expect(d).toBeLessThanOrEqual(10);
    }
  });

  it("caps stagger so groups never feel slow", () => {
    expect(STAGGER.step).toBeLessThanOrEqual(0.04);
    expect(STAGGER.max).toBeLessThanOrEqual(0.16);
  });
});

describe("fadeRiseVariants (reduced-motion selection)", () => {
  it("returns the fade+rise variant when motion is allowed", () => {
    const v = fadeRiseVariants(false);
    expect(v).toBe(fadeRise);
    // hidden state includes a small transform (the rise)
    expect(v.hidden).toMatchObject({ opacity: 0, y: DISTANCES.xs });
  });

  it("returns an opacity-only variant under reduced motion (no transform)", () => {
    const v = fadeRiseVariants(true);
    expect(v).toBe(reducedFade);
    // no y/x/scale anywhere — opacity only, so nothing translates
    const json = JSON.stringify(v);
    expect(json).not.toContain('"y"');
    expect(json).not.toContain('"x"');
    expect(json).not.toContain("scale");
  });

  it("both branches share the same state keys for a clean swap", () => {
    const allowed = fadeRiseVariants(false);
    const reduced = fadeRiseVariants(true);
    expect(Object.keys(allowed).sort()).toEqual(Object.keys(reduced).sort());
  });

  it("plain fade is already reduced-safe (opacity only)", () => {
    expect(JSON.stringify(fade)).not.toContain('"y"');
  });
});
