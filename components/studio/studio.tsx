"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { CompareSlider } from "@/components/compare-slider";
import { ControlPanel } from "@/components/studio/control-panel";
import { ShaderView } from "@/components/studio/shader-view";
import { ExportRenderer } from "@/components/studio/export-renderer";
import { VideoStage } from "@/components/studio/video-stage";
import {
  SHADERS_BY_ID,
  initialValues,
  DEFAULT_SHADER_ID,
  type ParamValue,
  type ParamValues,
} from "@/lib/studio/registry";
import { clampToMaxSide, GENERATIVE_EXPORT } from "@/lib/studio/download";

interface LoadedImage {
  url: string;
  isBlob: boolean;
  w: number;
  h: number;
  name: string;
}

type Mode = "photo" | "video";
type ExportStatus = "idle" | "working" | "done" | "error";

const IMAGE_ACCEPT = ["image/png", "image/jpeg", "image/webp", "image/avif"];
const VIDEO_ACCEPT = ["video/mp4", "video/webm", "video/quicktime"];
const ACCEPT_ATTR = [...IMAGE_ACCEPT, ...VIDEO_ACCEPT].join(",");
const MAX_VIDEO_BYTES = 200 * 1024 * 1024;
const MAX_VIDEO_SECONDS = 300;

const GHOST_BTN =
  "rounded-md border border-border px-2.5 py-1.5 font-mono text-[11px] uppercase tracking-[0.1em] text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

function humanize(id: string) {
  return id.replace(/-/g, " ");
}

export function Studio({ sampleSrc }: { sampleSrc: string }) {
  const [mode, setMode] = useState<Mode>("photo");
  const [image, setImage] = useState<LoadedImage | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoName, setVideoName] = useState<string | null>(null);
  const [videoDims, setVideoDims] = useState<{ w: number; h: number } | null>(null);
  const [videoStageOpen, setVideoStageOpen] = useState(false);

  const [activeId, setActiveId] = useState(DEFAULT_SHADER_ID);
  const [valuesByShader, setValuesByShader] = useState<Record<string, ParamValues>>(
    () => ({ [DEFAULT_SHADER_ID]: initialValues(SHADERS_BY_ID[DEFAULT_SHADER_ID]) }),
  );
  const [compareOn, setCompareOn] = useState(true);
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [announce, setAnnounce] = useState("");
  const [exportStatus, setExportStatus] = useState<ExportStatus>("idle");
  const [exportReq, setExportReq] = useState<null | {
    shaderId: string;
    values: ParamValues;
    imageUrl: string | null;
    width: number;
    height: number;
    filename: string;
  }>(null);

  const fileInput = useRef<HTMLInputElement>(null);
  const imageUrlRef = useRef<string | null>(null);
  const videoUrlRef = useRef<string | null>(null);
  const lastVideoTime = useRef(0);
  const dragDepth = useRef(0);

  const shader = SHADERS_BY_ID[activeId];
  const values = valuesByShader[activeId] ?? initialValues(shader);

  const stageOpen = mode === "video" && !!videoUrl && videoStageOpen;
  const showVideoDrop = mode === "video" && !videoUrl;
  const showPhotoDrop = mode === "photo" && shader.takesImage && !image;
  const showDrop = showVideoDrop || showPhotoDrop;
  const ar = stageOpen
    ? videoDims
      ? videoDims.w / videoDims.h
      : 16 / 10
    : image
      ? image.w / image.h
      : 16 / 10;
  const canCompare = shader.category === "image-filter" && !!image && !stageOpen;
  const showCompare = canCompare && compareOn;

  const announceMsg = (msg: string) => setAnnounce(`${msg} ​`);
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
      if (file.type && !IMAGE_ACCEPT.includes(file.type)) {
        flashNotice("Unsupported image — use JPG, PNG, or WebP.");
        return;
      }
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        setMode("photo");
        // abandoning any loaded video for an image source — release it
        if (videoUrlRef.current) {
          URL.revokeObjectURL(videoUrlRef.current);
          videoUrlRef.current = null;
        }
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
      if (file.type && !VIDEO_ACCEPT.includes(file.type)) {
        flashNotice("Unsupported video — use MP4, WebM, or MOV.");
        return;
      }
      if (file.size > MAX_VIDEO_BYTES) {
        flashNotice("Video is over 200 MB — try a shorter or smaller clip.");
        return;
      }
      const url = URL.createObjectURL(file);
      if (videoUrlRef.current) URL.revokeObjectURL(videoUrlRef.current);
      videoUrlRef.current = url;
      if (imageUrlRef.current) {
        URL.revokeObjectURL(imageUrlRef.current);
        imageUrlRef.current = null;
      }
      setImage(null);
      lastVideoTime.current = 0;
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
  const selectShader = (id: string) => {
    setActiveId(id);
    setValuesByShader((prev) =>
      prev[id] ? prev : { ...prev, [id]: initialValues(SHADERS_BY_ID[id]) },
    );
  };
  const changeParam = (name: string, value: ParamValue) =>
    setValuesByShader((prev) => ({
      ...prev,
      [activeId]: { ...(prev[activeId] ?? initialValues(shader)), [name]: value },
    }));
  const replaceValues = (next: ParamValues) =>
    setValuesByShader((prev) => ({ ...prev, [activeId]: next }));

  // ── video capture ────────────────────────────────────────────
  const onCaptureFrame = useCallback(
    (url: string, w: number, h: number, label: string) => {
      commitImage({ url, isBlob: true, w, h, name: `frame-${label}.png` });
      setVideoStageOpen(false);
      announceMsg(`Captured frame at ${label}`);
    },
    [commitImage],
  );

  const onVideoMeta = useCallback(
    (w: number, h: number, duration: number) => {
      setVideoDims({ w, h });
      if (duration > MAX_VIDEO_SECONDS) {
        flashNotice("Long clip — scrubbing may be heavy. Capture still works.");
      }
    },
    [flashNotice],
  );

  // ── export ───────────────────────────────────────────────────
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
    setExportReq({
      shaderId: activeId,
      values,
      imageUrl: image?.url ?? null,
      width,
      height,
      filename: image ? `${activeId}-${image.name.replace(/\.[^.]+$/, "")}.png` : `${activeId}.png`,
    });
  };
  const onExportDone = (success: boolean) => {
    setExportReq(null);
    setExportStatus(success ? "done" : "error");
    if (success) announceMsg("Export saved");
    else flashNotice("Export failed — try a smaller image or another shader.");
    window.setTimeout(() => setExportStatus("idle"), 1600);
  };

  const browse = () => fileInput.current?.click();
  const canDownload =
    !stageOpen && (!!image || (mode === "photo" && shader.category === "generative"));
  const statusLabel = stageOpen
    ? (videoName ?? "Video")
    : image
      ? image.name
      : mode === "video"
        ? "No frame captured"
        : "No photo";
  const statusDims = stageOpen
    ? videoDims
      ? `${videoDims.w}×${videoDims.h}`
      : ""
    : image
      ? `${image.w}×${image.h}`
      : "";

  const areaSizing = stageOpen
    ? "h-[62vh] min-h-[360px] lg:h-[clamp(440px,72vh,760px)]"
    : "aspect-[var(--ar)] max-h-[62vh] min-h-[280px] lg:aspect-auto lg:h-[clamp(440px,72vh,760px)] lg:max-h-none lg:min-h-0";

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_18px_50px_-30px_rgba(0,0,0,0.85)]">
      {/* Studio top bar */}
      <div className="flex flex-col gap-2 border-b border-border px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <ModeToggle mode={mode} onChange={setMode} />
          <div className="flex min-w-0 items-center gap-2 font-mono text-[11px] text-muted-foreground">
            <span className="size-1.5 shrink-0 rounded-full bg-muted-foreground" />
            <span className="truncate">
              {statusLabel}
              {statusDims && <span className="ms-2 text-muted-foreground">{statusDims}</span>}
            </span>
            {notice && (
              <span className="ms-2 truncate text-foreground/80">· {notice}</span>
            )}
          </div>
        </div>

        <div className="flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto">
          {stageOpen ? (
            <button type="button" onClick={browse} className={GHOST_BTN}>
              Replace video
            </button>
          ) : (
            <>
              {mode === "video" && image && (
                <button
                  type="button"
                  onClick={() => setVideoStageOpen(true)}
                  className={GHOST_BTN}
                >
                  Recapture
                </button>
              )}
              {(image || mode === "video") && (
                <button type="button" onClick={browse} className={GHOST_BTN}>
                  {mode === "video" ? "New video" : "Replace"}
                </button>
              )}
              {canCompare && (
                <button
                  type="button"
                  onClick={() => setCompareOn((v) => !v)}
                  aria-pressed={compareOn}
                  className={`${GHOST_BTN} ${compareOn ? "bg-foreground/10 text-foreground" : ""}`}
                >
                  Compare {compareOn ? "on" : "off"}
                </button>
              )}
              {canDownload && (
                <button
                  type="button"
                  onClick={startExport}
                  disabled={exportStatus === "working"}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border bg-foreground/[0.06] px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.1em] text-foreground transition-colors hover:bg-foreground/15 disabled:opacity-60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                >
                  {exportStatus === "working"
                    ? "Rendering…"
                    : exportStatus === "done"
                      ? "Saved ✓"
                      : exportStatus === "error"
                        ? "Retry"
                        : "Download PNG"}
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Studio body */}
      <div className="flex flex-col lg:flex-row">
        {/* Canvas / stage area */}
        <div
          className={`relative flex items-center justify-center overflow-hidden bg-[#070809] p-3 sm:p-5 lg:flex-1 ${areaSizing} ${
            dragging ? "ring-2 ring-inset ring-foreground/30" : ""
          }`}
          style={stageOpen ? undefined : ({ "--ar": String(ar) } as CSSProperties)}
        >
          {showDrop ? (
            <DropPrompt
              kind={mode}
              onPick={browse}
              onSample={
                mode === "photo"
                  ? () => loadSampleImage(sampleSrc, commitImage, flashNotice)
                  : undefined
              }
            />
          ) : stageOpen ? (
            <VideoStage
              key={videoUrl}
              src={videoUrl!}
              initialTime={lastVideoTime.current}
              onMeta={onVideoMeta}
              onTime={(t) => {
                lastVideoTime.current = t;
              }}
              onCapture={onCaptureFrame}
              onError={flashNotice}
            />
          ) : (
            <PreviewBox ar={ar}>
              {showCompare ? (
                <CompareSlider
                  beforeLabel="Original"
                  afterLabel={humanize(shader.id)}
                  before={
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={image!.url}
                      alt={`${image!.name}, original`}
                      className="absolute inset-0 h-full w-full object-cover"
                    />
                  }
                  after={<ShaderView shader={shader} values={values} imageUrl={image?.url} />}
                />
              ) : (
                <ShaderView shader={shader} values={values} imageUrl={image?.url} />
              )}
            </PreviewBox>
          )}

          {dragging && (
            <div className="pointer-events-none absolute inset-3 rounded-lg border border-dashed border-foreground/40" />
          )}
        </div>

        {/* Control rail */}
        <div className="max-h-[78vh] border-t border-border lg:h-[clamp(440px,72vh,760px)] lg:max-h-none lg:w-[340px] lg:shrink-0 lg:border-l lg:border-t-0">
          <ControlPanel
            shader={shader}
            values={values}
            onSelectShader={selectShader}
            onChange={changeParam}
            onReplaceValues={replaceValues}
          />
        </div>
      </div>

      <input
        ref={fileInput}
        type="file"
        accept={ACCEPT_ATTR}
        aria-label="Upload a photo or video"
        className="sr-only"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) ingest(f);
          e.target.value = "";
        }}
      />

      <div className="sr-only" role="status" aria-live="polite">
        {announce}
      </div>

      {exportReq && (
        <ExportRenderer
          shader={SHADERS_BY_ID[exportReq.shaderId]}
          values={exportReq.values}
          imageUrl={exportReq.imageUrl}
          width={exportReq.width}
          height={exportReq.height}
          filename={exportReq.filename}
          onDone={onExportDone}
        />
      )}
    </div>
  );
}

function loadSampleImage(
  src: string,
  commit: (img: LoadedImage) => void,
  onError?: (msg: string) => void,
) {
  const img = new Image();
  img.onload = () =>
    commit({
      url: src,
      isBlob: false,
      w: img.naturalWidth,
      h: img.naturalHeight,
      name: "sample.jpg",
    });
  img.onerror = () => onError?.("Couldn't load the sample image.");
  img.src = src;
}

function ModeToggle({ mode, onChange }: { mode: Mode; onChange: (m: Mode) => void }) {
  return (
    <div
      role="radiogroup"
      aria-label="Source type"
      className="flex shrink-0 rounded-md border border-border p-0.5"
    >
      {(["photo", "video"] as const).map((m) => {
        const active = m === mode;
        return (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(m)}
            onKeyDown={(e) => {
              if (e.key.startsWith("Arrow")) {
                e.preventDefault();
                onChange(m === "photo" ? "video" : "photo");
              }
            }}
            className={`rounded-[5px] px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em] transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
              active ? "bg-foreground/10 text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {m}
          </button>
        );
      })}
    </div>
  );
}

/** Largest box of aspect `ar` that fits the measured container, centered. */
function PreviewBox({ ar, children }: { ar: number; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const cw = el.clientWidth;
      const ch = el.clientHeight;
      let w = cw;
      let h = cw / ar;
      if (h > ch) {
        h = ch;
        w = ch * ar;
      }
      setBox({ w: Math.round(w), h: Math.round(h) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ar]);

  return (
    <div ref={ref} className="flex h-full w-full items-center justify-center">
      <div
        className="relative overflow-hidden rounded-lg ring-1 ring-white/10"
        style={{ width: box.w || "100%", height: box.h || "100%" }}
      >
        {children}
      </div>
    </div>
  );
}

function DropPrompt({
  kind,
  onPick,
  onSample,
}: {
  kind: Mode;
  onPick: () => void;
  onSample?: () => void;
}) {
  const isVideo = kind === "video";
  return (
    <div className="flex flex-col items-center text-center">
      <button
        type="button"
        onClick={onPick}
        className="group flex flex-col items-center rounded-xl px-8 py-6 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        <svg
          width="36"
          height="36"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.25"
          className="text-muted-foreground transition-colors group-hover:text-foreground"
          aria-hidden
        >
          {isVideo ? (
            <>
              <rect x="3" y="5" width="18" height="14" rx="2" />
              <path d="m10 9 5 3-5 3z" fill="currentColor" stroke="none" />
            </>
          ) : (
            <>
              <circle cx="12" cy="12" r="9" />
              <circle cx="12" cy="12" r="3.2" />
              <path d="M12 3v4M12 17v4M3 12h4M17 12h4" />
            </>
          )}
        </svg>
        <p className="mt-4 text-[15px] text-foreground">
          {isVideo
            ? "Drop a video, click to browse, or paste"
            : "Drop a photo, click to browse, or paste"}
        </p>
        <p className="mt-1 font-mono text-[11px] text-muted-foreground">
          {isVideo
            ? "MP4, WebM, MOV · stays in your browser"
            : "JPG, PNG, WebP · processed entirely in your browser"}
        </p>
      </button>
      {onSample && (
        <button
          type="button"
          onClick={onSample}
          className="mt-2 font-mono text-[11px] uppercase tracking-[0.14em] text-foreground/70 underline decoration-border underline-offset-4 transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          Or try a sample
        </button>
      )}
    </div>
  );
}
