import { useVideoPlayer, VideoView } from "expo-video";
import { useMemo, useState } from "react";
import { useReducedMotion } from "react-native-reanimated";

import { useAppActive } from "@/lib/app-active";
import { RemoteImage } from "@/ui";

import type { VideoMedia } from "./classify";
import { useMediaBox } from "./box";
import { MediaFrame, MediaTag } from "./frame";
import { useLoopSlot } from "./playback";
import { videoSource } from "./sources";

const FILL = {
  position: "absolute",
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
} as const;

/**
 * The silent player. It exists only while the loop holds a slot, so a row
 * that scrolls away, or a backgrounded app, releases its decoder.
 */
export function LoopSurface({ url }: { url: string }) {
  const source = useMemo(() => videoSource(url), [url]);
  const [shown, setShown] = useState(false);
  const player = useVideoPlayer(source, (p) => {
    p.muted = true;
    p.loop = true;
    // A muted GIF must never pause someone's music.
    p.audioMixingMode = "mixWithOthers";
    p.play();
  });
  return (
    <VideoView
      player={player}
      nativeControls={false}
      contentFit="cover"
      // A TextureView clips to the tile's corners and scrolls with the list.
      surfaceType="textureView"
      useExoShutter={false}
      onFirstFrameRender={() => setShown(true)}
      style={[FILL, { opacity: shown ? 1 : 0 }]}
    />
  );
}

/**
 * A GIF sent as video: plays silently on repeat while its row is on screen
 * and the app is in front, else holds its poster. Under reduced motion it
 * waits for a tap.
 */
export function GifvPlayer({
  media,
  id,
  visible,
  maxWidth,
}: {
  media: VideoMedia;
  /** Unique across the list: the message and the tile. */
  id: string;
  visible: boolean;
  maxWidth: number;
}) {
  const active = useAppActive();
  const reducedMotion = useReducedMotion();
  const [started, setStarted] = useState(false);
  const wanted = visible && active && (!reducedMotion || started);
  const playing = useLoopSlot(id, wanted);
  const { box, onSize } = useMediaBox(media.url, media, maxWidth);
  return (
    <MediaFrame
      box={box}
      label={`GIF: ${media.label}`}
      onPress={reducedMotion ? () => setStarted((on) => !on) : undefined}
    >
      {media.poster ? (
        <RemoteImage url={media.poster} style={FILL} onSize={onSize} />
      ) : null}
      {playing ? <LoopSurface url={media.url} /> : null}
      {playing ? null : <MediaTag>GIF</MediaTag>}
    </MediaFrame>
  );
}
