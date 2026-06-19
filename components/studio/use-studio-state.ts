"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  SHADERS_BY_ID,
  initialValues,
  DEFAULT_SHADER_ID,
  type ParamValue,
  type ParamValues,
  type Shader,
} from "@/lib/studio/registry";
import {
  validateImageFile,
  validateVideoFile,
  validateDecodedImage,
  isVideoTooLong,
} from "@/lib/studio/upload-validation";
import {
  readInitialUrlState,
  useUrlState,
} from "@/components/studio/use-url-state";
import type { UrlState } from "@/lib/studio/url-state";

export interface LoadedImage {
  url: string;
  isBlob: boolean;
  w: number;
  h: number;
  name: string;
}

export type Mode = "photo" | "video";

export interface StudioState {
  // ── source state ──────────────────────────────────────────────
  mode: Mode;
  setMode: (m: Mode) => void;
  image: LoadedImage | null;
  videoUrl: string | null;
  videoName: string | null;
  videoDims: { w: number; h: number } | null;
  videoStageOpen: boolean;
  setVideoStageOpen: (open: boolean) => void;
  /** Live ref to the loaded video File (read at export time; never triggers render). */
  videoFileRef: React.RefObject<File | null>;
  /** Persisted scrub position across VideoStage remounts. */
  lastVideoTimeRef: React.RefObject<number>;

  // ── shader + param state ──────────────────────────────────────
  shader: Shader;
  values: ParamValues;
  activeId: string;
  selectShader: (id: string) => void;
  changeParam: (name: string, value: ParamValue) => void;
  replaceValues: (next: ParamValues) => void;

  // ── compare / drag / notices ──────────────────────────────────
  compareOn: boolean;
  setCompareOn: React.Dispatch<React.SetStateAction<boolean>>;
  dragging: boolean;
  notice: string | null;
  announce: string;
  announceMsg: (msg: string) => void;
  flashNotice: (msg: string) => void;

  // ── ingest ────────────────────────────────────────────────────
  commitImage: (next: LoadedImage) => void;
  loadImageFile: (file: File) => void;
  loadVideoFile: (file: File) => void;
  ingest: (file: File) => void;
  onCaptureFrame: (url: string, w: number, h: number, label: string) => void;
  onVideoMeta: (w: number, h: number, duration: number) => void;
}

/**
 * Owns the studio's source/shader state and ingest pipeline: mode, the loaded
 * image/video, object-URL lifecycle, shader selection, per-shader param values,
 * drag-drop/paste, video metadata + frame capture. Validation defers to the
 * pure `lib/studio/upload-validation` helpers; this hook owns the side effects
 * (object-URL creation/revocation, decode, state, notices).
 *
 * Object-URL discipline (must hold to avoid leaks / use-after-revoke):
 * - `commitImage` revokes the prior blob URL only when replacing it with a
 *   *different* URL, and only tracks blob URLs (sample images are not blobs).
 * - switching photo→video / video→photo revokes the abandoned source.
 * - a failed image decode revokes the URL it created.
 * - both source refs are revoked on unmount.
 */
export function useStudioState(): StudioState {
  const [mode, setMode] = useState<Mode>("photo");
  const [image, setImage] = useState<LoadedImage | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoName, setVideoName] = useState<string | null>(null);
  const [videoDims, setVideoDims] = useState<{ w: number; h: number } | null>(
    null,
  );
  const [videoStageOpen, setVideoStageOpen] = useState(false);

  // Seed with the DEFAULT shader so the server-rendered HTML and the first client
  // render match — the URL hash is client-only (never sent to the server), so
  // reading it during render would cause a hydration mismatch (React #418). The
  // shared "look" from the hash is applied AFTER mount, in the effect below.
  const [activeId, setActiveId] = useState(DEFAULT_SHADER_ID);
  const [valuesByShader, setValuesByShader] = useState<
    Record<string, ParamValues>
  >(() => ({
    [DEFAULT_SHADER_ID]: initialValues(SHADERS_BY_ID[DEFAULT_SHADER_ID]),
  }));
  const [compareOn, setCompareOn] = useState(true);
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [announce, setAnnounce] = useState("");

  const imageUrlRef = useRef<string | null>(null);
  const videoUrlRef = useRef<string | null>(null);
  const videoFileRef = useRef<File | null>(null);
  const lastVideoTimeRef = useRef(0);
  const dragDepth = useRef(0);

  const shader = SHADERS_BY_ID[activeId];
  const values = valuesByShader[activeId] ?? initialValues(shader);

  const announceMsg = useCallback((msg: string) => setAnnounce(`${msg} ​`), []);
  const flashNotice = useCallback((msg: string) => {
    setNotice(msg);
    setAnnounce(`${msg} ​`);
    window.setTimeout(() => setNotice((n) => (n === msg ? null : n)), 3200);
  }, []);

  const commitImage = useCallback((next: LoadedImage) => {
    if (imageUrlRef.current && imageUrlRef.current !== next.url) {
      URL.revokeObjectURL(imageUrlRef.current);
    }
    imageUrlRef.current = next.isBlob ? next.url : null;
    setImage(next);
    setAnnounce(`Loaded ${next.name}, ${next.w} by ${next.h} pixels ​`);
  }, []);

  const loadImageFile = useCallback(
    (file: File) => {
      const check = validateImageFile(file);
      if (!check.ok) {
        flashNotice(check.message);
        return;
      }
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const dims = validateDecodedImage({
          width: img.naturalWidth,
          height: img.naturalHeight,
        });
        if (!dims.ok) {
          URL.revokeObjectURL(url);
          flashNotice(dims.message);
          return;
        }
        setMode("photo");
        // abandoning any loaded video for an image source — release it
        if (videoUrlRef.current) {
          URL.revokeObjectURL(videoUrlRef.current);
          videoUrlRef.current = null;
        }
        videoFileRef.current = null;
        setVideoUrl(null);
        setVideoName(null);
        setVideoDims(null);
        setVideoStageOpen(false);
        commitImage({
          url,
          isBlob: true,
          w: img.naturalWidth,
          h: img.naturalHeight,
          name: file.name || "image",
        });
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        flashNotice("Couldn't read that image. Try another file.");
      };
      img.src = url;
    },
    [commitImage, flashNotice],
  );

  const loadVideoFile = useCallback(
    (file: File) => {
      const check = validateVideoFile(file);
      if (!check.ok) {
        flashNotice(check.message);
        return;
      }
      const url = URL.createObjectURL(file);
      if (videoUrlRef.current) URL.revokeObjectURL(videoUrlRef.current);
      videoUrlRef.current = url;
      videoFileRef.current = file;
      if (imageUrlRef.current) {
        URL.revokeObjectURL(imageUrlRef.current);
        imageUrlRef.current = null;
      }
      setImage(null);
      lastVideoTimeRef.current = 0;
      setVideoDims(null);
      setVideoName(file.name || "video");
      setVideoUrl(url);
      setVideoStageOpen(true);
      setMode("video");
      setAnnounce(`Loaded video ${file.name} ​`);
    },
    [flashNotice],
  );

  const ingest = useCallback(
    (file: File) => {
      if (file.type.startsWith("video/")) loadVideoFile(file);
      else loadImageFile(file);
    },
    [loadVideoFile, loadImageFile],
  );

  // drag-drop + paste anywhere
  useEffect(() => {
    const hasFiles = (e: DragEvent) =>
      Array.from(e.dataTransfer?.types ?? []).includes("Files");
    const onDragOver = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const onDragEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth.current += 1;
      setDragging(true);
    };
    const onDragLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setDragging(false);
    };
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      const file = e.dataTransfer?.files?.[0];
      if (file) ingest(file);
    };
    const onDragEnd = () => {
      dragDepth.current = 0;
      setDragging(false);
    };
    const onPaste = (e: ClipboardEvent) => {
      const item = Array.from(e.clipboardData?.items ?? []).find(
        (i) => i.type.startsWith("image/") || i.type.startsWith("video/"),
      );
      const file = item?.getAsFile();
      if (file) {
        e.preventDefault();
        ingest(file);
      }
    };
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    window.addEventListener("dragend", onDragEnd);
    window.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
      window.removeEventListener("dragend", onDragEnd);
      window.removeEventListener("paste", onPaste);
    };
  }, [ingest]);

  useEffect(() => {
    return () => {
      if (imageUrlRef.current) URL.revokeObjectURL(imageUrlRef.current);
      if (videoUrlRef.current) URL.revokeObjectURL(videoUrlRef.current);
    };
  }, []);

  // ── shader + param updates ───────────────────────────────────
  // Stable identities (useCallback): ControlPanel forwards `changeParam` to
  // every ParamControl as its `onChange`, and ParamControl is memoized — a fresh
  // function each render would defeat that memo and re-render all sibling
  // controls on every drag tick. `shader` is derived from `activeId`, so
  // [activeId] fully covers the closures below.
  const selectShader = useCallback((id: string) => {
    setActiveId(id);
    setValuesByShader((prev) =>
      prev[id] ? prev : { ...prev, [id]: initialValues(SHADERS_BY_ID[id]) },
    );
  }, []);
  const changeParam = useCallback(
    (name: string, value: ParamValue) =>
      setValuesByShader((prev) => ({
        ...prev,
        [activeId]: {
          ...(prev[activeId] ?? initialValues(SHADERS_BY_ID[activeId])),
          [name]: value,
        },
      })),
    [activeId],
  );
  const replaceValues = useCallback(
    (next: ParamValues) =>
      setValuesByShader((prev) => ({ ...prev, [activeId]: next })),
    [activeId],
  );

  // ── shareable URL hash sync ──────────────────────────────────
  // Restore state pushed in by back/forward navigation or a pasted link. The
  // decoded values are a partial patch validated against the registry, so merge
  // them over the shader's defaults.
  const restoreFromUrl = useCallback((next: UrlState) => {
    const target = SHADERS_BY_ID[next.shaderId];
    if (!target) return;
    setActiveId(next.shaderId);
    setValuesByShader((prev) => ({
      ...prev,
      [next.shaderId]: { ...initialValues(target), ...next.values },
    }));
  }, []);

  useUrlState({
    state: { shaderId: activeId, values },
    onExternalChange: restoreFromUrl,
  });

  // Apply a shared "look" from the URL hash AFTER mount — never during render
  // (the hash is client-only; applying it at render time mismatches SSR
  // hydration). Runs once; a present, valid hash restores its shader + params.
  const urlAppliedRef = useRef(false);
  useEffect(() => {
    if (urlAppliedRef.current) return;
    urlAppliedRef.current = true;
    const initial = readInitialUrlState();
    // Apply the client-only URL hash exactly once, post-mount — this is the
    // React-blessed time to reconcile state from an external system (here, the
    // location hash) that isn't available during SSR. Doing it at render time
    // would mismatch hydration (#418); the disable is for this intentional,
    // one-shot external reconciliation, not an ongoing render-driven setState.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (initial) restoreFromUrl(initial);
  }, [restoreFromUrl]);

  // ── video capture ────────────────────────────────────────────
  const onCaptureFrame = useCallback(
    (url: string, w: number, h: number, label: string) => {
      commitImage({ url, isBlob: true, w, h, name: `frame-${label}.png` });
      setVideoStageOpen(false);
      announceMsg(`Captured frame at ${label}`);
    },
    [commitImage, announceMsg],
  );

  const onVideoMeta = useCallback(
    (w: number, h: number, duration: number) => {
      setVideoDims({ w, h });
      if (isVideoTooLong(duration)) {
        flashNotice("Long clip — scrubbing may be heavy. Capture still works.");
      }
    },
    [flashNotice],
  );

  return {
    mode,
    setMode,
    image,
    videoUrl,
    videoName,
    videoDims,
    videoStageOpen,
    setVideoStageOpen,
    videoFileRef,
    lastVideoTimeRef,
    shader,
    values,
    activeId,
    selectShader,
    changeParam,
    replaceValues,
    compareOn,
    setCompareOn,
    dragging,
    notice,
    announce,
    announceMsg,
    flashNotice,
    commitImage,
    loadImageFile,
    loadVideoFile,
    ingest,
    onCaptureFrame,
    onVideoMeta,
  };
}
