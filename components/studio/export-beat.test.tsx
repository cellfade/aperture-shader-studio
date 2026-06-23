import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { ExportCheck, ExportShimmer } from "@/components/studio/export-beat";

// A7 — drive the reduced-motion branches of the export progress/completion beat.
const reducedMotion = vi.hoisted(() => ({ value: false }));
vi.mock("@/lib/studio/use-media-query", () => ({
  useReducedMotion: () => reducedMotion.value,
  useMediaQuery: () => false,
}));

afterEach(() => {
  reducedMotion.value = false;
  cleanup();
});

describe("ExportShimmer (A7 — indeterminate working hairline)", () => {
  it("renders the hairline shimmer element when motion is allowed", () => {
    const { container } = render(<ExportShimmer />);
    const el = container.querySelector(".export-shimmer");
    expect(el).not.toBeNull();
    expect(el?.getAttribute("aria-hidden")).toBe("true");
  });

  it("renders NOTHING under reduced motion (static label, no shimmer)", () => {
    reducedMotion.value = true;
    const { container } = render(<ExportShimmer />);
    expect(container.querySelector(".export-shimmer")).toBeNull();
    expect(container.firstChild).toBeNull();
  });
});

describe("ExportCheck (A7 — completion checkmark draw-on)", () => {
  it("renders a single checkmark path (decorative, aria-hidden)", () => {
    const { container } = render(<ExportCheck />);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
    expect(container.querySelectorAll("path")).toHaveLength(1);
  });

  it("renders fully-drawn (no draw-on) under reduced motion without crashing", () => {
    reducedMotion.value = true;
    const { container } = render(<ExportCheck />);
    expect(container.querySelector("path")).not.toBeNull();
  });
});
