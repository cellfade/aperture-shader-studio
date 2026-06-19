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

/** Set a controlled input's value and dispatch a React-observed input event. */
function fireInput(el: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}
