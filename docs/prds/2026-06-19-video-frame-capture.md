# Aperture — Video Frame Capture · Product Requirements Document

_Date: 2026-06-19 · Status: Draft (discovery confirmed) · Owner: andrew.miller_

## 1. Overview

Add a **Video** mode to the Aperture studio so creators can pull a still out of a video clip and stylize it with shaders — without screenshotting elsewhere first. You load a video (entirely in-browser), scrub or step to the exact moment, pause, and **capture the frame**. That frame then behaves exactly like an uploaded photo: every shader, every live control, the before/after compare, and original-resolution PNG export all work unchanged. Video never leaves the device. This v1 is deliberately scoped to **single-frame capture → static image**; filtered-video export and batch frame sequences are explicit non-goals (the heavy, separate effort).

## 2. Problem Statement

**Current situation.** Aperture only accepts still images (drag/click/paste a photo). The entire pipeline — shader catalog, controls, compare, export — assumes a single `HTMLImageElement` texture.

**Pain points.**
- Creators working from footage must first screenshot/extract a frame in another tool, then bring it in — a clunky, lossy round-trip.
- The "right moment" in a clip is hard to hit with an external screenshot; there's no scrubbing/precision.
- Frame stills from screenshots are often downscaled (viewport-sized), not full resolution.

**Impact of not solving.** A large class of source material (video) is locked out of the tool, and the natural "grab a frame and stylize it" workflow — common for social, thumbnails, album art, mood boards — isn't possible.

## 3. Goals & Non-Goals

### Goals (measurable)
- [ ] **G1 — Load video client-side.** Accept MP4, WebM, and MOV via drag/click/paste; decode in-browser with **zero** network requests carrying video data; first frame visible in **< 1.5s** for a ≤1080p clip.
- [ ] **G2 — Find the moment.** Scrub a timeline, play/pause, and step ±1 frame; the previewed frame is accurate to **within 1 frame** where `requestVideoFrameCallback` is supported (Chrome/Edge/Safari).
- [ ] **G3 — Capture = photo.** Capturing the paused frame produces an image at the **video's native resolution** and hands it to the existing studio so **100%** of current shaders, controls, compare, and PNG export work with no code branch downstream.
- [ ] **G4 — Export the still.** Download the shader-applied frame as a PNG at native resolution (reusing the existing export path), in **< 2s** for ≤12MP.
- [ ] **G5 — One studio.** Video adds a **Photo / Video** mode toggle to the existing studio (no separate page); switching modes is one click and preserves the chosen shader.
- [ ] **G6 — Safe by default.** Reject/із-warn on files over the size/duration caps with a clear inline notice; never crash the tab on a too-large clip (graceful path in **100%** of over-cap cases).

### Non-Goals
- **No filtered-video export / re-encoding** (no mp4/webm output). Deferred — heaviest lift (per-frame GPU render + WebCodecs/ffmpeg.wasm).
- **No batch frame-sequence export** (in/out range, every-Nth, .zip) in v1 — candidate P1.
- **No real-time shader playback** over moving video (live filtered playback at 30/60fps).
- **No video editing** — trim, cut, splice, audio, filters-on-timeline.
- **No server-side decode/transcode.** Strictly client-side.
- **No cloud/import-by-URL** of remote videos (CORS-tainted canvas would block frame grab).

## 4. User Stories

> **US-1 — Grab a frame from footage.** As a creator, I want to load a video, scrub to a moment, and capture that frame, so that I can stylize a still from my clip.
> **Acceptance:** _Given_ Video mode with a clip loaded, _when_ I scrub/step to a time and click Capture frame, _then_ a full-resolution still of that exact frame loads into the studio with the active shader applied, and no upload request is made.

> **US-2 — A captured frame is just a photo.** As a user, I want the captured frame to behave like an uploaded image, so that I can use any shader, tune controls, compare, and export.
> **Acceptance:** _Given_ a captured frame, _when_ I switch shaders / drag sliders / toggle compare / click Download, _then_ each behaves identically to the photo flow, exporting at the frame's native resolution.

> **US-3 — Precise stepping.** As a creator, I want to step one frame at a time, so that I can land on the exact frame.
> **Acceptance:** _Given_ a paused video, _when_ I press the next/prev-frame controls (or ←/→), _then_ the preview advances one frame (via `requestVideoFrameCallback` where available; otherwise a best-effort time step) and the timecode updates.

> **US-4 — Clear limits.** As a user, I want to know when a file won't work, so that I'm not stuck on a blank screen.
> **Acceptance:** _Given_ an unsupported codec, an undecodable file, or one over the caps, _when_ I load it, _then_ an inline notice explains what happened and what to try; the app stays usable.

> **US-5 — Switch modes freely.** As a user, I want to move between Photo and Video, so that I can work from either source.
> **Acceptance:** _Given_ either mode, _when_ I toggle Photo/Video, _then_ the input surface switches, the active shader is preserved, and prior media is released (object URL revoked).

> **US-6 — Accessible scrubbing.** As a keyboard/AT user, I want the timeline and capture operable and announced.
> **Acceptance:** _Given_ Video mode, _when_ I tab to the scrubber, _then_ it's a focusable slider with `aria-valuetext` (timecode), play/pause and capture are buttons with labels, and capture is announced via the existing `aria-live` region.

## 5. Functional Requirements

### FR-1 — Mode toggle (P0)
A **Photo / Video** segmented control in the studio top bar. Default Photo. Switching to Video swaps the input/empty-state and reveals the transport (scrubber). The active shader + its param values persist across the switch. Switching away releases the other mode's media.

### FR-2 — Video input (P0)
Drag-drop, click, and paste a video file; accept `video/mp4`, `video/webm`, `video/quicktime` (.mov). Decode via a hidden/inline `<video>` with `URL.createObjectURL` (no upload). Empty state mirrors the photo dropzone ("Drop a video, click to browse, or paste" + format/privacy line + "try a sample" clip). Revoke object URLs on replace/mode-switch/unmount.

### FR-3 — Transport & scrubbing (P0)
Below the preview: play/pause, a draggable timeline (current time / duration), a timecode readout, and prev/next-frame step buttons. Frame stepping uses `requestVideoFrameCallback` to land on frame boundaries where supported; otherwise steps by `1/assumedFps` (assume 30fps, note imprecision). Keyboard: Space = play/pause, ←/→ = step frame, Home/End = start/end.

### FR-4 — Frame capture (P0)
A **Capture frame** action grabs the current frame: draw the `<video>` (at `videoWidth × videoHeight`) into an offscreen 2D canvas, `canvas.toBlob('image/png')` → object URL → `Image` → commit through the **existing** image pipeline (`commitImage`), so the captured frame is a normal `LoadedImage` at native resolution. After capture, the studio behaves exactly as for an uploaded photo. Announce "Captured frame at HH:MM:SS.mmm".

### FR-5 — Reuse downstream (P0)
No changes to the shader catalog, control panel, compare, or export beyond accepting the captured frame as the image source. Export (`ExportRenderer`) uses the captured frame's native dimensions (already the existing original-resolution path, clamped by `MAX_EXPORT_SIDE`).

### FR-6 — Caps & validation (P0)
Soft caps with graceful inline notices (reuse `flashNotice`): file size (≈≤200MB), duration (≈≤5min), and capture resolution clamped to `MAX_EXPORT_SIDE` (8192). On decode error / unsupported codec (`video.error`, or `loadedmetadata` never fires within a timeout), show a specific message. Never block the UI thread hard; never crash on over-cap.

### FR-7 — Sample clip (P1)
A small bundled, permissively-licensed sample video for one-click "try a sample" in Video mode (parallels the photo sample).

### FR-8 — Batch frame sequence (P1 — deferred)
Mark in/out (or every-Nth) and export multiple shader-applied PNGs as a `.zip`. Out of v1 scope; captured here so the transport UI can be designed to accommodate range markers later.

### FR-9 — Filtered-video export (P2 — separate effort)
Re-encode a shader-filtered video via per-frame GPU render + client-side encoding (WebCodecs, ffmpeg.wasm fallback). Large, perf/compat-risky; explicitly out of scope for this PRD beyond acknowledgement.

## 6. Non-Functional Requirements
- **Performance.** First frame < 1.5s (≤1080p); frame capture (draw + toBlob + decode) < 500ms at ≤4K; scrubbing stays responsive (seek on input, throttle). Export unchanged (<2s ≤12MP).
- **Privacy/Security.** Video data never transmitted; object URLs only; canvas stays untainted (local files); no analytics on media. Revoke URLs to avoid leaks.
- **Accessibility.** WCAG 2.1 AA: scrubber is a labeled slider with `aria-valuetext` timecode; transport buttons labeled; keyboard transport; capture announced via `aria-live`; respect `prefers-reduced-motion` (don't autoplay).
- **Compatibility.** Chrome/Edge/Safari/Firefox current. MP4(H.264)/WebM(VP9/AV1) broadly; MOV depends on browser codec support — covered by the graceful-notice path. `requestVideoFrameCallback` is progressive enhancement.
- **Responsive.** Transport + scrubber usable from 360px → desktop; reuse the existing responsive studio shell.

## 7. Technical Constraints
- **Stack.** Existing Next.js 16 / React 19 / TS / Tailwind v4 client studio. New code is client-only (`'use client'`).
- **Shader texture type.** Paper shaders accept `HTMLImageElement | string`, **not** a canvas/video — hence the capture-to-image conversion (canvas → blob URL → `Image`) rather than feeding the `<video>` directly.
- **Frame accuracy.** Exact frame stepping needs `requestVideoFrameCallback` (no stable cross-browser fps API); time-based fallback is approximate.
- **Decode/seek.** Frame grab must wait for the `seeked` event (and `readyState ≥ 2`) before `drawImage`, or the canvas is stale/blank.
- **Memory.** Large/long 4K clips are the main risk → caps + notices; consider releasing the `<video>` when switching to Photo mode.
- **Reuse boundary.** `commitImage` becomes the single entry point for "set current image" from both upload and capture, preserving the object-URL revoke invariant.

## 8. Success Metrics
| Metric | Current | Target | How to measure |
|---|---|---|---|
| Video sources supported | none | MP4 + WebM + MOV (browser-permitting) | Manual matrix across browsers |
| First frame visible (≤1080p) | n/a | < 1.5s | Perf trace |
| Frame-step accuracy (rVFC browsers) | n/a | ±1 frame | Visual/QA verification |
| Capture→studio parity | n/a | 100% of shaders/controls/export work on a captured frame | Coverage check |
| Frame capture time (≤4K) | n/a | < 500ms | Timed capture |
| Export resolution | n/a | = video native (≤ 8192/side) | Inspect exported PNG dims |
| Network requests w/ video data | n/a | 0 | Network panel |
| Over-cap handling | n/a | 100% graceful (no crash) | Fault injection |

## 9. Timeline & Milestones
| Phase | Scope | Exit criteria |
|---|---|---|
| **P0 — Frame capture MVP** | FR-1,2,3,4,5,6 | Load video → scrub/step → capture → stylize with any shader → export PNG at native res; mode toggle; caps + notices; responsive + a11y; build/typecheck clean; QA + design review pass |
| **P1 — Convenience** | FR-7 sample clip, FR-8 batch sequence (.zip), shareable state parity | Batch export N frames; bundled sample; URL state |
| **P2 — Filtered video** | FR-9 re-encode filtered video | (Separate PRD; spike WebCodecs/ffmpeg.wasm first) |

## 10. Open Questions
- [ ] MOV/HEVC: accept and rely on graceful failure, or detect-and-warn proactively before load?
- [ ] Frame-step fallback when `requestVideoFrameCallback` is absent (Firefox): assume 30fps, or expose a small fps field?
- [ ] Exact caps — confirm size (200MB?) and duration (5min?) ceilings against real device memory.
- [ ] Sample clip sourcing/licensing for "try a sample" in Video mode.
- [ ] Should switching Photo↔Video keep the previously captured/loaded image around (to return to it), or release immediately? (Leaning release for memory.)

## 11. Appendix
- **Capture pipeline:** `<video>` (objectURL) → seek to t, await `seeked` → `ctx.drawImage(video, 0, 0, videoWidth, videoHeight)` → `canvas.toBlob('image/png')` → objectURL → `new Image()` → `commitImage({ url, isBlob:true, w, h, name: "frame-<timecode>.png" })` → existing studio + export.
- **Reused, unchanged:** `lib/studio/registry.ts`, `control-panel`, `param-control`, `shader-view`, `compare-slider`, `export-renderer`, `download`.
- **New (proposed):** `components/studio/video-mode.tsx` (transport + capture), a `mode: 'photo' | 'video'` state in `studio.tsx`, `lib/studio/capture-frame.ts`.
- **Related:** base product PRD `docs/prds/2026-06-18-aperture-shader-studio.md`; research `docs/research-brief.md`.
