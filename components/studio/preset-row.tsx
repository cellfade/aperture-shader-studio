"use client";

import { useCallback, useEffect, useRef } from "react";
import type { ParamValues, Shader } from "@/lib/studio/registry";
import { presetsFor, valuesMatchPreset } from "@/lib/studio/presets";
import { PRESET_TWEEN_MS, tweenValues } from "@/lib/studio/tween";
import { useReducedMotion } from "@/lib/studio/use-media-query";

const FOCUS =
  "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

interface Props {
  shader: Shader;
  values: ParamValues;
  /** Writes the full param set (same path the panel uses) — URL + preview update. */
  onReplaceValues: (values: ParamValues) => void;
}

export function PresetRow({ shader, values, onReplaceValues }: Props) {
  const presets = presetsFor(shader.id);
  const reduced = useReducedMotion();

  // rAF tween bookkeeping. `rafRef` holds the live frame handle; clearing it
  // cancels the animation. `latestValuesRef` lets the loop detect that an
  // outside change (slider drag, shader switch) landed mid-tween and bail.
  const rafRef = useRef<number | null>(null);
  const latestValuesRef = useRef(values);
  // The exact object the tween loop last wrote — lets the loop tell its own
  // updates apart from an outside edit (a slider drag) that landed mid-tween.
  const lastWrittenRef = useRef<ParamValues | null>(null);
  useEffect(() => {
    latestValuesRef.current = values;
  }, [values]);

  const cancel = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    lastWrittenRef.current = null;
  }, []);

  // Cancel any in-flight tween if the shader changes or on unmount.
  useEffect(() => cancel, [cancel, shader.id]);

  const apply = useCallback(
    (target: ParamValues) => {
      cancel();
      const from = { ...latestValuesRef.current };

      if (reduced) {
        onReplaceValues({ ...from, ...target });
        return;
      }

      const start = performance.now();
      const frame = (now: number) => {
        // If the live values aren't the ones we last wrote, an outside edit (a
        // slider drag) interrupted the tween — bail and leave it where it is.
        if (
          lastWrittenRef.current !== null &&
          latestValuesRef.current !== lastWrittenRef.current
        ) {
          cancel();
          return;
        }
        const t = Math.min(1, (now - start) / PRESET_TWEEN_MS);
        const next = tweenValues(shader, from, target, t);
        lastWrittenRef.current = next;
        onReplaceValues(next);
        if (t < 1) {
          rafRef.current = requestAnimationFrame(frame);
        } else {
          rafRef.current = null;
          lastWrittenRef.current = null;
        }
      };
      rafRef.current = requestAnimationFrame(frame);
    },
    [cancel, reduced, shader, onReplaceValues],
  );

  if (presets.length <= 1) return null;

  return (
    <div className="mb-5">
      <h3 className="mb-2.5 font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
        Presets
      </h3>
      <div
        className="flex flex-wrap gap-1.5"
        role="group"
        aria-label="Shader presets"
      >
        {presets.map((preset, i) => {
          const active = valuesMatchPreset(values, preset);
          return (
            <button
              key={`${preset.name}-${i}`}
              type="button"
              aria-pressed={active}
              onClick={() => apply(preset.values)}
              className={`rounded-md border px-2.5 py-2 text-[12px] transition-colors sm:py-1.5 ${FOCUS} ${
                active
                  ? "border-foreground/30 bg-foreground/10 text-foreground"
                  : "border-border bg-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {preset.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}
