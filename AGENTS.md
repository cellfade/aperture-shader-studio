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

## Gotchas

- **macOS `* 2.ts` files**: a stale `.next/` can leave duplicate
  `something 2.ts` files that break `tsc`/`next build`. If you hit them,
  `rm -rf .next` before `tsc`/`build`.
- The dynamic shader components are resolved through a stable module-level
  registry (`getComponent`); the `react-hooks/static-components` disable in
  `shader-view.tsx` is intentional and justified inline.
