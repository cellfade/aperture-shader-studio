/**
 * Pure upload-ingest validation, extracted from the studio orchestrator so the
 * accept/reject rules can be unit-tested without mounting the component.
 *
 * `studio.tsx` owns the side effects (object-URL creation, `<Image>`/`<video>`
 * decode, state updates, user-facing notices); these helpers own only the
 * decisions — MIME acceptance, size/duration caps, and decoded-dimension
 * sanity. Each returns a discriminated result so the caller can map a rejection
 * straight to the existing `flashNotice` copy.
 */

/** Accepted source MIME types (kept in sync with studio.tsx's accept attr). */
export const IMAGE_ACCEPT: readonly string[] = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/avif",
];
export const VIDEO_ACCEPT: readonly string[] = [
  "video/mp4",
  "video/webm",
  "video/quicktime",
];

/** 200 MB upload ceiling for video; longer/heavier clips are rejected up-front. */
export const MAX_VIDEO_BYTES = 200 * 1024 * 1024;
/** Soft duration ceiling (seconds) past which scrubbing is warned about. */
export const MAX_VIDEO_SECONDS = 300;

export type ValidationResult =
  | { ok: true }
  | { ok: false; reason: string; message: string };

const ok: ValidationResult = { ok: true };

/**
 * Validate an image file BEFORE attempting to decode it. An empty `file.type`
 * (some drops/pastes omit it) is allowed through — the subsequent decode is the
 * real gate. A present-but-unaccepted type is rejected.
 */
export function validateImageFile(file: {
  type: string;
}): ValidationResult {
  if (file.type && !IMAGE_ACCEPT.includes(file.type)) {
    return {
      ok: false,
      reason: "unsupported-type",
      message: "Unsupported image — use JPG, PNG, or WebP.",
    };
  }
  return ok;
}

/**
 * Validate a video file BEFORE creating an object URL: type then size. As with
 * images, a blank type defers to later checks; a present-but-unaccepted type is
 * rejected. Oversized files are rejected at the 200 MB ceiling.
 */
export function validateVideoFile(file: {
  type: string;
  size: number;
}): ValidationResult {
  if (file.type && !VIDEO_ACCEPT.includes(file.type)) {
    return {
      ok: false,
      reason: "unsupported-type",
      message: "Unsupported video — use MP4, WebM, or MOV.",
    };
  }
  if (file.size > MAX_VIDEO_BYTES) {
    return {
      ok: false,
      reason: "too-large",
      message: "Video is over 200 MB — try a shorter or smaller clip.",
    };
  }
  return ok;
}

/**
 * Validate decoded image dimensions. A failed decode surfaces as 0×0 (or
 * NaN/negative) natural dimensions; treat anything non-positive as unreadable.
 */
export function validateDecodedImage(dims: {
  width: number;
  height: number;
}): ValidationResult {
  if (
    !Number.isFinite(dims.width) ||
    !Number.isFinite(dims.height) ||
    dims.width <= 0 ||
    dims.height <= 0
  ) {
    return {
      ok: false,
      reason: "undecodable",
      message: "Couldn't read that image. Try another file.",
    };
  }
  return ok;
}

/**
 * Validate a video's decoded metadata: a clip with no decodable video track
 * reports `videoWidth`/`videoHeight` of 0, which must be rejected before we try
 * to capture or export frames from it.
 */
export function validateVideoTrack(dims: {
  videoWidth: number;
  videoHeight: number;
}): ValidationResult {
  if (
    !Number.isFinite(dims.videoWidth) ||
    !Number.isFinite(dims.videoHeight) ||
    dims.videoWidth <= 0 ||
    dims.videoHeight <= 0
  ) {
    return {
      ok: false,
      reason: "no-video-track",
      message: "No decodable video track — try a different file.",
    };
  }
  return ok;
}

/** Whether a decoded clip duration exceeds the soft scrubbing ceiling. */
export function isVideoTooLong(durationSec: number): boolean {
  return Number.isFinite(durationSec) && durationSec > MAX_VIDEO_SECONDS;
}
