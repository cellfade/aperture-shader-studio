import { describe, expect, it } from "vitest";
import {
  coercePresetValue,
  presetsFor,
  valuesMatchPreset,
} from "@/lib/studio/presets";
import { SHADERS_BY_ID } from "@/lib/studio/registry";

/**
 * Presets are sourced from the library's exported `*Presets` arrays and mapped
 * against the registry. These tests confirm real values are available, that
 * only catalog-known keys survive, and that values are validated/clamped.
 */

describe("presetsFor", () => {
  it("sources real preset values for a generative shader", () => {
    const presets = presetsFor("mesh-gradient");
    expect(presets.length).toBeGreaterThan(1);
    expect(presets[0].name.length).toBeGreaterThan(0);
    // values are a non-empty patch of catalog params
    expect(Object.keys(presets[0].values).length).toBeGreaterThan(0);
  });

  it("sources presets for an image-filter shader (image excluded)", () => {
    const presets = presetsFor("image-dithering");
    expect(presets.length).toBeGreaterThan(1);
    for (const p of presets) {
      expect(p.values).not.toHaveProperty("image");
    }
  });

  it("only keeps catalog-known param keys (drops library extras like rotation/fit)", () => {
    const shader = SHADERS_BY_ID["mesh-gradient"];
    const known = new Set(shader.params.map((p) => p.name));
    for (const preset of presetsFor("mesh-gradient")) {
      for (const key of Object.keys(preset.values)) {
        expect(known.has(key)).toBe(true);
      }
    }
  });

  it("clamps preset numeric values into the param range", () => {
    for (const preset of presetsFor("mesh-gradient")) {
      const shader = SHADERS_BY_ID["mesh-gradient"];
      for (const param of shader.params) {
        if (param.control !== "range") continue;
        const v = preset.values[param.name];
        if (typeof v === "number") {
          expect(v).toBeGreaterThanOrEqual(param.min);
          expect(v).toBeLessThanOrEqual(param.max);
        }
      }
    }
  });

  it("returns [] for an unknown shader id", () => {
    expect(presetsFor("does-not-exist")).toEqual([]);
  });
});

describe("coercePresetValue", () => {
  const shader = SHADERS_BY_ID["mesh-gradient"];
  const range = shader.params.find((p) => p.control === "range")!;
  const palette = shader.params.find((p) => p.control === "palette")!;

  it("clamps a range value", () => {
    expect(coercePresetValue(range, range.max + 100)).toBe(range.max);
    expect(coercePresetValue(range, range.min - 100)).toBe(range.min);
  });

  it("rejects a non-finite range value", () => {
    expect(coercePresetValue(range, "nope")).toBeNull();
  });

  it("keeps a string-array palette", () => {
    expect(coercePresetValue(palette, ["#000", "#fff"])).toEqual(["#000", "#fff"]);
    expect(coercePresetValue(palette, "not-array")).toBeNull();
  });
});

describe("valuesMatchPreset", () => {
  it("is true when values match the preset within epsilon", () => {
    const preset = presetsFor("mesh-gradient")[1];
    expect(valuesMatchPreset({ ...preset.values }, preset)).toBe(true);
  });

  it("is false when a value diverges", () => {
    const preset = presetsFor("mesh-gradient")[1];
    const key = Object.keys(preset.values).find(
      (k) => typeof preset.values[k] === "number",
    )!;
    const changed = { ...preset.values, [key]: (preset.values[key] as number) + 1 };
    expect(valuesMatchPreset(changed, preset)).toBe(false);
  });
});
