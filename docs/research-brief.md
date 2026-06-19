# Aperture Shader Studio — Build Brief

Synthesis of three research outputs (shader catalog, UX design direction, export spike) into directives the implementer can build against. Aperture is a dark "optical lab": monochrome chrome, the shader output is the only color in the room.

---

## Shader catalog summary

**32 shaders total.** Single source of truth lives at `lib/shader-catalog.json` (`{ "shaders": [...] }`); the UI is data-driven off it.

| Category | Count | Takes image? | Notes |
| --- | --- | --- | --- |
| `generative` | 22 | No | Standalone backgrounds/textures; no upload required to use. |
| `image-filter` | 7 | Yes (some optional) | Operate on the uploaded photo. `image-dithering`, `halftone-dots`, `halftone-cmyk` require an image; `paper-texture`, `fluted-glass`, `water` accept an optional image (usable standalone). |
| `logo` | 3 | Yes | `heatmap` requires an image; `liquid-metal`, `gem-smoke` accept optional image or a built-in shape. |

**Metadata flags:** 18 shaders set `hasMeta: true`; all 32 set `hasPresets: true`. Preset counts range 1–6 (`dot-grid` has only `defaultPreset`; `warp`, `dithering`, `grain-gradient` have 6). Default per-shader preset is always `defaultPreset` — load it on shader select.

**Feature first (the demo set).** Because Aperture is a photo tool, lead with the image-driven effects that make the upload feel instantly worthwhile, then showcase the generative range:
1. `image-dithering` — immediate, recognizable transform of the user's photo; strong "do something" first beat.
2. `halftone-cmyk` — print-shop wow factor, per-channel ink controls read as a real instrument.
3. `fluted-glass` — premium refractive distortion over a photo.
4. `liquid-metal` — flagship "logo" effect, works on photo or built-in shape.
5. `mesh-gradient` — the canonical generative showcase (rich presets: default/purple/beach/ink) for the no-upload path.

**Param control conventions** (drive the panel renderer off these): `range` (min/max/step/default slider), `color` (swatch; `note` flags color arrays — expose 1–3 swatches even when the array allows up to 10), `enum` (segmented/dropdown from `options`), `boolean` (toggle). `image` params are wired to the upload, not rendered as a normal control.

---

## UX decisions

Resolved directives. Where research offered a spectrum, the choice is made here.

**Upload / dropzone**
- The whole viewport is the dropzone. Wire three inputs: click empty canvas (file picker), drag-drop on `<body>`, and `Cmd/Ctrl+V` paste. `preventDefault` on `dragenter/dragover/dragleave/drop` so the browser never navigates away.
- Resting empty state = one centered cluster (1.5px thin-stroke glyph + one primary line "Drop a photo, click to browse, or paste" + one muted line "JPG, PNG, WebP · processed entirely in your browser"). No box at rest.
- The dashed 1.5px inset border belongs to the drag state only. On `dragenter`, fade it in and lift the field one luminance step (`#0a0a0a → #121212`) in under 120ms.
- No modal, no gated button. First frame the user sees is the live surface.
- On decode: scale image 0.98 → 1.0 + opacity fade, 180–220ms ease-out, and auto-apply a tasteful default shader so the tool visibly does something.
- Validate type/size client-side for UX (graceful inline toast on a too-large file / decode failure). No server trust concern — everything is client-side.

**Control panel**
- Two-tier disclosure: shader picker on top, then only the selected shader's params render below. Never show all params for all shaders.
- Row layout: label left, value right-aligned with `font-variant-numeric: tabular-nums` (no digit jitter while dragging). Reads like an instrument readout.
- Group params by function (Tone / Color / Grain-Texture) with muted-caps section headers. Keep visible param count low; most shaders need 2–4.
- Presets are the on-ramp: render each shader's presets as a chip row at the panel top. Selecting one animates sliders to their values (250ms ease-out) so the motion teaches what changed. Default to `defaultPreset` on shader select.
- Reset: double-click any slider resets to its `default`; one global "Reset all" text button at the panel foot.
- Mobile: controls become a draggable bottom sheet with two detents — peek (shader name + preset chips + one primary slider) and full expand (all params). Canvas always owns the screen; never letterbox it above a tall panel.

**Preview + compare**
- Float the image in near-black negative space with comfortable padding, `object-fit: contain` (never crop). Add a 1px inner border / soft `box-shadow` so dark photo regions don't bleed.
- Compare is a deliberate mode via a corner toggle, not always-on. Hide the Compare control entirely when no shader is applied.
- Seam anatomy: 1–2px vertical line + circular grab handle with `‹ ›` chevrons; "Before"/"After" pills top-left/top-right. Drive the seam directly off pointer position via `clip-path: inset(0 X% 0 0)` — no debounced state, zero lag. `cursor: ew-resize` over the canvas, `grab → grabbing` on the handle. Click anywhere on the image jumps the seam there.
- Acceptable to adopt `react-compare-slider` for built-in keyboard + SR support, or hand-roll the `clip-path` version.

**Layout & responsive**
- Desktop ≥1100px: dominant canvas + fixed 300–340px right control rail. Slim top bar (app mark left; Compare toggle + Download right).
- Tablet 700–1100px: narrow the rail or collapse it to a slide-over icon tab; canvas stays primary.
- Phone 360–700px: canvas fills screen, controls in the bottom sheet. Always-visible: image, shader name, primary slider(s), Download. Collapsed behind disclosure: secondary params, presets gallery, metadata. At 360px the peek must still expose preset chips + one slider.

**Motion**
- Durations 120–220ms, `ease-out` / `cubic-bezier(0.2,0,0,1)`. No spring overshoot, no bounce, no load cascades.
- Slider drag: live value text, 60fps canvas re-render; track fill animates only on programmatic (preset) changes, never under the finger.
- Shader switch: crossfade canvas output ~150ms ("developing" an image).
- Preset apply: sliders glide ~250ms ease-out (informational motion, earns its keep).
- Hover/focus on chrome: 1px luminance lift, never color (color stays reserved for the shader).
- Respect `prefers-reduced-motion` everywhere — drop to instant.

**Accessibility (non-negotiable)**
- Sliders are real `<input type="range">` (or full `role="slider"` ARIA): `aria-label`, valuemin/max/now, and `aria-valuetext` speaking human values ("Contrast 1.4×"). Arrow = fine step, Shift/Page = coarse, Home/End = min/max.
- Compare seam handle is focusable: arrows move 1%, Home/End snap to full before/after.
- Give the `<canvas>` a state-describing `aria-label` ("Photo with Cinematic shader applied"); announce uploaded filename/alt.
- Label/value text meets WCAG AA (≥4.5:1) even in the dark theme. Visible 2px light focus ring on every interactive element.
- Hit targets ≥44×44px (handle, toggles, chips, slider thumb) — pad the seam handle invisibly so its visible 2px line still has a 44px target.
- Never rely on color alone for before/after — the text pills carry the meaning.

---

## Export approach

**Chosen technique: a dedicated offscreen full-resolution shader instance, read via `preserveDrawingBuffer`, normalized to exact natural dimensions.**

Each shader component renders exactly one `<canvas>`. The React `ref` points at the wrapper `<div>` (`PaperShaderElement`), and the canvas is reached via `el.paperShaderMount.canvasElement` (a public field). Guard with `isPaperShaderElement(el)` before touching `paperShaderMount`.

The on-screen canvas is sized to its CSS box × render scale and clamped by `maxPixelCount` — you **cannot** coax a small on-screen div into rendering at full photo resolution. So export from a second instance:

1. Decode the image first (`naturalWidth/Height` valid; `setTextureUniform` throws if `!complete || naturalWidth === 0`).
2. Mount a dedicated `<ShaderMount>` / typed component into a div sized to the image's natural pixels, positioned `position: fixed; left: -99999px; top: 0`. Do **not** use `display: none` — a zero box renders nothing.
3. Pass `webGlContextAttributes={{ preserveDrawingBuffer: true }}` — **the single most load-bearing line.** The library sets no context attributes by default, so `preserveDrawingBuffer` is `false` and `toBlob`/`toDataURL` on a later tick returns a blank image.
4. Set `minPixelRatio={1}` and `maxPixelCount={w*h*4}` (or higher) so the target is never clamped below natural.
5. Freeze for a deterministic frame: `mount.setSpeed(0)` + `mount.setFrame(0)`, then wait 1–2 `requestAnimationFrame` ticks for a composited draw.
6. Draw `mount.canvasElement` once into a plain 2D canvas of exactly `naturalWidth × naturalHeight`, then `canvas.toBlob(cb, 'image/png')`. The 2D resample makes output dimensions deterministic regardless of DPR/clamp rounding. Prefer `toBlob` over `toDataURL`.
7. Trigger download with filename `photo-<shadername>.png`. Unmount + `dispose()` the export instance after.

**Download UX payoff:** button shows brief inline spinner during the off-screen render, morphs to a checkmark for ~1s on completion, optional single subtle canvas-border pulse. No confetti.

**Risks / gotchas**
- **Blank PNG** if `preserveDrawingBuffer` is omitted — the most common failure; it is mandatory on the export instance.
- **CORS taint** throws on `toBlob`. Our sources are safe (same-origin `/sample.jpg`; user `File` via object URL / `createImageBitmap` is untainted). Don't set `crossOrigin` wrongly on cross-origin URLs.
- **Canvas/texture size caps:** browsers cap ~16384 px/side plus a total-area cap (Safari/iOS stricter); large images can exceed `MAX_TEXTURE_SIZE`, yielding a blank context. Clamp export to a sane max side (8192, consider 4096) and warn.
- **Resolution misconception:** raising `maxPixelCount` on the *visible* instance only lifts the clamp ceiling — it does not enlarge the canvas beyond its CSS box. Full-res must come from the offscreen instance.
- **Readiness/timing:** RAF loop runs only while `speed !== 0`; with `speed = 0` it draws once. Texture must be loaded before draw. With `preserveDrawingBuffer: true` the exact tick stops mattering — only that one draw occurred after the texture loaded.
- For typed components (`MeshGradient`, `ImageDithering`, etc.) pass the image via that component's own image prop (accepts `HTMLImageElement` or a URL string), not a raw `u_image` uniform.

**Reference source files:** `node_modules/@paper-design/shaders/dist/shader-mount.js` (ctx creation L64, resize L149–206, texture guard L214–216), `.../shader-mount.d.ts` (L1–3, 103–105), `node_modules/@paper-design/shaders-react/dist/shader-mount.d.ts` (L11–33).
