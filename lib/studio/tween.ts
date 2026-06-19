import type { Param, ParamValues, Shader } from "@/lib/studio/registry";

/** Default animation duration for a preset apply, in milliseconds. */
export const PRESET_TWEEN_MS = 250;

/** Cubic ease-out — fast start, gentle settle. */
export function easeOutCubic(t: number): number {
  const c = 1 - t;
  return 1 - c * c * c;
}

/**
 * Interpolate one frame of a preset apply at progress `t` (0..1, pre-eased by
 * the caller is fine — this applies the easing itself). Numeric `range` params
 * tween linearly between `from` and `to`; every other control (enum, boolean,
 * color, palette) is a discrete value and snaps to `to` once `t > 0` (so the
 * change registers immediately) — only numbers animate. Keys present in `to`
 * drive the result; keys absent from `to` keep their `from` value.
 *
 * Pure and side-effect free so it can be unit-tested without a clock.
 */
export function tweenValues(
  shader: Shader,
  from: ParamValues,
  to: ParamValues,
  t: number,
): ParamValues {
  const eased = easeOutCubic(clamp01(t));
  const byName = new Map<string, Param>(shader.params.map((p) => [p.name, p]));
  const next: ParamValues = { ...from };

  for (const key of Object.keys(to)) {
    const param = byName.get(key);
    const target = to[key];
    if (
      param?.control === "range" &&
      typeof target === "number" &&
      typeof from[key] === "number"
    ) {
      const start = from[key] as number;
      next[key] = start + (target - start) * eased;
    } else {
      // Discrete: snap once the tween has started; hold the start value at t=0.
      next[key] = eased > 0 ? target : from[key];
    }
  }
  return next;
}

function clamp01(t: number): number {
  if (t < 0) return 0;
  if (t > 1) return 1;
  return t;
}
