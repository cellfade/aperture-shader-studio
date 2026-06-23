import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { PreviewCrossfade } from "@/components/studio/preview-crossfade";

// A1 — drive both the motion-allowed and reduced-motion (hard-cut) branches.
const reducedMotion = vi.hoisted(() => ({ value: false }));
vi.mock("@/lib/studio/use-media-query", () => ({
  useReducedMotion: () => reducedMotion.value,
  useMediaQuery: () => false,
}));

afterEach(() => {
  reducedMotion.value = false;
  vi.useRealTimers();
  cleanup();
});

/** A stand-in for a WebGL preview layer; counted like a canvas. */
function Layer({ id }: { id: string }) {
  return <div data-layer={id} />;
}

function layerCount(container: HTMLElement) {
  return container.querySelectorAll("[data-layer]").length;
}
function wipeCount(container: HTMLElement) {
  // the exposure wipe is the only 1px white absolute span we render
  return container.querySelectorAll("span[aria-hidden]").length;
}

describe("PreviewCrossfade (A1 — hero crossfade canvas discipline)", () => {
  it("renders exactly one layer at rest, no wipe on first paint", () => {
    const { container } = render(
      <PreviewCrossfade layerKey="a">
        <Layer id="a" />
      </PreviewCrossfade>,
    );
    expect(layerCount(container)).toBe(1);
    expect(wipeCount(container)).toBe(0);
  });

  it("overlaps to TWO layers during a switch, then collapses back to one", () => {
    vi.useFakeTimers();
    const { container, rerender } = render(
      <PreviewCrossfade layerKey="a">
        <Layer id="a" />
      </PreviewCrossfade>,
    );
    act(() => {
      rerender(
        <PreviewCrossfade layerKey="b">
          <Layer id="b" />
        </PreviewCrossfade>,
      );
    });
    // current (b) + outgoing (a) coexist for the overlap — never more than 2
    expect(layerCount(container)).toBe(2);
    // a single exposure wipe is playing
    expect(wipeCount(container)).toBe(1);
    // after the exit beat the outgoing layer is unmounted → back to one canvas
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(layerCount(container)).toBe(1);
  });

  it("REPLACES (never stacks) the outgoing layer on rapid switching — caps at 2", () => {
    vi.useFakeTimers();
    const { container, rerender } = render(
      <PreviewCrossfade layerKey="a">
        <Layer id="a" />
      </PreviewCrossfade>,
    );
    // a → b → c → d with no time elapsing between switches
    for (const k of ["b", "c", "d"]) {
      act(() => {
        rerender(
          <PreviewCrossfade layerKey={k}>
            <Layer id={k} />
          </PreviewCrossfade>,
        );
      });
      // at every instant: current + at most one outgoing = 2, never 3+
      expect(layerCount(container)).toBeLessThanOrEqual(2);
    }
    expect(layerCount(container)).toBe(2);
  });

  it("hard-cuts under reduced motion: no outgoing layer, no wipe", () => {
    reducedMotion.value = true;
    const { container, rerender } = render(
      <PreviewCrossfade layerKey="a">
        <Layer id="a" />
      </PreviewCrossfade>,
    );
    act(() => {
      rerender(
        <PreviewCrossfade layerKey="b">
          <Layer id="b" />
        </PreviewCrossfade>,
      );
    });
    // instant cut — only the new layer, no overlap, no wipe
    expect(layerCount(container)).toBe(1);
    expect(wipeCount(container)).toBe(0);
  });
});
