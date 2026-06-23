<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Aperture — agent guide

A fully client-side shader studio: load a photo or video, run any
[`@paper-design/shaders-react`](https://shaders.paper.design/) shader over it,
tune params live, and export a PNG / frame ZIP / filtered MP4. Nothing is
uploaded — every pixel stays in the browser.

Stack: **Next.js 16** (App Router), **React 19**, **TypeScript (strict)**,
**Tailwind v4**. The chrome is intentionally **monochrome**; the only color on
the page comes from the shaders themselves.

## Verify before you finish

All four must pass — this is the completion gate:

```bash
npx eslint .        # 0 problems (there is no `next lint` — it was removed; use eslint)
npx tsc --noEmit    # clean  (or: npm run typecheck)
npx next build      # succeeds
npm test            # vitest run — unit/component tests, all green
```

`npm run lint:fix` is available for autofixable lint.

Tests: **Vitest + Testing Library** drive the pure-logic + presentational-
component suites (`*.test.ts[x]` co-located next to source; `vitest.config.ts`,
`vitest.setup.ts`). The WebGL render cores are NOT unit-tested (paper-shaders
needs a real GL context jsdom can't provide) — they're covered by the
**Playwright** smoke test (`e2e/smoke.spec.ts`, run with `npm run test:e2e`),
which loads the sample photo, applies the dithering filter, and asserts a real
PNG download with zero console errors. `playwright.config.ts`'s `webServer`
builds + starts the app automatically. CI runs all of this on every push/PR via
`.github/workflows/ci.yml` (a `verify` job for lint/typecheck/build/test and a
separate `e2e` job for the Playwright smoke).

## Architecture

- **`components/studio/studio.tsx`** — the orchestrator. Owns mode (`photo` /
  `video`), the loaded image/video, shader selection + per-shader param values,
  drag-drop/paste ingest, and export orchestration. It mounts the off-screen
  render pipelines on demand.
- **Photo pipeline** — `shader-view.tsx` renders the live preview;
  `compare-slider.tsx` is the before/after seam; `export-renderer.tsx` mounts a
  dedicated full-res instance off-screen, waits for a real drawn frame
  (readback gate, not a timer), and downloads a PNG.
- **Video pipeline** — `video-stage.tsx` handles scrub/step/capture, the
  sequence (frames→ZIP) panel, and the MP4 export controls.
  `video-export/frame-renderer.tsx` is the imperative per-frame render core.
- **Export pipeline (filtered MP4)** — `lib/studio/video-export/`:
  `frame-source.ts` (MP4Box demux + WebCodecs `VideoDecoder`) →
  `encode-filtered-video.ts` (orchestrator; drives `FrameRenderer` via a
  detached React root) → `encoder.ts` (WebCodecs `VideoEncoder` + mp4-muxer).
  Frame-buffer discipline: **every `VideoFrame` is closed** or WebCodecs stalls.
- **`lib/studio/`** — `registry.ts` (catalog → normalized shader params, the
  `getComponent` registry lookup into the paper-shaders map), `download.ts`
  (`clampToMaxSide`, `sanitizeFilename`, `downloadBlob`), `render-readiness.ts`
  (the readback/content gate), `use-media-query.ts` (SSR-safe
  `useReducedMotion`), `capture-frame.ts`, `zip-frames.ts`.
- The shader catalog is data: `lib/shader-catalog.json` drives all controls.

## Conventions

- **Client-only.** Studio components are `"use client"`; nothing touches the
  network for media. Object URLs are revoked on replace/unmount.
- **Monochrome tokens.** Use the CSS variables in `app/globals.css`
  (`--foreground`, `--muted-foreground`, `--card`, `--border`, `--ring`, …).
  Keep text ≥4.5:1 (WCAG AA). Don't introduce chromatic chrome.
- **Mono-uppercase microtype labels** (`font-mono text-[10px/11px] uppercase
  tracking-[…]`) and the shared `FOCUS` focus-ring constant.
- **Reduced motion** via `useReducedMotion()` from `lib/studio/use-media-query.ts`
  (`useSyncExternalStore`, SSR-safe — do not reintroduce a setState-in-effect
  matchMedia hook).
- **`@paper-design/shaders-react` is pinned exactly at `0.0.x`** — it ships
  breaking changes under patch versions. `.npmrc` sets `save-exact=true`; keep
  new deps pinned.

## Motion system (Phases I–M)

Motion is a **system**, not ad-hoc animations — all of it derives from one
module and obeys a hard performance/accessibility budget.

- **Tokens + variants live in `lib/studio/motion.ts`** (the single source of
  truth): `DURATIONS` (instant/fast 0.12 / base 0.18 / slow 0.28 / hero ≤0.6s),
  `EASINGS` (`easeOut`, `easeInOut`, a non-overshoot `settle` spring), `DISTANCES`
  (4–10px reveal offsets), `STAGGER`, and ready-made `Variants` (`fade`,
  `fadeRise`, `crossfade`, `heroCrossfade`, `exposureWipe`, …). **Never scatter
  magic numbers** in components — import from here so the system stays tunable in
  one place. Each fade+transform variant has a `*Variants(reducedMotion)` helper
  (e.g. `fadeRiseVariants`, `heroCrossfadeVariants`) that returns an opacity-only
  hard-cut under reduced motion.
- **`MotionProvider` (`components/studio/motion-provider.tsx`)** wraps the Studio
  subtree with `<MotionConfig reducedMotion="user">` + `<LazyMotion features={…}
  strict>`. `features` async-imports only the **`domAnimation`** bundle
  (`motion-features.ts`) so it is **code-split OFF the initial route** (motion
  adds ~0 KB to the critical path). Stay on `domAnimation` — do **not** escalate
  to `domMax`/`layout` (bigger bundle); container resizes use a CSS transition,
  not Framer `layout`.
- **Use `m.*`, never `motion.*`.** `LazyMotion … strict` makes any accidental
  full-`motion` import throw in dev — that's intentional; it keeps the bundle
  tree-shaken to the loaded feature set.
- **Reduced motion is a hard requirement.** Every JS-driven (`AnimatePresence` /
  `m.*`) animation must read `useReducedMotion()` from
  `lib/studio/use-media-query.ts` (SSR-safe `useSyncExternalStore`) and collapse
  to opacity-only or instant — never translate/scale/large-movement. CSS-only
  transitions are covered by the global `@media (prefers-reduced-motion: reduce)`
  backstop in `app/globals.css`; keep both.
- **Perf/scope guardrails (do-not-touch): D1** — never animate over the live
  WebGL canvas; crossfades are one-shot transients keyed on the swap, ≤2 canvases
  coexisting only for the brief overlap, nothing loops on the preview afterward.
  **D2** — export progress/completion motion (`export-beat.tsx`) lives on the
  **visible button DOM only**, fully decoupled from the off-screen renderers; it
  reads display status, never renderer internals. Never touch the off-screen
  render cores (`export-renderer` / `batch-export-renderer` / `frame-renderer`),
  `lib/studio/video-export/*`, `render-readiness.ts`, or the URL-state post-mount
  hydration. **JS budget:** incremental motion JS ≤ ~18 KB gzip on the initial
  route (met with margin — feature bundle is code-split, see PRD §10).
- **Accessibility gate.** `@axe-core/playwright` runs in `e2e/a11y.spec.ts`
  (`npm run test:a11y`) across default / sample-loaded / video-mode-awaiting /
  reduced-motion surfaces and **asserts 0 serious/critical** violations (currently
  0 of any impact). The reduced-motion case is emulated (`reducedMotion: "reduce"`)
  and is part of the gate, not an afterthought.

## Gotchas

- **macOS `* 2.ts` files**: a stale `.next/` can leave duplicate
  `something 2.ts` files that break `tsc`/`next build`. If you hit them,
  `rm -rf .next` before `tsc`/`build`.
- The dynamic shader components are resolved through a stable module-level
  registry (`getComponent`); the `react-hooks/static-components` disable in
  `shader-view.tsx` is intentional and justified inline.
