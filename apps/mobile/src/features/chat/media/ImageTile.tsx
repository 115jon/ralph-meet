import { useState } from "react";

import { openImage } from "@/features/media/viewer-store";
import { useAppActive } from "@/lib/app-active";
import { RemoteImage } from "@/ui";

import type { ImageMedia } from "./classify";
import { useMediaBox } from "./box";
import { MediaFrame } from "./frame";

// URLs that failed, so a dead preview never draws an empty frame again.
const failedUrls = new Set<string>();

/** A picture; tap opens the viewer. Animated ones play while on screen. */
export function ImageTile({
  image,
  visible,
  maxWidth,
}: {
  image: ImageMedia;
  visible: boolean;
  maxWidth: number;
}) {
  const active = useAppActive();
  const { box, onSize } = useMediaBox(image.url, image, maxWidth);
  const [failed, setFailed] = useState(() => failedUrls.has(image.url));
  if (failed) return null;
  return (
    <MediaFrame
      box={box}
      label={`Open image: ${image.label}`}
      onPress={() =>
        openImage({
          url: image.url,
          label: image.label,
          animated: image.animated,
        })
      }
    >
      <RemoteImage
        url={image.url}
        style={{ width: "100%", height: "100%" }}
        animate={image.animated && visible && active}
        onError={() => {
          failedUrls.add(image.url);
          setFailed(true);
        }}
        onSize={onSize}
      />
    </MediaFrame>
  );
}
