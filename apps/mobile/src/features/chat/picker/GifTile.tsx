import { Star } from "phosphor-react-native";
import { memo } from "react";
import { Pressable, View } from "react-native";

import { RADIUS, THEMES, useTheme } from "@/theme";
import { Icon, RemoteImage } from "@/ui";

import { LoopSurface } from "../media/GifvPlayer";
import { useLoopSlot } from "../media/playback";
import { gifKey, gifPreview, type Gif } from "./api";
import type { Frame } from "./masonry";
import { useIsFavorite } from "./library";

const FILL = {
  position: "absolute",
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
} as const;

/** A video preview: it holds a loop slot only while it may play. */
function VideoPreview({
  id,
  url,
  play,
}: {
  id: string;
  url: string;
  play: boolean;
}) {
  const playing = useLoopSlot(`picker-${id}`, play);
  return playing ? <LoopSurface url={url} /> : null;
}

/**
 * One GIF in the picker grid. It moves only while `play` (on screen, the
 * panel up, the app in front); otherwise it holds its first frame. A star
 * marks a favorite.
 */
export const GifTile = memo(function GifTile({
  gif,
  frame,
  play,
  onPress,
  onLongPress,
}: {
  gif: Gif;
  frame: Frame;
  play: boolean;
  onPress: (gif: Gif) => void;
  onLongPress: (gif: Gif) => void;
}) {
  const theme = useTheme();
  const favorite = useIsFavorite(gif);
  const preview = gifPreview(gif);
  const label = gif.altText || gif.title || "GIF";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}${favorite ? ", favorite" : ""}`}
      accessibilityHint="Sends it. Long press to star or unstar it."
      onPress={() => onPress(gif)}
      onLongPress={() => onLongPress(gif)}
      delayLongPress={350}
      style={({ pressed }) => ({
        position: "absolute",
        left: frame.x,
        top: frame.y,
        width: frame.width,
        height: frame.height,
        borderRadius: RADIUS,
        overflow: "hidden",
        backgroundColor: theme.tint1,
        opacity: pressed ? 0.72 : 1,
      })}
    >
      {preview.kind === "image" ? (
        <RemoteImage url={preview.url} style={FILL} animate={play} />
      ) : (
        <VideoPreview id={gifKey(gif)} url={preview.url} play={play} />
      )}
      {favorite ? (
        <View
          style={{
            position: "absolute",
            top: 6,
            right: 6,
            padding: 3,
            borderRadius: RADIUS,
            backgroundColor: "rgba(0, 0, 0, 0.56)",
          }}
        >
          <Icon icon={Star} active size={14} color={THEMES.dark.ink1} />
        </View>
      ) : null}
    </Pressable>
  );
});
