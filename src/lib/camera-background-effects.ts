import { clog } from "@/lib/console-logger";
import { getAuthAssetUrl } from "@/lib/platform";
import type { CameraBackgroundSetting, CustomCameraBackground } from "@/stores/useVoiceSettingsStore";

const bgLog = clog("CameraBackground");

const MEDIAPIPE_WASM_URL = "/mediapipe";
const SELFIE_SEGMENTER_MODEL_URL = "/mediapipe/selfie_segmenter.tflite";
const MAX_EFFECT_WIDTH = 1280;
const MAX_EFFECT_HEIGHT = 720;
const EFFECT_FPS = 24;
const SEGMENT_FPS = 12;
const MASK_EDGE_FEATHER_PX = 1.5;
const MASK_EDGE_INSET_PX = 2;

interface SegmenterResult {
  categoryMask?: {
    width: number;
    height: number;
    getAsUint8Array: () => Uint8Array;
    close?: () => void;
  };
  close?: () => void;
}

interface CameraSegmenter {
  segmentForVideo: (videoFrame: TexImageSource, timestamp: number) => SegmenterResult;
}

interface LoadedBackgroundImage {
  kind: "static";
  image: HTMLImageElement;
  cleanup: () => void;
}

type DecodedAnimationFrame = CanvasImageSource & {
  duration?: number;
  close?: () => void;
};

interface LoadedAnimatedBackgroundImage {
  kind: "animated";
  decoder: {
    decode: (options: { frameIndex: number }) => Promise<{ image: DecodedAnimationFrame }>;
    close?: () => void;
  };
  frame: DecodedAnimationFrame;
  frameCount: number;
  nextFrameIndex: number;
  currentFrameDurationMs: number;
  nextFrameAt: number | null;
  decoding: Promise<void> | null;
  stopped: boolean;
  cleanup: () => void;
}

type LoadedBackground = LoadedBackgroundImage | LoadedAnimatedBackgroundImage;

const ANIMATED_BACKGROUND_MIME_TYPES = new Set(["image/gif", "image/webp", "image/avif", "image/apng"]);
const DEFAULT_ANIMATION_FRAME_DURATION_MS = 100;
const MIN_ANIMATION_FRAME_DURATION_MS = 20;

export interface CameraBackgroundEffect {
  key: string;
  stream: MediaStream;
  track: MediaStreamTrack;
  stop: () => void;
}

export interface CameraBackgroundEffectOptions {
  document?: Document;
  createSegmenter?: () => Promise<CameraSegmenter>;
  requestAnimationFrame?: (callback: FrameRequestCallback) => number;
  cancelAnimationFrame?: (handle: number) => void;
  now?: () => number;
}

let segmenterPromise: Promise<CameraSegmenter> | null = null;

export function getCameraBackgroundEffectKey(
  setting: CameraBackgroundSetting,
  customBackgrounds: CustomCameraBackground[],
): string {
  if (setting.type === "none") return "none";
  if (setting.type === "blur") return `blur:${setting.strength}`;

  const background = customBackgrounds.find((candidate) => candidate.id === setting.id);
  return background ? `image:${setting.id}:${background.createdAt}` : "none";
}

function normalizeMimeType(contentType: string | undefined | null): string {
  return (contentType ?? "").toLowerCase().split(";")[0].trim();
}

function mimeTypeFromDataUrl(source: string): string {
  const match = /^data:([^;,]+)/i.exec(source);
  return normalizeMimeType(match?.[1]);
}

function getBackgroundImageSource(
  setting: CameraBackgroundSetting,
  customBackgrounds: CustomCameraBackground[],
): { src: string; contentType?: string } | null {
  if (setting.type !== "image") return null;
  const background = customBackgrounds.find((candidate) => candidate.id === setting.id);
  if (!background) return null;
  const src = background.url ? getAuthAssetUrl(background.url) : background.dataUrl;
  return src ? { src, contentType: background.contentType } : null;
}

async function defaultCreateSegmenter(): Promise<CameraSegmenter> {
  if (!segmenterPromise) {
    segmenterPromise = (async () => {
      const { FilesetResolver, ImageSegmenter } = await import("@mediapipe/tasks-vision");
      const vision = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_URL);
      const create = (delegate: "GPU" | "CPU") => ImageSegmenter.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: SELFIE_SEGMENTER_MODEL_URL,
          delegate,
        },
        runningMode: "VIDEO",
        outputCategoryMask: true,
        outputConfidenceMasks: false,
      });

      try {
        return await create("GPU");
      } catch (error) {
        bgLog.warn("GPU selfie segmentation unavailable; falling back to CPU", error);
        return create("CPU");
      }
    })().catch((error) => {
      segmenterPromise = null;
      throw error;
    });
  }

  return segmenterPromise;
}

function getOutputSize(track: MediaStreamTrack): { width: number; height: number } {
  const settings = track.getSettings?.() ?? {};
  const sourceWidth = typeof settings.width === "number" && settings.width > 0 ? settings.width : MAX_EFFECT_WIDTH;
  const sourceHeight = typeof settings.height === "number" && settings.height > 0 ? settings.height : MAX_EFFECT_HEIGHT;
  const scale = Math.min(1, MAX_EFFECT_WIDTH / sourceWidth, MAX_EFFECT_HEIGHT / sourceHeight);

  return {
    width: Math.max(2, Math.round(sourceWidth * scale)),
    height: Math.max(2, Math.round(sourceHeight * scale)),
  };
}

function drawCover(ctx: CanvasRenderingContext2D, source: CanvasImageSource, width: number, height: number, scale = 1) {
  const anySource = source as any;
  const sourceWidth = anySource.videoWidth || anySource.naturalWidth || anySource.displayWidth || anySource.width || width;
  const sourceHeight = anySource.videoHeight || anySource.naturalHeight || anySource.displayHeight || anySource.height || height;
  const ratio = Math.max(width / sourceWidth, height / sourceHeight) * scale;
  const drawWidth = sourceWidth * ratio;
  const drawHeight = sourceHeight * ratio;
  ctx.drawImage(source, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
}

function getAnimationFrameDurationMs(frame: DecodedAnimationFrame): number {
  const durationMs = typeof frame.duration === "number" && frame.duration > 0
    ? frame.duration / 1000
    : DEFAULT_ANIMATION_FRAME_DURATION_MS;
  return Math.max(MIN_ANIMATION_FRAME_DURATION_MS, durationMs);
}

function queueNextAnimationFrame(background: LoadedAnimatedBackgroundImage, timestamp: number) {
  if (background.stopped || background.decoding || background.nextFrameAt === null || timestamp < background.nextFrameAt) return;

  const frameIndex = background.nextFrameIndex;
  background.decoding = background.decoder.decode({ frameIndex })
    .then(({ image }) => {
      if (background.stopped) {
        image.close?.();
        return;
      }

      background.frame.close?.();
      background.frame = image;
      background.currentFrameDurationMs = getAnimationFrameDurationMs(image);
      background.nextFrameIndex = (frameIndex + 1) % background.frameCount;
      background.nextFrameAt = timestamp + background.currentFrameDurationMs;
    })
    .catch((error) => {
      if (background.stopped) return;
      background.nextFrameAt = timestamp + DEFAULT_ANIMATION_FRAME_DURATION_MS;
      bgLog.warn("Animated camera background frame failed to decode", error);
    })
    .finally(() => {
      if (!background.stopped) background.decoding = null;
    });
}

function drawLoadedBackground(
  ctx: CanvasRenderingContext2D,
  background: LoadedBackground,
  width: number,
  height: number,
  timestamp: number,
) {
  if (background.kind === "animated") {
    if (background.nextFrameAt === null) {
      background.nextFrameAt = timestamp + background.currentFrameDurationMs;
    } else {
      queueNextAnimationFrame(background, timestamp);
    }
    drawCover(ctx, background.frame, width, height);
    return;
  }

  drawCover(ctx, background.image, width, height);
}

function attachBackgroundImagePlayback(image: HTMLImageElement, doc: Document): () => void {
  const body = doc.body;
  if (!body?.appendChild) return () => {};

  // Animated backgrounds only keep advancing frames while the image remains in
  // the rendered tree, so keep a 1x1 copy mounted offscreen for canvas draws.
  image.alt = "";
  image.style.position = "fixed";
  image.style.left = "-9999px";
  image.style.top = "0";
  image.style.width = "1px";
  image.style.height = "1px";
  image.style.opacity = "0";
  image.style.pointerEvents = "none";
  image.style.userSelect = "none";
  image.style.zIndex = "-1";
  body.appendChild(image);

  return () => image.remove?.();
}

async function loadImage(dataUrl: string, doc: Document): Promise<LoadedBackgroundImage | null> {
  const image = doc.createElement("img");
  image.decoding = "async";
  // Do NOT set crossOrigin here: the URL already contains a ?token= query param for auth.
  // Setting crossOrigin="anonymous" forces CORS mode which requires the server to echo back
  // the Origin header — but CEF can report a null/opaque origin from voice frame contexts,
  // causing the request to be blocked even when the server CORS config is correct.
  const cleanup = attachBackgroundImagePlayback(image, doc);
  image.src = dataUrl;

  try {
    if (typeof image.decode === "function") await image.decode();
    else if (!image.complete) {
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error("Could not load camera background image"));
      });
    }
    return { kind: "static", image, cleanup };
  } catch (error) {
    cleanup();
    bgLog.warn("Custom camera background image failed to load", error);
    return null;
  }
}

async function loadAnimatedImage(source: string, contentType?: string): Promise<LoadedAnimatedBackgroundImage | null> {
  const mimeType = normalizeMimeType(contentType) || mimeTypeFromDataUrl(source);
  if (!ANIMATED_BACKGROUND_MIME_TYPES.has(mimeType)) return null;

  const ImageDecoderCtor = (globalThis as any).ImageDecoder;
  if (typeof ImageDecoderCtor !== "function") return null;

  let decoder: LoadedAnimatedBackgroundImage["decoder"] | null = null;

  try {
    // Use credentials: "omit" — auth is via ?token= in the URL, not cookies.
    // "include" forces CORS mode which can fail when the request originates from a
    // null/opaque security context (e.g. a MediaStream processing frame in CEF).
    const response = await fetch(source, { credentials: "omit" });
    if (!response.ok) throw new Error(`Could not fetch animated background (${response.status})`);

    const responseMimeType = normalizeMimeType(response.headers.get("Content-Type")) || mimeType;
    if (!ANIMATED_BACKGROUND_MIME_TYPES.has(responseMimeType)) return null;

    const decoderInit = {
      data: await response.arrayBuffer(),
      type: responseMimeType,
    };
    const createdDecoder = new ImageDecoderCtor(decoderInit) as LoadedAnimatedBackgroundImage["decoder"] & {
      tracks: { ready: Promise<void>; selectedTrack?: { frameCount?: number } };
    };
    decoder = createdDecoder;
    await createdDecoder.tracks.ready;

    const frameCount = Number(createdDecoder.tracks.selectedTrack?.frameCount ?? 1);
    if (!Number.isFinite(frameCount) || frameCount <= 1) {
      createdDecoder.close?.();
      return null;
    }

    const { image } = await createdDecoder.decode({ frameIndex: 0 });
    const background: LoadedAnimatedBackgroundImage = {
      kind: "animated",
      decoder: createdDecoder,
      frame: image,
      frameCount,
      nextFrameIndex: 1,
      currentFrameDurationMs: getAnimationFrameDurationMs(image),
      nextFrameAt: null,
      decoding: null,
      stopped: false,
      cleanup: () => {
        background.stopped = true;
        background.frame.close?.();
        background.decoder.close?.();
      },
    };
    return background;
  } catch (error) {
    decoder?.close?.();
    bgLog.warn("Animated camera background failed to decode; falling back to static image", error);
    return null;
  }
}

async function loadBackgroundImage(source: string, doc: Document, contentType?: string): Promise<LoadedBackground | null> {
  return await loadAnimatedImage(source, contentType) ?? await loadImage(source, doc);
}

function maskToCanvas(mask: NonNullable<SegmenterResult["categoryMask"]>, canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D) {
  const width = Math.max(1, mask.width);
  const height = Math.max(1, mask.height);
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;

  const maskData = mask.getAsUint8Array();
  const imageData = ctx.createImageData(width, height);
  for (let index = 0; index < maskData.length; index++) {
    const pixel = index * 4;
    // MediaPipe's selfie segmenter emits category 0 for the person and non-zero for background.
    const alpha = maskData[index] === 0 ? 255 : 0;
    imageData.data[pixel] = 255;
    imageData.data[pixel + 1] = 255;
    imageData.data[pixel + 2] = 255;
    imageData.data[pixel + 3] = alpha;
  }
  ctx.putImageData(imageData, 0, 0);
}

export async function createCameraBackgroundEffect(
  sourceTrack: MediaStreamTrack,
  setting: CameraBackgroundSetting,
  customBackgrounds: CustomCameraBackground[],
  options: CameraBackgroundEffectOptions = {},
): Promise<CameraBackgroundEffect | null> {
  const key = getCameraBackgroundEffectKey(setting, customBackgrounds);
  if (key === "none") return null;

  const doc = options.document ?? globalThis.document;
  if (!doc?.createElement) return null;

  const createSegmenter = options.createSegmenter ?? defaultCreateSegmenter;
  const segmenter = await createSegmenter();
  const { width, height } = getOutputSize(sourceTrack);
  const video = doc.createElement("video");
  const canvas = doc.createElement("canvas");
  const foregroundCanvas = doc.createElement("canvas");
  const maskCanvas = doc.createElement("canvas");
  const ctx = canvas.getContext("2d", { alpha: false });
  const foregroundCtx = foregroundCanvas.getContext("2d");
  const maskCtx = maskCanvas.getContext("2d");
  if (!ctx || !foregroundCtx || !maskCtx || typeof canvas.captureStream !== "function") return null;

  canvas.width = width;
  canvas.height = height;
  foregroundCanvas.width = width;
  foregroundCanvas.height = height;
  ctx.imageSmoothingEnabled = true;
  foregroundCtx.imageSmoothingEnabled = true;
  maskCtx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  foregroundCtx.imageSmoothingQuality = "high";
  maskCtx.imageSmoothingQuality = "high";

  const imageSource = getBackgroundImageSource(setting, customBackgrounds);
  const loadedBackgroundImage = imageSource ? await loadBackgroundImage(imageSource.src, doc, imageSource.contentType) : null;

  video.muted = true;
  video.playsInline = true;
  video.srcObject = new MediaStream([sourceTrack]);

  try {
    await video.play();
  } catch (error) {
    bgLog.warn("Camera background processor could not start video playback", error);
    loadedBackgroundImage?.cleanup();
    video.srcObject = null;
    return null;
  }

  const stream = canvas.captureStream(EFFECT_FPS);
  const track = stream.getVideoTracks()[0];
  if (!track) {
    loadedBackgroundImage?.cleanup();
    video.srcObject = null;
    return null;
  }
  track.contentHint = "motion";

  const requestAnimationFrame = options.requestAnimationFrame ?? globalThis.requestAnimationFrame?.bind(globalThis);
  const cancelAnimationFrame = options.cancelAnimationFrame ?? globalThis.cancelAnimationFrame?.bind(globalThis);
  const now = options.now ?? (() => performance.now());
  let raf = 0;
  let stopped = false;
  let lastSegmentedAt = -Infinity;
  let hasMask = false;

  const drawFrame = (timestamp: number) => {
    if (stopped) return;

    if (timestamp - lastSegmentedAt >= 1000 / SEGMENT_FPS) {
      lastSegmentedAt = timestamp;
      try {
        const result = segmenter.segmentForVideo(video, timestamp);
        if (result.categoryMask) {
          maskToCanvas(result.categoryMask, maskCanvas, maskCtx);
          hasMask = true;
        }
        result.close?.();
      } catch (error) {
        hasMask = false;
        bgLog.warn("Camera background segmentation frame failed", error);
      }
    }

    if (setting.type === "image" && loadedBackgroundImage) {
      ctx.filter = "none";
      drawLoadedBackground(ctx, loadedBackgroundImage, width, height, timestamp);
    } else {
      ctx.filter = setting.type === "blur" && setting.strength === "light" ? "blur(10px)" : "blur(18px)";
      drawCover(ctx, video, width, height, 1.08);
      ctx.filter = "none";
    }

    foregroundCtx.globalCompositeOperation = "source-over";
    foregroundCtx.clearRect(0, 0, width, height);
    drawCover(foregroundCtx, video, width, height);
    if (hasMask) {
      const maskInsetX = Math.min(MASK_EDGE_INSET_PX, Math.max(0, Math.floor((width - 1) / 2)));
      const maskInsetY = Math.min(MASK_EDGE_INSET_PX, Math.max(0, Math.floor((height - 1) / 2)));
      foregroundCtx.globalCompositeOperation = "destination-in";
      foregroundCtx.filter = `blur(${MASK_EDGE_FEATHER_PX}px)`;
      foregroundCtx.drawImage(
        maskCanvas,
        maskInsetX,
        maskInsetY,
        width - maskInsetX * 2,
        height - maskInsetY * 2,
      );
      foregroundCtx.filter = "none";
      foregroundCtx.globalCompositeOperation = "source-over";
    }
    ctx.drawImage(foregroundCanvas, 0, 0, width, height);

    if (requestAnimationFrame) raf = requestAnimationFrame(drawFrame);
  };

  drawFrame(now());

  return {
    key,
    stream,
    track,
    stop: () => {
      if (stopped) return;
      stopped = true;
      if (raf && cancelAnimationFrame) cancelAnimationFrame(raf);
      track.stop();
      video.pause?.();
      video.srcObject = null;
      video.removeAttribute?.("src");
      loadedBackgroundImage?.cleanup();
    },
  };
}
