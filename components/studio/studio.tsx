"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CompareSlider } from "@/components/compare-slider";
import { ControlPanel } from "@/components/studio/control-panel";
import { ShaderView } from "@/components/studio/shader-view";
import { ExportRenderer } from "@/components/studio/export-renderer";
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

const ACCEPT = ["image/png", "image/jpeg", "image/webp", "image/avif"];
type ExportStatus = "idle" | "working" | "done" | "error";

function humanize(id: string) {
  return id.replace(/-/g, " ");
}

export function Studio({ sampleSrc }: { sampleSrc: string }) {
  const [image, setImage] = useState<LoadedImage | null>(null);
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
  const objectUrl = useRef<string | null>(null);
  const dragDepth = useRef(0);

  const shader = SHADERS_BY_ID[activeId];
  const values = valuesByShader[activeId] ?? initialValues(shader);

  const showDropPrompt = shader.takesImage && !image;
  const canCompare = shader.category === "image-filter" && !!image;
  const showCompare = canCompare && compareOn;

  const flashNotice = (msg: string) => {
    setNotice(msg);
    window.setTimeout(() => setNotice((n) => (n === msg ? null : n)), 3200);
  };

  // single place that owns the blob-url revoke invariant
  const commitImage = useCallback((next: LoadedImage) => {
    if (objectUrl.current && objectUrl.current !== next.url) {
      URL.revokeObjectURL(objectUrl.current);
    }
    objectUrl.current = next.isBlob ? next.url : null;
    setImage(next);
    setAnnounce(`Loaded ${next.name}, ${next.w} by ${next.h} pixels`);
  }, []);

  const loadFile = useCallback(
    (file: File) => {
      if (file.type && !ACCEPT.includes(file.type)) {
        flashNotice("Unsupported format — use JPG, PNG, or WebP.");
        return;
      }
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () =>
        commitImage({
          url,
          isBlob: true,
          w: img.naturalWidth,
          h: img.naturalHeight,
          name: file.name || "image",
        });
      img.onerror = () => {
        URL.revokeObjectURL(url);
        flashNotice("Couldn't read that image. Try another file.");
      };
      img.src = url;
    },
    [commitImage],
  );

  const loadSample = useCallback(() => {
    const img = new Image();
    img.onload = () =>
      commitImage({
        url: sampleSrc,
        isBlob: false,
        w: img.naturalWidth,
        h: img.naturalHeight,
        name: "sample.jpg",
      });
    img.src = sampleSrc;
  }, [sampleSrc, commitImage]);

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
      if (file) loadFile(file);
    };
    const onDragEnd = () => {
      dragDepth.current = 0;
      setDragging(false);
    };
    const onPaste = (e: ClipboardEvent) => {
      const item = Array.from(e.clipboardData?.items ?? []).find((i) =>
        i.type.startsWith("image/"),
      );
      const file = item?.getAsFile();
      if (file) loadFile(file);
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
  }, [loadFile]);

  useEffect(() => {
    return () => {
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    };
  }, []);

  // ── param + shader updates ───────────────────────────────────
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
    setExportReq({
      shaderId: activeId,
      values,
      imageUrl: image?.url ?? null,
      width,
      height,
      filename: image ? `photo-${activeId}.png` : `${activeId}.png`,
    });
  };
  const onExportDone = (success: boolean) => {
    setExportReq(null);
    setExportStatus(success ? "done" : "error");
    if (!success) flashNotice("Export failed — try a smaller image or another shader.");
    window.setTimeout(() => setExportStatus("idle"), 1600);
  };

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_18px_50px_-30px_rgba(0,0,0,0.85)]">
      {/* Studio top bar */}
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2 font-mono text-[11px] text-muted-foreground">
          <span className="size-1.5 rounded-full bg-muted-foreground" />
          <span className="truncate">
            {image ? image.name : "No photo"}
            {image && (
              <span className="ms-2 text-muted-foreground">
                {image.w}×{image.h}
              </span>
            )}
          </span>
          {notice && <span className="ms-2 truncate text-foreground/80">· {notice}</span>}
        </div>
        <div className="flex items-center gap-2">
          {canCompare && (
            <button
              type="button"
              onClick={() => setCompareOn((v) => !v)}
              aria-pressed={compareOn}
              className={`rounded-md border px-2.5 py-1.5 font-mono text-[11px] uppercase tracking-[0.1em] transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
                compareOn
                  ? "border-foreground/30 bg-foreground/10 text-foreground"
                  : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              Compare {compareOn ? "on" : "off"}
            </button>
          )}
          <button
            type="button"
            onClick={startExport}
            disabled={exportStatus === "working"}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.1em] text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            {exportStatus === "working"
              ? "Rendering…"
              : exportStatus === "done"
                ? "Saved ✓"
                : exportStatus === "error"
                  ? "Retry"
                  : "Download PNG"}
          </button>
        </div>
      </div>

      {/* Studio body */}
      <div className="flex flex-col lg:flex-row">
        {/* Canvas area */}
        <div
          className={`relative flex h-[44vh] min-h-[300px] items-center justify-center bg-[#070809] p-3 sm:p-6 lg:h-[640px] lg:flex-1 ${
            dragging ? "ring-2 ring-inset ring-foreground/30" : ""
          }`}
        >
          {showDropPrompt ? (
            <DropPrompt onPick={() => fileInput.current?.click()} onSample={loadSample} />
          ) : (
            <PreviewBox ar={image ? image.w / image.h : 16 / 10}>
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
        <div className="border-t border-border lg:h-[640px] lg:w-[340px] lg:shrink-0 lg:border-l lg:border-t-0">
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
        accept={ACCEPT.join(",")}
        className="sr-only"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) loadFile(f);
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
  onPick,
  onSample,
}: {
  onPick: () => void;
  onSample: () => void;
}) {
  return (
    <div className="flex flex-col items-center text-center">
      <button
        type="button"
        onClick={onPick}
        className="group flex flex-col items-center rounded-xl px-8 py-6 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        <svg
          width="34"
          height="34"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-muted-foreground transition-colors group-hover:text-foreground"
          aria-hidden
        >
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <path d="M12 3v13" />
          <path d="m7 8 5-5 5 5" />
        </svg>
        <p className="mt-4 text-[15px] text-foreground">
          Drop a photo, click to browse, or paste
        </p>
        <p className="mt-1 font-mono text-[11px] text-muted-foreground">
          JPG, PNG, WebP · processed entirely in your browser
        </p>
      </button>
      <button
        type="button"
        onClick={onSample}
        className="mt-2 font-mono text-[11px] uppercase tracking-[0.14em] text-foreground/70 underline decoration-border underline-offset-4 transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        Or try a sample
      </button>
    </div>
  );
}
