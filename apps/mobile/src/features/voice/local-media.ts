import { Dimensions, PixelRatio } from "react-native";
import {
  mediaDevices,
  type MediaStream as NativeMediaStream,
} from "react-native-webrtc";

// Our camera and screen captures. react-native-webrtc's registerGlobals()
// makes its MediaStream the global one, so the streams below are the same
// objects PartyTracks and the media manager see as DOM MediaStreams; the
// casts here are the only place the two typings meet.

export type CameraFacing = "front" | "back";

/** The web's 720p30 camera profile (src/lib/camera-quality.ts). */
const CAMERA_WIDTH = 1280;
const CAMERA_HEIGHT = 720;
const CAMERA_FPS = 30;

/**
 * Screen frames are captured at the display's size times this scale. A phone
 * is ~2400 px tall; 1280 keeps text readable at a bitrate a phone can send.
 */
const SCREEN_LONG_EDGE = 1280;

function asDomStream(stream: NativeMediaStream): MediaStream {
  return stream as unknown as MediaStream;
}

function asNativeStream(stream: MediaStream): NativeMediaStream {
  return stream as unknown as NativeMediaStream;
}

/** The camera, video only, at 720p30 at most. */
export async function captureCamera(
  facing: CameraFacing,
): Promise<MediaStream> {
  const stream = await mediaDevices.getUserMedia({
    audio: false,
    video: {
      facingMode: facing === "front" ? "user" : "environment",
      width: CAMERA_WIDTH,
      height: CAMERA_HEIGHT,
      frameRate: CAMERA_FPS,
    },
  });
  return asDomStream(stream);
}

/**
 * The whole screen through MediaProjection: Android shows its consent dialog
 * first and the promise rejects (NotAllowedError) when the user declines.
 * The call service must be ready for the capture (prepareScreenCapture).
 */
export async function captureScreen(): Promise<MediaStream> {
  const { width, height } = Dimensions.get("screen");
  const longEdge = Math.max(width, height) * PixelRatio.get();
  const resolutionScale = Math.min(1, SCREEN_LONG_EDGE / longEdge);
  const stream = await mediaDevices.getDisplayMedia({
    android: { resolutionScale },
  });
  return asDomStream(stream);
}

/** The stream's URL for RTCView. */
export function streamUrl(stream: MediaStream): string {
  return asNativeStream(stream).toURL();
}

/**
 * The camera the stream actually got. getUserMedia falls back to any camera
 * when the asked-for facing is missing (an emulator, some tablets), so the
 * request is not the answer.
 */
export function facingOf(stream: MediaStream): CameraFacing {
  const facing = stream.getVideoTracks()[0]?.getSettings().facingMode;
  return facing === "environment" ? "back" : "front";
}

/**
 * Swaps between the front and back camera on the same track (what the
 * deprecated _switchCamera() does, but awaited, so a phone with one camera
 * rejects here instead of as an unhandled promise). Resolves with the facing
 * now in use.
 */
export async function switchCamera(stream: MediaStream): Promise<CameraFacing> {
  const track = stream.getVideoTracks()[0];
  if (!track) throw new Error("No camera track");
  await track.applyConstraints({
    facingMode: facingOf(stream) === "front" ? "environment" : "user",
    width: CAMERA_WIDTH,
    height: CAMERA_HEIGHT,
    frameRate: CAMERA_FPS,
  });
  return facingOf(stream);
}

/** Stops every track and frees the native stream. */
export function stopStream(stream: MediaStream): void {
  for (const track of stream.getTracks()) track.stop();
  // react-native-webrtc frees the native stream only on release().
  asNativeStream(stream).release();
}

/**
 * True for a declined capture dialog. Android rejects with code DOMException
 * and message NotAllowedError, which MediaStreamError keeps as `message`.
 */
export function isPermissionRefusal(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const { name, message } = error as { name?: unknown; message?: unknown };
  return name === "NotAllowedError" || message === "NotAllowedError";
}
