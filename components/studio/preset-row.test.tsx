import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { PresetRow } from "@/components/studio/preset-row";
import { presetsFor } from "@/lib/studio/presets";
import { SHADERS_BY_ID, initialValues } from "@/lib/studio/registry";

/**
 * Component-level tests for the preset apply flow. The pure tween math is tested
 * in tween.test.ts; here we verify the integration: reduced-motion jumps
 * instantly, the animated path writes through onReplaceValues and lands on the
 * preset values, and an outside edit mid-tween cancels cleanly.
 */

const shader = SHADERS_BY_ID["mesh-gradient"];

/** Drive prefers-reduced-motion via a matchMedia stub. */
function setReducedMotion(reduced: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query.includes("reduce") ? reduced : false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
    onchange: null,
  }));
}

// A controllable rAF: tests flush frames by hand via `runFrames`.
let frameQueue: FrameRequestCallback[];
function installRaf() {
  frameQueue = [];
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    frameQueue.push(cb);
    return frameQueue.length;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
}
function runFrame(time: number) {
  const queued = frameQueue;
  frameQueue = [];
  act(() => queued.forEach((cb) => cb(time)));
}

beforeEach(() => {
  installRaf();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("PresetRow — reduced motion", () => {
  it("jumps instantly to the preset values (no rAF) when reduced", () => {
    setReducedMotion(true);
    const preset = presetsFor(shader.id)[1];
    const onReplaceValues = vi.fn();
    render(
      <PresetRow
        shader={shader}
        values={initialValues(shader)}
        onReplaceValues={onReplaceValues}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: preset.name }));
    // exactly one write, no frames scheduled
    expect(onReplaceValues).toHaveBeenCalledTimes(1);
    expect(frameQueue.length).toBe(0);
    const written = onReplaceValues.mock.calls[0][0];
    for (const [k, v] of Object.entries(preset.values)) {
      expect(written[k]).toEqual(v);
    }
  });
});

describe("PresetRow — animated apply", () => {
  it("tweens through rAF and lands on the preset values", () => {
    setReducedMotion(false);
    const preset = presetsFor(shader.id)[1];
    const onReplaceValues = vi.fn();
    vi.spyOn(performance, "now").mockReturnValue(0);
    render(
      <PresetRow
        shader={shader}
        values={initialValues(shader)}
        onReplaceValues={onReplaceValues}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: preset.name }));
    // a frame was scheduled (animating, not jumping)
    expect(frameQueue.length).toBe(1);
    // advance to the end of the tween
    runFrame(1000);
    const last = onReplaceValues.mock.calls.at(-1)![0];
    for (const [k, v] of Object.entries(preset.values)) {
      expect(last[k]).toEqual(v);
    }
  });

  it("cancels the tween when an outside edit lands mid-animation", () => {
    setReducedMotion(false);
    const preset = presetsFor(shader.id)[1];
    vi.spyOn(performance, "now").mockReturnValue(0);
    const initial = initialValues(shader);

    // Mirror the real state flow: each onReplaceValues write feeds back as the
    // next `values` prop (so the loop sees its own writes as "not interfered").
    let current = initial;
    const onReplaceValues = vi.fn((next) => {
      current = next;
    });
    const { rerender } = render(
      <PresetRow shader={shader} values={current} onReplaceValues={onReplaceValues} />,
    );
    fireEvent.click(screen.getByRole("button", { name: preset.name }));

    runFrame(50); // first tween tick writes a step
    rerender(
      <PresetRow shader={shader} values={current} onReplaceValues={onReplaceValues} />,
    );
    const callsBeforeDrag = onReplaceValues.mock.calls.length;
    expect(callsBeforeDrag).toBeGreaterThan(0);

    // A slider drag lands a DIFFERENT object that the tween did not write.
    current = { ...current, speed: 0.123456 };
    rerender(
      <PresetRow shader={shader} values={current} onReplaceValues={onReplaceValues} />,
    );
    runFrame(100); // next tick detects interference → cancels, no further write

    expect(onReplaceValues.mock.calls.length).toBe(callsBeforeDrag);
    expect(frameQueue.length).toBe(0); // no further frames scheduled
  });
});
