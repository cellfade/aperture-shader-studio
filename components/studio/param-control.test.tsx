import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ParamControl } from "@/components/studio/param-control";
import type { Param } from "@/lib/studio/registry";

function makeParam(over: Partial<Param>): Param {
  return {
    name: "size",
    label: "Size",
    control: "range",
    min: 0,
    max: 10,
    step: 1,
    options: [],
    default: 5,
    ...over,
  };
}

describe("ParamControl (range)", () => {
  it("renders a slider for the param and reflects its value", () => {
    const param = makeParam({ name: "size", label: "Size", control: "range" });
    render(<ParamControl param={param} value={3} onChange={() => {}} />);
    const slider = screen.getByRole("slider", { name: "Size" });
    expect(slider).toHaveValue("3");
  });

  it("calls onChange with (name, numericValue) on input", () => {
    const onChange = vi.fn();
    const param = makeParam({ name: "size", control: "range", min: 0, max: 10 });
    render(<ParamControl param={param} value={3} onChange={onChange} />);
    const slider = screen.getByRole("slider", { name: "Size" });
    // jsdom range inputs respond to a direct value change + input event.
    fireInput(slider as HTMLInputElement, "7");
    expect(onChange).toHaveBeenCalledWith("size", 7);
  });
});

describe("ParamControl (range) — invalid/out-of-range values", () => {
  it("falls back to param.min when the value is not a finite number", () => {
    const param = makeParam({ name: "size", control: "range", min: 2, max: 10 });
    // NaN — a corrupted/uninitialized value must not produce an invalid input.
    render(<ParamControl param={param} value={NaN} onChange={() => {}} />);
    expect(screen.getByRole("slider", { name: "Size" })).toHaveValue("2");
  });

  it("falls back to param.min when the value is the wrong type entirely", () => {
    const param = makeParam({ name: "size", control: "range", min: 2, max: 10 });
    render(
      <ParamControl
        param={param}
        value={"not-a-number" as unknown as number}
        onChange={() => {}}
      />,
    );
    expect(screen.getByRole("slider", { name: "Size" })).toHaveValue("2");
  });

  it("resets to the default on double-click", async () => {
    const onChange = vi.fn();
    const param = makeParam({
      name: "size",
      control: "range",
      min: 0,
      max: 10,
      default: 4,
    });
    render(<ParamControl param={param} value={9} onChange={onChange} />);
    await userEvent.dblClick(screen.getByRole("slider", { name: "Size" }));
    expect(onChange).toHaveBeenCalledWith("size", 4);
  });
});

describe("ParamControl (boolean)", () => {
  it("renders a switch and toggles via onChange(name, !value)", async () => {
    const onChange = vi.fn();
    const param = makeParam({
      name: "inverted",
      label: "Inverted",
      control: "boolean",
      default: false,
    });
    render(<ParamControl param={param} value={false} onChange={onChange} />);
    const sw = screen.getByRole("switch", { name: "Inverted" });
    expect(sw).toHaveAttribute("aria-checked", "false");
    await userEvent.click(sw);
    expect(onChange).toHaveBeenCalledWith("inverted", true);
  });
});

describe("ParamControl (enum)", () => {
  it("renders option buttons and selects via onChange(name, option)", async () => {
    const onChange = vi.fn();
    const param = makeParam({
      name: "type",
      label: "Type",
      control: "enum",
      options: ["random", "2x2", "4x4"],
      default: "random",
    });
    render(<ParamControl param={param} value="random" onChange={onChange} />);
    const btn = screen.getByRole("button", { name: "4x4" });
    await userEvent.click(btn);
    expect(onChange).toHaveBeenCalledWith("type", "4x4");
  });
});

describe("ParamControl (enum) — invalid values", () => {
  it("falls back to the first option when the value is not one of the options", () => {
    const onChange = vi.fn();
    const param = makeParam({
      name: "type",
      label: "Type",
      control: "enum",
      options: ["random", "2x2", "4x4"],
      default: "random",
    });
    // A bogus value must still render with a valid selection (first option
    // pressed) rather than no selection at all.
    render(
      <ParamControl
        param={param}
        value={42 as unknown as string}
        onChange={onChange}
      />,
    );
    expect(screen.getByRole("button", { name: "random" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});

describe("ParamControl (boolean) — invalid values", () => {
  it("treats any non-`true` value as off", () => {
    const param = makeParam({
      name: "inverted",
      label: "Inverted",
      control: "boolean",
      default: false,
    });
    render(
      <ParamControl
        param={param}
        value={"yes" as unknown as boolean}
        onChange={() => {}}
      />,
    );
    expect(screen.getByRole("switch", { name: "Inverted" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });
});

describe("ParamControl (color) — B5 editable hex field", () => {
  const colorParam = makeParam({
    name: "tint",
    label: "Tint",
    control: "color",
    default: "#9ee7ff",
  });

  it("renders an editable hex text input reflecting the value", () => {
    render(<ParamControl param={colorParam} value="#9ee7ff" onChange={() => {}} />);
    const field = screen.getByRole("textbox", { name: /tint hex value/i });
    expect(field).toHaveValue("#9ee7ff");
  });

  it("commits a normalized #rrggbb on blur through onChange(name, value)", async () => {
    const onChange = vi.fn();
    render(<ParamControl param={colorParam} value="#9ee7ff" onChange={onChange} />);
    const field = screen.getByRole("textbox", { name: /tint hex value/i });
    await userEvent.clear(field);
    await userEvent.type(field, "abc"); // shorthand, no #
    await userEvent.tab(); // blur → commit
    expect(onChange).toHaveBeenCalledWith("tint", "#aabbcc");
  });

  it("reverts to the prior value on an invalid blur (no onChange)", async () => {
    const onChange = vi.fn();
    render(<ParamControl param={colorParam} value="#9ee7ff" onChange={onChange} />);
    const field = screen.getByRole("textbox", { name: /tint hex value/i });
    await userEvent.clear(field);
    await userEvent.type(field, "nope");
    await userEvent.tab();
    expect(onChange).not.toHaveBeenCalled();
    expect(field).toHaveValue("#9ee7ff");
  });

  it("keeps the native color swatch alongside the text field", () => {
    const { container } = render(
      <ParamControl param={colorParam} value="#9ee7ff" onChange={() => {}} />,
    );
    expect(container.querySelector('input[type="color"]')).not.toBeNull();
  });
});

/** Set a controlled input's value and dispatch a React-observed input event. */
function fireInput(el: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}
