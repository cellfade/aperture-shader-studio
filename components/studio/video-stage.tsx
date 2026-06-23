"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ExportShimmer } from "@/components/studio/export-beat";
import { captureVideoFrame } from "@/lib/studio/capture-frame";
import { clampToMaxSide } from "@/lib/studio/download";
import { zipAndDownloadFrames } from "@/lib/studio/zip-frames";
import type { BatchFrame } from "@/components/studio/batch-export-renderer";
import { VideoExporterLoadError } from "@/components/studio/use-video-export";

const FOCUS =
  "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

const MIN_FRAMES = 2;
const MAX_FRAMES = 30;
const DEFAULT_FRAMES = 8;

function fmt(t: number): string {
  if (!Number.isFinite(t)) return "0:00";
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
function stamp(t: number): string {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const ms = Math.floor((t % 1) * 1000);
  return `${m}m${s.toString().padStart(2, "0")}s${ms.toString().padStart(3, "0")}`;
}

/**
 * Throttle progress announcements to ~decile (10%) milestones plus the final
 * frame. Per-frame polite-live-region updates get coalesced + skipped by screen
 * readers (#43); this writes the live-region text only when a new decile is
 * crossed, while the visual per-frame status is updated separately and untouched.
 *
 * `decileRef` holds the last announced decile (0–10); seed it to -1 per run so
 * the first reported frame announces. Returns the (possibly unchanged) text to
 * set, or `null` to skip this update.
 */
function milestoneText(
  done: number,
  total: number,
  decileRef: { current: number },
  verb: string,
): string | null {
  if (total <= 0) return null;
  const decile = done >= total ? 10 : Math.floor((done / total) * 10);
  if (decile <= decileRef.current) return null;
  decileRef.current = decile;
  return `${verb} ${done} of ${total}`;
}

/** Resolve once the video has finished seeking (so the drawn frame is the target one). */
function awaitSeeked(
  v: HTMLVideoElement,
  signal?: AbortSignal,
  timeoutMs = 1500,
): Promise<void> {
  if (!v.seeking && v.readyState >= 2) return Promise.resolve();
  return new Promise((resolve) => {
    let done = false;
    let timer = 0;
    const finish = () => {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      v.removeEventListener("seeked", finish);
      signal?.removeEventListener("abort", finish);
      resolve();
    };
    v.addEventListener("seeked", finish, { once: true });
    signal?.addEventListener("abort", finish, { once: true });
    timer = window.setTimeout(finish, timeoutMs);
  });
}

/** Seek to `t` and resolve once that exact frame is presented (awaiting 'seeked'). */
function seekTo(v: HTMLVideoElement, t: number, signal?: AbortSignal): Promise<void> {
  v.currentTime = t;
  return awaitSeeked(v, signal);
}

interface VideoStageProps {
  src: string;
  /** Lazily read the start time (called at mount) — avoids reading a ref during render. */
  getInitialTime?: () => number;
  onMeta?: (w: number, h: number, duration: number) => void;
  onTime?: (t: number) => void;
  onCapture: (url: string, w: number, h: number, label: string) => void;
  onError?: (msg: string) => void;
  /** Render extracted frames through the active shader → ordered PNG blobs (null = failed). */
  renderSequence?: (
    frames: BatchFrame[],
    onProgress: (rendered: number, total: number) => void,
    signal: AbortSignal,
  ) => Promise<Blob[] | null>;
  /** Encode the in/out range through the active shader to an MP4 and download it. */
  exportVideo?: (
    inSec: number,
    outSec: number,
    onProgress: (done: number, total: number) => void,
    signal: AbortSignal,
  ) => Promise<void>;
  /** Active shader id, used for the zip filename. */
  shaderId?: string;
}

export function VideoStage({
  src,
  getInitialTime,
  onMeta,
  onTime,
  onCapture,
  onError,
  renderSequence,
  exportVideo,
  shaderId,
}: VideoStageProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const scrubbing = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(() => getInitialTime?.() ?? 0);
  const [duration, setDuration] = useState(0);
  const [busy, setBusy] = useState(false);

  // ── sequence export state ──────────────────────────────────────
  const [seqOpen, setSeqOpen] = useState(false);
  const [inTime, setInTime] = useState(0);
  const [outTime, setOutTime] = useState(0);
  const [count, setCount] = useState(DEFAULT_FRAMES);
  const [running, setRunning] = useState(false);
  const [seqStatus, setSeqStatus] = useState(""); // visual, per-frame
  const [seqAnnounce, setSeqAnnounce] = useState(""); // live-region, throttled
  const seqDecileRef = useRef(-1);
  const abortRef = useRef<AbortController | null>(null);

  // ── mp4 export state ───────────────────────────────────────────
  const [videoExportOk, setVideoExportOk] = useState(false);
  const [vidRunning, setVidRunning] = useState(false);
  const [vidStatus, setVidStatus] = useState(""); // visual, per-frame
  const [vidAnnounce, setVidAnnounce] = useState(""); // live-region, throttled
  const vidDecileRef = useRef(-1);
  const vidAbortRef = useRef<AbortController | null>(null);

  // Probe WebCodecs H.264 support without importing the heavy export module.
  useEffect(() => {
    if (typeof window === "undefined" || !("VideoEncoder" in window)) return;
    let cancelled = false;
    VideoEncoder.isConfigSupported({
      codec: "avc1.42001f",
      width: 1280,
      height: 720,
      bitrate: 1_000_000,
      framerate: 30,
    })
      .then((res) => {
        if (!cancelled) setVideoExportOk(res.supported === true);
      })
      .catch(() => {
        if (!cancelled) setVideoExportOk(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const seekable = Number.isFinite(duration) && duration > 0;

  const syncDuration = () => {
    const v = videoRef.current;
    if (!v) return;
    const d = Number.isFinite(v.duration) ? v.duration : 0;
    setDuration(d);
    if (d > 0) {
      onMeta?.(v.videoWidth, v.videoHeight, d);
      // default the sequence out-point to the full clip the first time we learn it
      setOutTime((prev) => (prev > 0 ? prev : d));
    }
  };

  const handleLoadedMeta = () => {
    const v = videoRef.current;
    if (!v) return;
    syncDuration();
    const it = getInitialTime?.() ?? 0;
    if (it > 0 && Number.isFinite(v.duration) && it < v.duration) {
      v.currentTime = it;
    }
  };

  const handleTimeUpdate = () => {
    const v = videoRef.current;
    if (!v || scrubbing.current) return;
    setCurrent(v.currentTime);
    onTime?.(v.currentTime);
  };

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => {});
    else v.pause();
  };

  const seek = (t: number) => {
    const v = videoRef.current;
    if (!v || !seekable) return;
    const clamped = Math.max(0, Math.min(duration, t));
    v.currentTime = clamped;
    setCurrent(clamped);
    onTime?.(clamped);
  };

  // Step one frame using requestVideoFrameCallback for an exact single-frame
  // advance where available; otherwise fall back to a ~1/30s nudge.
  const step = (dir: number) => {
    const v = videoRef.current;
    if (!v) return;
    if (!v.paused) v.pause();
    const rvfc = typeof v.requestVideoFrameCallback === "function";
    if (rvfc && dir > 0) {
      // forward: let the decoder present the very next frame, then sync to its time
      v.requestVideoFrameCallback((_now, meta) => {
        const t = typeof meta.mediaTime === "number" ? meta.mediaTime : v.currentTime;
        setCurrent(t);
        onTime?.(t);
      });
      seek(v.currentTime + 1 / 60); // smallest reliable nudge; rVFC reports the real landing time
      return;
    }
    seek(v.currentTime + dir / 30); // ~1 frame nudge (no stable fps API)
  };

  const onSliderKey = (e: React.KeyboardEvent) => {
    const v = videoRef.current;
    if (!v) return;
    let t: number | null = null;
    if (e.key === "ArrowLeft" || e.key === "ArrowDown") t = v.currentTime - 1;
    else if (e.key === "ArrowRight" || e.key === "ArrowUp") t = v.currentTime + 1;
    else if (e.key === "PageDown") t = v.currentTime - 10;
    else if (e.key === "PageUp") t = v.currentTime + 10;
    else if (e.key === "Home") t = 0;
    else if (e.key === "End") t = duration;
    if (t !== null) {
      e.preventDefault();
      if (!v.paused) v.pause();
      seek(t);
    }
  };

  const capture = useCallback(async () => {
    const v = videoRef.current;
    if (!v || busy) return;
    v.pause();
    setBusy(true);
    try {
      await awaitSeeked(v); // ensure the displayed frame is the target frame
      const frame = await captureVideoFrame(v);
      onCapture(frame.url, frame.w, frame.h, stamp(v.currentTime));
    } catch (err) {
      const msg =
        err instanceof DOMException && err.name === "SecurityError"
          ? "Can't capture this video (cross-origin source)."
          : "Couldn't capture this frame — try another moment.";
      onError?.(msg);
    } finally {
      setBusy(false);
    }
  }, [busy, onCapture, onError]);

  // ── sequence export ────────────────────────────────────────────
  const seqValid =
    seekable && outTime > inTime && count >= MIN_FRAMES && count <= MAX_FRAMES;
  // While running the button toggles to a always-enabled "Cancel".
  const seqDisabled = !running && (!seqValid || vidRunning);
  // In/out markers are locked while either export runs, or with no seekable clip.
  const markersLocked = running || vidRunning || !seekable;

  const setIn = () => {
    if (markersLocked) return;
    setInTime(current);
  };
  const setOut = () => {
    if (markersLocked) return;
    setOutTime(current);
  };

  const cancelSequence = () => {
    abortRef.current?.abort();
  };

  const runSequence = useCallback(async () => {
    const v = videoRef.current;
    if (!v || running || !renderSequence) return;
    const n = Math.max(MIN_FRAMES, Math.min(MAX_FRAMES, Math.round(count)));
    const lo = Math.max(0, Math.min(inTime, outTime));
    const hi = Math.min(duration, Math.max(inTime, outTime));
    if (!(hi > lo)) return;

    const controller = new AbortController();
    abortRef.current = controller;
    const { signal } = controller;

    v.pause();
    setRunning(true);
    seqDecileRef.current = -1;
    setSeqAnnounce(`Exporting ${n} frames…`);
    const created: string[] = [];
    let done = false;

    const cleanup = () => {
      for (const url of created) URL.revokeObjectURL(url);
    };

    try {
      const frames: BatchFrame[] = [];
      for (let i = 0; i < n; i++) {
        if (signal.aborted) throw new DOMException("Aborted", "AbortError");
        setSeqStatus(`Extracting ${i + 1}/${n}…`);
        const t = lo + ((hi - lo) * i) / (n - 1);
        await seekTo(v, t, signal);
        if (signal.aborted) throw new DOMException("Aborted", "AbortError");
        const cap = await captureVideoFrame(v);
        created.push(cap.url);
        const { width, height } = clampToMaxSide(cap.w, cap.h);
        frames.push({ imageUrl: cap.url, width, height });
      }

      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      setSeqStatus(`Rendering 1/${n}…`);
      const blobs = await renderSequence(
        frames,
        (rendered, total) => {
          setSeqStatus(`Rendering ${rendered}/${total}…`); // visual, per-frame
          const msg = milestoneText(rendered, total, seqDecileRef, "Rendered");
          if (msg) setSeqAnnounce(msg); // live-region, throttled to deciles
        },
        signal,
      );
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      if (!blobs || blobs.length === 0) {
        onError?.("Sequence render failed — try fewer frames or another shader.");
        setSeqStatus("");
        return;
      }

      setSeqStatus("Packaging…");
      await zipAndDownloadFrames(blobs, `frames-${shaderId ?? "shader"}.zip`);
      done = true;
      setSeqStatus(`Saved ${blobs.length} frames ✓`);
      setSeqAnnounce(`Saved ${blobs.length} frames.`);
      window.setTimeout(() => setSeqStatus((s) => (s.startsWith("Saved") ? "" : s)), 2400);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setSeqStatus("Cancelled");
        setSeqAnnounce("Frame export cancelled.");
        window.setTimeout(() => setSeqStatus((s) => (s === "Cancelled" ? "" : s)), 1600);
      } else {
        onError?.("Couldn't export the sequence — try a shorter range.");
        setSeqStatus("");
        setSeqAnnounce("");
      }
    } finally {
      cleanup();
      if (!done) setSeqStatus((s) => (s.startsWith("Rendering") || s.startsWith("Extracting") || s === "Packaging…" ? "" : s));
      setRunning(false);
      abortRef.current = null;
    }
  }, [running, renderSequence, count, inTime, outTime, duration, shaderId, onError]);

  // ── mp4 export ─────────────────────────────────────────────────
  const vidValid = seekable && outTime > inTime;
  const vidDisabled = !vidRunning && (!vidValid || running);
  // While either export runs, the in/out markers + frame count are locked.
  const anyRunning = running || vidRunning;

  const cancelVideoExport = () => {
    vidAbortRef.current?.abort();
  };

  const runVideoExport = useCallback(async () => {
    const v = videoRef.current;
    if (!v || vidRunning || !exportVideo) return;
    const lo = Math.max(0, Math.min(inTime, outTime));
    const hi = Math.min(duration, Math.max(inTime, outTime));
    if (!(hi > lo)) return;

    const controller = new AbortController();
    vidAbortRef.current = controller;
    const { signal } = controller;

    v.pause();
    setVidRunning(true);
    setVidStatus("Preparing…");
    vidDecileRef.current = -1;
    setVidAnnounce("Preparing MP4 export…");
    let done = false;

    try {
      await exportVideo(
        lo,
        hi,
        (rendered, total) => {
          setVidStatus(`Rendering ${rendered}/${total}…`); // visual, per-frame
          const msg = milestoneText(rendered, total, vidDecileRef, "Encoded");
          if (msg) setVidAnnounce(msg); // live-region, throttled to deciles
        },
        signal,
      );
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      done = true;
      setVidStatus("Saved ✓");
      setVidAnnounce("MP4 export saved.");
      window.setTimeout(() => setVidStatus((s) => (s === "Saved ✓" ? "" : s)), 2400);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setVidStatus("Cancelled");
        setVidAnnounce("MP4 export cancelled.");
        window.setTimeout(() => setVidStatus((s) => (s === "Cancelled" ? "" : s)), 1600);
      } else if (err instanceof VideoExporterLoadError) {
        // #24: the exporter chunk failed to load — distinct from an encode
        // failure, so surface the connectivity-oriented message.
        onError?.(err.message);
        setVidStatus("");
        setVidAnnounce("");
      } else {
        onError?.("Couldn't export the video — try a shorter range or another shader.");
        setVidStatus("");
        setVidAnnounce("");
      }
    } finally {
      if (!done) setVidStatus((s) => (s.startsWith("Rendering") || s === "Preparing…" ? "" : s));
      setVidRunning(false);
      vidAbortRef.current = null;
    }
  }, [vidRunning, exportVideo, inTime, outTime, duration, onError]);

  return (
    <div className="flex h-full w-full flex-col">
      <div className="relative flex min-h-0 flex-1 items-center justify-center">
        {/* Muted, no-audio preview (no captions needed); never autoplays. */}
        <video
          ref={videoRef}
          src={src}
          muted
          playsInline
          preload="auto"
          aria-label="Video preview — scrub to a frame, then capture it"
          onLoadedMetadata={handleLoadedMeta}
          onDurationChange={syncDuration}
          onTimeUpdate={handleTimeUpdate}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
          onError={() => onError?.("Couldn't play that video. Try MP4 or WebM.")}
          className="max-h-full max-w-full rounded-lg ring-1 ring-white/10"
        />
      </div>

      {/* transport: controls / scrubber / capture — stacks on mobile, inline on desktop */}
      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={togglePlay}
            aria-label={playing ? "Pause" : "Play"}
            className={`grid size-9 shrink-0 place-items-center rounded-md border border-border text-foreground transition-colors hover:bg-foreground/10 ${FOCUS}`}
          >
            {playing ? <PauseIcon /> : <PlayIcon />}
          </button>
          <button
            type="button"
            onClick={() => step(-1)}
            aria-label="Step back ~1 frame"
            className={`grid size-9 place-items-center rounded-md border border-border text-muted-foreground transition-colors hover:text-foreground ${FOCUS}`}
          >
            <StepIcon dir="prev" />
          </button>
          <button
            type="button"
            onClick={() => step(1)}
            aria-label="Step forward ~1 frame"
            className={`grid size-9 place-items-center rounded-md border border-border text-muted-foreground transition-colors hover:text-foreground ${FOCUS}`}
          >
            <StepIcon dir="next" />
          </button>
        </div>

        <input
          type="range"
          min={0}
          max={seekable ? duration : 1}
          step={0.01}
          value={current}
          disabled={!seekable}
          aria-label="Seek"
          aria-valuetext={`${fmt(current)} of ${fmt(duration)}`}
          onPointerDown={() => {
            scrubbing.current = true;
            videoRef.current?.pause();
          }}
          onPointerUp={() => {
            scrubbing.current = false;
          }}
          onKeyDown={onSliderKey}
          onChange={(e) => seek(parseFloat(e.target.value))}
          className="h-1 w-full cursor-ew-resize rounded-full bg-border py-2 outline-none disabled:opacity-40 sm:w-auto sm:flex-1"
        />

        <div className="flex items-center justify-between gap-3 sm:justify-start">
          <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
            {fmt(current)} / {fmt(duration)}
          </span>
          {(renderSequence || exportVideo) && (
            <button
              type="button"
              onClick={() => setSeqOpen((v) => !v)}
              aria-expanded={seqOpen}
              aria-controls="sequence-panel"
              className={`shrink-0 rounded-md border border-border px-3 py-2 font-mono text-[11px] uppercase tracking-[0.1em] transition-colors hover:bg-foreground/10 ${
                seqOpen ? "bg-foreground/10 text-foreground" : "text-muted-foreground"
              } ${FOCUS}`}
            >
              Sequence
            </button>
          )}
          <button
            type="button"
            onClick={capture}
            aria-disabled={busy}
            aria-busy={busy}
            onClickCapture={(e) => {
              if (busy) e.stopPropagation();
            }}
            className={`shrink-0 rounded-md border border-border bg-foreground/[0.06] px-3 py-2 font-mono text-[11px] uppercase tracking-[0.1em] text-foreground transition-colors hover:bg-foreground/15 aria-disabled:text-muted-foreground aria-disabled:hover:bg-foreground/[0.06] ${FOCUS}`}
          >
            {busy ? "Capturing…" : "Capture frame"}
          </button>
        </div>
      </div>

      {/* sequence + mp4 export panel */}
      {(renderSequence || exportVideo) && seqOpen && (
        <div
          id="sequence-panel"
          className="mt-3 flex flex-col gap-3 rounded-md border border-border bg-foreground/[0.02] p-3 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={setIn}
              onClickCapture={(e) => {
                if (markersLocked) e.stopPropagation();
              }}
              aria-disabled={markersLocked || undefined}
              className={`rounded-md border border-border px-2.5 py-1.5 font-mono text-[11px] uppercase tracking-[0.1em] text-foreground transition-colors hover:bg-foreground/10 aria-disabled:text-muted-foreground aria-disabled:hover:bg-transparent ${FOCUS}`}
            >
              Set in
            </button>
            <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
              in {fmt(inTime)}
            </span>
            <button
              type="button"
              onClick={setOut}
              onClickCapture={(e) => {
                if (markersLocked) e.stopPropagation();
              }}
              aria-disabled={markersLocked || undefined}
              className={`rounded-md border border-border px-2.5 py-1.5 font-mono text-[11px] uppercase tracking-[0.1em] text-foreground transition-colors hover:bg-foreground/10 aria-disabled:text-muted-foreground aria-disabled:hover:bg-transparent ${FOCUS}`}
            >
              Set out
            </button>
            <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
              out {fmt(outTime)}
            </span>
            {renderSequence && (
              <label className="ms-1 flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
                Frames
                <input
                  type="number"
                  inputMode="numeric"
                  min={MIN_FRAMES}
                  max={MAX_FRAMES}
                  value={count}
                  disabled={anyRunning}
                  aria-label="Frame count (2 to 30)"
                  onChange={(e) => {
                    const n = parseInt(e.target.value, 10);
                    if (Number.isNaN(n)) setCount(MIN_FRAMES);
                    else setCount(Math.max(MIN_FRAMES, Math.min(MAX_FRAMES, n)));
                  }}
                  className={`w-14 rounded-md border border-border bg-transparent px-2 py-1 text-center font-mono text-[12px] tabular-nums text-foreground disabled:opacity-50 ${FOCUS}`}
                />
              </label>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {(running || vidRunning || seqStatus || vidStatus) && (
              <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                {running ? seqStatus : vidRunning ? vidStatus : vidStatus || seqStatus}
              </span>
            )}
            {/* Frames → zip (secondary, outline). Persistent button: toggles to Cancel so focus is never lost on completion. */}
            {renderSequence && (
              <button
                type="button"
                onClick={running ? cancelSequence : runSequence}
                onClickCapture={(e) => {
                  if (seqDisabled) e.stopPropagation();
                }}
                aria-disabled={seqDisabled || undefined}
                aria-describedby={seqDisabled ? "seq-reason" : undefined}
                aria-label={running ? "Cancel frame export" : "Export frames as a zip"}
                className={`relative overflow-hidden rounded-md border border-border px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.1em] text-foreground transition-colors hover:bg-foreground/10 aria-disabled:text-muted-foreground aria-disabled:hover:bg-transparent ${FOCUS}`}
              >
                {running ? "Cancel" : "Frames · zip"}
                {/* A7 — indeterminate hairline shimmer while the frame export
                   runs. Visible-button-only; the off-screen BatchExportRenderer
                   and its timing are untouched (D2). */}
                {running && <ExportShimmer />}
              </button>
            )}
            {/* Video → mp4 (primary, filled). */}
            {exportVideo && videoExportOk && (
              <button
                type="button"
                onClick={vidRunning ? cancelVideoExport : runVideoExport}
                onClickCapture={(e) => {
                  if (vidDisabled) e.stopPropagation();
                }}
                aria-disabled={vidDisabled || undefined}
                aria-describedby={vidDisabled ? "vid-reason" : undefined}
                aria-label={vidRunning ? "Cancel MP4 export" : "Export filtered video as MP4"}
                className={`relative overflow-hidden rounded-md border border-foreground/30 bg-foreground/[0.08] px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.1em] text-foreground transition-colors hover:bg-foreground/15 aria-disabled:text-muted-foreground aria-disabled:border-border aria-disabled:bg-transparent aria-disabled:hover:bg-transparent ${FOCUS}`}
              >
                {vidRunning ? "Cancel" : "Video · mp4"}
                {/* A7 — indeterminate hairline shimmer while the MP4 export runs.
                   Visible-button-only; the WebCodecs export path, timing, and
                   frame-buffer discipline are untouched (D2). */}
                {vidRunning && <ExportShimmer />}
              </button>
            )}
          </div>

          {/* Why an export action is unavailable — referenced by aria-describedby
              on the focusable aria-disabled buttons so AT announces the reason. */}
          {renderSequence && seqDisabled && (
            <span id="seq-reason" className="sr-only">
              {vidRunning
                ? "Another export is running."
                : "Set an out-point after the in-point to export frames."}
            </span>
          )}
          {exportVideo && videoExportOk && vidDisabled && (
            <span id="vid-reason" className="sr-only">
              {running
                ? "Another export is running."
                : "Set an out-point after the in-point to export an MP4."}
            </span>
          )}

          {exportVideo && !videoExportOk && (
            <p
              role="status"
              aria-live="polite"
              className="font-mono text-[11px] text-foreground/85 sm:basis-full"
            >
              MP4 export needs Chrome, Edge, or Safari — frame zip works everywhere.
            </p>
          )}

          {/* Live regions read the THROTTLED milestone text (every ~10% +
              start/done), not the per-frame visual status above, so AT doesn't
              coalesce and skip intermediate steps (#43). */}
          <div className="sr-only" role="status" aria-live="polite">
            {seqAnnounce}
          </div>
          <div className="sr-only" role="status" aria-live="polite">
            {vidAnnounce}
          </div>
        </div>
      )}
    </div>
  );
}

function PlayIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}
function PauseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M6 5h4v14H6zM14 5h4v14h-4z" />
    </svg>
  );
}
function StepIcon({ dir }: { dir: "prev" | "next" }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
      style={dir === "prev" ? { transform: "scaleX(-1)" } : undefined}
    >
      <path d="M5 5v14l9-7zM16 5h3v14h-3z" />
    </svg>
  );
}
