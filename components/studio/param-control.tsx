"use client";

import { memo, useCallback, useState } from "react";
import type { Param, ParamValue } from "@/lib/studio/registry";
import { isValidHex, normalizeHex } from "@/lib/studio/hex-color";

const FOCUS =
  "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

function fmt(value: number, step: number): string {
  const dec = step >= 1 ? 0 : step <= 0.01 ? 2 : 1;
  return value.toFixed(dec);
}

interface Props {
  param: Param;
  value: ParamValue;
  /**
   * Panel-level setter, keyed by param name. Receiving `(name, value)` (rather
   * than a per-param `(value)` arrow created at the call site) lets the parent
   * pass ONE stable callback to every control, so React.memo below actually
   * holds during a slider drag and only the dragged control re-renders.
   */
  onChange: (name: string, value: ParamValue) => void;
}

function ParamControlImpl({ param, value, onChange }: Props) {
  // Bind this control's name to the stable panel-level setter. Memoized on
  // [onChange, param.name] — both stable across renders — so the leaf handlers
  // below keep a stable identity and don't defeat the memo.
  const set = useCallback(
    (v: ParamValue) => onChange(param.name, v),
    [onChange, param.name],
  );
  switch (param.control) {
    case "range": {
      const v = typeof value === "number" && Number.isFinite(value) ? value : param.min;
      const def = typeof param.default === "number" ? param.default : param.min;
      return (
        <label className="block py-1.5">
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
            // B6 — surface the otherwise-hidden reset affordance (double-click or
            // Backspace restores the default) via a native tooltip. Unobtrusive:
            // no added visual clutter, and it folds into the slider's a11y name
            // via `aria-valuetext` already present above.
            title={`Double-click or press Backspace to reset to ${fmt(def, param.step)}`}
            onChange={(e) => {
              const n = parseFloat(e.target.value);
              if (Number.isFinite(n)) set(n);
            }}
            onDoubleClick={() => set(param.default)}
            onKeyDown={(e) => {
              if (e.key === "Backspace" || e.key === "Delete") {
                e.preventDefault();
                set(param.default);
              }
            }}
            className="mt-3 h-1 w-full cursor-ew-resize rounded-full bg-border outline-none"
          />
        </label>
      );
    }

    case "boolean": {
      const on = value === true;
      return (
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label={param.label}
          onClick={() => set(!on)}
          className={`flex w-full items-center justify-between rounded-md py-1 text-left ${FOCUS}`}
        >
          <span className="text-[13px] text-foreground/80">{param.label}</span>
          <span
            className={`relative h-6 w-11 shrink-0 rounded-full border transition-colors ${
              on ? "border-foreground/40 bg-foreground/25" : "border-border bg-secondary"
            }`}
          >
            {/* A4+C2 — crisp thumb slide. Scoped to `left`+`background-color`
               (not the flagged `transition-all`), ~160ms ease-out. CSS-only, so
               the reduced-motion backstop neutralises it. */}
            <span
              className={`absolute top-1/2 size-5 -translate-y-1/2 rounded-full transition-[left,background-color] duration-[160ms] ease-out ${
                on ? "left-[22px] bg-foreground" : "left-0.5 bg-muted-foreground"
              }`}
            />
          </span>
        </button>
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
              onChange={(e) => set(e.target.value)}
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
                    onClick={() => set(opt)}
                    className={`touch-target rounded-md border px-2 py-1 font-mono text-[11px] transition-colors ${FOCUS} ${
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
        <div className="flex items-center justify-between">
          <span className="text-[13px] text-foreground/80">{param.label}</span>
          <span className="flex items-center gap-2">
            {/* B5 — the hex is an editable, validated text field (was static
               text). Accepts #rgb/#rrggbb (and bare, mixed-case), normalizes to
               #rrggbb on commit, and falls back to the prior value on invalid
               blur. Commits through the same `set` → onChange(name,value) path
               so the live preview + URL state update identically to the swatch. */}
            <HexInput value={hex} label={param.label} onCommit={(c) => set(c)} />
            <Swatch color={hex} label={param.label} onChange={(c) => set(c)} />
          </span>
        </div>
      );
    }

    case "palette": {
      const colors = Array.isArray(value) ? value : ["#9ee7ff"];
      const setAt = (i: number, hex: string) => {
        const next = [...colors];
        next[i] = hex;
        set(next);
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

/**
 * Memoized so a slider drag re-renders only the dragged control, not every
 * sibling. The parent (control-panel) passes a stable `param` (from
 * `shader.params`), the per-param `value`, and ONE stable `onChange` setter, so
 * only the control whose `value` actually changed fails the shallow prop
 * comparison and re-renders.
 */
export const ParamControl = memo(ParamControlImpl);
ParamControl.displayName = "ParamControl";

/**
 * Editable, validated hex text field (B5). Locally controlled while focused so
 * the user can type freely; commits a normalized `#rrggbb` on Enter or blur via
 * `onCommit`. Invalid input on blur reverts to the last committed value (`value`
 * prop) so the field never holds a value the preview can't render. Stays
 * monochrome (mono-uppercase microtype, the shared focus ring).
 */
function HexInput({
  value,
  label,
  onCommit,
}: {
  value: string;
  label: string;
  onCommit: (hex: string) => void;
}) {
  // `draft` holds the in-flight text only WHILE editing; `null` means "show the
  // committed `value`". Deriving the displayed value this way (rather than
  // syncing `value`→state in an effect) means an external update — swatch pick,
  // preset load, URL-state restore — is reflected instantly with no effect and
  // never clobbers what the user is actively typing.
  const [draft, setDraft] = useState<string | null>(null);
  const display = draft ?? value;

  const commit = () => {
    const normalized = draft === null ? null : normalizeHex(draft);
    if (normalized && normalized !== value) onCommit(normalized);
    setDraft(null); // leave editing mode → fall back to the committed `value`
  };

  const invalid = draft !== null && draft.trim() !== "" && !isValidHex(draft);

  return (
    <input
      type="text"
      inputMode="text"
      spellCheck={false}
      autoCapitalize="off"
      autoCorrect="off"
      value={display}
      aria-label={`${label} hex value`}
      aria-invalid={invalid || undefined}
      maxLength={7}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          (e.target as HTMLInputElement).blur();
        } else if (e.key === "Escape") {
          e.preventDefault();
          setDraft(null);
          (e.target as HTMLInputElement).blur();
        }
      }}
      className={`w-[8.5ch] rounded-md border bg-transparent px-1.5 py-0.5 text-right font-mono text-[11px] uppercase tabular-nums text-muted-foreground outline-none focus:text-foreground ${FOCUS} ${
        invalid ? "border-foreground/40" : "border-transparent hover:border-border"
      }`}
    />
  );
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
