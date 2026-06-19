"use client";

import { useCallback, useRef, useState } from "react";
import { captureVideoFrame } from "@/lib/studio/capture-frame";

const FOCUS =
  "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

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

/** Resolve once the video has finished seeking (so the drawn frame is the target one). */
function awaitSeeked(v: HTMLVideoElement, timeoutMs = 1500): Promise<void> {
  if (!v.seeking && v.readyState >= 2) return Promise.resolve();
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      v.removeEventListener("seeked", finish);
      resolve();
    };
    v.addEventListener("seeked", finish, { once: true });
    window.setTimeout(finish, timeoutMs);
  });
}

interface VideoStageProps {
  src: string;
  initialTime?: number;
  onMeta?: (w: number, h: number, duration: number) => void;
  onTime?: (t: number) => void;
  onCapture: (url: string, w: number, h: number, label: string) => void;
  onError?: (msg: string) => void;
}

export function VideoStage({
  src,
  initialTime = 0,
  onMeta,
  onTime,
  onCapture,
  onError,
}: VideoStageProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const scrubbing = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(initialTime);
  const [duration, setDuration] = useState(0);
  const [busy, setBusy] = useState(false);

  const seekable = Number.isFinite(duration) && duration > 0;

  const syncDuration = () => {
    const v = videoRef.current;
    if (!v) return;
    const d = Number.isFinite(v.duration) ? v.duration : 0;
    setDuration(d);
    if (d > 0) onMeta?.(v.videoWidth, v.videoHeight, d);
  };

  const handleLoadedMeta = () => {
    const v = videoRef.current;
    if (!v) return;
    syncDuration();
    if (initialTime > 0 && Number.isFinite(v.duration) && initialTime < v.duration) {
      v.currentTime = initialTime;
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

  const step = (dir: number) => {
    const v = videoRef.current;
    if (!v) return;
    if (!v.paused) v.pause();
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

  return (
    <div className="flex h-full w-full flex-col">
      <div className="relative flex min-h-0 flex-1 items-center justify-center">
        {/* Muted, no-audio preview (no captions needed); never autoplays. */}
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
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
          <button
            type="button"
            onClick={capture}
            aria-disabled={busy}
            aria-busy={busy}
            onClickCapture={(e) => {
              if (busy) e.stopPropagation();
            }}
            className={`shrink-0 rounded-md border border-border bg-foreground/[0.06] px-3 py-2 font-mono text-[11px] uppercase tracking-[0.1em] text-foreground transition-colors hover:bg-foreground/15 aria-disabled:opacity-60 ${FOCUS}`}
          >
            {busy ? "Capturing…" : "Capture frame"}
          </button>
        </div>
      </div>
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
