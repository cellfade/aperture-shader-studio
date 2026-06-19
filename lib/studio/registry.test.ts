import { describe, expect, it } from "vitest";
import {
  CATEGORIES,
  SHADERS,
  SHADERS_BY_ID,
  getComponent,
  initialValues,
  type Shader,
} from "@/lib/studio/registry";

const dithering = SHADERS_BY_ID["image-dithering"];

describe("param normalization", () => {
  it("has the sample shader in the catalog", () => {
    expect(dithering).toBeDefined();
  });

  it("skips the `image` param (wired to the upload, not a control)", () => {
    const names = dithering.params.map((p) => p.name);
    expect(names).not.toContain("image");
    // every other catalog param survived
    expect(names).toContain("colorFront");
    expect(names).toContain("type");
    expect(names).toContain("size");
  });

  it("maps a `colors` param to the palette control", () => {
    const withColors = SHADERS.find((s) =>
      s.params.some((p) => p.name === "colors"),
    );
    expect(withColors, "at least one shader has a `colors` param").toBeDefined();
    const colorsParam = withColors!.params.find((p) => p.name === "colors")!;
    expect(colorsParam.control).toBe("palette");
    expect(Array.isArray(colorsParam.default)).toBe(true);
  });

  it("derives a human label from a camelCase name", () => {
    const colorFront = dithering.params.find((p) => p.name === "colorFront")!;
    expect(colorFront.label).toBe("Color front");
  });

  it("preserves declared control kinds and ranges", () => {
    const size = dithering.params.find((p) => p.name === "size")!;
    expect(size.control).toBe("range");
    expect(size.min).toBe(0.5);
    expect(size.max).toBe(20);
    expect(size.step).toBe(0.1);

    const type = dithering.params.find((p) => p.name === "type")!;
    expect(type.control).toBe("enum");
    expect(type.options).toEqual(["random", "2x2", "4x4", "8x8"]);
  });
});

describe("initialValues", () => {
  it("returns the documented defaults for the sample shader", () => {
    const v = initialValues(dithering);
    expect(v).toEqual({
      colorFront: "#ffffff",
      colorBack: "#000000",
      colorHighlight: "#ffffff",
      type: "4x4",
      size: 2,
      colorSteps: 1,
      originalColors: false,
      inverted: false,
    });
  });

  it("never includes the skipped `image` key", () => {
    expect(initialValues(dithering)).not.toHaveProperty("image");
  });

  it("keys exactly match the shader's params", () => {
    const v = initialValues(dithering);
    expect(Object.keys(v).sort()).toEqual(
      dithering.params.map((p) => p.name).sort(),
    );
  });
});

describe("CATEGORIES", () => {
  it("partitions every shader into exactly one category", () => {
    const counted = CATEGORIES.reduce((n, c) => n + c.shaders.length, 0);
    expect(counted).toBe(SHADERS.length);

    const ids = CATEGORIES.flatMap((c) => c.shaders.map((s) => s.id));
    expect(new Set(ids).size).toBe(SHADERS.length);
  });

  it("places each shader in the category matching its own `category` field", () => {
    for (const cat of CATEGORIES) {
      for (const s of cat.shaders) {
        expect(s.category).toBe(cat.key);
      }
    }
  });

  it("exposes the three expected category keys", () => {
    expect(CATEGORIES.map((c) => c.key)).toEqual([
      "image-filter",
      "logo",
      "generative",
    ]);
  });
});

describe("getComponent", () => {
  it("returns a component for a known shader's component name", () => {
    const comp = getComponent(dithering.component);
    expect(comp).toBeTruthy();
  });

  it("returns null for an unknown id", () => {
    expect(getComponent("DefinitelyNotAShader")).toBeNull();
    expect(getComponent("")).toBeNull();
  });
});

describe("SHADERS_BY_ID", () => {
  it("indexes every shader by id", () => {
    const sample: Shader = SHADERS[0];
    expect(SHADERS_BY_ID[sample.id]).toBe(sample);
  });
});
