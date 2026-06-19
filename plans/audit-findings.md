# Aperture Shader Studio — Consolidated Audit Backlog

Consolidated from 76 raw findings across 8 categories. Overlapping findings (especially the
repeatedly-reported "no test suite", the PNG-roundtrip / duplicate-frame gate, the `as any`
shader-component casts, the `studio.tsx` 743-line orchestrator, and the disabled-button /
contrast a11y items) have been merged into single rows. Ordering is by leverage =
impact ÷ effort × confidence, where impact/effort/confidence are scored High=3, Med=2, Low=1
(risk shown as context, not a multiplier).

Rows scored "no-issue" (correctly-implemented patterns confirmed by the audit) are excluded
from the table and listed under **Considered / low-value**.

## Backlog (leverage-ordered)

| # | Finding | Category | Impact | Effort | Risk | Confidence | Evidence |
|---|---------|----------|--------|--------|------|------------|----------|
| 1 | Remove unused heavyweight deps (@base-ui/react, lucide-react, class-variance-authority, shadcn) — ~80–120KB gzipped of dead code, only imported by unused `components/ui/` stubs | Performance | H | S | low | high | package.json:11-24; components/ui/button.tsx:1-2; zero Button/Badge usage in studio code |
| 2 | Muted-foreground contrast fails WCAG AA — `--muted-foreground` #98a1b0 on card #131720 ≈ 4.26:1 (< 4.5:1), used in 20+ status/label/timecode spots | Accessibility | H | S | low | high | app/globals.css:154; video-stage.tsx:449,495,506,510,533; studio.tsx:414,418,726; param-control.tsx:27,134; control-panel.tsx:70,119 |
| 3 | `text-foreground/70` (#c0c4d5 ≈ 4.1:1) fails WCAG AA on MP4 fallback message and "try a sample" button (two findings merged) | Accessibility | H | S | low | high | video-stage.tsx:581; studio.tsx:736 |
| 4 | MP4 fallback message lacks `role=status`/`aria-live` — screen-reader users never learn why MP4 export is unavailable after async probe resolves | Accessibility | M | S | low | high | video-stage.tsx:577-585, 118-137 |
| 5 | Fix the 5 lint errors + 2 warnings now (setState-in-effect ×3, component-created-during-render, unused `glow` prop, unused eslint-disable directive) | DX & Tooling | M | S | low | high | npm run lint output; ambient-gradient.tsx:15; shader-view.tsx:14,32; compare-slider.tsx:10,37; video-stage.tsx:379 |
| 6 | ExportEncoder.isSupported never called on actual (clamped/evened) export dims — only probed once at fixed 1280×720; unsupported dims fail late mid-export | Correctness | M | S | low | high | encode-filtered-video.ts:191-195; video-stage.tsx:121 |
| 7 | Disabled export buttons use native `disabled` + `title` (silent to AT, removed from tab order) — inconsistent with the focusable `aria-disabled`/`aria-busy` Capture pattern; standardize on aria-disabled + aria-describedby (3 a11y findings merged) | Accessibility | M | S | low | high | video-stage.tsx:539-554,558-573,465-476,543-549,562-568 |
| 8 | Export dimension/category not atomically snapshotted — `startExport` snapshots shaderId/values but re-derives width/height from live image/category; switching shader mid-export desyncs dims (known P1) | Correctness | M | S | low | high | docs/qa/findings.md P1 line 59; studio.tsx:276-286 |
| 9 | Duplicate "Cancel" accessible names — sequence-cancel and mp4-cancel both expose bare "Cancel"; add distinct aria-labels (WCAG 2.4.3) | Accessibility | M | S | low | high | video-stage.tsx:541,560 |
| 10 | ExportRenderer/BatchExportRenderer suppress exhaustive-deps with empty arrays and no justifying comment — captured props (onDone, imageUrl, shader, values) can go stale | Correctness | M | S | medium | high | export-renderer.tsx:120-121; batch-export-renderer.tsx:144-145 |
| 11 | Characterization tests for registry.ts param normalization — highest fan-out pure logic (six edge cases, no test, no catalog schema) | Test Coverage | M | S | medium | high | registry.ts:67-107; lib/shader-catalog.json |
| 12 | Unit/integration tests for dimension-clamping + frame-lifecycle math (clampToMaxSide odd-rounding, makeEven, 1×1/near-MAX dims, null blob/ctx, videoWidth=0) | Test Coverage | M | S | medium | high | download.ts:19-24; encode-filtered-video.ts:54-57; capture-frame.ts:24-26 |
| 13 | Add a verify/test script — only lint+build exist; build passes on type errors in unreachable code, giving zero runtime confidence | DX & Tooling | M | S | low | high | package.json:5-9 |
| 14 | Filename sanitization — user image.name/videoName flow into download filenames via a bare `.replace(/\.[^.]+$/,'')`, allowing unsafe chars (defensive hygiene) | Security | M | S | low | high | studio.tsx:375; video-stage.tsx:304 |
| 15 | VFR source timestamps forced to constant frame duration (usPerFrame from whole-clip avg) — overlaps/gaps on variable-rate input; correct for CFR H.264 (known P2) | Correctness | M | S | low | high | encode-filtered-video.ts:165-169,226-235 |
| 16 | `as any` on dynamic shader components at 3 render sites + `componentMap` cast in registry — bypasses the safe return type; no runtime validation that catalog IDs resolve (two findings merged) | Tech Debt | M | S | low | medium | registry.ts:4-5,164; export-renderer.tsx; frame-renderer.tsx; batch-export-renderer.tsx |
| 17 | CLAUDE.md is a one-line redirect stub and AGENTS.md is a 5-line generic warning — no architecture/critical-path/decision-gate guidance for agent execution | Documentation | M | S | low | high | CLAUDE.md; AGENTS.md; docs/ has PRDs but no agent guide |
| 18 | Null check on `getContext('2d')` in toBlob paths — assumed non-null in 3 places; caught but path is unclear | Correctness | L | S | low | high | export-renderer.tsx:93-95; batch-export-renderer.tsx:123-125; frame-renderer.tsx:233-234 |
| 19 | downloadBlob revokes object URL on a 1s timer — leaks blob if the page unloads within 1s | Correctness | L | S | low | medium | download.ts:1-11 (line 10) |
| 20 | sourceToImageWithUrl relies on caller's try/finally to revoke its blob URL on reject — fragile pattern | Correctness | L | S | low | medium | frame-renderer.tsx:122-134; renderSource finally 225-227 |
| 21 | RenderCore not disposed until finally if first renderSource() throws — off-screen shader element lingers during error handling | Correctness | L | S | low | medium | encode-filtered-video.ts:119-126,286 |
| 22 | Slider re-render churn during drag — ParamControl not memoized; values object recreated per change re-renders all sibling controls | Performance | L | S | low | medium | param-control.tsx; control-panel.tsx:78-95; studio.tsx:272-276 |
| 23 | CompareSlider re-renders/re-mounts ShaderView child on every drag tick (inline JSX, no memo) — frame drops on low-end devices | Performance | L | S | low | medium | compare-slider.tsx:20,63-66,99-104; studio.tsx:516-528 |
| 24 | Dynamic import of video-export codec module is unguarded — chunk-load failure looks identical to a real encode failure | Performance | L | S | low | medium | studio.tsx:338-339 |
| 25 | Pointer capture: `setPointerCapture` called without optional chaining while `releasePointerCapture` uses it — asymmetric, slider could stay captured in non-standard envs | Correctness | L | S | low | low | compare-slider.tsx:60,69 |
| 26 | README claims prefers-reduced-motion support not enforced globally (only JS spot-checks); no app-wide `@media (prefers-reduced-motion: reduce)` rule (two findings merged) | Accessibility | L | S | low | medium | README.md:14; compare-slider.tsx:34-39; shader-view.tsx:13; globals.css:214-218 |
| 27 | OG / social-preview metadata missing (no og:image/url/type, no Twitter Card) — shared links show no-image preview | Documentation | L | S | low | high | app/layout.tsx:21-25 |
| 28 | @paper-design/shaders-react pinned exactly at 0.0.76 but no tooling fence — accidental `npm update`/typo could land 0.0.x breaking change | Dependencies | L | S | low | high | package.json:13; README.md:25 |
| 29 | FrameRenderer useImperativeHandle deps are only [width,height] but handle captures shader/values — stale uniforms if they change before renderSource() | Correctness | M | M | medium | high | frame-renderer.tsx:151-240 (line 239), 203 |
| 30 | Per-frame PNG encode→decode→re-encode roundtrip in export/frame renderers + content-presence gate that checks non-blank (not content-change) so a silent upload failure duplicates the prior frame; scratch readback canvas reallocated per frame (four Perf/Correctness findings merged — known P2) | Performance | H | M | medium | high | frame-renderer.tsx:104-237; export-renderer.tsx:104-152; render-readiness.ts:35-54 |
| 31 | Decode backpressure missing — onSamples decodes all samples ≤ outUs with no decoder.decodeQueueSize check; >60s/60fps clips can exhaust frame pool / hang (known P1) | Performance | M | M | medium | high | frame-source.ts:314-331,235-240 |
| 32 | Stale closure risk in renderSequence — sequenceProgressRef written in promise ctor and read in cleanup; activeId/values changing mid-batch can drive onProgress against stale state | Correctness | M | M | medium | medium | studio.tsx:303-324 (309-314), 587 |
| 33 | Consolidate the triplicated readiness-gate + readback pattern (export-renderer, batch-export-renderer, frame-renderer) — bug fixes must currently land in 3 places | Tech Debt | M | M | medium | medium | export-renderer.tsx:43-121; batch-export-renderer.tsx:57-145; frame-renderer.tsx:155-237; render-readiness.ts:10-55 |
| 34 | preloadImage doesn't clear onload/onerror handlers when img.decode() wins — leaks Image ref / fires then() after unmount | Correctness | M | M | low | medium | render-readiness.ts:58-66 |
| 35 | Smoke/integration tests for video-export abort flow + frame-lifecycle cleanup (abort mid-decode/render/encode, onFrame errors, no double-close) — carefully designed P1 logic with zero coverage | Test Coverage | M | M | medium | high | frame-source.ts:145-148,269-279,252-257; encode-filtered-video.ts:149-151,272-286 |
| 36 | Establish pragmatic test baseline: Vitest+RTL unit tests for pure logic (registry, download clamp, zip-frames padding) + Playwright smoke on studio page; defer full WebCodecs mocking. Merges all "no test suite / no CI / no test infra" findings (7+ duplicates across categories) | Test Coverage | H | M | high | high | package.json (no test script); no vitest/jest/playwright config; no __tests__ |
| 37 | Add CI pipeline (GitHub Actions) running lint+typecheck+build (+tests once they exist) — lint errors can currently be committed freely | DX & Tooling | M | M | medium | high | no .github/workflows/ |
| 38 | Migrate mp4-muxer (deprecated, v5.2.2, superseded by Mediabunny) before video export gains adoption — unmaintained dep in core path | Dependencies | M | M | medium | high | node_modules/mp4-muxer/README.md; package.json:18; encoder.ts |
| 39 | Tailwind v4 ships broad CSS (~40–60KB gzipped beyond used utilities) for a monochrome design with no purge/config optimization | Performance | M | M | medium | medium | package.json:28-29; next.config.ts (empty) |
| 40 | Input-validation tests for image/video upload (corrupted image, no video track, oversized dims, rapid re-upload) and out-of-range/invalid param values | Test Coverage | M | M | low | medium | studio.tsx:150-174,181-220; param-control.tsx |
| 41 | Range slider thumb is 16px (< WCAG AAA 24px) — bump to 20–24px for motor/touch users; keyboard already works | Accessibility | L | M | low | medium | globals.css:230-231; param-control.tsx:31-50; video-stage.tsx:427-445 |
| 42 | Disabled buttons rely on opacity-50/60 — drops already-low muted text to ~2.1–2.6:1; disabled vs active becomes ambiguous | Accessibility | L | M | low | high | studio.tsx:462; video-stage.tsx:491,502,525,551,570 |
| 43 | Export progress announced per-frame on polite live regions — AT coalesces rapid updates and skips intermediate steps; throttle to meaningful milestones | Accessibility | L | M | low | high | video-stage.tsx:587-592 |
| 44 | 10/11px mono secondary labels (15+ spots) — acceptable under WCAG but a low-vision readability trade-off; consider 12px floor | Accessibility | L | M | low | medium | shader-picker.tsx:37,49,63; video-stage.tsx multiple; studio.tsx:414,418,726,736 |
| 45 | studio.tsx is a 743-line orchestrator mixing image/video state, file I/O, shader selection, export orchestration, and UI — extract hooks/reducer (useStudioState, useVideoExport) for testability (two findings merged) | Tech Debt | M | L | low | medium | studio.tsx:52-591 |

## Direction (options)

Next-feature suggestions surfaced by the audit, ordered by leverage. All are explicitly
deferred (P1/Draft) in the PRDs — none are claimed as done.

- **Preset UI (FR-8, Aperture PRD)** — *recommended first.* Highest UX leverage for lowest
  engineering risk: 31/32 catalog shaders already carry `presetNames`; a horizontal chip row
  at the panel top that animates sliders to preset values (250ms ease-out) teaches what each
  shader does. Reuses control-panel architecture, zero new infrastructure. Effort M, risk low.
  Evidence: PRD 2026-06-18 line 85; research-brief line 46; shader-catalog.json:10.

- **Shareable URL state (FR-9, Aperture PRD)** — encode shader + params (not the image) in the
  URL hash for reproducible/linkable looks. Closes the "find the exact look" loop. Add a
  `useUrlState` hook syncing activeId/values to the hash with graceful invalid-state handling.
  Effort M, risk low, confidence high. Evidence: PRD 2026-06-18 line 89.

- **Batch frame-sequence export (FR-8, Video PRD)** — the renderer (`batch-export-renderer.tsx`,
  183 lines) and `zip-frames.ts` already exist; only the in/out range UI + an "Export frames
  (ZIP)" button wiring is missing. Mostly UI work. Effort M, risk low. Evidence: Video PRD
  2026-06-19 lines 68,82.

- **Video-mode integration / frame-capture MVP (FR-1..7, Video PRD)** — load video → scrub/step
  → capture frame → reuse existing shader/compare/export pipeline. Architecture settled in the
  spike (Option A: MP4Box demux + VideoDecoder for frame-exactness). Effort L, risk medium —
  adds WebCodecs, demux, a mode state machine, responsive timeline. Recommended after the
  video-export P0 stabilizes. Evidence: Video PRD 2026-06-19; docs/spike-webcodecs.md.

- **Filtered-video export (FR-1..7, filtered-video PRD)** — the headline differentiator: re-encode
  an H.264 MP4 with the shader applied to every frame. Encode half is prototyped; open questions
  (decode backpressure, frame-pool lifecycle, VFR timestamp normalization, memory at 900+ frames)
  are documented as failure modes. Effort L, risk high. Phase 1 after frame-capture stabilizes.
  Evidence: filtered-video PRD 2026-06-19; docs/qa/video-export-findings.md.

## Considered / low-value

- **decodeFramesInRange double-settle guard** — analysis concluded the existing `settled` guard
  makes the abort/reject path *safe but fragile*; the only action is documenting the guard. No
  code defect. (frame-source.ts:249-263,269-278)
- **Unused `glow` prop / unused eslint-disable directive** — real but trivial; folded into the
  lint-cleanup row (#5) rather than tracked separately.
- **@paper-design pin is correct as-is** — the audit confirmed the exact pin is appropriate and
  documented; only the *missing tooling fence* (row #28) carries any action. No action on the pin.
- **npm audit: 2 moderate PostCSS XSS in transitive Next.js dep** — build-time only, not
  user-facing; fix requires a breaking Next downgrade to v9. Monitor for a non-breaking Next
  patch; defer. (npm audit; package.json:20)
- **Missing local-dev setup docs / circular AGENTS.md note** — low impact; substantially covered
  by the CLAUDE.md guidance row (#17).

### Confirmed correct — no issue (excluded from backlog)

These audit entries verified existing implementations as correct and need no work:
ModeToggle radiogroup (studio.tsx:612-644); video element labeling + caption exemption
(video-stage.tsx:378-395); compare-slider 44px handle + full keyboard nav
(compare-slider.tsx:125-137); ShaderPicker radiogroup accessible name (shader-picker.tsx:28);
Capture button correct `aria-busy`+`aria-disabled` pairing (video-stage.tsx:468-469); file input
labeled via aria-label (studio.tsx:552-563 — minor "no explicit `<label>`" note, cosmetic only).
