import {
  CAMERA_CONNECT_GRACE_MS,
  cameraTileVideo,
  type CameraTileVideo,
  type VideoFlow,
} from "@ralph/voice-media/video-flow";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";

/** The part of SFUClient a camera tile reads (absent in fixtures). */
export interface RemoteVideoFlowSource {
  getRemoteVideoFlow(track: MediaStreamTrack): VideoFlow | undefined;
  subscribeRemoteVideoFlow(listener: () => void): () => void;
}

function isFlowSource(value: unknown): value is RemoteVideoFlowSource {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as RemoteVideoFlowSource).getRemoteVideoFlow === "function" &&
    typeof (value as RemoteVideoFlowSource).subscribeRemoteVideoFlow ===
      "function"
  );
}

const noSubscription = () => () => {};

function liveVideoTrack(stream: MediaStream | null | undefined) {
  return (
    stream?.getVideoTracks?.().find((track) => track.readyState === "live") ??
    null
  );
}

/**
 * What a remote camera tile shows: its video, the loading state, or the
 * avatar with "Video unavailable" (see @ralph/voice-media cameraTileVideo).
 *
 * `enabled` is a remote camera announced on; anything else is "video", as
 * before. The tile keeps its video element mounted whenever the stream has
 * a track, whatever this says: the media manager only measures video on
 * screen, and showing it again is instant once frames come back.
 */
export function useCameraTileVideo({
  sfu,
  stream,
  enabled,
}: {
  sfu: unknown;
  stream: MediaStream | null | undefined;
  enabled: boolean;
}): CameraTileVideo {
  const source = enabled && isFlowSource(sfu) ? sfu : null;
  const track = enabled ? liveVideoTrack(stream) : null;
  const subscribe = useCallback(
    (listener: () => void) =>
      source ? source.subscribeRemoteVideoFlow(listener) : noSubscription(),
    [source],
  );
  const read = () =>
    source && track ? source.getRemoteVideoFlow(track) : undefined;
  // read for the server snapshot too: fixtures render tiles to a string.
  const flow = useSyncExternalStore(subscribe, read, read);
  const now = cameraTileVideo({ hasTrack: !!track, flow, waitingForMs: 0 });
  const connecting = enabled && now === "connecting";

  // One wait per stretch without video: a fresh object each time it begins,
  // so a wait that ends and begins again gets its full grace.
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

  if (!enabled) return "video";
  if (wait && expiredWait === wait) return "unavailable";
  return now;
}
