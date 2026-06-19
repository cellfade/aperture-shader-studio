export interface CapturedFrame {
  /** object URL of a PNG blob of the frame */
  url: string;
  w: number;
  h: number;
}

/**
 * Draw the current frame of a video into a PNG blob at the video's native
 * resolution. The video should be paused and seeked to the desired time; the
 * element renders whatever frame is current. Source must be same-origin / an
 * object URL so the canvas stays untainted.
 */
export async function captureVideoFrame(
  video: HTMLVideoElement,
): Promise<CapturedFrame> {
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (!w || !h) throw new Error("Video frame not ready");

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D context unavailable");
  ctx.drawImage(video, 0, 0, w, h);

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/png"),
  );
  if (!blob) throw new Error("Could not encode frame");

  return { url: URL.createObjectURL(blob), w, h };
}
