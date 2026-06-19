# Improvement program — execution plan

Source backlog: `plans/audit-findings.md` (45 items + 5 direction options, leverage-ordered).
Scope selected: **Quick-wins + Perf + Tests/CI** (architecture refactor — #45/#33/#16 — deferred).
Verification gate every phase: `npx tsc --noEmit` + `npx eslint .` (0 problems) + `npx next build`, plus targeted browser E2E where relevant. Each phase commits → auto-deploys.

Vetting corrections (already done / dropped): **#4** (MP4 fallback `aria-live`) and **#9** (distinct "Cancel" labels) were fixed in the prior QA pass — dropped. `lib/utils.ts` is used only by the dead `components/ui/*` (extends the #1 dead-code chain).

## Phase A — Quick wins (S, low risk)
- #5 Lint to zero (set-state-in-effect → `useSyncExternalStore` for media-query/reduced-motion hooks; justify/qualify the dynamic-component `static-components` error; remove unused `glow` prop + dead eslint-disable).
- #1 Remove dead code: `components/ui/*`, `lib/utils.ts`, deps `lucide-react`, `@base-ui/react`, `class-variance-authority`, `clsx`, `tailwind-merge` (keep `shadcn`/`tw-animate-css` CSS imports unless build proves removable).
- #2 `--muted-foreground` → clear WCAG AA (≥4.5:1 on card). #3 `text-foreground/70` spots → ≥4.5:1.
- #6 `ExportEncoder.isSupported` on actual export dims (fail clean, not late). #8 atomically snapshot export dims/category.
- #14 sanitize download filenames. #27 OG/Twitter metadata. #13 `typecheck` script + `.npmrc` save-exact (#28). #17 real CLAUDE.md/AGENTS.md agent guide.

## Phase B — Performance
- #30 Kill per-frame PNG `toBlob`→`decode` roundtrip (reuse one `ImageBitmap`/canvas); make the readback gate **content-change-detecting** (fixes the transient duplicate-frame flake); reuse one scratch canvas.
- ~~Web Worker + OffscreenCanvas offload for the long-export render→encode loop (keep main thread responsive).~~ **Deferred — blocked by the library (see note below).**
- #22/#23 memoize `ParamControl` / stabilize `ShaderView` props so slider drags don't re-render siblings / re-mount the GL view.
- (#31 decode backpressure already landed in the video-export QA pass — verify, don't redo.)

## Phase C — Tests + CI ✅ done
Landed: Vitest + Testing Library baseline (jsdom, `@`-alias) with **51 unit/component tests** — `download` (sanitizeFilename + clampToMaxSide), `registry` (param normalization, initialValues, CATEGORIES partition, getComponent), `zip-frames` (frame padding/ordering), `render-readiness` (content-sampler presence/change/grace-window via stubbed 2D ctx), a `normalizeFps` helper extracted from the Phase-B fix + used at both call sites (29.97→30, NaN→1, …), and one RTL test on `ParamControl` (range/boolean/enum → `onChange(name,value)`). One **Playwright** smoke (`e2e/smoke.spec.ts`, self-contained `webServer`) covering the WebGL path: sample → dithering → real PNG download, zero console errors — passes. **GitHub Actions** `ci.yml`: `verify` job (lint/typecheck/build/test) + separate `e2e` job (chromium), npm-cached, node 24. `test`/`test:watch`/`test:coverage`/`test:e2e` scripts wired. Closes #36, #37, #11, #12, #13.

### Phase B — deferred: worker / OffscreenCanvas offload

Investigated against the real library source
(`node_modules/@paper-design/shaders/dist/shader-mount.js`). **Not feasible
without forking `@paper-design/shaders`.** `ShaderMount` is hard-wired to the
main-thread DOM:

- creates its `<canvas>` internally via `ownerDocument.createElement("canvas")`
  and `parentElement.prepend(canvas)` — there is **no constructor/prop hook to
  hand it a pre-made `OffscreenCanvas`**; the React `ShaderMount` wrapper has no
  such option either;
- depends on `ResizeObserver.observe(parentElement)`, `visualViewport`,
  `window.devicePixelRatio`, and `document.addEventListener("visibilitychange")`
  for sizing/render scheduling — none of which exist in a Worker;
- stashes itself on `parentElement.paperShaderMount`, which our render cores read
  back via `getPaperMount()` — there is no DOM element in a Worker to attach to.

**What would unblock it:** upstream support for an OffscreenCanvas render target
(e.g. a `ShaderMount` option accepting an `OffscreenCanvas` + explicit
width/height/DPR instead of measuring a DOM parent, and dropping the
DOM-observer/visibilitychange coupling). A hacky port was explicitly not
attempted.

**Responsiveness (the actual goal) is already met on the main thread.** The MP4
export loop in `encode-filtered-video.ts` yields to the event loop on every
frame: each `RenderCore.render()` awaits `sourceToImageWithUrl` (a `toBlob`
Promise + `img.decode()`) **and** a `requestAnimationFrame`-driven readback gate,
and the decode side (`frame-source.ts`) awaits a `dequeue`/8ms tick per chunk —
so `onProgress` and UI paint stay live throughout long exports. No extra
`scheduler.yield()` was needed.

## Follow-up pass (all four lanes selected) — gated phases, each commits → auto-deploys

Same gate every phase: `npx eslint .` (0) + `npx tsc --noEmit` + `npx next build` + `npm test` (all green), plus live browser smoke where the change touches the render/export path. Ordered to minimize cross-phase file churn.

### Phase D — Tech-debt foundations (do first; cleaner base for the rest)
- #16 Type the dynamic shader registry — drop `as any` at all 4 sites (registry `componentMap` + the 3 render cores). Give `getComponent` a precise return type (a `ComponentType` over the union of shader prop shapes) so the cast is unnecessary.
- #33 Consolidate the triplicated readiness/readback (export-renderer, batch-export-renderer, frame-renderer) into ONE shared hook/util (build on the Phase-B `render-readiness.ts`). Bug fixes should land in one place.
- Fold in #10 (justify or fix the empty-dep `eslint-disable`s in export/batch renderers — capture stale-able props correctly) and #29 (FrameRenderer `useImperativeHandle` deps `[width,height]` vs captured `shader/values`) since they live in these same files.

### Phase E — Correctness & robustness + deeper tests
- #34 `preloadImage` — clear `onload/onerror` when `decode()` wins (no late `then()`/leak). #18 null-check `getContext('2d')` paths. #19 `downloadBlob` revoke lifecycle. #20 `sourceToImageWithUrl` revoke robustness. #21 dispose `RenderCore` if first `renderSource()` throws.
- #35 Vitest tests for the video-export abort flow + frame-lifecycle (abort mid-decode/render/encode; onFrame error; no double-close). #40 upload input-validation tests (corrupt image, no video track, oversized, rapid re-upload; invalid param values).

### Phase F — `studio.tsx` refactor (#45, the architectural lift — isolated, after correctness is stable)
- Extract `useStudioState` (image/video/mode/shader/values/file-I/O) and `useVideoExport` (sequence + MP4 orchestration) hooks from the 743-line orchestrator. Fold in #32 (renderSequence stale-closure on `sequenceProgressRef`/activeId). Add hook unit tests. Keep behavior identical (verify via the Playwright smoke + a live export).

### Phase G — Accessibility polish
- #7/#42 standardize disabled export buttons on focusable `aria-disabled` + `aria-describedby` (match the Capture pattern) and fix disabled contrast (don't rely on opacity dropping muted text to ~2:1). #41 slider thumb → 24px. #43 throttle export-progress live-region announcements to milestones. #44 raise 10/11px mono labels toward a 12px floor. #26 add an app-wide `@media (prefers-reduced-motion: reduce)` rule.

### Phase H — New features
- **Preset chips** (highest UX leverage): horizontal chip row at the panel top; 31/32 catalog shaders carry `presetNames`; selecting animates sliders to preset values (~250ms ease-out). Reuses control-panel architecture.
- **Shareable URL state**: `useUrlState` hook syncing `activeId` + `values` (not the image) to the URL hash, with graceful invalid-state handling.

Held for later: #38 mp4-muxer → Mediabunny migration (riskiest, not yet pressing); #15 VFR timestamp normalization; #39 Tailwind purge (v4 already tree-shakes).
