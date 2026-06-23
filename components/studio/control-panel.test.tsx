import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ControlPanel } from "@/components/studio/control-panel";
import { SHADERS_BY_ID, initialValues } from "@/lib/studio/registry";

// A5 — drive the reduced-motion branch of the staggered control-group reveal.
const reducedMotion = vi.hoisted(() => ({ value: false }));
vi.mock("@/lib/studio/use-media-query", () => ({
  useReducedMotion: () => reducedMotion.value,
  useMediaQuery: () => false,
}));

afterEach(() => {
  reducedMotion.value = false;
  cleanup();
});

// image-dithering carries boolean params (originalColors / inverted) plus
// range/enum/color params — a good fixture for the panel's control wiring.
const shader = SHADERS_BY_ID["image-dithering"];

describe("ControlPanel — control wiring", () => {
  it("fires onChange(name, boolean) when a boolean toggle is clicked — not a string (regression)", async () => {
    const boolParam = shader.params.find((p) => p.control === "boolean");
    if (!boolParam) throw new Error("fixture shader has no boolean param");

    const values = initialValues(shader);
    const wasOn = values[boolParam.name] === true;
    const onChange = vi.fn();

    render(
      <ControlPanel
        shader={shader}
        values={values}
        onSelectShader={() => {}}
        onChange={onChange}
        onReplaceValues={() => {}}
      />,
    );

    const toggle = screen.getByRole("switch", { name: boolParam.label });
    await userEvent.click(toggle);

    expect(onChange).toHaveBeenCalledTimes(1);
    const [name, value] = onChange.mock.calls[0];
    expect(name).toBe(boolParam.name);
    // The bug: the panel's inline arrow dropped the boolean and forwarded the
    // param NAME (a string), so the toggle could never turn off and the uniform
    // received a truthy string. Assert a real boolean that flips the default.
    expect(typeof value).toBe("boolean");
    expect(value).toBe(!wasOn);
  });

  it("fires onChange(name, number) when a range slider changes", () => {
    const rangeParam = shader.params.find((p) => p.control === "range");
    if (!rangeParam) throw new Error("fixture shader has no range param");

    const onChange = vi.fn();
    render(
      <ControlPanel
        shader={shader}
        values={initialValues(shader)}
        onSelectShader={() => {}}
        onChange={onChange}
        onReplaceValues={() => {}}
      />,
    );

    // jsdom doesn't implement range-input keyboard stepping, so drive the
    // change event directly (what the control's handler actually listens to).
    const slider = screen.getByRole("slider", { name: rangeParam.label });
    const next = rangeParam.min + rangeParam.step;
    fireEvent.change(slider, { target: { value: String(next) } });

    expect(onChange).toHaveBeenCalled();
    const [name, value] = onChange.mock.calls[onChange.mock.calls.length - 1];
    expect(name).toBe(rangeParam.name);
    expect(typeof value).toBe("number");
    expect(value).toBeCloseTo(next, 5);
  });
});

describe("ControlPanel — A5 staggered reveal (reduced-motion safe)", () => {
  it("renders all sections with motion allowed", () => {
    reducedMotion.value = false;
    render(
      <ControlPanel
        shader={shader}
        values={initialValues(shader)}
        onSelectShader={() => {}}
        onChange={() => {}}
        onReplaceValues={() => {}}
      />,
    );
    expect(
      screen.getByRole("heading", { level: 3, name: "Adjust" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 3, name: "Color" }),
    ).toBeInTheDocument();
  });

  it("renders the same sections under reduced motion (no crash, opacity-only path)", () => {
    reducedMotion.value = true;
    render(
      <ControlPanel
        shader={shader}
        values={initialValues(shader)}
        onSelectShader={() => {}}
        onChange={() => {}}
        onReplaceValues={() => {}}
      />,
    );
    // Both motion branches must yield the same content (the reveal is purely
    // presentational; reduced motion just collapses the stagger).
    expect(
      screen.getByRole("heading", { level: 3, name: "Adjust" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 3, name: "Color" }),
    ).toBeInTheDocument();
  });
});
