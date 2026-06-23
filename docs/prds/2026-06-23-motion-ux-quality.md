# Aperture — Motion, UX Polish & Quality Hardening — Product Requirements Document

> Status: **Final** (2026-06-23). §5/§6 synthesized from two read-only audits (a design/UX/motion
> audit and a code-quality/a11y/perf sweep); executing in gated agentic phases I→M.
> Decisions locked with product owner: **Framer Motion** (`motion`) as the motion library;
> motion philosophy **subtle & precise**. Hero moment: **A1** (shader-switch crossfade + wipe).

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

## 5. Enhancement Inventory (synthesized from both audits — leverage-ordered)

> Verdict from the design audit: this is already a disciplined, on-brand build (monochrome
> identity consistent, reduced-motion genuinely wired, focus rings + `tabular-nums` present,
> memoization thoughtful). The work is **promotion, not rescue** — one hero moment + precise
> polish. The QA sweep verified gates green / `any`-free / pipelines healthy and surfaced one
> real bug (boolean toggle) — **already fixed & shipped** (commit `f27a5d5`, +2 tests).

**THE HERO MOMENT → `A1`: shader-switch preview crossfade + a single one-pass "exposure
wipe."** The preview *is* the product; this is the only orchestrated beat the subtle-precise
direction spends its boldness on. Everything else stays a whisper.

Legend: phase · effort (S/M/L) · risk · RM = needs reduced-motion path · lib = needs Framer
Motion (else CSS-only).

| ID | Surface — what | Why it elevates | Phase | Eff | Risk | RM | lib |
|----|----------------|-----------------|-------|-----|------|----|----|
| **A1** | Preview: `AnimatePresence` crossfade (fade+scale .985→1, ~220/160ms) on `shader.id` + one hairline white "exposure" wipe | **Hero.** Tool feels like an instrument re-exposing a plate, not a page re-rendering | L | M | **M** (D1) | yes | yes |
| **B1** | Touch targets <44px: mode toggle (23px), footer btns (17px), type segmented (27px), chips (36px) → 44px hit area on coarse pointers | Accessibility-first; pure win, no aesthetic cost | J | S | low | – | no |
| **A7** | Export button: indeterminate 1px hairline shimmer while `working`; single checkmark draw-on (`pathLength`) + "Downloaded ✓" dwell on done | The payoff currently reads as "nothing happened" | L | M | **M** (D2) | yes | yes (check) |
| **B2** | Video-mode-before-video: suppress/relabel stale photo-frame actions (Download PNG / Recapture shown with no video; stale "sample.jpg" status) | Removes a genuinely confusing state | M | S–M | low | – | no |
| **A3** | Compare handle: `scale(.94)` + glow on `pointerdown`, spring back (`bounce:0`, 120ms) | Signature interaction should feel physical | J | S | low | yes* | no |
| **B4** | Gate the compare auto-sweep to the FIRST photo of a session only (not every load/replace) | Stops a hero animation becoming a repetitive tic | J | S | low | done | no |
| **A4+C2** | Switch thumb: replace `transition:all` with `transition-[left,background-color]` 160ms; crisp slide | Fixes flagged anti-pattern; polishes most-touched control | J | S | low | * | no |
| **C1+C6** | Concentric-radius audit (inner = outer − padding at `p-5`) + normalize off-grid spacing (3.5/2.5 → 4/8/12/16) | Cheapest "feels more expensive"; minimal design lives on this | J | S | none | – | no |
| **A2** | Mode photo↔video: cross-dissolve stage contents + `layout` height/aspect settle (~240ms) | Modes read as peers ("same stage, different source") | K | M | M | yes | yes |
| **A5** | Control-panel sections (Presets/Adjust/Color) fade+rise w/ ~60–80ms stagger on `shader.id` change (reuse `@keyframes rise`) | Turns a content-dump into "new instrument loaded" | K | S–M | low | yes | opt |
| **A6** | Notice/status: subtle fade+slide-in (4px, 180ms) + soft fade-out via `AnimatePresence` (stays inline, not a floating toast) | Status changes are currently easy to miss | K | S | low | yes | yes |
| **A8** | Drag-drop: fade dashed overlay in (120ms) + drop settle 1.0→.98→1.0 (chrome only, never canvas) | Polishes the ingest affordance | J | S | low | yes* | no |
| **A9** | Masthead: one-time `opacity 0→.6` develop-in on first paint (400ms); otherwise leave the running MeshGradient alone | Page "develops" — a darkroom nod that costs nothing | K | S | low | yes | opt |
| **C3** | Compare "before" `<img>`: add 1px `outline-white/10` so before/after read as one plane | Depth consistency (make-it-feel-better #11) | J | S | none | – | no |
| **C4+C5** | One intermediate display step for active-shader name (15→17px); `text-wrap:pretty` on hero `<p>` + shader blurb | Tightens mid-tier hierarchy; kills orphans | J | S | low | – | no |
| **B5** | Color inputs: make the hex string an editable, validated text field (not static) | Power-user expectation | M | M | low | – | no |
| **B3** | Mode radiogroup arrow keys can silently discard preview context; prevent incidental focus / consider undo | Prevents accidental destructive switch | M | S | low | – | no |
| **B6** | Slider double-click/Backspace-resets-to-default is undiscoverable → add a hint/affordance | Discoverability | M | S | none | – | no |
| **B7** | Sequence "Frames" number field (14px, touch-hostile) → +/− steppers or wider | Mobile usability | M | S | low | – | no |
| **B8** | Microcopy: "Download PNG"→"Downloaded ✓" (verb consistency); "Or try a sample"→parallel phrasing | Copy as design material | J | S | none | – | no |
| **C7** | Verify (no change): `--muted-foreground` 8.1:1 holds; watch 10px mono labels over `backdrop-blur` at runtime (axe) | Guard against token drift | M | 0 | – | – | no |

\* covered by the existing global reduced-motion CSS backstop for CSS-only transitions; JS-driven
(`AnimatePresence`) items must additionally consume `useReducedMotion()` and hard-cut (D5).

**Do-not-touch (from the QA sweep's regression list):** the off-screen render cores + export
pipeline timing (`minSettle/maxWait/grace` constants), the readback content-change gate
(`hasChanged`/`markPresented`), `VideoFrame.close()` discipline, the URL-state one-shot post-mount
hydration (#418 guard), and the focusable `aria-disabled` export-button pattern. **Never animate
over the live WebGL canvas or the export render path** (D1/D2).

## 6. Functional / UX Requirements (acceptance criteria)

Every motion item's acceptance includes its reduced-motion behavior. Representative criteria
(full set tracked per phase; all share the §7 gate):

- **FR-A1 (hero).** Given a loaded photo, when the user switches shaders, the outgoing preview
  fades/scales out while the incoming fades/scales in over ~220ms (exit softer at ~160ms), with
  a single left→right 1px white wipe; at most one transition in flight; **both WebGL canvases
  coexist only for the overlap (~220ms), never longer**; live-preview FPS is unaffected after
  settle. **Reduced motion:** hard cut, no overlap, no wipe. Verified live (FPS + PNG/MP4 smoke).
- **FR-B1.** All interactive controls expose a ≥44px hit area on coarse pointers (visual size may
  stay); verified by measuring `getBoundingClientRect` at 390px on the mode toggle, footer
  buttons, segmented controls, and chips.
- **FR-A7.** While exporting, a 1px monochrome hairline shimmer indicates indeterminate progress
  on the **visible button only** (never the off-screen renderer); on success a single checkmark
  draws on then dwells ~1.6s as "Downloaded ✓". **Reduced motion:** static "Rendering…" + no
  draw-on. Export timing/readback/frame-buffer behavior is byte-identical (live smoke).
- **FR-B2.** In video mode before a video is loaded, photo-frame actions are suppressed or
  clearly relabeled and the status communicates what "Download" applies to.
- **FR-B4.** The orchestrated compare sweep runs only on the first photo of a session; later
  loads settle at rest.
- **FR-(A3/A4/A8/C1/C3/C4/C5/C6/B8).** CSS-only polish; the global reduced-motion backstop covers
  transition neutralization; no new chroma; concentric radii and on-grid spacing verified.
- **Cross-cutting reduced-motion (FR-RM).** With `prefers-reduced-motion: reduce`, no
  translate/scale/large-movement animation plays anywhere; state changes are instant or
  opacity-only; the axe pass and a reduced-motion manual check are part of Phase M.

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

- **Phase I — Motion foundation & QA baseline.** Install `motion` (pinned), author
  `lib/studio/motion.ts` (tokens + reusable variants), wrap the studio subtree in
  `MotionConfig reducedMotion="user"` + `LazyMotion`/`m`, add an `@axe-core/playwright` pass to
  the e2e setup, and record the perf/JS baseline (initial-route JS, a preview FPS reference).
  Prove the plumbing on ONE low-risk surface (A6 notice or A9 masthead develop-in). (Boolean-bug
  QA fix already shipped pre-I.)
- **Phase J — CSS-only polish & a11y (no library risk).** B1 touch targets, A3 compare-grab,
  A4+C2 switch thumb (kill `transition:all`), A8 drag-drop affordance, B4 first-load sweep gate,
  C1+C6 concentric radius + spacing, C3 photo outline, C4+C5 type/orphans, B6 reset hint, B8
  microcopy. Highest-leverage, lowest-risk; no new dependency in play.
- **Phase K — Framer Motion micro-interactions.** A2 mode crossfade + `layout` settle, A5
  staggered control-group reveal, A6 notice entrance (if not in I), A9 masthead develop-in (if
  not in I). Subtle, reduced-motion hard-cut, ≤ JS budget.
- **Phase L — The hero moment + export beat (perf-sensitive).** A1 shader-switch crossfade +
  exposure wipe and A7 export progress shimmer + completion check. Built carefully against D1/D2:
  one transition in flight, canvases coexist only for the overlap, shimmer on visible DOM only.
  Verified with an FPS check + full PNG/MP4 export smoke.
- **Phase M — UX state clarity + comprehensive QA.** B2 video-mode state, B3 arrow-key guard,
  B5 editable hex, B7 frames stepper, C7 verify; then full axe pass (0 serious/critical), perf
  re-measure vs the Phase-I baseline, expanded automated tests, cross-viewport screenshot review,
  full export regression smoke, and docs (`AGENTS.md`) update.

(The gate + live-verify discipline is fixed; CSS-only work is front-loaded to de-risk the library.)

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
