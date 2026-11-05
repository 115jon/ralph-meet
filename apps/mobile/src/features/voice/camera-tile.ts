import {
  CAMERA_CONNECT_GRACE_MS,
  cameraTileVideo,
  type CameraTileVideo,
  type VideoFlow,
} from "@ralph/voice-media/video-flow";
import { useEffect, useMemo, useState } from "react";

// What a remote camera tile shows (the web's useCameraTileVideo): its video,
// the avatar while the video is on its way, or the avatar with "Video
// unavailable" once it never came or stopped decoding after one fresh
// re-pull (@ralph/voice-media RemoteVideoHealth). Imports no React Native,
// so the rule is tested in Node.

/**
 * `remote` is a remote camera announced on (null for our own tile, a screen
 * or a camera off: those show as before), `hasStream` whether the store
 * holds its pulled video, `graceExpired` whether it has gone without video
 * past CAMERA_CONNECT_GRACE_MS.
 */
export function cameraTileView(
  remote: { readonly flow: VideoFlow | undefined } | null,
  hasStream: boolean,
  graceExpired: boolean,
): CameraTileVideo {
  if (!remote) return "video";
  const now = cameraTileVideo({
    hasTrack: hasStream,
    flow: remote.flow,
    waitingForMs: 0,
  });
  return now === "connecting" && graceExpired ? "unavailable" : now;
}

/** cameraTileView, with the grace timed from when the wait began. */
export function useCameraTileView(
  remote: { readonly flow: VideoFlow | undefined } | null,
  hasStream: boolean,
): CameraTileVideo {
  const connecting = cameraTileView(remote, hasStream, false) === "connecting";
  // A fresh object per wait, so a wait that ends and begins again gets its
  // full grace.
  const wait = useMemo(() => (connecting ? {} : null), [connecting]);
  const [expiredWait, setExpiredWait] = useState<object | null>(null);
  useEffect(() => {
    if (!wait) return;
    const timer = setTimeout(
      () => setExpiredWait(wait),
      CAMERA_CONNECT_GRACE_MS,
    );
    return () => clearTimeout(timer);
  }, [wait]);
  return cameraTileView(remote, hasStream, !!wait && expiredWait === wait);
}
