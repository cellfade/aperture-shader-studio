import { describe, expect, it } from "vitest";
import { easeOutCubic, tweenValues } from "@/lib/studio/tween";
import { SHADERS_BY_ID, initialValues } from "@/lib/studio/registry";

/**
 * The tween logic is the pure, testable core of the preset animation: numeric
 * `range` params interpolate; discrete params snap. The component just drives it
 * with rAF. Testing the pure function lets us assert the start/mid/end frames and
 * the discrete-snap behavior without a clock or a DOM.
 */

const shader = SHADERS_BY_ID["mesh-gradient"]; // speed (range) + colors (palette)

describe("easeOutCubic", () => {
  it("pins the endpoints and stays monotonic", () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.5); // ease-out front-loads
  });
});

describe("tweenValues", () => {
  const from = { ...initialValues(shader), speed: 0 };
  const to = { speed: 1 };

  it("holds the start value at t=0", () => {
    expect(tweenValues(shader, from, to, 0).speed).toBe(0);
  });

  it("reaches the target at t=1", () => {
    expect(tweenValues(shader, from, to, 1).speed).toBeCloseTo(1, 6);
  });

  it("interpolates a numeric range param at t=0.5", () => {
    const mid = tweenValues(shader, from, to, 0.5).speed as number;
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    expect(mid).toBeCloseTo(easeOutCubic(0.5), 6);
  });

  it("snaps a discrete (palette) param once the tween has started", () => {
    const fromPalette = {
      ...initialValues(shader),
      colors: ["#000000", "#000000"],
    };
    const toPalette = { colors: ["#ffffff", "#ffffff"] };
    // at t=0 it holds the start palette
    expect(tweenValues(shader, fromPalette, toPalette, 0).colors).toEqual([
      "#000000",
      "#000000",
    ]);
    // at any t>0 it snaps to target (no interpolation of discrete values)
    expect(tweenValues(shader, fromPalette, toPalette, 0.01).colors).toEqual([
      "#ffffff",
      "#ffffff",
    ]);
  });

  it("clamps t outside [0,1]", () => {
    expect(tweenValues(shader, from, to, -1).speed).toBe(0);
    expect(tweenValues(shader, from, to, 5).speed).toBeCloseTo(1, 6);
  });

  it("keeps `from` keys absent from `to`", () => {
    const result = tweenValues(shader, { ...from, swirl: 0.7 }, { speed: 1 }, 0.5);
    expect(result.swirl).toBe(0.7);
  });
});
