"use client";

import { LazyMotion, MotionConfig } from "motion/react";

/**
 * Async feature loader — code-splits the `domAnimation` bundle off the initial
 * route. `LazyMotion` calls this once on the client after mount and resolves the
 * default export to the feature definition.
 */
const loadFeatures = () =>
  import("@/components/studio/motion-features").then((mod) => mod.default);

/**
 * Wraps the Studio subtree so every downstream `m.*` component gets:
 *
 * - **`LazyMotion features={loadFeatures}`** — async-loads only the
 *   `domAnimation` feature bundle (opacity/transform/AnimatePresence), and does
 *   so via a dynamic import so the bundle is code-split OFF the initial route,
 *   keeping the incremental critical-path JS under the §4.3 budget. Using the
 *   lightweight `m` component instead of `motion` is what makes this work;
 *   `domMax` (for `layout` animations) is intentionally deferred to a later
 *   phase that actually needs it. `strict` makes any accidental full-`motion`
 *   usage throw in dev so we can't silently regress the bundle.
 * - **`MotionConfig reducedMotion="user"`** — the framework-level honoring of
 *   `prefers-reduced-motion`; combined with each component reading
 *   `useReducedMotion()` to pick an opacity-only variant (PRD §4.2).
 *
 * No hydration risk: this provider renders identical markup on server and
 * client (it reads no client-only/layout state during render — see the #418
 * lesson), and `MotionConfig`/`LazyMotion` emit no DOM of their own. The
 * reduced-motion preference is resolved by Framer Motion at animation time on
 * the client, not during SSR render.
 */
export function MotionProvider({ children }: { children: React.ReactNode }) {
  return (
    <MotionConfig reducedMotion="user">
      <LazyMotion features={loadFeatures} strict>
        {children}
      </LazyMotion>
    </MotionConfig>
  );
}
