"use client";

import { MeshGradient } from "@paper-design/shaders-react";
import { useReducedMotion } from "@/lib/studio/use-media-query";

/**
 * Ambient atmosphere behind the masthead. Low opacity, slow, edge-faded —
 * the only chromatic light in the page chrome, and it comes from a shader.
 * Frozen under prefers-reduced-motion.
 */
export function AmbientGradient() {
  const reduced = useReducedMotion();

  return (
    <div
      aria-hidden
      // A9 — one-shot CSS "develop-in" fade (opacity 0 → the resting `opacity-60`)
      // on first paint (~400ms). CSS-only because the masthead is outside the
      // Studio MotionProvider subtree; only the container opacity animates (no
      // second loop on the running shader). Reduced motion shows it at rest
      // immediately (the keyframe is neutralised in globals.css).
      className="animate-develop-in pointer-events-none absolute inset-x-0 top-0 h-[420px] opacity-60"
      style={{
        maskImage: "linear-gradient(to bottom, black, transparent 85%)",
        WebkitMaskImage: "linear-gradient(to bottom, black, transparent 85%)",
      }}
    >
      <MeshGradient
        colors={["#0b0d10", "#0f2a3d", "#9ee7ff", "#0b0d10"]}
        distortion={0.9}
        swirl={0.6}
        speed={reduced ? 0 : 0.15}
        style={{ width: "100%", height: "100%" }}
      />
    </div>
  );
}
