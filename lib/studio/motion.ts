/**
 * Motion system — single source of truth (PRD §4.1).
 *
 * Every animation in the app derives its timing, easing, and movement from the
 * tokens below. Components must NOT scatter magic numbers; import from here so
 * the system stays coherent and tunable in one place.
 *
 * Philosophy (PRD §4.4): subtle & precise. Motion communicates continuity and
 * causality, never decoration. Reveal offsets are small (4–10px), durations are
 * short (≤280ms for micro-interactions), and exactly one orchestrated "hero"
 * beat (≤600ms) is reserved for the preview crossfade in a later phase.
 *
 * Reduced motion (PRD §4.2): the Studio subtree is wrapped in
 * `<MotionConfig reducedMotion="user">`, and animated components additionally
 * read `useReducedMotion()` to collapse to opacity-only / instant — never
 * translate/scale under reduced motion. The `reduced*` helpers below build those
 * hard-cut variants from the same source tokens.
 *
 * Types are kept loose-but-precise (`Variants`/`Transition` from `motion/react`)
 * so variant objects stay assignable to `m.*` props without casts.
 */
import type { Transition, Variants } from "motion/react";

/** Durations in seconds (Framer Motion expresses time in seconds, not ms). */
export const DURATIONS = {
  /** No animation — used for the reduced-motion hard cut. */
  instant: 0,
  /** Tightest feedback (hover, small toggles). */
  fast: 0.12,
  /** Default micro-interaction (most entrances/exits). */
  base: 0.18,
  /** Deliberate moves (panel reveals, settles). */
  slow: 0.28,
  /** The single orchestrated hero beat (preview crossfade). Cap, not a default. */
  hero: 0.6,
} as const;

/** Cubic-bezier easing curves + the one spring spec for "settle" interactions. */
export const EASINGS = {
  /** Standard ease-out for entrances and most UI. */
  easeOut: [0.22, 1, 0.36, 1],
  /** Symmetric ease-in-out for moves and crossfades. */
  easeInOut: [0.65, 0, 0.35, 1],
  /**
   * A non-overshooting "settle" spring (bounce 0) for controls that snap back
   * to rest — physical without wobble. Use sparingly (toggles, grab handles).
   */
  settle: { type: "spring", bounce: 0, duration: DURATIONS.slow } satisfies Transition,
} as const;

/** Small reveal offsets in px — precise, not "flying in" (PRD §4.1). */
export const DISTANCES = {
  /** The notice/status nudge. */
  xs: 4,
  /** Default reveal rise. */
  sm: 6,
  /** Largest allowed reveal offset. */
  md: 10,
} as const;

/** Stagger between sibling reveals — capped, used sparingly (one group). */
export const STAGGER = {
  /** Per-child delay. */
  step: 0.035,
  /** Total cap so a long list never feels slow. */
  max: 0.16,
} as const;

const easeOutBase: Transition = {
  duration: DURATIONS.base,
  ease: EASINGS.easeOut,
};

/**
 * Opacity-only fade. Safe under reduced motion as-is (no transform), so it is
 * its own reduced variant.
 */
export const fade: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: easeOutBase },
  exit: { opacity: 0, transition: { duration: DURATIONS.fast, ease: EASINGS.easeOut } },
};

/**
 * Fade + a small upward rise (default reveal). Enters at `base`, exits softer at
 * `fast` with no movement so dismissal never tugs the eye.
 */
export const fadeRise: Variants = {
  hidden: { opacity: 0, y: DISTANCES.xs },
  visible: { opacity: 1, y: 0, transition: easeOutBase },
  exit: { opacity: 0, transition: { duration: DURATIONS.fast, ease: EASINGS.easeOut } },
};

/**
 * Symmetric crossfade for swapping one element for another in place (e.g. mode
 * or content swaps). Pair with `AnimatePresence mode="popLayout"` or `"wait"`.
 */
export const crossfade: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { duration: DURATIONS.slow, ease: EASINGS.easeInOut },
  },
  exit: {
    opacity: 0,
    transition: { duration: DURATIONS.base, ease: EASINGS.easeInOut },
  },
};

/**
 * Reduced-motion counterpart of any fade+transform variant: opacity-only, same
 * timing, NO translate/scale. Components select this when `useReducedMotion()`
 * is true. (Plain `fade` is already reduced-safe; this exists so callers using
 * `fadeRise`/`crossfade` have a drop-in hard-cut with identical state keys.)
 */
export const reducedFade: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: easeOutBase },
  exit: { opacity: 0, transition: { duration: DURATIONS.fast, ease: EASINGS.easeOut } },
};

/**
 * Pick the appropriate variant for a fade+rise surface given the user's
 * reduced-motion preference. Returns the opacity-only variant under reduced
 * motion so no transform ever plays.
 */
export function fadeRiseVariants(reducedMotion: boolean): Variants {
  return reducedMotion ? reducedFade : fadeRise;
}
