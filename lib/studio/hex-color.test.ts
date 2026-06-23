import { describe, expect, it } from "vitest";
import { isValidHex, normalizeHex } from "@/lib/studio/hex-color";

describe("isValidHex", () => {
  it("accepts #rrggbb and #rgb (with or without #)", () => {
    expect(isValidHex("#9ee7ff")).toBe(true);
    expect(isValidHex("9ee7ff")).toBe(true);
    expect(isValidHex("#abc")).toBe(true);
    expect(isValidHex("abc")).toBe(true);
  });

  it("is case-insensitive and tolerates surrounding whitespace", () => {
    expect(isValidHex("#FFF")).toBe(true);
    expect(isValidHex("  #AaBbCc  ")).toBe(true);
  });

  it("rejects malformed values", () => {
    expect(isValidHex("")).toBe(false);
    expect(isValidHex("#")).toBe(false);
    expect(isValidHex("#12")).toBe(false); // 2 digits
    expect(isValidHex("#1234")).toBe(false); // 4 digits
    expect(isValidHex("#12345")).toBe(false); // 5 digits
    expect(isValidHex("#1234567")).toBe(false); // 7 digits
    expect(isValidHex("#ggg")).toBe(false); // non-hex chars
    expect(isValidHex("red")).toBe(false);
    expect(isValidHex("rgb(1,2,3)")).toBe(false);
  });
});

describe("normalizeHex", () => {
  it("expands #rgb shorthand to lowercase #rrggbb", () => {
    expect(normalizeHex("#abc")).toBe("#aabbcc");
    expect(normalizeHex("ABC")).toBe("#aabbcc");
    expect(normalizeHex("#F0A")).toBe("#ff00aa");
  });

  it("lowercases + prefixes a 6-digit hex", () => {
    expect(normalizeHex("9EE7FF")).toBe("#9ee7ff");
    expect(normalizeHex("#9ee7ff")).toBe("#9ee7ff");
    expect(normalizeHex("  #AABBCC  ")).toBe("#aabbcc");
  });

  it("returns null for invalid input (caller falls back to prior value)", () => {
    expect(normalizeHex("")).toBeNull();
    expect(normalizeHex("#")).toBeNull();
    expect(normalizeHex("#12")).toBeNull();
    expect(normalizeHex("nope")).toBeNull();
    expect(normalizeHex("#1234567")).toBeNull();
  });
});
