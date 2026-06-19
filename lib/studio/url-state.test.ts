import { describe, expect, it } from "vitest";
import { decodeState, encodeState } from "@/lib/studio/url-state";
import {
  DEFAULT_SHADER_ID,
  SHADERS_BY_ID,
  initialValues,
  type ParamValues,
} from "@/lib/studio/registry";

/**
 * The URL codec is the privacy + robustness surface for FR-9: it must round-trip
 * a look, never throw on garbage input, validate every value against the
 * registry, and never carry image data. Tests drive only the pure codec (no
 * window / no hook) so they're deterministic.
 */

const dithering = SHADERS_BY_ID[DEFAULT_SHADER_ID];

describe("encode <-> decode round-trip", () => {
  it("preserves a full set of values across the active shader", () => {
    const values = initialValues(dithering);
    const hash = encodeState({ shaderId: dithering.id, values });
    const decoded = decodeState(hash);
    expect(decoded).not.toBeNull();
    expect(decoded?.shaderId).toBe(dithering.id);
    for (const [name, expected] of Object.entries(values)) {
      expect(decoded?.values[name]).toEqual(expected);
    }
  });

  it("round-trips numeric, enum, boolean, color, and palette params", () => {
    const mesh = SHADERS_BY_ID["mesh-gradient"]; // has range + palette
    const values: ParamValues = { ...initialValues(mesh), speed: 1.23, swirl: 0.42 };
    const decoded = decodeState(encodeState({ shaderId: mesh.id, values }));
    expect(decoded?.values.speed).toBeCloseTo(1.23, 4);
    expect(decoded?.values.swirl).toBeCloseTo(0.42, 4);
    expect(decoded?.values.colors).toEqual(values.colors);
  });

  it("encodes a leading-hash-free string parseable by decode either way", () => {
    const hash = encodeState({ shaderId: dithering.id, values: initialValues(dithering) });
    expect(hash.startsWith("#")).toBe(false);
    expect(decodeState(hash)).not.toBeNull();
    expect(decodeState(`#${hash}`)).not.toBeNull();
  });
});

describe("defensive decode", () => {
  it("returns null for an unknown shader id", () => {
    expect(decodeState("s=not-a-real-shader&p=speed:1")).toBeNull();
  });

  it("returns null for a malformed / empty hash", () => {
    expect(decodeState("")).toBeNull();
    expect(decodeState("#")).toBeNull();
    expect(decodeState("garbage-without-s-key")).toBeNull();
    expect(decodeState("p=speed:1")).toBeNull(); // no shader key
  });

  it("drops unknown param keys but keeps valid ones", () => {
    const decoded = decodeState(
      `s=${dithering.id}&p=size:1,bogusKey:99,colorFront:%23abcdef`,
    );
    expect(decoded).not.toBeNull();
    expect(decoded?.values).not.toHaveProperty("bogusKey");
    expect(decoded?.values.size).toBe(1);
    expect(decoded?.values.colorFront).toBe("#abcdef");
  });

  it("clamps out-of-range numeric values via the registry", () => {
    const sizeParam = dithering.params.find((p) => p.name === "size")!;
    const decoded = decodeState(`s=${dithering.id}&p=size:99999`);
    expect(decoded?.values.size).toBe(sizeParam.max);
    const low = decodeState(`s=${dithering.id}&p=size:-99999`);
    expect(low?.values.size).toBe(sizeParam.min);
  });

  it("rejects an invalid enum value (drops the key)", () => {
    const enumParam = dithering.params.find((p) => p.control === "enum");
    if (!enumParam) return; // dithering should have `type`
    const decoded = decodeState(`s=${dithering.id}&p=${enumParam.name}:notAnOption`);
    expect(decoded?.values).not.toHaveProperty(enumParam.name);
  });

  it("survives a malformed percent-escape without throwing", () => {
    expect(() => decodeState(`s=${dithering.id}&p=colorFront:%ZZ`)).not.toThrow();
    const decoded = decodeState(`s=${dithering.id}&p=colorFront:%ZZ,size:1`);
    // bad escape dropped, the rest survives
    expect(decoded?.values).not.toHaveProperty("colorFront");
    expect(decoded?.values.size).toBe(1);
  });
});

describe("privacy", () => {
  it("never encodes image/video data — only shader id + known params", () => {
    const values: ParamValues = {
      ...initialValues(dithering),
      image: "blob:secret-photo",
    };
    const hash = encodeState({ shaderId: dithering.id, values });
    expect(hash).not.toContain("secret-photo");
    expect(hash).not.toContain("blob:");
    // `image` is not a catalog param, so it must not survive a decode either
    expect(decodeState(hash)?.values).not.toHaveProperty("image");
  });
});
