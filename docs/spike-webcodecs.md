# Spike: WebCodecs filtered-video export — frame sourcing

> Throwaway feasibility spike. The encode → mux → playable-MP4 path is proven
> in `app/spike/page.tsx` (VideoEncoder + mp4-muxer 5.2.2, codec `avc1.42001f`).
> This note records the one decision the spike does **not** settle: where the
> real feature gets its source frames from.
>
> Spike status: written and type-checks (`npx tsc --noEmit` passes). It has
> **not** been executed in a browser by the author; the orchestrator runs it in
> Chromium via Playwright and reads the `RESULT` line from `#spike-status`.

## The question

The spike synthesizes frames on a canvas. The real feature must pull frames out
of an existing video, run each through the shader pipeline, then re-encode. The
hard part is getting a clean, in-order, gap-free sequence of frames to feed the
encoder. Two viable approaches:

### Option A — Demux + `VideoDecoder` (MP4Box.js)

Use MP4Box.js (or similar) to demux the source container, pull encoded samples,
and decode them with a WebCodecs `VideoDecoder`. Each decoded `VideoFrame` is
drawn through the shader, re-encoded, and muxed.

- **Exactness:** frame-exact. You get every coded frame exactly once, in
  presentation order, with the source's real timestamps and durations. No
  guessing about frame boundaries.
- **Perf:** fastest. Decode is hardware-accelerated and pull-based — no
  real-time playback constraint, no reliance on the `<video>` render clock.
- **Complexity:** highest. Adds an `mp4box` dependency, plus container parsing,
  sample-to-decoder plumbing, codec-config (`description`/`avcC`) extraction,
  decode-order vs presentation-order handling, and backpressure across two
  WebCodecs queues. Format coverage is bounded by what you demux/decode.

### Option B — Deterministic seek-step + `drawImage` on a `<video>`

Load the source into a hidden `<video>`, then for each target frame set
`currentTime`, wait for the `seeked` event, and `drawImage` the element onto a
canvas to capture that frame.

- **Exactness:** approximate and the real risk. Seeking lands on the nearest
  decodable frame, not necessarily the exact timestamp you asked for. At dense
  frame rates the rounding between your target times and actual decoded frames
  produces **duplicated or dropped frames** — visible judder, and drift against
  the audio if audio is ever added. `requestVideoFrameCallback` tightens this
  but does not make arbitrary-time seeks frame-exact.
- **Perf:** slower. Each step pays a seek + decode + `seeked` round-trip gated
  by the media element; throughput is well below pull-based decode.
- **Complexity:** lowest. No extra dependency, little code, and it transparently
  handles any format the browser's `<video>` can play.

## Recommendation: **Option A (demux + `VideoDecoder`)**

For a video *export* feature, frame-exactness is the product. Option B's
duplicate/dropped-frame risk is intrinsic to seek-stepping — it is exactly the
artifact users would notice in an exported file, and it cannot be fully
engineered away while sourcing frames through the `<video>` render path. Option
A removes that risk by construction: one decoded frame in, one shaded frame out,
correct timestamps throughout. It is also the faster path, which matters when
exporting hundreds or thousands of frames.

The cost is real — an `mp4box` dependency and meaningfully more plumbing
(container parse, codec config extraction, two coordinated WebCodecs queues).
That complexity is justified for the core export path. The spike already proves
the encode/mux half on the same WebCodecs foundation, so Option A reuses that
machinery and adds a decoder of the same shape on the front.

**Suggested hedge:** keep Option B as a narrowly-scoped fallback for source
formats the demux path can't yet handle (so export degrades to "available but
approximate" rather than "unsupported"), and start the real implementation by
extending the spike with an MP4Box `VideoDecoder` front-end.
