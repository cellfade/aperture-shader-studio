"use client";

import { useEffect, useRef } from "react";
import {
  decodeState,
  encodeState,
  type UrlState,
} from "@/lib/studio/url-state";

/** Read + validate the current location hash once (SSR-safe → null on server). */
export function readInitialUrlState(): UrlState | null {
  if (typeof window === "undefined") return null;
  return decodeState(window.location.hash);
}

interface Options {
  /** Current shareable state to mirror into the hash. */
  state: UrlState;
  /**
   * Called when the hash changes from OUTSIDE our own writes (back/forward
   * navigation, manual edit, a pasted link) with the decoded state — so the
   * studio can restore it. Not called for our own `replaceState` writes.
   */
  onExternalChange: (state: UrlState) => void;
  /** Debounce for hash writes (ms) — keeps slider drags from spamming. */
  debounceMs?: number;
}

const DEFAULT_DEBOUNCE_MS = 200;

/**
 * Two-way sync between studio state and the URL hash.
 *
 * - Writes are debounced and use `history.replaceState` so dragging a slider
 *   doesn't flood the Back stack.
 * - Reads on `hashchange` (back/forward / manual edits) call `onExternalChange`;
 *   our own writes are tagged via a ref so they don't echo back as external.
 * - Never encodes the image/video — only `shaderId` + `values` (see url-state).
 */
export function useUrlState({
  state,
  onExternalChange,
  debounceMs = DEFAULT_DEBOUNCE_MS,
}: Options): void {
  const onExternalChangeRef = useRef(onExternalChange);
  useEffect(() => {
    onExternalChangeRef.current = onExternalChange;
  }, [onExternalChange]);

  // The last hash WE wrote — so the resulting `hashchange` is recognized as
  // ours and not bounced back through onExternalChange.
  const ownHashRef = useRef<string | null>(null);
  const timerRef = useRef<number | null>(null);
  const firstWriteSkipped = useRef(false);

  const encoded = encodeState(state);

  // Debounced write of the latest encoded state via replaceState.
  useEffect(() => {
    if (typeof window === "undefined") return;
    // Skip the initial mount write: it carries default state and would clobber
    // an incoming shared-link hash before the studio applies it post-mount.
    // Only user-driven state changes (subsequent runs) should write the hash —
    // this also keeps a hash-free URL clean until the user changes something.
    if (!firstWriteSkipped.current) {
      firstWriteSkipped.current = true;
      return;
    }
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      const next = `#${encoded}`;
      if (window.location.hash === next) return;
      ownHashRef.current = next;
      const { pathname, search } = window.location;
      window.history.replaceState(null, "", `${pathname}${search}${next}`);
    }, debounceMs);
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, [encoded, debounceMs]);

  // Restore on external hash changes (back/forward / manual paste).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onHashChange = () => {
      const current = window.location.hash;
      if (current === ownHashRef.current) return; // our own write — ignore
      const decoded = decodeState(current);
      if (decoded) onExternalChangeRef.current(decoded);
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);
}

/** Convenience: build the full shareable URL for the current state. */
export function buildShareUrl(state: UrlState): string {
  if (typeof window === "undefined") return "";
  const { origin, pathname } = window.location;
  const encoded = encodeState(state);
  return `${origin}${pathname}#${encoded}`;
}

/** Imperative copy of the share link; returns whether it succeeded. */
export async function copyShareLink(url: string): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.clipboard) return false;
  try {
    await navigator.clipboard.writeText(url);
    return true;
  } catch {
    return false;
  }
}
