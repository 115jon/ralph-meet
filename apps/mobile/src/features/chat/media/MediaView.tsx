import { hasNativeModule } from "@/lib/native";

import { useIsMessageVisible } from "../visibility";
import type { Media } from "./classify";
import type * as EmbedVideoModule from "./EmbedVideo";
import type * as GifvPlayerModule from "./GifvPlayer";
import { ImageTile } from "./ImageTile";

// expo-video when the build links it; a dev client built before it was
// added shows every GIF and video as its poster.
const players = hasNativeModule("ExpoVideo")
  ? {
      ...(require("./EmbedVideo") as typeof EmbedVideoModule),
      ...(require("./GifvPlayer") as typeof GifvPlayerModule),
    }
  : null;

/** One picture, GIF or video, sized to `maxWidth`; plays only while visible. */
export function MediaView({
  media,
  messageId,
  maxWidth,
}: {
  media: Media;
  messageId: string;
  maxWidth: number;
}) {
  const visible = useIsMessageVisible(messageId);
  // Attachment ids and embed keys ("<message>-embed-<n>") are unique.
  const id = media.key;
  if (media.kind === "image") {
    return <ImageTile image={media} visible={visible} maxWidth={maxWidth} />;
  }
  if (!players) {
    return media.poster ? (
      <ImageTile
        image={{ ...media, kind: "image", url: media.poster, animated: false }}
        visible={visible}
        maxWidth={maxWidth}
      />
    ) : null;
  }
  return media.kind === "loop" ? (
    <players.GifvPlayer
      media={media}
      id={id}
      visible={visible}
      maxWidth={maxWidth}
    />
  ) : (
    <players.EmbedVideo
      media={media}
      id={id}
      visible={visible}
      maxWidth={maxWidth}
    />
  );
}
