# Aperture — Filtered-Video Export · Product Requirements Document

_Date: 2026-06-19 · Status: Draft (discovery confirmed) · Owner: andrew.miller_

## 1. Overview

Export a **shader-filtered video**, not just stills. In Video mode, the user picks an in/out range, hits Export video, and Aperture renders every frame in that range through the active shader on the GPU and encodes a downloadable **MP4 (H.264)** — entirely in the browser via **WebCodecs** (`VideoEncoder` + an MP4 muxer). No upload, no server transcode, no ffmpeg.wasm (so no cross-origin-isolation headers). Where WebCodecs/H.264 isn't available (e.g. Firefox), the UI degrades gracefully to the existing frame-sequence zip. This is the last major item from the video PRD and the heaviest: per-frame decode → shader render → encode at the clip's frame rate.

## 2. Problem Statement

**Current situation.** Aperture filters single frames and can export a zip of N stills, but motion is lost — you cannot get a *filtered video* out.

**Pain points.**
- Creators who want a stylized *clip* (dithered, halftoned, fluted, etc.) must export stills and reassemble them in another tool.
- The frame-zip is a workaround, not a deliverable; there's no single playable artifact.

**Impact of not solving.** Aperture stays a still-image tool for video sources; the obvious "filter my clip" outcome remains impossible in-product.

## 3. Goals & Non-Goals

### Goals (measurable)
- [ ] **G1 — Export a filtered MP4.** From a loaded video, export the chosen [in,out] range as a single **MP4/H.264** file with the active shader applied to every frame, at the source frame rate, fully client-side (**0** network requests carrying video data).
- [ ] **G2 — Faithful frames.** Every output frame matches the live preview's shader + params; output dimensions = source (capped); **no dropped/duplicated frames** (frame-accurate pipeline, not best-effort playback capture).
- [ ] **G3 — Bounded & safe.** Enforced caps (resolution **≤1080p**, duration **≤30s**) with a clear notice; **live progress %** and a working **Cancel** that stops cleanly and frees memory in **100%** of cases.
- [ ] **G4 — Graceful capability handling.** Detect WebCodecs + H.264 support up front; when absent, **hide/disable** Export video and point to the frame-zip — **0** dead/exploding controls.
- [ ] **G5 — Reasonable throughput.** Encodes a 10s 720p clip in **≤ ~2× realtime** on a typical laptop (target, not a hard gate); UI stays responsive (no main-thread lock-ups > 100ms during encode).

### Non-Goals
- **No audio.** Output is silent (no demux/passthrough/sync) for v1.
- **No ffmpeg.wasm**, no server-side encode, no cross-origin-isolation headers.
- **No format/quality picker** (MP4/H.264 only; one sensible bitrate). WebM/VP9, bitrate tiers, fps override = future.
- **No GIF / image-sequence-to-video** beyond the existing zip.
- **No editing** (trim handles beyond in/out, cuts, transitions, speed).
- **No background/Web Worker offload** in v1 unless the spike shows the main thread can't keep UI responsive (then it becomes a P1).

## 4. User Stories

> **US-1 — Export a filtered clip.** As a creator, I want to export my chosen range as a filtered MP4, so that I have a single playable video with the effect baked in.
> **Acceptance:** _Given_ a video + an image-filter shader + an in/out range, _when_ I click Export video, _then_ a progress indicator runs and an MP4 downloads that plays back the range with the shader applied to every frame, at source fps, no audio, no upload.

> **US-2 — Stay in control.** As a user, I want progress and a cancel, so that a long encode never traps me.
> **Acceptance:** _Given_ an export in progress, _when_ I watch it, _then_ I see % / frame count; _when_ I click Cancel, _then_ it stops within ~1s, no file downloads, and memory returns to baseline.

> **US-3 — Know the limits.** As a user, I want clear handling of caps and unsupported browsers.
> **Acceptance:** _Given_ a range > 30s or source > 1080p, _then_ a notice states the cap and what will happen (clamp/trim); _given_ a browser without WebCodecs/H.264, _then_ Export video is unavailable with a one-line explanation and a pointer to "Export frames (zip)".

> **US-4 — Accessible export.** As a keyboard/AT user, I want the control operable and progress announced.
> **Acceptance:** Export/Cancel are labeled buttons in tab order; progress is announced via `aria-live`; `prefers-reduced-motion` respected.

## 5. Functional Requirements

### FR-1 — Capability detection (P0)
On entering Video mode, detect `window.VideoEncoder` + `VideoEncoder.isConfigSupported({codec:'avc1.*'})` (async). Gate the Export-video control on support; otherwise show the fallback note + the existing zip export. Never render a control that will throw.

### FR-2 — Range + settings (P0)
Reuse the Sequence in/out markers for the export range (single source of truth). Source fps detected (via `requestVideoFrameCallback` median delta, fallback 30). Resolution = source clamped to ≤1080p longest side (or `MAX_EXPORT_SIDE`), even dimensions enforced (H.264 needs even W/H). Duration clamp ≤30s (trim range + notice).

### FR-3 — Frame-accurate render→encode pipeline (P0)
For each frame timestamp across [in,out] at source fps: obtain the decoded frame → render it through the active shader via a **persistent** offscreen GL instance (texture/image swapped per frame, context NOT remounted) → wrap the result canvas as a `VideoFrame` with the correct timestamp/duration → `encoder.encode(frame)`. Frame sourcing approach is decided by the Phase-0 spike (preferred: `WebCodecs VideoDecoder` fed by a demuxer for exactness; acceptable fallback: deterministic seek-step + draw). Backpressure: respect `encoder.encodeQueueSize`.

### FR-4 — Mux + download (P0)
Configure `VideoEncoder` (`avc1`, source-derived width/height/framerate, target bitrate ~ resolution-based). Collect `EncodedVideoChunk`s into an MP4 muxer (`mp4-muxer`, pinned exact). On finish: `encoder.flush()` → muxer finalize → `Blob('video/mp4')` → download `<shaderid>-<clip>.mp4`. Reuse `downloadBlob`.

### FR-5 — Progress / cancel / lifecycle (P0)
Live progress (`encoded/total` %) via `aria-live`; Cancel aborts the loop, closes the encoder/decoder, frees `VideoFrame`s (`.close()` every frame — critical for memory), revokes URLs. Disable inputs while running. One export at a time.

### FR-6 — UI (P0)
An "Export video" action in Video mode (within/next to the Sequence panel, since it shares the in/out range). Monochrome, accessible, consistent with existing transport buttons. Progress bar + Cancel. Caps/notices via the existing notice + live region.

### FR-7 — Fallback (P0)
Firefox / unsupported: Export-video control replaced by a short line ("Filtered-video export needs WebCodecs — try Chrome/Edge/Safari, or export frames as a zip") with the zip action adjacent.

### FR-8 — Worker offload (P1, conditional)
If the spike/QA shows main-thread jank, move the render→encode loop to a Web Worker (OffscreenCanvas + WebGL in worker, VideoEncoder in worker). Deferred unless needed.

## 6. Non-Functional Requirements
- **Performance.** Target ≤2× realtime for 10s/720p; never block the main thread >100ms/tick (chunk work across rAF or a worker); cap memory by closing every `VideoFrame`.
- **Privacy/Security.** Fully client-side; no uploads; no COOP/COEP headers; no new third-party network calls.
- **Compatibility.** Chrome/Edge/Safari (WebCodecs + H.264). Firefox → documented fallback. Feature-detected, never assumed.
- **Accessibility.** WCAG 2.1 AA: labeled controls, `aria-live` progress, keyboard operable, reduced-motion.
- **Footprint.** One small dep (`mp4-muxer`); no large wasm; keep initial bundle lean (lazy-load the export module).

## 7. Technical Constraints
- **Stack.** Existing Next 16 / React 19 / TS strict / Tailwind v4 client app. Export logic is client-only, lazy-imported.
- **WebCodecs.** `VideoEncoder`/`VideoFrame` are browser-only — cannot be unit-tested in Node; verification is via Playwright/Chromium + manual.
- **Even dimensions** required for H.264; clamp + round.
- **Shader render reuse.** Needs a *persistent* offscreen instance with a per-frame-updatable image uniform — an extension of `render-readiness`/`export-renderer`, not the per-frame remount used by the still/batch path (too slow for video).
- **Frame exactness.** Seek-per-frame is unreliable for dense fps; prefer a decode pipeline (`mp4box.js`/`MP4Box` demux → `VideoDecoder`) — to be confirmed by the spike. mp4box adds a small dep if chosen.
- **Memory.** `VideoFrame` and `EncodedVideoChunk` must be closed/released promptly.

## 8. Success Metrics
| Metric | Current | Target | How to measure |
|---|---|---|---|
| Filtered video export | none | MP4/H.264, range, source fps | Manual + Playwright E2E |
| Frame fidelity | n/a | every frame shader-applied, no drops | Frame-count check vs expected; spot frames |
| Output dims | n/a | = source, ≤1080p, even | Inspect MP4 |
| 10s/720p encode time | n/a | ≤ ~2× realtime | Timed export |
| Cancel cleanliness | n/a | stops ≤1s, memory to baseline | DevTools memory + fault test |
| Network w/ video data | n/a | 0 | Network panel |
| Unsupported handling | n/a | 100% graceful (no throw) | Firefox check |

## 9. Timeline & Milestones (phased — each is a verify gate)
| Phase | Scope | Exit gate |
|---|---|---|
| **P0 · Spike** | Prove WebCodecs `VideoEncoder('avc1')` + `mp4-muxer` in-browser; decide frame-sourcing (decode-pipeline vs seek-step); throwaway `/spike` page. | A ≥1s test produces a **playable MP4** in Chromium (verified via Playwright); written recommendation on frame sourcing. |
| **P1 · Render core** | Persistent offscreen shader instance with per-frame texture update → readable canvas (`renderFrameToCanvas`). Extends render-readiness. | `tsc` clean; a single frame renders correctly through it (visual check). |
| **P2 · Encode pipeline** | Frame loop (source→render→encode), muxer, caps, progress, cancel, `VideoFrame.close()` hygiene. | E2E: export a real clip → MP4 plays back filtered, correct dims/fps, frame count matches; cancel works. |
| **P3 · UI + fallback** | Export-video control in Video mode (range from Sequence), progress bar/cancel, capability detection + Firefox fallback. | E2E on desktop + responsive; a11y pass; tsc + build. |
| **P4 · QA loop + ship** | Parallel QA agents (build/design/a11y/code/perf) → fix P0/P1 → commit → auto-deploy → live verify. | Live MP4 export verified on production. |

## 10. Open Questions
- [ ] Frame sourcing: full `VideoDecoder` demux pipeline (exact, +mp4box dep, more code) vs deterministic seek-step+draw (simpler, risk of dupes at high fps)? **Spike decides.**
- [ ] Bitrate heuristic (e.g. `width*height*fps*0.1`) — tune after the spike.
- [ ] Main-thread vs Web Worker — decide from P2 perf (FR-8).
- [ ] Exact caps (1080p / 30s) — confirm against device memory during P2.
- [ ] WebM/VP9 + audio + quality picker — future PRD if desired.

## 11. Appendix — Agentic execution plan
Run as a phased workflow; **verify the gate before advancing** (per the chosen execution model). Within a phase, fan out parallel agents where independent; the WebCodecs gates require Playwright/Chromium verification (the orchestrator drives the browser since agents can't run WebCodecs headlessly).
- **Loop shape per phase:** implement (agent) → `tsc`/build → browser E2E (orchestrator via Playwright) → if gate fails, feed the failure back to a fix agent and repeat (bounded retries) → on pass, advance.
- **Parallelizable:** P1 (render core) and the P0 spike's muxer-dep wiring can overlap; P3 UI and P4 QA dimensions fan out.
- **Sequential dependencies:** P0 → P1 → P2 (pipeline needs both render core + proven encoder) → P3 → P4.
- **New deps (pinned exact):** `mp4-muxer`; possibly `mp4box` if the decode pipeline wins.
- **New files (proposed):** `lib/studio/video-export/encoder.ts` (WebCodecs config + mux), `lib/studio/video-export/frame-source.ts` (decode/seek frames), `lib/studio/video-export/persistent-renderer.ts` (shader render core), `components/studio/video-export-controls.tsx`; touches `video-stage.tsx` + `studio.tsx`.
- **Related:** video PRD `docs/prds/2026-06-19-video-frame-capture.md`; reuse `render-readiness.ts`, `export-renderer.tsx`, `download.ts`, the Sequence in/out markers.
