/**
 * The `domAnimation` feature bundle, isolated in its own module so `LazyMotion`
 * can code-split it OFF the initial route (PRD §4.3 / open-question #2). The `m`
 * component on the critical path is tiny; the animation features (the bulk of
 * the library weight) load asynchronously after first paint, keeping the
 * initial-route JS within the ≤18KB-gzip motion budget. `LazyMotion`'s
 * `features={() => import(...)}` form expects the default export to be the
 * feature definition.
 */
import { domAnimation } from "motion/react";

export default domAnimation;
