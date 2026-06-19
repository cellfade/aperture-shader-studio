"use client";

import { useSyncExternalStore } from "react";

/**
 * SSR-safe media-query subscription via `useSyncExternalStore`. Subscribes to the
 * `MediaQueryList` `change` event and reads `mql.matches` as the snapshot. The
 * server snapshot is `false`, so there is no hydration mismatch and no
 * setState-in-effect.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = (onChange: () => void) => {
    if (typeof window === "undefined" || !window.matchMedia) return () => {};
    const mql = window.matchMedia(query);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  };
  const getSnapshot = () =>
    typeof window !== "undefined" && window.matchMedia
      ? window.matchMedia(query).matches
      : false;
  const getServerSnapshot = () => false;
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** True when the user has requested reduced motion. SSR-safe (defaults to false). */
export function useReducedMotion(): boolean {
  return useMediaQuery("(prefers-reduced-motion: reduce)");
}
