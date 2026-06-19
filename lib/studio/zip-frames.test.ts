import { describe, expect, it } from "vitest";
import { frameName } from "@/lib/studio/zip-frames";

describe("frameName", () => {
  it("is 1-based (index 0 -> frame-01)", () => {
    expect(frameName(0)).toBe("frame-01.png");
  });

  it("zero-pads to at least two digits", () => {
    expect(frameName(8)).toBe("frame-09.png");
    expect(frameName(11)).toBe("frame-12.png");
  });

  it("does not truncate indices beyond two digits", () => {
    expect(frameName(99)).toBe("frame-100.png");
    expect(frameName(998)).toBe("frame-999.png");
  });

  it("produces names that sort lexicographically in capture order", () => {
    const names = Array.from({ length: 12 }, (_, i) => frameName(i));
    const sorted = [...names].sort();
    expect(sorted).toEqual(names);
  });
});
