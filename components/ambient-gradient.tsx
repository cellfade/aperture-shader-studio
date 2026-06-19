"use client";

import { useEffect, useState } from "react";
import { MeshGradient } from "@paper-design/shaders-react";

/**
 * Ambient atmosphere behind the masthead. Low opacity, slow, edge-faded —
 * the only chromatic light in the page chrome, and it comes from a shader.
 * Frozen under prefers-reduced-motion.
 */
export function AmbientGradient() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-x-0 top-0 h-[420px] opacity-60"
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
