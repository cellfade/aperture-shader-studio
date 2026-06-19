"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

interface CompareSliderProps {
  before: ReactNode;
  after: ReactNode;
  beforeLabel?: string;
  afterLabel?: string;
  glow?: string;
}

export function CompareSlider({
  before,
  after,
  beforeLabel = "Original",
  afterLabel = "Filtered",
  glow = "#e8ebf0",
}: CompareSliderProps) {
  const [pos, setPos] = useState(9);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const touched = useRef(false);

  const setFromClientX = useCallback((clientX: number) => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const next = ((clientX - rect.left) / rect.width) * 100;
    setPos(Math.max(0, Math.min(100, next)));
  }, []);

  // One orchestrated reveal on load — the seam sweeps to rest. Skipped under reduced motion.
  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setPos(56);
      return;
    }
    let raf = 0;
    let startedAt: number | null = null;
    const from = 9;
    const to = 56;
    const dur = 900;
    const tick = (t: number) => {
      if (touched.current) return;
      if (startedAt === null) startedAt = t;
      const k = Math.min(1, (t - startedAt) / dur);
      const eased = 1 - Math.pow(1 - k, 3);
      setPos(from + (to - from) * eased);
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    touched.current = true;
    dragging.current = true;
    containerRef.current?.setPointerCapture(e.pointerId);
    setFromClientX(e.clientX);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging.current) return;
    setFromClientX(e.clientX);
  };
  const endDrag = (e: React.PointerEvent) => {
    dragging.current = false;
    containerRef.current?.releasePointerCapture?.(e.pointerId);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 10 : 2;
    let handled = true;
    if (e.key === "ArrowLeft") setPos((p) => Math.max(0, p - step));
    else if (e.key === "ArrowRight") setPos((p) => Math.min(100, p + step));
    else if (e.key === "Home") setPos(0);
    else if (e.key === "End") setPos(100);
    else handled = false;
    if (handled) {
      touched.current = true;
      e.preventDefault();
    }
  };

  return (
    <div
      ref={containerRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      className="group relative h-full w-full touch-none select-none overflow-hidden"
    >
      {/* BEFORE — the actual image, full bleed underneath */}
      <div className="absolute inset-0">{before}</div>

      {/* AFTER — the shader, clipped to the right of the seam */}
      <div
        className="absolute inset-0"
        style={{ clipPath: `inset(0 0 0 ${pos}%)` }}
      >
        {after}
      </div>

      {/* corner labels — mono microtype in high-contrast pills (chrome stays monochrome) */}
      <span className="pointer-events-none absolute left-3 top-3 z-20 rounded-sm border border-white/15 bg-black/70 px-2 py-[3px] font-mono text-[10px] font-medium uppercase leading-none tracking-[0.2em] text-white/95 shadow-[0_1px_3px_rgba(0,0,0,0.4)] backdrop-blur-sm">
        {beforeLabel}
      </span>
      <span className="pointer-events-none absolute right-3 top-3 z-20 rounded-sm border border-white/15 bg-black/70 px-2 py-[3px] font-mono text-[10px] font-medium uppercase leading-none tracking-[0.2em] text-white/95 shadow-[0_1px_3px_rgba(0,0,0,0.4)] backdrop-blur-sm">
        {afterLabel}
      </span>

      {/* the seam */}
      <div
        className="pointer-events-none absolute inset-y-0 z-10 w-px -translate-x-1/2"
        style={{
          left: `${pos}%`,
          background: "#fff",
          boxShadow: "0 0 0 1px rgba(0,0,0,0.45), 0 0 10px rgba(255,255,255,0.4)",
        }}
      />

      {/* the aperture handle */}
      <div
        role="slider"
        tabIndex={0}
        aria-label="Reveal shader filter"
        aria-orientation="horizontal"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pos)}
        aria-valuetext={`${Math.round(pos)}% revealed — ${afterLabel}`}
        onKeyDown={onKeyDown}
        className="absolute top-1/2 z-20 flex size-11 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize items-center justify-center rounded-full border border-white/45 bg-black/55 backdrop-blur-md outline-none transition-[box-shadow,transform] focus-visible:scale-110 focus-visible:ring-2 focus-visible:ring-ring"
        style={{ left: `${pos}%`, boxShadow: "0 0 0 1px rgba(0,0,0,0.35), 0 0 16px rgba(255,255,255,0.22)" }}
      >
        <span className="block size-4 rounded-full bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.25)]" />
        <span className="absolute -left-3 text-white/85" aria-hidden>
          ‹
        </span>
        <span className="absolute -right-3 text-white/85" aria-hidden>
          ›
        </span>
      </div>
    </div>
  );
}
