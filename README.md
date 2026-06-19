# Aperture — Shader Studio

A fully client-side web studio for running [`@paper-design/shaders-react`](https://shaders.paper.design/) WebGL shaders on your own photos. Drop in an image, pick any shader, tune every parameter live, drag the before/after seam, and export the result as a PNG at the original resolution — all in your browser. **Nothing is uploaded.**

Built with Next.js 16 (App Router), Tailwind v4, shadcn/ui, and TypeScript.

## Features

- **Bring your own photo** — drag-drop, click, or paste; processed entirely client-side via `createObjectURL` (no network).
- **The whole library** — all 29 shaders, grouped into Image filters / Logo / Generative.
- **Live controls** — per-shader sliders, color pickers, segmented enums, toggles, and palettes, generated from the shader catalog. Reset + Randomize.
- **Before/after compare** — a draggable seam for image filters (pointer, touch, and keyboard accessible).
- **Original-resolution PNG export** — an off-screen full-res render (`preserveDrawingBuffer`) read into a 2D canvas and downloaded.
- **Responsive & accessible** — 360px → wide; WCAG-minded focus, ARIA, contrast, and `prefers-reduced-motion` support.

## Develop

```bash
npm install
npm run dev      # http://localhost:3000
npm run build    # production build
```

> Pin `@paper-design/shaders-react` exactly — it ships breaking changes under `0.0.x` versioning.

## Project docs

- `docs/prds/` — product requirements
- `docs/research-brief.md` — shader catalog, UX, and export research
- `docs/qa/` — QA punch list + screenshots

## How it works

Shaders are WebGL/canvas React components that run client-side. Image filters take the uploaded photo as a texture; generative shaders render their own art. The control panel is data-driven from `lib/shader-catalog.json` (derived from the package's type definitions). Export mounts a dedicated full-resolution instance off-screen, waits for a drawn frame, and reads the canvas into a PNG.
