// The WebRTC side of voice, loaded on the first join (see ./actions).
import "./webrtc-runtime";

import { Platform } from "react-native";
import InCallManager from "react-native-incall-manager";

export { CallSession } from "./session";
export {
  captureCamera,
  captureScreen,
  isPermissionRefusal,
  stopStream,
} from "./local-media";

/**
 * The microphone with the platform's voice processing (echo cancellation,
 * noise suppression, gain control are on by default in WebRTC's Android
 * audio device).
 */
export function captureMicrophone(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({ audio: true, video: false });
}

export function releaseMicrophone(stream: MediaStream): void {
  for (const track of stream.getTracks()) track.stop();
  (stream as unknown as { release?: () => void }).release?.();
}

/**
 * Call audio mode, speaker-first ("video" is InCallManager's name for that).
 * iOS only: on Android the ralph-call module's Telecom call owns audio mode,
 * focus and routing, and a second owner would fight it over the route.
 */
export function startCallAudio(): void {
  if (Platform.OS === "ios") InCallManager.start({ media: "video" });
}

export function stopCallAudio(): void {
  if (Platform.OS === "ios") InCallManager.stop();
}
