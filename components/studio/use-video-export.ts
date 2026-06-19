"use client";

import { useCallback, useRef, useState } from "react";
import type { BatchFrame } from "@/components/studio/batch-export-renderer";
import {
  clampToMaxSide,
  downloadBlob,
  GENERATIVE_EXPORT,
  sanitizeFilename,
} from "@/lib/studio/download";
import type { ParamValues, Shader } from "@/lib/studio/registry";
import type { LoadedImage } from "@/components/studio/use-studio-state";

export type ExportStatus = "idle" | "working" | "done" | "error";

/** PNG export snapshot — frozen at click time so mid-render source switches can't desync. */
export interface ExportReq {
  shaderId: string;
  values: ParamValues;
  imageUrl: string | null;
  width: number;
  height: number;
  filename: string;
}

/** Frames-sequence snapshot — the off-screen BatchExportRenderer reads only from this. */
export interface BatchReq {
  shaderId: string;
  values: ParamValues;
  frames: BatchFrame[];
}

export interface UseVideoExportArgs {
  activeId: string;
  values: ParamValues;
  shader: Shader;
  image: LoadedImage | null;
  videoName: string | null;
  /** Live ref to the loaded File — read at export time. */
  videoFileRef: React.RefObject<File | null>;
  flashNotice: (msg: string) => void;
  announceMsg: (msg: string) => void;
}

export interface VideoExport {
  // ── PNG export ────────────────────────────────────────────────
  exportStatus: ExportStatus;
  exportReq: ExportReq | null;
  startExport: () => void;
  onExportDone: (success: boolean) => void;

  // ── frames-sequence (→ zip) export ────────────────────────────
  batchReq: BatchReq | null;
  renderSequence: (
    frames: BatchFrame[],
    onProgress: (rendered: number, total: number) => void,
    signal: AbortSignal,
  ) => Promise<Blob[] | null>;
  /** Wire onto BatchExportRenderer.onProgress; dispatches to the active sequence. */
  onBatchProgress: (rendered: number, total: number) => void;
  /** Wire onto BatchExportRenderer.onDone; resolves the active sequence. */
  onBatchDone: (blobs: Blob[] | null) => void;

  // ── filtered MP4 export ───────────────────────────────────────
  runVideoExport: (
    inSec: number,
    outSec: number,
    onProgress: (done: number, total: number) => void,
    signal: AbortSignal,
  ) => Promise<void>;
}

/** Distinguishes a chunk-load failure from a genuine encode failure (#24). */
export class VideoExporterLoadError extends Error {
  constructor(cause?: unknown) {
    super("Couldn't load the video exporter — check your connection and retry.");
    this.name = "VideoExporterLoadError";
    if (cause !== undefined) this.cause = cause;
  }
}

/**
 * Owns the studio's export orchestration: the PNG export (atomic snapshot →
 * off-screen ExportRenderer), the frames-sequence export (atomic snapshot →
 * off-screen BatchExportRenderer → zip), and the filtered-MP4 export (dynamic
 * import of the heavy WebCodecs pipeline → download). Progress/abort/snapshot
 * state lives here; the off-screen renderers stay mounted by studio.tsx only
 * while their request object is non-null (one-shot keyed-mount contract).
 */
export function useVideoExport({
  activeId,
  values,
  shader,
  image,
  videoName,
  videoFileRef,
  flashNotice,
  announceMsg,
}: UseVideoExportArgs): VideoExport {
  const [exportStatus, setExportStatus] = useState<ExportStatus>("idle");
  const [exportReq, setExportReq] = useState<ExportReq | null>(null);
  const [batchReq, setBatchReq] = useState<BatchReq | null>(null);

  const batchResolve = useRef<((blobs: Blob[] | null) => void) | null>(null);
  // #32: capture the sequence's progress callback for the in-flight batch. It is
  // dispatched to ONLY through onBatchProgress (a stable handler studio.tsx wires
  // onto BatchExportRenderer), never read directly during render. Together with
  // the snapshotted batchReq.{shaderId,values}, this keeps onProgress bound to
  // the export-start values even if activeId/values change mid-batch.
  const sequenceProgressRef = useRef<
    ((rendered: number, total: number) => void) | null
  >(null);

  // ── PNG export ──────────────────────────────────────────────────
  // Plain function (not useCallback): it closes over the live exportStatus for
  // the click-time re-entrancy guard, mirroring the original orchestrator. It is
  // only ever wired to an onClick, so a fresh identity per render is harmless.
  const startExport = () => {
    if (exportStatus === "working") return;
    let width: number;
    let height: number;
    let clamped = false;
    if (shader.category === "generative" || !image) {
      ({ width, height } = GENERATIVE_EXPORT);
    } else {
      ({ width, height, clamped } = clampToMaxSide(image.w, image.h));
    }
    if (clamped) flashNotice(`Large image — exported at ${width}×${height}.`);
    setExportStatus("working");
    announceMsg("Rendering export");
    // Atomic snapshot: shaderId, values, imageUrl, and the derived width/height
    // are all frozen into exportReq here at click time. ExportRenderer reads
    // only from exportReq.*, so switching shader/image mid-render can't desync
    // the exported dimensions.
    setExportReq({
      shaderId: activeId,
      values,
      imageUrl: image?.url ?? null,
      width,
      height,
      filename: image
        ? `${activeId}-${sanitizeFilename(image.name.replace(/\.[^.]+$/, ""))}.png`
        : `${activeId}.png`,
    });
  };

  const onExportDone = useCallback(
    (success: boolean) => {
      setExportReq(null);
      setExportStatus(success ? "done" : "error");
      if (success) announceMsg("Export saved");
      else flashNotice("Export failed — try a smaller image or another shader.");
      window.setTimeout(() => setExportStatus("idle"), 1600);
    },
    [announceMsg, flashNotice],
  );

  // ── frames-sequence export ──────────────────────────────────────
  // Render extracted video frames through the active shader off-screen and
  // resolve the ordered PNG blobs. Mounts a single BatchExportRenderer; the
  // AbortSignal lets VideoStage cancel mid-run.
  const renderSequence = useCallback(
    (
      frames: BatchFrame[],
      onProgress: (rendered: number, total: number) => void,
      signal: AbortSignal,
    ): Promise<Blob[] | null> => {
      sequenceProgressRef.current = onProgress;
      return new Promise<Blob[] | null>((resolve) => {
        const settle = (blobs: Blob[] | null) => {
          if (!batchResolve.current) return;
          batchResolve.current = null;
          sequenceProgressRef.current = null;
          setBatchReq(null);
          resolve(blobs);
        };
        batchResolve.current = settle;
        signal.addEventListener("abort", () => settle(null), { once: true });
        setBatchReq({ shaderId: activeId, values, frames });
      });
    },
    [activeId, values],
  );

  const onBatchProgress = useCallback((rendered: number, total: number) => {
    sequenceProgressRef.current?.(rendered, total);
  }, []);

  const onBatchDone = useCallback((blobs: Blob[] | null) => {
    batchResolve.current?.(blobs);
  }, []);

  // ── filtered MP4 export ─────────────────────────────────────────
  // Encode the in/out range of the loaded clip through the active shader to an
  // MP4 and download it. The heavy WebCodecs pipeline is dynamically imported so
  // it stays out of the initial bundle until the user actually exports a video.
  const runVideoExport = useCallback(
    async (
      inSec: number,
      outSec: number,
      onProgress: (done: number, total: number) => void,
      signal: AbortSignal,
    ): Promise<void> => {
      const file = videoFileRef.current;
      if (!file) return;
      // #24: a chunk-load failure on the dynamic import is surfaced as a distinct
      // VideoExporterLoadError so VideoStage can show a connectivity message
      // rather than the generic "encode failed" copy. Only the import is guarded;
      // the encode path's own rejections propagate unchanged.
      let encodeFilteredVideo: typeof import("@/lib/studio/video-export/encode-filtered-video").encodeFilteredVideo;
      try {
        ({ encodeFilteredVideo } = await import(
          "@/lib/studio/video-export/encode-filtered-video"
        ));
      } catch (err) {
        throw new VideoExporterLoadError(err);
      }
      const { blob } = await encodeFilteredVideo({
        file,
        shaderId: activeId,
        values,
        inSec,
        outSec,
        onProgress,
        signal,
      });
      downloadBlob(
        blob,
        `${activeId}-${sanitizeFilename((videoName ?? "video").replace(/\.[^.]+$/, ""))}.mp4`,
      );
    },
    [activeId, values, videoName, videoFileRef],
  );

  return {
    exportStatus,
    exportReq,
    startExport,
    onExportDone,
    batchReq,
    renderSequence,
    onBatchProgress,
    onBatchDone,
    runVideoExport,
  };
}
