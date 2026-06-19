import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  buildShareUrl,
  readInitialUrlState,
  useUrlState,
} from "@/components/studio/use-url-state";
import { DEFAULT_SHADER_ID, SHADERS_BY_ID, initialValues } from "@/lib/studio/registry";

/**
 * Hook-level tests for the URL-hash sync: debounced replaceState writes,
 * external hashchange restore, and the share-url builder. The pure codec is
 * covered in url-state.test.ts.
 */

const dithering = SHADERS_BY_ID[DEFAULT_SHADER_ID];

beforeEach(() => {
  vi.useFakeTimers();
  window.history.replaceState(null, "", "/");
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("useUrlState — writes", () => {
  it("does not write on mount (clobber-safe), then writes a state change via replaceState (not pushState)", () => {
    const replaceSpy = vi.spyOn(window.history, "replaceState");
    const pushSpy = vi.spyOn(window.history, "pushState");
    const { rerender } = renderHook(
      ({ size }: { size: number }) =>
        useUrlState({
          state: {
            shaderId: dithering.id,
            values: { ...initialValues(dithering), size },
          },
          onExternalChange: () => {},
          debounceMs: 200,
        }),
      { initialProps: { size: 1 } },
    );
    // The initial mount write is intentionally skipped so it can't overwrite an
    // incoming shared-link hash before the studio applies it post-mount.
    act(() => vi.advanceTimersByTime(200));
    expect(replaceSpy).not.toHaveBeenCalled();
    // A user-driven state change does write (debounced, replaceState).
    rerender({ size: 2 });
    act(() => vi.advanceTimersByTime(200));
    expect(replaceSpy).toHaveBeenCalledTimes(1);
    expect(pushSpy).not.toHaveBeenCalled();
    expect(window.location.hash).toContain(`s=${dithering.id}`);
  });

  it("debounces rapid state changes into a single write", () => {
    const replaceSpy = vi.spyOn(window.history, "replaceState");
    const { rerender } = renderHook(
      ({ speed }: { speed: number }) =>
        useUrlState({
          state: {
            shaderId: dithering.id,
            values: { ...initialValues(dithering), size: speed },
          },
          onExternalChange: () => {},
          debounceMs: 200,
        }),
      { initialProps: { speed: 1 } },
    );
    rerender({ speed: 2 });
    rerender({ speed: 3 });
    act(() => vi.advanceTimersByTime(100)); // mid-debounce
    expect(replaceSpy).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(200));
    expect(replaceSpy).toHaveBeenCalledTimes(1);
  });
});

describe("useUrlState — external restore", () => {
  it("calls onExternalChange when the hash changes from outside our writes", () => {
    const onExternalChange = vi.fn();
    renderHook(() =>
      useUrlState({
        state: { shaderId: dithering.id, values: initialValues(dithering) },
        onExternalChange,
        debounceMs: 200,
      }),
    );
    act(() => {
      window.location.hash = `#s=mesh-gradient&p=speed:1.5`;
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(onExternalChange).toHaveBeenCalledTimes(1);
    expect(onExternalChange.mock.calls[0][0].shaderId).toBe("mesh-gradient");
  });

  it("ignores the hashchange caused by its own write (no echo)", () => {
    const onExternalChange = vi.fn();
    renderHook(() =>
      useUrlState({
        state: { shaderId: dithering.id, values: initialValues(dithering) },
        onExternalChange,
        debounceMs: 200,
      }),
    );
    act(() => vi.advanceTimersByTime(200)); // our own write
    act(() => window.dispatchEvent(new HashChangeEvent("hashchange")));
    expect(onExternalChange).not.toHaveBeenCalled();
  });
});

describe("readInitialUrlState / buildShareUrl", () => {
  it("reads a look from the current hash", () => {
    window.history.replaceState(null, "", `/#s=mesh-gradient&p=speed:1`);
    const state = readInitialUrlState();
    expect(state?.shaderId).toBe("mesh-gradient");
  });

  it("builds an absolute share url with the hash", () => {
    const url = buildShareUrl({ shaderId: dithering.id, values: initialValues(dithering) });
    expect(url).toContain(`#s=${dithering.id}`);
    expect(url.startsWith(window.location.origin)).toBe(true);
  });
});
