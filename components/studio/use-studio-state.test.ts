import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  useStudioState,
  type LoadedImage,
} from "@/components/studio/use-studio-state";
import { DEFAULT_SHADER_ID, SHADERS_BY_ID } from "@/lib/studio/registry";

/**
 * Unit tests for the source/shader/ingest hook extracted from studio.tsx (#45).
 * The object-URL invariants (revoke-on-replace, revoke-the-abandoned-source,
 * revoke-on-decode-failure, revoke-on-unmount) are the load-bearing behavior, so
 * those get the closest scrutiny. WebGL/GL rendering stays with the Playwright
 * smoke; here we only exercise the framework-light state machine, driving the
 * stubbed `<Image>` decode by hand.
 */

let createSpy: ReturnType<typeof vi.fn>;
let revokeSpy: ReturnType<typeof vi.fn>;
let urlSeq: number;
/** Captures the most recently constructed stub Image so a test can fire its handlers. */
let lastImage: StubImage | null;

class StubImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  naturalWidth = 0;
  naturalHeight = 0;
  src = "";
  constructor() {
    // Test stub: expose the just-constructed Image so a test can fire its
    // onload/onerror by hand (jsdom never decodes a real blob URL).
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    lastImage = this;
  }
  /** Test helper: simulate a successful decode at the given dimensions. */
  succeed(w: number, h: number) {
    this.naturalWidth = w;
    this.naturalHeight = h;
    this.onload?.();
  }
  /** Test helper: simulate a decode failure. */
  fail() {
    this.onerror?.();
  }
}

function fileOf(name: string, type: string): File {
  return new File(["x"], name, { type });
}

beforeEach(() => {
  urlSeq = 0;
  lastImage = null;
  createSpy = vi.fn(() => `blob:mock/${++urlSeq}`);
  revokeSpy = vi.fn();
  vi.stubGlobal("URL", {
    createObjectURL: createSpy,
    revokeObjectURL: revokeSpy,
  });
  vi.stubGlobal("Image", StubImage);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("shader + param state", () => {
  it("starts on the default shader with its initial values", () => {
    const { result } = renderHook(() => useStudioState());
    expect(result.current.activeId).toBe(DEFAULT_SHADER_ID);
    expect(result.current.shader.id).toBe(DEFAULT_SHADER_ID);
    expect(Object.keys(result.current.values).length).toBeGreaterThan(0);
  });

  it("selectShader switches the active shader and seeds its values once", () => {
    const other = Object.keys(SHADERS_BY_ID).find(
      (id) => id !== DEFAULT_SHADER_ID,
    )!;
    const { result } = renderHook(() => useStudioState());

    act(() => result.current.selectShader(other));
    expect(result.current.activeId).toBe(other);
    const seeded = result.current.values;

    // mutate, switch away, and back — values must persist (not be re-seeded)
    const paramName = Object.keys(seeded)[0];
    act(() => result.current.changeParam(paramName, 0.5));
    act(() => result.current.selectShader(DEFAULT_SHADER_ID));
    act(() => result.current.selectShader(other));
    expect(result.current.values[paramName]).toBe(0.5);
  });

  it("changeParam updates only the active shader's value", () => {
    const { result } = renderHook(() => useStudioState());
    const name = Object.keys(result.current.values)[0];
    act(() => result.current.changeParam(name, 0.25));
    expect(result.current.values[name]).toBe(0.25);
  });

  it("replaceValues swaps the whole value map for the active shader", () => {
    const { result } = renderHook(() => useStudioState());
    act(() => result.current.replaceValues({ custom: 7 }));
    expect(result.current.values).toEqual({ custom: 7 });
  });
});

describe("image ingest + object-URL lifecycle", () => {
  it("rejects an unsupported image type without creating a URL", () => {
    const { result } = renderHook(() => useStudioState());
    act(() => result.current.loadImageFile(fileOf("x.gif", "image/gif")));
    expect(createSpy).not.toHaveBeenCalled();
    expect(result.current.notice).toMatch(/Unsupported image/);
    expect(result.current.image).toBeNull();
  });

  it("revokes the created URL and notices when decode fails", () => {
    const { result } = renderHook(() => useStudioState());
    act(() => result.current.loadImageFile(fileOf("x.png", "image/png")));
    const created = createSpy.mock.results[0].value as string;
    act(() => lastImage!.fail());
    expect(revokeSpy).toHaveBeenCalledWith(created);
    expect(result.current.image).toBeNull();
    expect(result.current.notice).toMatch(/Couldn't read/);
  });

  it("revokes the created URL when decoded dims are degenerate (0x0)", () => {
    const { result } = renderHook(() => useStudioState());
    act(() => result.current.loadImageFile(fileOf("x.png", "image/png")));
    const created = createSpy.mock.results[0].value as string;
    act(() => lastImage!.succeed(0, 0));
    expect(revokeSpy).toHaveBeenCalledWith(created);
    expect(result.current.image).toBeNull();
  });

  it("commits a decoded image and stores its blob URL", () => {
    const { result } = renderHook(() => useStudioState());
    act(() => result.current.loadImageFile(fileOf("photo.png", "image/png")));
    act(() => lastImage!.succeed(640, 480));
    expect(result.current.image).toMatchObject({
      w: 640,
      h: 480,
      name: "photo.png",
      isBlob: true,
    });
    expect(result.current.mode).toBe("photo");
  });

  it("revokes the previous blob URL when a new image replaces it", () => {
    const { result } = renderHook(() => useStudioState());
    act(() => result.current.loadImageFile(fileOf("a.png", "image/png")));
    const firstUrl = createSpy.mock.results[0].value as string;
    act(() => lastImage!.succeed(10, 10));

    act(() => result.current.loadImageFile(fileOf("b.png", "image/png")));
    act(() => lastImage!.succeed(20, 20));

    expect(revokeSpy).toHaveBeenCalledWith(firstUrl);
    expect(result.current.image?.name).toBe("b.png");
  });

  it("does NOT track or revoke a non-blob (sample) image URL", () => {
    const { result } = renderHook(() => useStudioState());
    const sample: LoadedImage = {
      url: "/sample.jpg",
      isBlob: false,
      w: 100,
      h: 100,
      name: "sample.jpg",
    };
    act(() => result.current.commitImage(sample));
    // replacing the sample with another image must not revoke the sample's URL
    act(() => result.current.loadImageFile(fileOf("real.png", "image/png")));
    act(() => lastImage!.succeed(50, 50));
    expect(revokeSpy).not.toHaveBeenCalledWith("/sample.jpg");
  });
});

describe("video ingest + cross-source revoke", () => {
  it("rejects an unsupported video type", () => {
    const { result } = renderHook(() => useStudioState());
    act(() => result.current.loadVideoFile(fileOf("x.avi", "video/x-msvideo")));
    expect(createSpy).not.toHaveBeenCalled();
    expect(result.current.notice).toMatch(/Unsupported video/);
  });

  it("loads a video, opens the stage, and switches to video mode", () => {
    const { result } = renderHook(() => useStudioState());
    act(() => result.current.loadVideoFile(fileOf("clip.mp4", "video/mp4")));
    expect(result.current.mode).toBe("video");
    expect(result.current.videoStageOpen).toBe(true);
    expect(result.current.videoName).toBe("clip.mp4");
    expect(result.current.videoUrl).toBeTruthy();
    expect(result.current.videoFileRef.current?.name).toBe("clip.mp4");
  });

  it("revokes the abandoned image URL when a video is loaded over it", () => {
    const { result } = renderHook(() => useStudioState());
    act(() => result.current.loadImageFile(fileOf("a.png", "image/png")));
    const imageUrl = createSpy.mock.results[0].value as string;
    act(() => lastImage!.succeed(10, 10));

    act(() => result.current.loadVideoFile(fileOf("c.mp4", "video/mp4")));
    expect(revokeSpy).toHaveBeenCalledWith(imageUrl);
    expect(result.current.image).toBeNull();
  });

  it("revokes the abandoned video URL when an image is loaded over it", () => {
    const { result } = renderHook(() => useStudioState());
    act(() => result.current.loadVideoFile(fileOf("c.mp4", "video/mp4")));
    const videoUrl = createSpy.mock.results[0].value as string;

    act(() => result.current.loadImageFile(fileOf("a.png", "image/png")));
    act(() => lastImage!.succeed(10, 10));
    expect(revokeSpy).toHaveBeenCalledWith(videoUrl);
    expect(result.current.videoUrl).toBeNull();
  });

  it("revokes a previous video URL when a new video replaces it", () => {
    const { result } = renderHook(() => useStudioState());
    act(() => result.current.loadVideoFile(fileOf("c1.mp4", "video/mp4")));
    const first = createSpy.mock.results[0].value as string;
    act(() => result.current.loadVideoFile(fileOf("c2.mp4", "video/mp4")));
    expect(revokeSpy).toHaveBeenCalledWith(first);
    expect(result.current.videoName).toBe("c2.mp4");
  });
});

describe("ingest dispatch + capture", () => {
  it("routes video MIME types to the video path", () => {
    const { result } = renderHook(() => useStudioState());
    act(() => result.current.ingest(fileOf("c.mp4", "video/mp4")));
    expect(result.current.mode).toBe("video");
  });

  it("routes non-video files to the image path", () => {
    const { result } = renderHook(() => useStudioState());
    act(() => result.current.ingest(fileOf("a.png", "image/png")));
    act(() => lastImage!.succeed(8, 8));
    expect(result.current.mode).toBe("photo");
    expect(result.current.image?.name).toBe("a.png");
  });

  it("onCaptureFrame commits a frame image and closes the stage", () => {
    const { result } = renderHook(() => useStudioState());
    act(() => result.current.loadVideoFile(fileOf("c.mp4", "video/mp4")));
    act(() =>
      result.current.onCaptureFrame("blob:mock/frame", 320, 240, "0m01s000"),
    );
    expect(result.current.image).toMatchObject({
      w: 320,
      h: 240,
      isBlob: true,
      name: "frame-0m01s000.png",
    });
    expect(result.current.videoStageOpen).toBe(false);
  });

  it("onVideoMeta warns for a clip past the soft duration ceiling", () => {
    const { result } = renderHook(() => useStudioState());
    act(() => result.current.onVideoMeta(1920, 1080, 99999));
    expect(result.current.videoDims).toEqual({ w: 1920, h: 1080 });
    expect(result.current.notice).toMatch(/Long clip/);
  });
});

describe("URL-hash seeding + restore", () => {
  afterEach(() => {
    window.history.replaceState(null, "", "/");
  });

  it("seeds the active shader + params from the location hash on init", () => {
    window.history.replaceState(null, "", "/#s=mesh-gradient&p=speed:1.5");
    const { result } = renderHook(() => useStudioState());
    expect(result.current.activeId).toBe("mesh-gradient");
    expect(result.current.values.speed).toBeCloseTo(1.5, 4);
    // unspecified params still take their shader defaults
    const mesh = SHADERS_BY_ID["mesh-gradient"];
    const swirl = mesh.params.find((p) => p.name === "swirl");
    expect(result.current.values.swirl).toBe(swirl?.default);
  });

  it("falls back to the default shader for an unknown hash shader id", () => {
    window.history.replaceState(null, "", "/#s=not-real&p=speed:9");
    const { result } = renderHook(() => useStudioState());
    expect(result.current.activeId).toBe(DEFAULT_SHADER_ID);
  });

  it("restores state on a back/forward hashchange", () => {
    const { result } = renderHook(() => useStudioState());
    expect(result.current.activeId).toBe(DEFAULT_SHADER_ID);
    act(() => {
      window.location.hash = "#s=mesh-gradient&p=speed:0.5";
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(result.current.activeId).toBe("mesh-gradient");
    expect(result.current.values.speed).toBeCloseTo(0.5, 4);
  });
});

describe("unmount cleanup", () => {
  it("revokes both live source URLs on unmount", () => {
    const { result, unmount } = renderHook(() => useStudioState());
    act(() => result.current.loadVideoFile(fileOf("c.mp4", "video/mp4")));
    const videoUrl = createSpy.mock.results[0].value as string;
    revokeSpy.mockClear();
    unmount();
    expect(revokeSpy).toHaveBeenCalledWith(videoUrl);
  });
});
