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

## Phase C — Tests + CI
- #36 Vitest + RTL baseline; unit tests for `registry` (param normalization/initialValues/categories), `download` (clampToMaxSide/even dims), `zip-frames` padding (#11/#12). Playwright smoke on the studio page.
- #37 GitHub Actions CI: lint + typecheck + build (+ tests). #13 wire `test` script.

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

## Deferred (documented, not in this program)
#45 extract `studio.tsx` into hooks; #33 consolidate the triplicated readiness/readback; #16 type the dynamic registry (drop `as any`); plus the lower-value a11y polish (#41 thumb 24px, #42 disabled contrast, #43 progress throttle, #44 12px floor) and direction features (presets, URL-state) — tracked in `audit-findings.md`.
