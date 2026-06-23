import { describe, expect, it } from "vitest";
import {
  DISTANCES,
  DURATIONS,
  EASINGS,
  EXPOSURE_WIPE,
  HERO_CROSSFADE,
  STAGGER,
  exposureWipe,
  fade,
  fadeRise,
  fadeRiseVariants,
  heroCrossfade,
  heroCrossfadeReduced,
  heroCrossfadeVariants,
  reducedFade,
  staggerGroupVariants,
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

describe("heroCrossfadeVariants (A1 — shader-switch hero crossfade)", () => {
  it("enters fade+scale and exits softer/shorter when motion is allowed", () => {
    const v = heroCrossfadeVariants(false);
    expect(v).toBe(heroCrossfade);
    // incoming starts at opacity 0 + a slight downscale, settles to 1/1
    expect(v.hidden).toMatchObject({ opacity: 0, scale: HERO_CROSSFADE.scaleFrom });
    expect(v.visible).toMatchObject({ opacity: 1, scale: 1 });
    // exit is softer (shorter) than enter — dismissal never tugs
    expect(HERO_CROSSFADE.exit).toBeLessThan(HERO_CROSSFADE.enter);
    // ~220ms in / ~160ms out per spec
    expect(HERO_CROSSFADE.enter).toBeCloseTo(0.22, 3);
    expect(HERO_CROSSFADE.exit).toBeCloseTo(0.16, 3);
    // scale is precise (close to 1), not a "pop"
    expect(HERO_CROSSFADE.scaleFrom).toBeGreaterThanOrEqual(0.98);
  });

  it("hard-cuts (instant, opacity-only, no scale) under reduced motion", () => {
    const v = heroCrossfadeVariants(true);
    expect(v).toBe(heroCrossfadeReduced);
    const json = JSON.stringify(v);
    // no scale/translate anywhere — purely an instant opacity swap
    expect(json).not.toContain("scale");
    expect(json).not.toContain('"y"');
    expect(json).not.toContain('"x"');
    const visible = v.visible as { transition?: { duration?: number } };
    const exit = v.exit as { transition?: { duration?: number } };
    expect(visible.transition?.duration).toBe(DURATIONS.instant);
    expect(exit.transition?.duration).toBe(DURATIONS.instant);
  });

  it("both branches share state keys for a clean swap", () => {
    expect(Object.keys(heroCrossfadeVariants(false)).sort()).toEqual(
      Object.keys(heroCrossfadeVariants(true)).sort(),
    );
  });

  it("uses the ease-out curve for the enter beat", () => {
    const visible = heroCrossfade.visible as { transition?: { ease?: unknown } };
    expect(visible.transition?.ease).toEqual(EASINGS.easeOut);
  });
});

describe("exposureWipe (A1 — one-pass exposure wipe)", () => {
  it("sweeps left→right exactly once (not a loop) over the crossfade", () => {
    const visible = exposureWipe.visible as {
      left?: unknown;
      transition?: { duration?: number; repeat?: number };
    };
    // travels off-left to off-right in a single pass
    expect(visible.left).toEqual(["-2%", "102%"]);
    // no repeat configured → plays once
    expect(visible.transition?.repeat).toBeUndefined();
    // spans the crossfade window
    expect(visible.transition?.duration).toBe(EXPOSURE_WIPE.duration);
    expect(EXPOSURE_WIPE.duration).toBeLessThanOrEqual(DURATIONS.slow);
  });

  it("fades in then out so the line never lingers", () => {
    const visible = exposureWipe.visible as { opacity?: number[] };
    expect(visible.opacity?.[0]).toBe(0);
    expect(visible.opacity?.[visible.opacity.length - 1]).toBe(0);
  });
});

describe("staggerGroupVariants (A5 — control-group reveal)", () => {
  it("staggers children by STAGGER.step when motion is allowed", () => {
    const v = staggerGroupVariants(false);
    const visible = v.visible as { transition?: { staggerChildren?: number } };
    expect(visible.transition?.staggerChildren).toBe(STAGGER.step);
  });

  it("collapses the stagger to 0 (instant group) under reduced motion", () => {
    const v = staggerGroupVariants(true);
    const visible = v.visible as { transition?: { staggerChildren?: number } };
    expect(visible.transition?.staggerChildren).toBe(0);
  });

  it("orchestrates only (no transform/opacity on the container itself)", () => {
    const v = staggerGroupVariants(false);
    // The hidden state is empty: the container never moves; only its children
    // (which use fadeRiseVariants) animate.
    expect(v.hidden).toEqual({});
    const json = JSON.stringify(v);
    expect(json).not.toContain("scale");
    expect(json).not.toContain('"y"');
  });

  it("keeps the worst-case total stagger within STAGGER.max for the 4-section group", () => {
    // The control panel reveals at most 4 sections (header/presets/adjust/color).
    const childCount = 4;
    const total = STAGGER.step * (childCount - 1);
    expect(total).toBeLessThanOrEqual(STAGGER.max);
  });
});
