"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { m } from "motion/react";
import {
  EXPOSURE_WIPE,
  HERO_CROSSFADE,
  exposureWipe,
  heroCrossfadeVariants,
} from "@/lib/studio/motion";
import { useReducedMotion } from "@/lib/studio/use-media-query";

interface PreviewCrossfadeProps {
  /** Identity of the active layer. A change triggers the hero crossfade. */
  layerKey: string;
  /** The live preview for the current `layerKey` (a `<ShaderView>` or compare seam). */
  children: ReactNode;
  className?: string;
}

interface Layer {
  key: string;
  node: ReactNode;
}

/** Exit duration in ms — the outgoing layer is unmounted after this. */
const EXIT_MS = HERO_CROSSFADE.exit * 1000;

/**
 * A1 (hero) — the one orchestrated moment. Wraps the live preview so that when
 * the active layer changes (`shader.id`), the new canvas fades/scales in
 * (`opacity 0, scale .985 → 1`, ~220ms) while the old fades under it (~160ms,
 * softer), with a single left→right 1px white "exposure wipe" across the frame.
 *
 * **Canvas discipline (PRD D1).** The cap is enforced structurally, not hoped
 * for: state holds at most ONE outgoing layer plus the current one, so the
 * preview renders **≤2** WebGL canvases at any instant. The outgoing layer is
 * unmounted by a timer after the (short) exit beat; if a new switch arrives
 * while a layer is still exiting (rapid switching), it REPLACES the outgoing
 * snapshot and resets the timer — the in-flight transition never stacks and a
 * stale shader canvas is never left mounted. After the overlap the preview
 * collapses back to exactly 1 canvas.
 *
 * **Reduced motion (FR-A1).** `heroCrossfadeVariants(true)` is an instant hard
 * cut (no overlap/scale) and the wipe is not rendered at all (no outgoing layer
 * is ever created under reduced motion).
 *
 * One-shot only: each layer animates exactly once on mount/exit; nothing keeps
 * animating on the persisting preview afterward, so it never competes with the
 * live shader for the main thread once settled.
 */
export function PreviewCrossfade({
  layerKey,
  children,
  className,
}: PreviewCrossfadeProps) {
  const reduced = useReducedMotion();
  const variants = heroCrossfadeVariants(reduced);

  // The active layer is always re-derived from the latest props so the live
  // preview (param tweaks, compare drag) updates without re-mounting the canvas.
  const current: Layer = { key: layerKey, node: children };

  // At most one outgoing layer is retained during the overlap. Its node is
  // snapshotted at switch time so it keeps rendering its OWN (old) shader while
  // fading out. A timer unmounts it after the exit beat.
  const [outgoing, setOutgoing] = useState<Layer | null>(null);
  const prevKey = useRef(layerKey);
  const prevNode = useRef<ReactNode>(children);
  const exitTimer = useRef<number | null>(null);
  // Bumped once per switch so the wipe re-mounts and replays a single pass.
  const [wipeId, setWipeId] = useState(0);

  useEffect(() => {
    if (prevKey.current !== layerKey) {
      if (!reduced) {
        // Replace any in-flight outgoing (never stack) and snapshot the layer
        // we're leaving so it fades out rendering its own shader.
        setOutgoing({ key: prevKey.current, node: prevNode.current });
        setWipeId((n) => n + 1);
        if (exitTimer.current !== null) window.clearTimeout(exitTimer.current);
        exitTimer.current = window.setTimeout(() => {
          setOutgoing(null);
          exitTimer.current = null;
        }, EXIT_MS);
      } else {
        // Reduced motion: instant hard cut — no overlap, no outgoing, no wipe.
        if (exitTimer.current !== null) window.clearTimeout(exitTimer.current);
        exitTimer.current = null;
        setOutgoing(null);
      }
      prevKey.current = layerKey;
    }
    prevNode.current = children;
  }, [layerKey, children, reduced]);

  // Clean up the pending unmount timer on unmount.
  useEffect(
    () => () => {
      if (exitTimer.current !== null) window.clearTimeout(exitTimer.current);
    },
    [],
  );

  return (
    <div className={`relative h-full w-full ${className ?? ""}`}>
      {/* Outgoing layer — only present during the short exit beat, then removed
          by the timer. Capped to one; a newer switch replaces it. Sits beneath
          the incoming layer. */}
      {outgoing && outgoing.key !== current.key && (
        <m.div
          key={outgoing.key}
          variants={variants}
          initial="visible"
          animate="exit"
          className="absolute inset-0"
        >
          {outgoing.node}
        </m.div>
      )}

      {/* Incoming / current layer — re-keyed on switch so it remounts and plays
          the enter beat once, then renders the live preview at rest. */}
      <m.div
        key={current.key}
        variants={variants}
        initial="hidden"
        animate="visible"
        className="absolute inset-0"
      >
        {current.node}
      </m.div>

      {/* The single one-pass exposure wipe: a 1px white hairline sweeping
          left→right once per switch (reuses the seam-glow vocabulary). Not a
          loop — it ends at opacity 0 off-frame. Suppressed under reduced motion.
          `wipeId > 0` keeps it off the very first paint. */}
      {!reduced && wipeId > 0 && (
        <m.span
          key={wipeId}
          aria-hidden
          variants={exposureWipe}
          initial="hidden"
          animate="visible"
          className="pointer-events-none absolute inset-y-0 z-10 w-px"
          style={{
            background: "#fff",
            boxShadow:
              "0 0 0 1px rgba(0,0,0,0.45), 0 0 10px rgba(255,255,255,0.4)",
          }}
          transition={{ duration: EXPOSURE_WIPE.duration }}
        />
      )}
    </div>
  );
}
