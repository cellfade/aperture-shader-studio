# Aperture — Motion, UX Polish & Quality Hardening — Product Requirements Document

> Status: **Draft** (scaffold written 2026-06-23; concrete enhancement inventory in §5 is
> populated from two read-only audits — a design/UX/motion audit and a code-quality/a11y/perf
> sweep — then this PRD is finalized and executed in gated agentic phases).
> Decisions locked with product owner: **Framer Motion** (`motion`) as the motion library;
> motion philosophy **subtle & precise**.

## 1. Overview

Aperture is a fully client-side WebGL shader studio: load a photo or video, run any
`@paper-design/shaders-react` shader over it, tune params live, compare before/after, and export
a full-resolution PNG, a frame ZIP, or a filtered H.264 MP4 — nothing ever leaves the browser.
Eight prior improvement phases (A–H) made it correct, fast, typed (`any`-free), tested (167
Vitest tests + a Playwright smoke + CI), accessible (WCAG-AA tokens, focusable disabled
controls, reduced-motion backstop), and feature-complete (presets + shareable URL state).

This initiative takes it from "solid" to **a modern best-practice web app with a smooth,
considered user experience**: a coherent, restrained motion system (Framer Motion), a full
UX/interaction polish pass, visual-design tightening, and a comprehensive QA/quality/a11y/perf
verification — all without betraying the minimal monochrome "optical lab" identity or
regressing the performance-sensitive WebGL preview and export pipelines.

## 2. Problem Statement

- **Current situation.** The app is functional and clean but largely *static*: state changes
  (shader switch, mode photo↔video, panel/preset reveal, export progress→success, notices)
  snap with no continuity. Interaction feedback is minimal. There is no motion system — only a
  CSS reduced-motion backstop and ad-hoc Tailwind transitions.
- **Pain points.** Without motion-as-continuity, the interface can feel abrupt and "unfinished"
  next to modern best-practice web apps; users lose spatial context across transitions; success
  and error moments lack the feedback that builds trust; the minimal aesthetic reads as "plain"
  rather than "precise."
- **Impact of not solving.** The product undersells its own sophistication. A WebGL shader lab
  whose *chrome* doesn't feel as smooth as its *output* is a credibility gap for the
  designer/creator audience it targets.

## 3. Goals & Non-Goals

### Goals
- [ ] **A coherent motion system** built on Framer Motion: a small set of tokens (durations,
      easings, distances) and reusable primitives, applied consistently. Subtle & precise:
      micro-interactions ~120–280ms; exactly **one** orchestrated "hero moment."
- [ ] **`prefers-reduced-motion` honored everywhere** — every animation has a reduced/none path;
      reduced-motion users get instant, non-disorienting state changes (verified, not assumed).
- [ ] **No performance regression**: live WebGL preview holds ≥ its current frame rate;
      filtered-MP4/PNG/ZIP export timing, the readback gate, and frame-buffer discipline are
      **byte-for-byte behavior-identical** (verified by live PNG+MP4 export smoke each phase).
- [ ] **Motion JS budget**: incremental client JS from the motion library ≤ ~18KB gzip on the
      initial route (use Framer Motion's `LazyMotion` + `m` to tree-shake; lazy-load heavy
      features). Build's initial route JS must not regress beyond this.
- [ ] **UX polish**: every state has a designed loading / empty / error / disabled / success
      treatment; focus order and touch targets meet best practice; microcopy is tightened.
- [ ] **Visual-design refinement**: spacing/rhythm/hierarchy/typographic-scale tightened within
      the monochrome identity (no chromatic chrome introduced).
- [ ] **Comprehensive QA**: gates stay green (`eslint` 0 / `tsc` / `npm test` / `next build`),
      zero `any`, `npm audit` reviewed; a live **axe-core** pass shows **0 serious/critical**
      violations; expanded automated tests cover the new behaviors.
- [ ] **Quality bar verified live**: each phase passes a Playwright functional smoke (incl.
      export) AND a screenshot design check confirming the minimal aesthetic is intact.

### Non-Goals
- **No GSAP** (no skill/MCP support; Framer Motion chosen). No second motion library.
- **No cinematic/decorative choreography** — expressly out of scope per the chosen direction.
- **No re-theming / color introduction** — monochrome optical-lab identity is preserved.
- **No new product features** beyond what UX polish implies (no new shaders, no accounts, no
  backend). Presets/URL-state already shipped; this is polish + quality, not scope growth.
- **No animating over the live shader canvas or during export render** (perf-sensitive zones).
- **Not** migrating mp4-muxer→Mediabunny (#38), VFR timestamps (#15), or Tailwind purge (#39) —
  those remain documented-deferred unless an audit elevates one with evidence.

## 4. Motion System (specification)

The system is the deliverable, not a pile of one-off animations. All motion derives from these.

### 4.1 Tokens (single source of truth)
Define once (a `lib/studio/motion.ts` module exporting typed constants + Framer variants, and/or
CSS custom properties in `app/globals.css` for any CSS-driven motion). Indicative values
(final values tuned during build):

- **Durations**: `instant 0`, `fast 0.12s`, `base 0.18s`, `slow 0.28s`, `hero ≤0.6s` (the one
  orchestrated moment only).
- **Easings**: a standard ease-out `[0.22, 1, 0.36, 1]` (entrances/most UI), a symmetric
  ease-in-out for moves/crossfades, a tiny spring only where a control "settles" (toggles).
- **Distances**: reveal offsets small (4–10px) — precise, not "flying in."
- **Stagger**: ≤ 30–40ms between siblings, capped total; used sparingly (one group reveal).

### 4.2 Reduced motion (hard requirement)
- Wrap the app (or studio subtree) in Framer Motion `MotionConfig reducedMotion="user"`.
- Every animated component reads `useReducedMotion()` (the SSR-safe hook already exists at
  `lib/studio/use-media-query.ts`) and collapses to opacity-only or instant — **never**
  translate/scale/large-movement under reduced motion. Keep the existing global CSS backstop.
- Reduced-motion is part of the test plan and the axe/QA gate, not an afterthought.

### 4.3 Bundle discipline
- Use `LazyMotion` + the `m` component (not the full `motion`) so only used features ship;
  load the `domAnimation` feature bundle, escalate to `domMax` only if `layout` is needed.
- No motion on the SSR critical path that would cause hydration mismatch (lessons from the
  Phase-H URL-state #418 fix: never read client-only/layout state during render).

### 4.4 Principles (from the design-taste / make-it-feel-better lens)
- Motion communicates **continuity and causality**, not decoration. If an animation doesn't
  help the user understand *what changed* or *that their action registered*, cut it.
- One hero moment; everything else recedes. (Chanel's "remove one accessory" rule.)
- Never animate layout in a way that causes CLS or shifts focus targets under the pointer.
- 60fps or don't ship it; never compete with the WebGL canvas for the main thread.

## 5. Enhancement Inventory (populated from audits — leverage-ordered)

> Filled from the design/UX/motion audit and the code-quality/a11y/perf sweep. Each item:
> surface · what · why · effort (S/M/L) · risk · reduced-motion handling · phase.

_TBD — synthesized when both audits return; the single "hero moment" is named here._

## 6. Functional / UX Requirements

> Detailed acceptance criteria per accepted enhancement are written here once §5 is populated.
> Every motion requirement includes its reduced-motion behavior as explicit acceptance criteria.

## 7. Non-Functional Requirements
- **Performance**: live preview frame rate ≥ baseline; export timing within noise of baseline
  (live PNG + MP4 smoke each phase); initial-route JS within the motion budget (§ Goals);
  no new long tasks > 50ms introduced on interaction.
- **Accessibility**: WCAG 2.2 AA; live axe-core 0 serious/critical; full keyboard operability
  preserved; reduced-motion verified; focus visible and order logical through all transitions.
- **Quality gates** (every phase, non-negotiable): `npx eslint .` = 0 · `npx tsc --noEmit`
  clean · `npm test` all green · `npx next build` success · zero `any` · no stray `console.*`.
- **Privacy**: the "nothing leaves the browser" guarantee is preserved (no telemetry, no media
  egress); URL state continues to exclude image/video.
- **Compatibility**: Chromium-class evergreen browsers (WebCodecs/WebGL already required);
  graceful degradation messaging already present for unsupported export.

## 8. Technical Approach
- Add `motion` (Framer Motion) pinned exactly (`.npmrc` save-exact). Centralize tokens/variants
  in `lib/studio/motion.ts`; wrap with `MotionConfig` + `LazyMotion`.
- Apply motion at component seams without touching export/render-core logic. The off-screen
  render cores, `lib/studio/video-export/*`, the readback gate, and frame-buffer discipline are
  **out of scope for edits** — motion lives in the visible chrome only.
- Reuse existing infra: `useReducedMotion`, the monochrome tokens, the `FOCUS` ring, the
  one-shot keyed-mount contract, the URL-state hydration pattern.
- Tests: unit/RTL for new interactive components + reduced-motion branches; extend the
  Playwright smoke to assert the export flows still work and (optionally) drive an axe pass.

## 9. Execution Plan (gated agentic phases)
Same methodology as phases A–H: each phase is dispatched to an agent, must pass the full gate
(eslint/tsc/test/build) + a live PNG+MP4 export smoke + a screenshot design check, then is
committed → auto-deployed to `main` (cellfade/Vercel). Phases are sequenced to minimize churn:

- **Phase I — Motion foundation & QA baseline.** Install Framer Motion (LazyMotion/MotionConfig),
  author `lib/studio/motion.ts` tokens+variants, wire reduced-motion, add an axe-core pass to the
  e2e setup. Land any HIGH-confidence quick fixes the QA sweep surfaces. Establish the perf/JS
  baseline numbers. No visible motion yet beyond proving the plumbing on one low-risk surface.
- **Phase J — Core micro-interactions.** Apply the system to the highest-leverage component
  surfaces (controls, mode toggle, shader switch, preset apply already tweens — align it to the
  system, notices/toasts, drag-drop affordance). Subtle, fast, reduced-motion-correct.
- **Phase K — The hero moment + reveals.** Implement the single orchestrated moment + tasteful
  entrance/transition reveals (masthead, panel/section, photo-loaded). Restraint enforced.
- **Phase L — UX & visual-design polish.** State treatments (loading/empty/error/success),
  microcopy, spacing/rhythm/hierarchy refinements, touch targets/responsive nits from §5.
- **Phase M — Comprehensive QA & verification.** Full axe pass (0 serious/critical), perf
  re-measure vs baseline, expanded automated tests, cross-viewport screenshot review, final
  regression smoke of all export paths. Update `AGENTS.md`/docs.

(Phases may merge/split once §5 is finalized; the gate and live-verify discipline is fixed.)

## 10. Success Metrics
| Metric | Baseline (pre-I) | Target | How measured |
|--------|------------------|--------|--------------|
| Quality gates green | green (167 tests) | green (expanded) | eslint/tsc/test/build in CI |
| `any` count (app/components/lib) | 0 | 0 | grep |
| axe serious/critical violations (live) | _measure in I_ | 0 | @axe-core/playwright |
| Initial-route JS (gzip) | _measure in I_ | ≤ baseline + ~18KB | `next build` output |
| Live-preview frame rate | baseline | ≥ baseline | manual/perf trace |
| Export behavior (PNG/MP4) | byte-valid | unchanged | live smoke each phase |
| Reduced-motion correctness | backstop only | every animation has a path | test + manual |
| Surfaces with designed state treatments | partial | loading/empty/error/success all covered | review |

## 11. Open Questions
- [ ] Does any surface genuinely need `layout` animations (→ `domMax` feature bundle, larger)?
      Default assumption: no; opacity/transform variants suffice.
- [ ] Is `LazyMotion` sufficient, or is a route-level dynamic import of motion-heavy components
      warranted to protect first paint? Decide from the Phase-I JS measurement.
- [ ] Which single surface is the "hero moment"? (Named in §5 from the design audit.)

## 12. Appendix
- Prior program: `plans/README.md` (Phases A–H), `plans/audit-findings.md` (45-item backlog +
  deferred items). Related PRDs: `docs/prds/2026-06-18-aperture-shader-studio.md`,
  `…-video-frame-capture.md`, `…-filtered-video-export.md`.
- Skills applied: design-taste (`frontend-design`), `make-interfaces-feel-better`,
  `ui-ux-pro-max`, `web-design-guidelines`, `senior-frontend`, `react-best-practices`,
  `performance-optimization`, `code-review`, `security-review`, `testing-strategy`,
  `webapp-testing`. Inspiration MCPs available: Magic (21st.dev), Mobbin.
