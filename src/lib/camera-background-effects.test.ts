import { afterEach, describe, expect, it, vi } from "vitest";
import type { CameraBackgroundSetting } from "@/stores/useVoiceSettingsStore";
import {
  createCameraBackgroundEffect,
  getCameraBackgroundEffectKey,
} from "./camera-background-effects";
import { MockMediaStream, MockMediaStreamTrack } from "./__tests__/webrtc-mocks";

function mockTrack(width = 1280, height = 720) {
  const track = new MockMediaStreamTrack("video") as any;
  track.getSettings = vi.fn(() => ({ width, height, frameRate: 30, deviceId: "camera-1" }));
  return track as MediaStreamTrack;
}

function mockCanvasEnvironment(outputTrack: MediaStreamTrack) {
  const contexts: any[] = [];
  const canvases: any[] = [];
  const image = {
    decoding: "auto",
    crossOrigin: null as string | null,
    src: "",
    complete: true,
    naturalWidth: 640,
    naturalHeight: 360,
    style: {},
    decode: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn(),
  };
  const body = {
    appendChild: vi.fn((node: unknown) => node),
  };
  const createContext = () => ({
    clearRect: vi.fn(),
    drawImage: vi.fn(),
    putImageData: vi.fn(),
    createImageData: vi.fn((width: number, height: number) => ({
      width,
      height,
      data: new Uint8ClampedArray(width * height * 4),
    })),
    filter: "none",
    globalCompositeOperation: "source-over",
    imageSmoothingEnabled: false,
  });

  const createCanvas = () => {
    const context = createContext();
    contexts.push(context);
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => context),
      captureStream: vi.fn(() => new MockMediaStream([outputTrack])),
    };
    canvases.push(canvas);
    return canvas;
  };

  const video = {
    muted: false,
    playsInline: false,
    srcObject: null as MediaStream | null,
    videoWidth: 1280,
    videoHeight: 720,
    play: vi.fn().mockResolvedValue(undefined),
    removeAttribute: vi.fn(),
  };

  const document = {
    body,
    createElement: vi.fn((tag: string) => {
      if (tag === "video") return video;
      if (tag === "img") return image;
      return createCanvas();
    }),
  } as unknown as Document;

  return { body, canvases, contexts, document, image, video };
}

describe("camera background effects", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses a stable key that changes when the selected custom image changes", () => {
    const setting: CameraBackgroundSetting = { type: "image", id: "bg-1" };

    expect(getCameraBackgroundEffectKey({ type: "none" }, [])).toBe("none");
    expect(getCameraBackgroundEffectKey({ type: "blur", strength: "light" }, [])).toBe("blur:light");
    expect(getCameraBackgroundEffectKey(setting, [
      { id: "bg-1", name: "one.webp", url: "/api/camera-backgrounds/bg-1/one.webp", contentType: "image/webp", sizeBytes: 123, createdAt: 1 },
    ])).toBe("image:bg-1:1");
  });

  it("loads uploaded image backgrounds from URL sources with CORS enabled", async () => {
    vi.stubGlobal("MediaStream", MockMediaStream);
    const outputTrack = new MockMediaStreamTrack("video") as any;
    const { body, contexts, document, image } = mockCanvasEnvironment(outputTrack as MediaStreamTrack);
    const createSegmenter = vi.fn().mockResolvedValue({
      segmentForVideo: vi.fn(() => ({
        categoryMask: {
          width: 1,
          height: 1,
          getAsUint8Array: () => new Uint8Array([0]),
        },
      })),
    });

    const effect = await createCameraBackgroundEffect(
      mockTrack(),
      { type: "image", id: "bg-1" },
      [{
        id: "bg-1",
        name: "animated.webp",
        url: "/api/camera-backgrounds/bg-1/animated.webp",
        contentType: "image/webp",
        sizeBytes: 123,
        createdAt: 1,
      }],
      {
        createSegmenter,
        document,
        now: () => 123,
      },
    );

    expect(effect).not.toBeNull();
    expect(image.src).toBe("/api/camera-backgrounds/bg-1/animated.webp");
    expect(image.crossOrigin).toBe("anonymous");
    expect(image.decode).toHaveBeenCalledTimes(1);
    expect(body.appendChild).toHaveBeenCalledWith(image);
    expect(contexts[0].drawImage.mock.calls.some((call: any[]) => call[0] === image)).toBe(true);

    effect?.stop();

    expect(image.remove).toHaveBeenCalledTimes(1);
  });

  it("draws animated image backgrounds from decoded frames", async () => {
    vi.stubGlobal("MediaStream", MockMediaStream);
    const outputTrack = new MockMediaStreamTrack("video") as any;
    const { contexts, document } = mockCanvasEnvironment(outputTrack as MediaStreamTrack);
    const frame0 = { displayWidth: 640, displayHeight: 360, duration: 40_000, close: vi.fn() } as any;
    const frame1 = { displayWidth: 640, displayHeight: 360, duration: 40_000, close: vi.fn() } as any;
    const buffer = new ArrayBuffer(8);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: vi.fn(() => "image/webp") },
      arrayBuffer: vi.fn().mockResolvedValue(buffer),
    });
    const decodeMock = vi.fn(({ frameIndex }: { frameIndex: number }) => Promise.resolve({
      image: frameIndex === 0 ? frame0 : frame1,
    }));
    const decoderClose = vi.fn();
    const decoderInits: any[] = [];

    class MockImageDecoder {
      tracks = { ready: Promise.resolve(), selectedTrack: { frameCount: 2 } };
      decode = decodeMock;
      close = decoderClose;

      constructor(init: any) {
        decoderInits.push(init);
      }
    }

    let rafCallback: FrameRequestCallback | null = null;
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("ImageDecoder", MockImageDecoder);
    const createSegmenter = vi.fn().mockResolvedValue({
      segmentForVideo: vi.fn(() => ({
        categoryMask: {
          width: 1,
          height: 1,
          getAsUint8Array: () => new Uint8Array([0]),
        },
      })),
    });

    const effect = await createCameraBackgroundEffect(
      mockTrack(),
      { type: "image", id: "bg-1" },
      [{
        id: "bg-1",
        name: "animated.webp",
        url: "/api/camera-backgrounds/bg-1/animated.webp",
        contentType: "image/webp",
        sizeBytes: 123,
        createdAt: 1,
      }],
      {
        createSegmenter,
        document,
        now: () => 0,
        requestAnimationFrame: vi.fn((callback) => {
          rafCallback = callback;
          return 7;
        }),
      },
    );

    expect(effect).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledWith("/api/camera-backgrounds/bg-1/animated.webp", { credentials: "include" });
    expect(decoderInits[0]).toEqual({ data: buffer, type: "image/webp" });
    expect(contexts[0].drawImage.mock.calls.some((call: any[]) => call[0] === frame0)).toBe(true);

    const runRaf = (timestamp: number) => {
      const callback = rafCallback;
      if (!callback) throw new Error("requestAnimationFrame was not scheduled");
      callback(timestamp);
    };

    runRaf(50);
    await Promise.resolve();
    await Promise.resolve();
    runRaf(80);

    expect(contexts[0].drawImage.mock.calls.some((call: any[]) => call[0] === frame1)).toBe(true);

    effect?.stop();

    expect(frame0.close).toHaveBeenCalledTimes(1);
    expect(frame1.close).toHaveBeenCalledTimes(1);
    expect(decoderClose).toHaveBeenCalledTimes(1);
  });

  it("does not allocate a processor when no background is selected", async () => {
    const createSegmenter = vi.fn();

    await expect(createCameraBackgroundEffect(mockTrack(), { type: "none" }, [], { createSegmenter })).resolves.toBeNull();

    expect(createSegmenter).not.toHaveBeenCalled();
  });

  it("creates a processed canvas stream for blur and releases it on stop", async () => {
    vi.stubGlobal("MediaStream", MockMediaStream);
    const outputTrack = new MockMediaStreamTrack("video") as any;
    outputTrack.getSettings = vi.fn(() => ({ width: 1280, height: 720, frameRate: 24 }));
    const { contexts, document, video } = mockCanvasEnvironment(outputTrack as MediaStreamTrack);
    const closeResult = vi.fn();
    const closeMask = vi.fn();
    const segmentForVideo = vi.fn(() => ({
      categoryMask: {
        width: 1,
        height: 1,
        getAsUint8Array: () => new Uint8Array([1]),
        close: closeMask,
      },
      close: closeResult,
    }));
    const createSegmenter = vi.fn().mockResolvedValue({ segmentForVideo });

    const effect = await createCameraBackgroundEffect(
      mockTrack(),
      { type: "blur", strength: "strong" },
      [],
      {
        createSegmenter,
        document,
        now: () => 123,
        requestAnimationFrame: vi.fn(() => 7),
        cancelAnimationFrame: vi.fn(),
      },
    );

    expect(effect).not.toBeNull();
    expect(effect?.stream.getVideoTracks()[0]).toBe(outputTrack);
    expect(createSegmenter).toHaveBeenCalledTimes(1);
    expect(segmentForVideo).toHaveBeenCalledWith(video, 123);
    expect(contexts.some((ctx) => ctx.drawImage.mock.calls.length > 0)).toBe(true);

    effect?.stop();

    expect(outputTrack.stop).toHaveBeenCalledTimes(1);
    expect(video.srcObject).toBeNull();
    expect(closeResult).toHaveBeenCalledTimes(1);
  });

  it("treats selfie segmenter category 0 as the foreground subject", async () => {
    vi.stubGlobal("MediaStream", MockMediaStream);
    const outputTrack = new MockMediaStreamTrack("video") as any;
    const { contexts, document } = mockCanvasEnvironment(outputTrack as MediaStreamTrack);
    const segmentForVideo = vi.fn(() => ({
      categoryMask: {
        width: 2,
        height: 1,
        getAsUint8Array: () => new Uint8Array([0, 1]),
      },
    }));
    const createSegmenter = vi.fn().mockResolvedValue({ segmentForVideo });

    const effect = await createCameraBackgroundEffect(
      mockTrack(),
      { type: "blur", strength: "strong" },
      [],
      {
        createSegmenter,
        document,
        now: () => 123,
      },
    );

    const maskContext = contexts[2];
    const imageData = maskContext.putImageData.mock.calls[0][0];

    expect(imageData.data[3]).toBe(255);
    expect(imageData.data[7]).toBe(0);

    effect?.stop();
  });
});
