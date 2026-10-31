// The WebRTC side of voice, loaded on the first join (see ./actions).
import "./webrtc-runtime";

import InCallManager from "react-native-incall-manager";

export { VoiceSession } from "./session";

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
 * Puts the phone in call audio mode with the loudspeaker as the default
 * route; InCallManager's automatic routing still moves to a wired headset or
 * Bluetooth when one is connected. ("video" is its name for speaker-first;
 * "audio" would start on the earpiece and blank the screen near the face.)
 * Picking a route by hand, Bluetooth, and the foreground service are the next
 * step; they build on this same manager.
 */
export function startCallAudio(): void {
  InCallManager.start({ media: "video" });
}

export function stopCallAudio(): void {
  InCallManager.stop();
}
