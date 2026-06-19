"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { CompareSlider } from "@/components/compare-slider";
import { ControlPanel } from "@/components/studio/control-panel";
import { ShaderView } from "@/components/studio/shader-view";
import { ExportRenderer } from "@/components/studio/export-renderer";
import { BatchExportRenderer } from "@/components/studio/batch-export-renderer";
import { VideoStage } from "@/components/studio/video-stage";
import { SHADERS_BY_ID } from "@/lib/studio/registry";
import { IMAGE_ACCEPT, VIDEO_ACCEPT } from "@/lib/studio/upload-validation";
import {
  useStudioState,
  type LoadedImage,
  type Mode,
} from "@/components/studio/use-studio-state";
import { useVideoExport } from "@/components/studio/use-video-export";

const ACCEPT_ATTR = [...IMAGE_ACCEPT, ...VIDEO_ACCEPT].join(",");

const GHOST_BTN =
  "rounded-md border border-border px-2.5 py-1.5 font-mono text-[11px] uppercase tracking-[0.1em] text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

function humanize(id: string) {
  return id.replace(/-/g, " ");
}

export function Studio({ sampleSrc }: { sampleSrc: string }) {
  const studio = useStudioState();
  const {
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
    ingest,
    onCaptureFrame,
    onVideoMeta,
  } = studio;

  const {
    exportStatus,
    exportReq,
    startExport,
    onExportDone,
    batchReq,
    renderSequence,
    onBatchProgress,
    onBatchDone,
    runVideoExport,
  } = useVideoExport({
    activeId,
    values,
    shader,
    image,
    videoName,
    videoFileRef,
    flashNotice,
    announceMsg,
  });

  const fileInput = useRef<HTMLInputElement>(null);

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
              getInitialTime={() => lastVideoTimeRef.current}
              onMeta={onVideoMeta}
              onTime={(t) => {
                lastVideoTimeRef.current = t;
              }}
              onCapture={onCaptureFrame}
              onError={flashNotice}
              // sequence export only makes sense for image-filter shaders (generative ignores the frame)
              renderSequence={shader.takesImage ? renderSequence : undefined}
              exportVideo={shader.takesImage ? runVideoExport : undefined}
              shaderId={activeId}
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

      {batchReq && (
        <BatchExportRenderer
          shader={SHADERS_BY_ID[batchReq.shaderId]}
          values={batchReq.values}
          frames={batchReq.frames}
          onProgress={onBatchProgress}
          onDone={onBatchDone}
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
          className="mt-2 font-mono text-[11px] uppercase tracking-[0.14em] text-foreground/85 underline decoration-border underline-offset-4 transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          Or try a sample
        </button>
      )}
    </div>
  );
}
