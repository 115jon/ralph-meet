import type { CreateVideoKeepalive, VideoKeepalive } from "@ralph/voice-media";
import { NativeModules, Platform } from "react-native";
import { MediaStream as NativeMediaStream } from "react-native-webrtc";

// What a camera or screen share sends while it is off, so its SFU track
// stays alive and viewers keep their pulls (see @ralph/voice-media's
// VideoKeepalive; the web paints a canvas instead).
//
// On Android it is a native source that sends one 160x96 black frame per
// second and opens no camera: KeepaliveCaptureController, added to
// react-native-webrtc by patches/react-native-webrtc@155.0.1.patch and
// reached through getUserMedia with its device id. The native call is made
// directly, not through mediaDevices.getUserMedia, which would ask for the
// camera permission first (a screen share needs none).
//
// The media manager asks for a keepalive synchronously when a video
// publication is withdrawn, and opening one is asynchronous, so the pool
// keeps one opened and paused per video slot (a disabled react-native-webrtc
// video track stops its capturer: no frames, no CPU) and opens the next one
// when one is taken. With none ready (iOS, which has no such source, or a
// withdraw right after the last one was taken), the publication is closed
// as before: viewers pull its next SFU track again.

/** Native KeepaliveCaptureController.DEVICE_ID. */
const KEEPALIVE_DEVICE_ID = "yap:video-keepalive";

interface NativeTrackInfo {
  readonly id: string;
  readonly kind: string;
}

interface WebRtcModule {
  getUserMedia(
    constraints: { video: { deviceId: string } },
    success: (streamId: string, tracks: NativeTrackInfo[]) => void,
    failure: (type: string, message: string) => void,
  ): void;
}

function openKeepalive(): Promise<NativeMediaStream> {
  const module = (NativeModules as { WebRTCModule?: WebRtcModule })
    .WebRTCModule;
  if (!module) return Promise.reject(new Error("WebRTCModule is missing"));
  return new Promise((resolve, reject) => {
    module.getUserMedia(
      { video: { deviceId: KEEPALIVE_DEVICE_ID } },
      (streamId, tracks) =>
        resolve(
          new NativeMediaStream({
            streamId,
            streamReactTag: streamId,
            tracks: tracks as never,
          }),
        ),
      (type, message) => reject(new Error(`${type}: ${message}`)),
    );
  });
}

function release(stream: NativeMediaStream): void {
  for (const track of stream.getTracks()) track.stop();
  stream.release();
}

export class VideoKeepalivePool {
  private readonly ready: NativeMediaStream[] = [];
  private opening = 0;
  private disposed = false;

  /** `size`: keepalives kept ready, one per video slot that may withdraw. */
  constructor(
    private readonly size: number,
    private readonly onError: (error: unknown) => void = () => {},
  ) {}

  /** Whether this platform has the native source. */
  static get supported(): boolean {
    return Platform.OS === "android";
  }

  /** Opens keepalives until `size` are ready or opening. */
  fill(): void {
    if (!VideoKeepalivePool.supported) return;
    while (!this.disposed && this.ready.length + this.opening < this.size) {
      this.opening += 1;
      openKeepalive().then(
        (stream) => {
          this.opening -= 1;
          const track = stream.getVideoTracks()[0];
          if (this.disposed || !track) {
            release(stream);
            return;
          }
          // Paused until taken: the native capturer stops.
          track.enabled = false;
          this.ready.push(stream);
        },
        (error: unknown) => {
          this.opening -= 1;
          this.onError(error);
        },
      );
    }
  }

  /** The media manager's createVideoKeepalive. */
  readonly create: CreateVideoKeepalive = () => {
    if (this.disposed) return null;
    const stream = this.ready.shift();
    const track = stream?.getVideoTracks()[0];
    if (!stream || !track) return null;
    track.enabled = true;
    this.fill();
    let stopped = false;
    const keepalive: VideoKeepalive = {
      // react-native-webrtc's track is what the DOM types call MediaStreamTrack.
      track: track as unknown as MediaStreamTrack,
      // A native Handler paints the frames; it is not throttled the way a
      // background browser timer is, so it does not stall.
      longestGapMs: () => 0,
      stop: () => {
        if (stopped) return;
        stopped = true;
        release(stream);
      },
    };
    return keepalive;
  };

  dispose(): void {
    this.disposed = true;
    for (const stream of this.ready.splice(0)) release(stream);
  }
}
