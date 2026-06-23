"use client";

import { m } from "motion/react";
import { DURATIONS, EASINGS } from "@/lib/studio/motion";
import { useReducedMotion } from "@/lib/studio/use-media-query";

/**
 * A7 — export progress + quiet completion beat.
 *
 * These two presentational pieces live on the VISIBLE export button DOM ONLY and
 * are entirely DECOUPLED from the off-screen ExportRenderer / render path (D2):
 * they read only the button's display status, never the renderer's internals,
 * and add no animation to any off-screen render node. Export timing, the
 * readback gate, and frame-buffer discipline are untouched.
 */

/** Checkmark draw-on duration (seconds). ~260ms per spec — within `slow`. */
const CHECK_DRAW = DURATIONS.slow - 0.02; // 0.26s

/**
 * The indeterminate hairline shimmer shown along the button's bottom edge while
 * an export is `working`. CSS-driven (covered by the reduced-motion backstop),
 * but gated here too so reduced-motion users get NO shimmer element at all —
 * just the static "Rendering…" label. Render inside a `relative` button.
 */
export function ExportShimmer() {
  const reduced = useReducedMotion();
  if (reduced) return null;
  return <span aria-hidden className="export-shimmer" />;
}

/**
 * A single checkmark that draws on (`pathLength 0→1`, ~260ms ease-out) on a
 * successful export, then settles. The parent keeps it mounted for the ~1.6s
 * "Downloaded ✓" dwell. Under reduced motion the check is shown fully drawn with
 * no draw-on animation (FR-A7).
 *
 * `pathLength` is part of the `domAnimation` feature bundle, so this stays on
 * the current budget (no `domMax`).
 */
export function ExportCheck() {
  const reduced = useReducedMotion();
  return (
    <m.svg
      aria-hidden
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0"
    >
      <m.path
        d="M5 13l4 4L19 7"
        initial={reduced ? { pathLength: 1 } : { pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={
          reduced
            ? { duration: DURATIONS.instant }
            : { duration: CHECK_DRAW, ease: EASINGS.easeOut }
        }
      />
    </m.svg>
  );
}
