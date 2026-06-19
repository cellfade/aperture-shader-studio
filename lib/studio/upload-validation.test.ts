import { describe, expect, it } from "vitest";
import {
  MAX_VIDEO_BYTES,
  MAX_VIDEO_SECONDS,
  validateImageFile,
  validateVideoFile,
  validateDecodedImage,
  validateVideoTrack,
  isVideoTooLong,
} from "@/lib/studio/upload-validation";

describe("validateImageFile", () => {
  it("accepts each supported image type", () => {
    for (const type of [
      "image/png",
      "image/jpeg",
      "image/webp",
      "image/avif",
    ]) {
      expect(validateImageFile({ type }).ok).toBe(true);
    }
  });

  it("rejects a present-but-unsupported type", () => {
    const r = validateImageFile({ type: "image/gif" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("unsupported-type");
      expect(r.message).toMatch(/JPG, PNG, or WebP/);
    }
  });

  it("rejects a video type submitted as an image", () => {
    expect(validateImageFile({ type: "video/mp4" }).ok).toBe(false);
  });

  it("allows a blank type through (decode is the real gate)", () => {
    expect(validateImageFile({ type: "" }).ok).toBe(true);
  });
});

describe("validateVideoFile", () => {
  it("accepts each supported video type under the size cap", () => {
    for (const type of ["video/mp4", "video/webm", "video/quicktime"]) {
      expect(validateVideoFile({ type, size: 1_000 }).ok).toBe(true);
    }
  });

  it("rejects a present-but-unsupported type", () => {
    const r = validateVideoFile({ type: "video/x-msvideo", size: 1_000 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("unsupported-type");
      expect(r.message).toMatch(/MP4, WebM, or MOV/);
    }
  });

  it("rejects an oversized file", () => {
    const r = validateVideoFile({
      type: "video/mp4",
      size: MAX_VIDEO_BYTES + 1,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("too-large");
      expect(r.message).toMatch(/200 MB/);
    }
  });

  it("accepts a file exactly at the size cap", () => {
    expect(
      validateVideoFile({ type: "video/mp4", size: MAX_VIDEO_BYTES }).ok,
    ).toBe(true);
  });

  it("checks type before size (unsupported type wins)", () => {
    const r = validateVideoFile({
      type: "image/png",
      size: MAX_VIDEO_BYTES + 1,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("unsupported-type");
  });

  it("allows a blank type through if under the cap", () => {
    expect(validateVideoFile({ type: "", size: 1_000 }).ok).toBe(true);
  });
});

describe("validateDecodedImage", () => {
  it("accepts positive dimensions", () => {
    expect(validateDecodedImage({ width: 1920, height: 1080 }).ok).toBe(true);
  });

  it("rejects a corrupted image that decoded to 0x0", () => {
    const r = validateDecodedImage({ width: 0, height: 0 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("undecodable");
      expect(r.message).toMatch(/Couldn't read that image/);
    }
  });

  it("rejects zero width or zero height alone", () => {
    expect(validateDecodedImage({ width: 1920, height: 0 }).ok).toBe(false);
    expect(validateDecodedImage({ width: 0, height: 1080 }).ok).toBe(false);
  });

  it("rejects non-finite or negative dimensions", () => {
    expect(validateDecodedImage({ width: NaN, height: 100 }).ok).toBe(false);
    expect(validateDecodedImage({ width: -10, height: 100 }).ok).toBe(false);
    expect(
      validateDecodedImage({ width: Infinity, height: 100 }).ok,
    ).toBe(false);
  });
});

describe("validateVideoTrack", () => {
  it("accepts a clip with a decodable track", () => {
    expect(
      validateVideoTrack({ videoWidth: 1280, videoHeight: 720 }).ok,
    ).toBe(true);
  });

  it("rejects a clip with no decodable video track (0x0)", () => {
    const r = validateVideoTrack({ videoWidth: 0, videoHeight: 0 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("no-video-track");
      expect(r.message).toMatch(/No decodable video track/);
    }
  });

  it("rejects an audio-only-style clip (width 0, height present)", () => {
    expect(
      validateVideoTrack({ videoWidth: 0, videoHeight: 480 }).ok,
    ).toBe(false);
  });

  it("rejects non-finite dimensions", () => {
    expect(
      validateVideoTrack({ videoWidth: NaN, videoHeight: NaN }).ok,
    ).toBe(false);
  });
});

describe("isVideoTooLong", () => {
  it("is false at or under the duration ceiling", () => {
    expect(isVideoTooLong(MAX_VIDEO_SECONDS)).toBe(false);
    expect(isVideoTooLong(10)).toBe(false);
  });

  it("is true just over the ceiling", () => {
    expect(isVideoTooLong(MAX_VIDEO_SECONDS + 0.1)).toBe(true);
  });

  it("is false for a non-finite duration (metadata not ready / live stream)", () => {
    expect(isVideoTooLong(NaN)).toBe(false);
    expect(isVideoTooLong(Infinity)).toBe(false);
  });
});
