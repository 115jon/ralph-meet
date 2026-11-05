// The web client's screen capture sources for the @ralph/voice ScreenShare
// module: the native Rust hardware publisher (desktop) and the browser
// paths (CEF desktop capture of a picked source, or getDisplayMedia). The
// module decides when each runs; see packages/voice/SCREEN_SHARE.md.

import {
  ScreenShare,
  type PublicationReconciler,
  type ScreenCapture,
  type ScreenShareRequest,
  type ScreenShareSources,
} from "@ralph/voice";
import { clog } from "@/lib/console-logger";
import { getHost } from "@/lib/host";
import {
  getCapturePolicy,
  isDesktop,
  isWgcCaptureAllowed,
} from "@/lib/platform";
import type {
  ScreenShareOptions,
  ScreenShareSourceState,
} from "@/lib/screen-share-types";
import type { SFUClient } from "@/lib/sfu-client";

const screenLog = clog("ScreenShare");
const previewLog = clog("Preview");

const SCREEN_QUALITY_MAP: Record<
  string,
  { width: number; height: number; bitrate: number }
> = {
  "720p": { width: 1280, height: 720, bitrate: 5_000_000 },
  "1080p": { width: 1920, height: 1080, bitrate: 8_000_000 },
  "1440p": { width: 2560, height: 1440, bitrate: 14_000_000 },
  "4k": { width: 3840, height: 2160, bitrate: 24_000_000 },
};

function getScreenQualitySettings(quality: string) {
  const fps = quality.endsWith("60") ? 60 : 30;
  const resKey = quality.replace(/\d+$/, "");
  const res = SCREEN_QUALITY_MAP[resKey];
  return { fps, res };
}

function desktopCaptureSourceId(
  sourceId: string,
  sourceKind?: "window" | "monitor" | "device",
) {
  if (sourceKind === "window" && sourceId.startsWith("window-")) {
    return `window:${sourceId.slice("window-".length)}:0`;
  }

  if (sourceKind === "monitor" && sourceId.startsWith("monitor-")) {
    return `screen:${sourceId.slice("monitor-".length)}:0`;
  }

  return null;
}

export async function getCustomPickerDesktopStream(options: {
  sourceId?: string;
  captureId?: string;
  sourceKind?: "window" | "monitor" | "device";
  withAudio: boolean;
  videoConstraints: MediaTrackConstraints;
  desktopMandatoryConstraints: Record<string, unknown>;
}): Promise<MediaStream | null> {
  if (!options.sourceId) return null;

  if (options.sourceKind === "device") {
    return navigator.mediaDevices.getUserMedia({
      video: {
        deviceId: { exact: options.sourceId },
        ...options.videoConstraints,
      },
      audio: false,
    });
  }

  const chromeMediaSourceId =
    options.captureId ??
    desktopCaptureSourceId(options.sourceId, options.sourceKind);
  if (!chromeMediaSourceId) return null;

  const constraints: MediaStreamConstraints = {
    video: {
      mandatory: {
        chromeMediaSource: "desktop",
        chromeMediaSourceId,
        ...options.desktopMandatoryConstraints,
      },
    } as MediaTrackConstraints,
    audio: false,
  };

  if (options.withAudio && options.sourceKind === "monitor") {
    constraints.audio = {
      mandatory: {
        chromeMediaSource: "desktop",
        chromeMediaSourceId,
      },
    } as MediaTrackConstraints;
  }

  return navigator.mediaDevices.getUserMedia(constraints);
}

export function screenShareVideoConstraints(quality: string) {
  const { fps, res } = getScreenQualitySettings(quality);
  const browserVideoConstraints = {
    ...(res
      ? { width: { ideal: res.width }, height: { ideal: res.height } }
      : {}),
    frameRate: { ideal: fps, max: fps },
    cursor: "always",
  } as MediaTrackConstraints;

  const desktopMandatoryConstraints: Record<string, unknown> = {
    maxFrameRate: fps,
    cursor: "always",
  };

  if (res) {
    desktopMandatoryConstraints.maxWidth = res.width;
    desktopMandatoryConstraints.maxHeight = res.height;
  }

  return { fps, res, browserVideoConstraints, desktopMandatoryConstraints };
}

/** Whether a screen share is driven by the native hardware pipeline or by CEF. */
export type ScreenSharePreviewKind = "native" | "cef";

export interface PreviewStartDecision {
  /** Initial `isPreviewHidden` value for the session. */
  isPreviewHidden: boolean;
  /** Whether a CEF preview capture session should be opened for the shared source. */
  openCefPreview: boolean;
}

/**
 * Pure decision for the initial Local_Preview state when a screen share starts.
 *
 * Native (hardware) shares default to PAUSED so a second WGC/getDisplayMedia
 * session is not opened on the same source, which would add capture overhead
 * (Req 5.1). If the user explicitly enables "Always Show Stream Preview", that
 * preference overrides the native default and opens the preview immediately.
 * CEF (non-native) shares keep the existing default of showing the preview
 * (Req 5.4). The resume control later reopens the preview through the existing
 * `togglePreviewHidden` flow (Req 5.3).
 *
 * Preview is paused (and no CEF preview session is opened) if and only if the
 * share is native and the user has not opted into always showing the preview.
 */
export function resolvePreviewStartState(
  kind: ScreenSharePreviewKind,
  alwaysShowPreview = false,
): PreviewStartDecision {
  const isNative = kind === "native";
  const shouldPausePreview = isNative && !alwaysShowPreview;
  return {
    isPreviewHidden: shouldPausePreview,
    openCefPreview: !shouldPausePreview,
  };
}

function describeVideoTrack(track?: MediaStreamTrack) {
  if (!track) return null;
  const settings = track.getSettings();
  return {
    id: track.id,
    label: track.label,
    readyState: track.readyState,
    muted: track.muted,
    width: settings.width,
    height: settings.height,
    frameRate: settings.frameRate,
    displaySurface: (
      settings as MediaTrackSettings & { displaySurface?: string }
    ).displaySurface,
    deviceId: settings.deviceId,
  };
}

function describeAudioTrack(track?: MediaStreamTrack) {
  if (!track) return null;
  const settings = track.getSettings();
  return {
    id: track.id,
    label: track.label,
    readyState: track.readyState,
    muted: track.muted,
    deviceId: settings.deviceId,
    sampleRate: (settings as MediaTrackSettings & { sampleRate?: number })
      .sampleRate,
    channelCount: (settings as MediaTrackSettings & { channelCount?: number })
      .channelCount,
  };
}

export function logScreenShare(message: string, details?: unknown) {
  if (details === undefined) {
    screenLog.info(message);
    return;
  }
  try {
    screenLog.info(
      `${message} ${JSON.stringify(details, (_key, value) => {
        if (value instanceof Error) {
          return {
            name: value.name,
            message: value.message,
            stack: value.stack,
          };
        }
        return value;
      })}`,
    );
  } catch {
    screenLog.info(message, details);
  }
}

async function probeNativeHardwareEncoders() {
  if (!isDesktop()) return null;
  try {
    return await getHost().media.probeHardwareVideoEncoders();
  } catch (error) {
    return { error };
  }
}

function hasNativeH264HardwareEncoder(probe: unknown) {
  return (
    Array.isArray((probe as { h264?: unknown[] } | null)?.h264) &&
    ((probe as { h264?: unknown[] }).h264?.length ?? 0) > 0
  );
}

type QualityClient = Pick<SFUClient, "updateSenderEncoding">;

async function applyScreenTrackQuality(
  stream: MediaStream | null,
  quality: string,
  sfu: QualityClient | null,
  participantId: string | null,
) {
  const videoTrack = stream?.getVideoTracks()[0];
  if (!videoTrack) return;

  const { fps, res } = getScreenQualitySettings(quality);
  if (res) {
    logScreenShare("Applying screen quality", {
      quality,
      requested: {
        width: res.width,
        height: res.height,
        fps,
        bitrate: res.bitrate,
      },
      before: describeVideoTrack(videoTrack),
    });
    await videoTrack
      .applyConstraints({
        width: { ideal: res.width, max: res.width },
        height: { ideal: res.height, max: res.height },
        frameRate: { ideal: fps, max: fps },
      })
      .catch((err) => {
        screenLog.warn("Failed to apply video constraints:", err);
      });
    logScreenShare("Applied screen quality", {
      quality,
      after: describeVideoTrack(videoTrack),
      constraints: videoTrack.getConstraints?.(),
    });
  }

  if (!sfu || !participantId) return;

  await sfu
    .updateSenderEncoding(`screen-video-${participantId}`, {
      maxBitrate: res?.bitrate,
      maxFramerate: fps,
      scaleResolutionDownBy: 1,
    })
    .catch((err) => {
      screenLog.warn("Failed to update sender encoding:", err);
    });
  logScreenShare("Updated sender encoding", {
    trackName: `screen-video-${participantId}`,
    quality,
    maxBitrate: res?.bitrate,
    maxFramerate: fps,
  });
}

/** What the web asks the share module to capture: the picker's choice. */
export type WebScreenSource = ScreenShareSourceState &
  Pick<ScreenShareOptions, "pickerOpenedAt" | "pickerSelectionElapsedMs">;

export type WebScreenShareRequest = ScreenShareRequest<WebScreenSource>;

export interface WebScreenCapture extends ScreenCapture<MediaStreamTrack> {
  /**
   * What the local tile shows: the browser capture itself, or a native
   * share's CEF preview (null while hidden). The preview toggle replaces it.
   */
  stream: MediaStream | null;
  /** Whether the local preview starts hidden (native shares). */
  readonly previewHidden: boolean;
}

export type WebScreenShare = ScreenShare<
  MediaStreamTrack,
  WebScreenSource,
  WebScreenCapture
>;

/** Builds a share request from the picker's options. */
export function webScreenShareRequest(
  options: ScreenShareOptions | undefined,
  defaults: { quality: string; audio: boolean },
): WebScreenShareRequest {
  const source: WebScreenSource = {
    sourceId: options?.sourceId ?? null,
    captureId: options?.captureId ?? null,
    sourceName: options?.sourceName ?? null,
    sourceKind: options?.sourceKind ?? null,
    sourceAppName: options?.sourceAppName ?? null,
    sourceIcon: options?.sourceIcon ?? null,
    pickerOpenedAt: options?.pickerOpenedAt,
    pickerSelectionElapsedMs: options?.pickerSelectionElapsedMs,
  };
  return {
    source,
    sourceKey: options?.sourceId ?? null,
    quality: options?.quality || defaults.quality,
    audio: options?.withAudio ?? defaults.audio,
    preferNative: !options?.skipNative,
  };
}

/** The UI's view of a share's source (without picker timings). */
export function screenSourceState(
  source: WebScreenSource,
): ScreenShareSourceState {
  return {
    sourceId: source.sourceId ?? null,
    captureId: source.captureId ?? null,
    sourceName: source.sourceName ?? null,
    sourceKind: source.sourceKind ?? null,
    sourceAppName: source.sourceAppName ?? null,
    sourceIcon: source.sourceIcon ?? null,
  };
}

function stopStream(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => {
    track.onended = null;
    track.stop();
  });
}

/**
 * Sets the stream a capture's local tile shows. A native share's preview
 * ending by itself means the source closed: `onEnded` ends the share.
 */
export function attachScreenPreview(
  capture: WebScreenCapture,
  stream: MediaStream | null,
  onEnded: ((capture: WebScreenCapture) => void) | null,
): void {
  capture.stream = stream;
  const videoTrack = stream?.getVideoTracks()[0];
  if (videoTrack && onEnded) {
    videoTrack.onended = () => {
      if (capture.stream !== stream) return;
      onEnded(capture);
    };
  }
}

type ShareClient = Pick<
  SFUClient,
  | "publishNativeScreenShare"
  | "stopNativeScreenShare"
  | "updateNativeScreenQuality"
  | "updateSenderEncoding"
  | "isNativeScreenShareActive"
>;

export interface WebScreenShareSourcesOptions {
  readonly sfu: ShareClient;
  readonly participantId: () => string;
  readonly alwaysShowPreview: () => boolean;
  /** A capture's video (or a native share's preview) ended by itself. */
  readonly onCaptureEnded: (capture: WebScreenCapture) => void;
}

export function createWebScreenShareSources({
  sfu,
  participantId,
  alwaysShowPreview,
  onCaptureEnded,
}: WebScreenShareSourcesOptions): ScreenShareSources<
  WebScreenSource,
  WebScreenCapture
> {
  const isDesktopSource = (request: WebScreenShareRequest) =>
    isDesktop() && !!request.source.sourceId;

  return {
    native: {
      async eligible(request) {
        const { source } = request;
        if (!isDesktopSource(request)) return false;
        const capturePolicy = getCapturePolicy();
        logScreenShare("Discord-style capture summary", {
          sourceId: source.captureId ?? source.sourceId,
          sourceName: source.sourceName ?? null,
          type:
            source.sourceKind === "monitor"
              ? "screen"
              : (source.sourceKind ?? null),
          capturePolicy,
          mayAttemptVideoHook: source.sourceKind === "window",
          useGraphicsCapture: true,
          useCaptureDeviceForEncode: "native-wmf-hardware-first",
          requestedHardwareEncode: true,
          note:
            capturePolicy === "hook-exclusive"
              ? "Hook-exclusive policy forces the native hook for eligible windows; WGC/CEF fallback is disabled."
              : "Window shares may speculatively try the native hook first, but must fall back quickly to WGC/CEF if no frames arrive.",
        });
        const probe = await probeNativeHardwareEncoders();
        logScreenShare("Native hardware encoder probe", probe);
        return (
          source.sourceKind !== "device" && hasNativeH264HardwareEncoder(probe)
        );
      },
      async start(request) {
        const { source } = request;
        const startedAt = performance.now();
        const elapsed = () => Math.round(performance.now() - startedAt);
        logScreenShare("Calling native hardware screen publisher", {
          sourceId: source.sourceId,
          sourceKind: source.sourceKind,
          sourceName: source.sourceName ?? null,
          quality: request.quality,
          withAudio: request.audio,
        });
        await sfu.publishNativeScreenShare({
          sourceId: source.sourceId!,
          sourceName: source.sourceName ?? null,
          quality: request.quality,
          withAudio: request.audio,
        });
        if (!sfu.isNativeScreenShareActive) {
          return {
            path: "native",
            video: null,
            audio: null,
            stream: null,
            previewHidden: true,
          };
        }
        logScreenShare("Native hardware screen publisher connected", {
          elapsedMs: elapsed(),
          sourceId: source.sourceId,
          sourceKind: source.sourceKind,
          sourceName: source.sourceName ?? null,
        });

        // Native capture already runs a WGC session on the source; a second
        // CEF preview on it adds capture overhead, so the local preview
        // starts paused unless the user always shows it.
        const decision = resolvePreviewStartState(
          "native",
          alwaysShowPreview(),
        );
        let preview: MediaStream | null = null;
        if (decision.openCefPreview) {
          const { browserVideoConstraints, desktopMandatoryConstraints } =
            screenShareVideoConstraints(request.quality);
          try {
            preview = await getCustomPickerDesktopStream({
              sourceId: source.sourceId ?? undefined,
              captureId: source.captureId ?? undefined,
              sourceKind: source.sourceKind ?? undefined,
              withAudio: false,
              videoConstraints: browserVideoConstraints,
              desktopMandatoryConstraints,
            });
          } catch (error) {
            previewLog.warn(
              "Failed to open native share preview on start",
              error,
            );
          }
        }
        const capture: WebScreenCapture = {
          path: "native",
          video: null,
          audio: null,
          stream: null,
          previewHidden: decision.openCefPreview
            ? !preview
            : decision.isPreviewHidden,
        };
        attachScreenPreview(capture, preview, onCaptureEnded);
        return capture;
      },
      isActive: () => sfu.isNativeScreenShareActive,
      stop: () => sfu.stopNativeScreenShare(),
      async updateQuality(quality) {
        const applied = await sfu.updateNativeScreenQuality(quality);
        if (applied) {
          logScreenShare("Applied in-place native quality switch", { quality });
        }
        return applied;
      },
      fallbackAllowed: () => isWgcCaptureAllowed(),
    },
    browser: {
      async capture(request) {
        const { source, quality, audio } = request;
        const { browserVideoConstraints, desktopMandatoryConstraints } =
          screenShareVideoConstraints(quality);
        const startedAt = performance.now();
        const elapsed = () => Math.round(performance.now() - startedAt);
        const selectedDesktopSource = isDesktopSource(request);
        logScreenShare("Starting capture", {
          elapsedMs: 0,
          selectedDesktopSource,
          sourceId: source.sourceId ?? null,
          captureId: source.captureId ?? null,
          sourceKind: source.sourceKind ?? null,
          sourceName: source.sourceName ?? null,
          pickerSelectionElapsedMs: source.pickerSelectionElapsedMs ?? null,
          pickerToCaptureStartMs: source.pickerOpenedAt
            ? Math.round(startedAt - source.pickerOpenedAt)
            : null,
          quality,
          withAudio: audio,
          browserVideoConstraints,
          desktopMandatoryConstraints,
        });

        let stream: MediaStream | null = null;
        if (selectedDesktopSource) {
          stream = await getCustomPickerDesktopStream({
            sourceId: source.sourceId ?? undefined,
            captureId: source.captureId ?? undefined,
            sourceKind: source.sourceKind ?? undefined,
            withAudio: audio,
            videoConstraints: browserVideoConstraints,
            desktopMandatoryConstraints,
          });
          if (!stream) {
            throw new Error(
              `Selected desktop source could not be captured: ${source.sourceName || source.sourceId}`,
            );
          }
          logScreenShare("Captured selected desktop source", {
            elapsedMs: elapsed(),
            sourceId: source.sourceId,
            captureId: source.captureId,
            sourceKind: source.sourceKind,
            sourceName: source.sourceName,
            track: describeVideoTrack(stream.getVideoTracks()[0]),
            audioTracks: stream.getAudioTracks().map(describeAudioTrack),
          });
        } else {
          const audioConstraints = audio
            ? {
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false,
              }
            : false;
          const displayMediaOptions: any = {
            video: browserVideoConstraints,
            audio: audioConstraints as any,
            monitorTypeSurfaces: "include",
            selfBrowserSurface: "exclude",
            surfaceSwitching: "include",
            systemAudio: audio ? "include" : "exclude",
            windowAudio: audio ? "window" : "exclude",
          };
          try {
            logScreenShare("Calling getDisplayMedia", {
              elapsedMs: elapsed(),
              options: displayMediaOptions,
            });
            stream =
              await navigator.mediaDevices.getDisplayMedia(displayMediaOptions);
          } catch (err: any) {
            if (!audio || err?.name === "NotAllowedError") throw err;
            logScreenShare(
              "getDisplayMedia with audio failed; retrying video-only",
              { elapsedMs: elapsed(), error: err },
            );
            stream = await navigator.mediaDevices.getDisplayMedia({
              video: browserVideoConstraints as any,
              audio: false,
            });
          }
          logScreenShare("getDisplayMedia returned", {
            elapsedMs: elapsed(),
            videoTracks: stream.getVideoTracks().map(describeVideoTrack),
            audioTracks: stream.getAudioTracks().map(describeAudioTrack),
          });
        }

        const video = stream.getVideoTracks()[0];
        if (!video) {
          stopStream(stream);
          throw new Error("No screen share source was selected");
        }
        const audioTrack =
          stream
            .getAudioTracks()
            .find((track: MediaStreamTrack) => track.readyState === "live") ??
          null;
        const capture: WebScreenCapture = {
          path: "browser",
          video,
          audio: audioTrack,
          stream,
          previewHidden: false,
        };
        stream.getVideoTracks().forEach((track) => {
          track.contentHint =
            source.sourceKind === "window" ? "motion" : "detail";
          // The browser's "Stop sharing" (or the window closing) ends it.
          track.onended = () => onCaptureEnded(capture);
        });
        logScreenShare("Capture ready", {
          elapsedMs: elapsed(),
          videoTracks: stream.getVideoTracks().map(describeVideoTrack),
          videoContentHints: stream
            .getVideoTracks()
            .map((track) => track.contentHint),
          audioTracks: stream.getAudioTracks().map(describeAudioTrack),
          screenHasAudio: audioTrack !== null,
        });
        return capture;
      },
      applyQuality(capture, quality) {
        return applyScreenTrackQuality(
          capture.stream,
          quality,
          sfu,
          participantId() || null,
        );
      },
    },
    // A picked desktop source cannot be captured twice (WGC, the native
    // hook): the old capture goes first. A getDisplayMedia restart keeps
    // the old one until the picker returns, so cancelling keeps the share.
    releaseBeforeRestart: (request) => isDesktopSource(request),
    isLive: (capture) =>
      capture.path === "native"
        ? sfu.isNativeScreenShareActive
        : capture.video?.readyState === "live",
    release(capture) {
      stopStream(capture.stream);
      for (const track of [capture.video, capture.audio]) {
        if (!track) continue;
        track.onended = null;
        track.stop();
      }
      capture.stream = null;
    },
  };
}

/** One client's share module, publishing through that client's reconciler. */
export function createWebScreenShare(
  options: Omit<WebScreenShareSourcesOptions, "onCaptureEnded"> & {
    readonly publication: PublicationReconciler<MediaStreamTrack>;
  },
): WebScreenShare {
  let share: WebScreenShare | null = null;
  const sources = createWebScreenShareSources({
    ...options,
    onCaptureEnded: (capture) => share?.captureEnded(capture),
  });
  share = new ScreenShare({
    publication: options.publication,
    sources,
    onError: (step, error) => {
      if (step === "native-start") {
        logScreenShare(
          "Native hardware publisher failed; falling back to CEF capture",
          { error },
        );
      } else {
        screenLog.warn(`Screen share step failed: ${step}`, error);
      }
    },
  });
  return share;
}
