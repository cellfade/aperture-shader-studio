"use client";

import type { Param, ParamValue } from "@/lib/studio/registry";

const FOCUS =
  "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

function fmt(value: number, step: number): string {
  const dec = step >= 1 ? 0 : step <= 0.01 ? 2 : 1;
  return value.toFixed(dec);
}

interface Props {
  param: Param;
  value: ParamValue;
  onChange: (v: ParamValue) => void;
}

export function ParamControl({ param, value, onChange }: Props) {
  switch (param.control) {
    case "range": {
      const v = typeof value === "number" && Number.isFinite(value) ? value : param.min;
      return (
        <label className="block py-0.5">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[13px] text-foreground/80">{param.label}</span>
            <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
              {fmt(v, param.step)}
            </span>
          </div>
          <input
            type="range"
            min={param.min}
            max={param.max}
            step={param.step}
            value={v}
            aria-label={param.label}
            aria-valuetext={`${param.label} ${fmt(v, param.step)}`}
            onChange={(e) => {
              const n = parseFloat(e.target.value);
              if (Number.isFinite(n)) onChange(n);
            }}
            onDoubleClick={() => onChange(param.default)}
            onKeyDown={(e) => {
              if (e.key === "Backspace" || e.key === "Delete") {
                e.preventDefault();
                onChange(param.default);
              }
            }}
            className="mt-2.5 h-1 w-full cursor-ew-resize rounded-full bg-border outline-none"
          />
        </label>
      );
    }

    case "boolean": {
      const on = value === true;
      return (
        <div className="flex items-center justify-between">
          <span className="text-[13px] text-foreground/80">{param.label}</span>
          <button
            type="button"
            role="switch"
            aria-checked={on}
            aria-label={param.label}
            onClick={() => onChange(!on)}
            className={`relative h-5 w-9 shrink-0 rounded-full border transition-colors ${FOCUS} ${
              on ? "border-foreground/40 bg-foreground/25" : "border-border bg-secondary"
            }`}
          >
            <span
              className={`absolute top-1/2 size-3.5 -translate-y-1/2 rounded-full transition-all ${
                on ? "left-[18px] bg-foreground" : "left-0.5 bg-muted-foreground"
              }`}
            />
          </button>
        </div>
      );
    }

    case "enum": {
      const cur = typeof value === "string" ? value : param.options[0];
      const many = param.options.length > 5;
      return (
        <div>
          <span className="text-[13px] text-foreground/80">{param.label}</span>
          {many ? (
            <select
              value={cur}
              aria-label={param.label}
              onChange={(e) => onChange(e.target.value)}
              className={`mt-2 w-full rounded-md border border-border bg-secondary px-2 py-1.5 font-mono text-[12px] text-foreground outline-none ${FOCUS}`}
            >
              {param.options.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          ) : (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {param.options.map((opt) => {
                const active = opt === cur;
                return (
                  <button
                    key={opt}
                    type="button"
                    aria-pressed={active}
                    onClick={() => onChange(opt)}
                    className={`rounded-md border px-2 py-1 font-mono text-[11px] transition-colors ${FOCUS} ${
                      active
                        ? "border-foreground/30 bg-foreground/10 text-foreground"
                        : "border-border bg-transparent text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {opt}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      );
    }

    case "color": {
      const hex = typeof value === "string" ? value : "#9ee7ff";
      return (
        <label className="flex items-center justify-between">
          <span className="text-[13px] text-foreground/80">{param.label}</span>
          <span className="flex items-center gap-2">
            <span className="font-mono text-[11px] uppercase tabular-nums text-muted-foreground">
              {hex}
            </span>
            <Swatch
              color={hex}
              label={param.label}
              onChange={(c) => onChange(c)}
            />
          </span>
        </label>
      );
    }

    case "palette": {
      const colors = Array.isArray(value) ? value : ["#9ee7ff"];
      const setAt = (i: number, hex: string) => {
        const next = [...colors];
        next[i] = hex;
        onChange(next);
      };
      return (
        <div className="flex items-center justify-between">
          <span className="text-[13px] text-foreground/80">{param.label}</span>
          <span className="flex items-center gap-2">
            {colors.slice(0, 6).map((c, i) => (
              <Swatch
                key={i}
                color={c}
                label={`${param.label} ${i + 1}`}
                onChange={(hex) => setAt(i, hex)}
              />
            ))}
          </span>
        </div>
      );
    }

    default:
      return null;
  }
}

/** A small color swatch with a ≥40px touch target and a visible focus ring. */
function Swatch({
  color,
  label,
  onChange,
}: {
  color: string;
  label: string;
  onChange: (hex: string) => void;
}) {
  return (
    <span
      className={`relative grid size-7 place-items-center overflow-hidden rounded-md border border-border ${FOCUS} focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-background`}
    >
      <input
        type="color"
        value={color}
        aria-label={label}
        onChange={(e) => onChange(e.target.value)}
        className="absolute -left-2 -top-2 size-11 cursor-pointer border-0 bg-transparent p-0"
      />
    </span>
  );
}
