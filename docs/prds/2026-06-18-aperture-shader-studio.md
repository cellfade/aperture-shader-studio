# Aperture — Shader Studio · Product Requirements Document

_Date: 2026-06-18 · Status: Approved (discovery confirmed) · Owner: andrew.miller_

## 1. Overview

Aperture is a fully client-side web studio for applying [`@paper-design/shaders-react`](https://shaders.paper.design/) WebGL shaders to your own photos — and for exploring the entire shader library with live, copyable code. You drop in an image, pick any shader, tune its real parameters with live sliders, drag a before/after seam, and download the result as a PNG at the original resolution. No Paper desktop app, no MCP, no backend, and the photo never leaves the browser. It is a single, tasteful, minimal page where the tool _is_ the experience.

## 2. Problem Statement

**Current situation.** The existing prototype proves these shaders run in code, but it is a fixed four-shader demo on one baked-in photo. You cannot use your own image, reach the rest of the ~30-shader library, change a single parameter, or get a result out.

**Pain points.**
- No way to apply a shader to _your_ image.
- Only a hand-picked subset of shaders is visible; the catalog isn't explorable.
- Nothing is tunable — the props are frozen in code.
- There is no export; the output stays trapped on screen.
- Evaluating the library still means hand-coding props blind or bouncing to Paper's desktop tool.

**Impact of not solving.** The prototype stays a demo, not a product. Makers can't produce an asset; evaluators can't judge the library against their own content; the "it's just code" promise goes unrealized.

## 3. Goals & Non-Goals

### Goals (measurable)
- [ ] **G1 — Bring your own photo.** Upload via drag-drop, file picker, _and_ paste; first preview renders in **< 1.5s** on a typical laptop for an image ≤ 12 MP.
- [ ] **G2 — Whole library, one surface.** **100%** of exported shader components are selectable, grouped by category (image-filter / generative / logo).
- [ ] **G3 — Live, real control.** Every selected shader exposes its actual tunable params as live controls; adjusting a control updates the preview at **≥ 50 fps** on mid hardware with **no full reload**.
- [ ] **G4 — Get the result out.** One-click **PNG download at the source image's original resolution** for image-filter shaders; export completes in **< 2s** for ≤ 12 MP. Generative shaders export at a chosen canvas size.
- [ ] **G5 — Private by construction.** **Zero** network requests carry image data; the app runs as a static/edge deploy with no backend.
- [ ] **G6 — Beautiful & responsive.** Usable and visually intact from **360px** to **2560px**; meets the design quality bar (minimal, intentional, not templated) verified by a design-taste review pass.
- [ ] **G7 — Copyable truth.** Each shader shows a working, copy-paste code snippet reflecting the _current_ params, accurate to the installed version.

### Non-Goals
- No accounts, backend, saved galleries, or shareable server links (revisit in P2).
- No video / GIF / animated export.
- No batch processing of multiple images.
- No custom/user-authored shaders or a node graph.
- No mobile-native app.
- Not a general photo editor (crop/levels/layers) — shaders only.

## 4. User Stories

> **US-1 — Maker applies a shader to their photo.** As a designer, I want to drop my own image in and see a shader applied instantly, so that I can judge the look on real content.
> **Acceptance:** _Given_ the studio is open, _when_ I drag a JPG/PNG/WebP onto the page (or paste from clipboard, or click to pick), _then_ the image loads, the active shader renders over it within 1.5s, and no upload request is made.

> **US-2 — Maker tunes the effect.** As a maker, I want to adjust a shader's parameters live, so that I can dial in exactly the look I want.
> **Acceptance:** _Given_ a shader is active, _when_ I drag a slider / pick a color / toggle an option, _then_ the preview updates continuously at ≥50fps and the value readout reflects the change.

> **US-3 — Maker compares before/after.** As a maker, I want to see the original next to the filtered result, so that I can evaluate the effect's strength.
> **Acceptance:** _Given_ an image-filter shader is active with a photo loaded, _when_ I drag the compare seam, _then_ the boundary between original and filtered moves smoothly; _and_ the seam is hidden for generative shaders (which have no "original").

> **US-4 — Maker exports.** As a maker, I want to download the filtered photo, so that I can use it elsewhere.
> **Acceptance:** _Given_ a rendered result, _when_ I click Download, _then_ a PNG at the image's original resolution is saved within 2s (≤12MP), pixel-faithful to the preview's settings.

> **US-5 — Evaluator explores the catalog.** As a developer evaluating the library, I want to browse every shader and copy its code, so that I can decide whether to adopt it.
> **Acceptance:** _Given_ the catalog, _when_ I select any shader and tune it, _then_ a copy-paste snippet updates to reflect the current props with the correct import and component name.

> **US-6 — Mobile maker.** As a phone user, I want the full tool, so that I can filter and download on the go.
> **Acceptance:** _Given_ a 360–430px viewport, _when_ I use the studio, _then_ upload, shader selection, controls, preview, and download are all reachable and legible with no horizontal scroll.

## 5. Functional Requirements

### FR-1 — Image input (P0)
Drag-and-drop, click-to-pick, and clipboard paste. Accept JPG/PNG/WebP (+ AVIF where supported). Decode via `createObjectURL`/`ImageBitmap` (untainted, same-origin). Show an inviting empty state with a bundled sample to try instantly. Validate type/size; friendly error on unsupported files. **No network for image data.**

### FR-2 — Shader catalog (P0)
All exported shaders, grouped: **Image filters** (operate on the photo), **Generative** (render their own art), **Logo**. Each entry: name, category, one-line blurb. Selecting a shader makes it active. Catalog is data-driven from `lib/shader-catalog.json` (generated from the library's type defs/metadata).

### FR-3 — Dynamic parameter controls (P0)
Render controls from each shader's param schema: `range`→slider (min/max/step + numeric readout), `color`→color picker, `enum`→segmented/select, `boolean`→switch. Live-bound to the preview. **Reset to defaults** and **Randomize** actions. Progressive disclosure: primary params visible, advanced collapsible.

### FR-4 — Live preview (P0)
WebGL preview sized responsively, debounced/rAF-driven so dragging a slider stays smooth. Loading + error states. Generative shaders render without requiring a photo.

### FR-5 — Before/after compare (P0)
The drag seam (existing, evolved) overlays original vs filtered — **only** for image-filter shaders with a photo loaded; otherwise the preview shows the shader alone. Pointer + touch + keyboard accessible.

### FR-6 — Export PNG (P0)
Download the current result as PNG. Image-filter shaders: render offscreen at the source image's **original resolution**, then `canvas.toBlob`. Generative shaders: export at the working canvas resolution (P1: size selector). Filename includes shader id. (Technique per the export spike: offscreen full-res instance, `preserveDrawingBuffer`/ready-gate as needed.)

### FR-7 — Copyable code (P1)
Per active shader, a live snippet (import + JSX) reflecting current params; copy button with confirmation.

### FR-8 — Presets (P1)
Where the library ships presets, expose them as quick-apply chips that populate the controls.

### FR-9 — Shareable state (P1)
Encode shader + params (not the image) in the URL hash so a look is reproducible/linkable.

### FR-10 — Redesigned homepage/intro (P0)
A single-page composition: hero thesis → the Studio (centerpiece) → copyable code → footer. Evolves the "optical lab" identity; minimalism central; the only chromatic color comes from the shaders.

## 6. Non-Functional Requirements
- **Performance.** Preview interaction ≥50fps on mid-tier hardware; first render <1.5s (≤12MP); export <2s (≤12MP). rAF/debounced uniform updates; one WebGL context for the live preview.
- **Responsive.** 360px → 2560px, no horizontal scroll; controls reflow to a bottom sheet / stacked layout on small screens.
- **Accessibility.** WCAG 2.1 AA: keyboard-operable sliders/seam/menus, visible focus, ARIA roles/values, `prefers-reduced-motion` respected, sufficient contrast on chrome.
- **Privacy/Security.** No backend; image data never transmitted; no third-party analytics on image content. CSP-friendly, no remote asset fetches for core flow.
- **Compatibility.** Modern evergreen browsers with WebGL2; graceful message if WebGL unavailable.
- **Scalability.** Static/edge deploy (Vercel); cost scales with static hosting only.

## 7. Technical Constraints
- **Stack.** Next.js 16 (App Router) · React client components for all WebGL surfaces · TypeScript · Tailwind v4 · shadcn/ui · `@paper-design/shaders-react` **pinned to 0.0.76** (breaking changes ship under 0.0.x).
- **Rendering.** Shaders are client-only (WebGL + rAF); `'use client'` boundaries isolated; SSR renders layout/chrome only.
- **Controls source of truth.** `lib/shader-catalog.json` derived from the package's `.d.ts` param interfaces and `*Meta`/`*Presets` exports — verified against the installed version, not memory.
- **Export.** Pure browser canvas pipeline (offscreen render → `toBlob`); no server image processing.
- **Data.** No persistence beyond optional URL-hash state (P1) and in-memory image (object URL revoked on replace).

## 8. Success Metrics
| Metric | Current | Target | How to measure |
|---|---|---|---|
| Shaders available in-app | 4 | 100% of exports (~30) | Count vs package exports |
| Use own photo | No | Yes (drag/click/paste) | Manual + e2e |
| Tunable params per shader | 0 | All documented params | Catalog coverage check |
| First preview render (≤12MP) | n/a | < 1.5s | Perf trace |
| Slider→preview frame rate | n/a | ≥ 50 fps | DevTools / rAF timing |
| PNG export (≤12MP) | none | < 2s, original res | Timed export + pixel dims |
| Network requests with image data | n/a | 0 | Network panel audit |
| Min supported width | ~not tuned | 360px, no h-scroll | Responsive QA |
| Design-quality review | n/a | Pass (taste + a11y) | Review-agent sign-off |

## 9. Timeline & Milestones
| Phase | Scope | Exit criteria |
|---|---|---|
| **P0 — Studio MVP** | FR-1,2,3,4,5,6,10; full responsive; new homepage | Upload→pick any shader→tune→compare→download PNG works on desktop+mobile; typecheck/build clean; QA + design review pass |
| **P1 — Power & polish** | FR-7 code copy, FR-8 presets, FR-9 URL state; multi-format/resolution export; motion polish | Copyable code accurate; presets apply; sharable look; export options |
| **P2 — Platform** | Accounts, saved/shared creations (backend), galleries | (Out of current scope; revisit) |

## 10. Open Questions
- [ ] Export resolution cap for very large uploads (memory) — propose hard cap (e.g. 24MP) with a notice. _(decide during export spike)_
- [ ] Generative-shader export size default — match a 16:10 canvas or offer a size field at P1?
- [ ] Which shaders to feature first in the catalog ordering (curated "start here" set).
- [ ] Sample-image licensing for the bundled "try it" asset (use a permissive/own image).

## 11. Appendix
- **Shader categories.** Image-filter (operate on the photo): Water, ImageDithering, HalftoneDots, HalftoneCmyk, FlutedGlass, PaperTexture. Logo: Heatmap, LiquidMetal, GemSmoke. Generative (own art): MeshGradient, Dithering, GrainGradient, DotOrbit, DotGrid, Warp, Spiral, Swirl, Waves, NeuroNoise, PerlinNoise, SimplexNoise, Voronoi, PulsingBorder, Metaballs, ColorPanels, SmokeRing, GodRays, Static* variants. _(Final categorization comes from `lib/shader-catalog.json`.)_
- **Design direction.** "Aperture / optical lab": deep blue-charcoal chrome, Space Grotesk display + Geist Mono instrument readouts, a single restrained signal accent, color sourced from the shaders themselves. Minimalism is the brief.
- **Related.** Prototype in this repo; research outputs in `docs/research-brief.md`; skill: `~/.claude/skills/paper-shaders`.
