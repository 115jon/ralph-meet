import { openBrowserAsync } from "expo-web-browser";
import { useVideoPlayer, VideoView } from "expo-video";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useAppActive } from "@/lib/app-active";
import { RemoteImage } from "@/ui";

import type { LinkOutMedia, VideoMedia } from "./classify";
import { formatDuration, useMediaBox } from "./box";
import { MediaFrame, MediaTag, PlayKey } from "./frame";
import { playVideo, stopVideo, useIsPlayingVideo } from "./playback";
import { videoSource } from "./sources";

const FILL = {
  position: "absolute",
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
} as const;

/** The started video, with sound and the system's controls and fullscreen. */
function InlineVideo({ url, onError }: { url: string; onError: () => void }) {
  const active = useAppActive();
  const source = useMemo(() => videoSource(url), [url]);
  const player = useVideoPlayer(source, (p) => p.play());
  useEffect(() => {
    if (!active) player.pause();
  }, [active, player]);
  useEffect(() => {
    const subscription = player.addListener("statusChange", ({ status }) => {
      if (status === "error") onError();
    });
    return () => subscription.remove();
  }, [player, onError]);
  return (
    <VideoView
      player={player}
      nativeControls
      contentFit="contain"
      fullscreenOptions={{ enable: true }}
      surfaceType="textureView"
      style={FILL}
    />
  );
}

/**
 * A video: its poster and a play key until tapped, then it plays in place.
 * One plays at a time; scrolling it away puts the poster back. A video
 * only its site can play, or one that fails (a deleted or expired post),
 * opens the post instead.
 */
export function EmbedVideo({
  media,
  id,
  visible,
  maxWidth,
}: {
  media: VideoMedia | LinkOutMedia;
  /** Unique across the list: the message and the tile. */
  id: string;
  visible: boolean;
  maxWidth: number;
}) {
  const playing = useIsPlayingVideo(id);
  const { box, onSize } = useMediaBox(media.url, media, maxWidth);
  const [failed, setFailed] = useState(false);
  const onError = useCallback(() => {
    setFailed(true);
    stopVideo(id);
  }, [id]);

  useEffect(() => {
    if (playing && !visible) stopVideo(id);
  }, [id, playing, visible]);
  useEffect(() => () => stopVideo(id), [id]);

  const link =
    media.kind === "link" ? media.url : failed ? media.post : undefined;
  const duration =
    media.kind === "video" && media.durationSeconds
      ? formatDuration(media.durationSeconds)
      : null;
  return (
    <MediaFrame
      box={box}
      label={`${link ? "Open" : "Play"} video: ${media.label}`}
      // While playing, touches belong to the player's own controls.
      onPress={
        playing
          ? undefined
          : link
            ? () => void openBrowserAsync(link).catch(() => undefined)
            : () => playVideo(id)
      }
    >
      {media.poster ? (
        <RemoteImage url={media.poster} style={FILL} onSize={onSize} />
      ) : null}
      {playing ? (
        <InlineVideo url={media.url} onError={onError} />
      ) : (
        <>
          <PlayKey />
          {duration ? <MediaTag>{duration}</MediaTag> : null}
        </>
      )}
    </MediaFrame>
  );
}
