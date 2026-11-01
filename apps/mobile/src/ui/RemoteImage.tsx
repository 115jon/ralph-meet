import type * as ExpoImageModule from "expo-image";
import { useEffect, useMemo, useRef } from "react";
import {
  Image as RNImage,
  type ImageStyle,
  type StyleProp,
} from "react-native";

import { mediaSource } from "@/lib/api";
import { hasNativeModule } from "@/lib/native";

// expo-image (disk cache, animated GIF/WebP) when the build links it; a
// dev client built before it was added falls back to React Native's Image,
// which draws stills only.
const ExpoImage: typeof ExpoImageModule.Image | null = hasNativeModule(
  "ExpoImage",
)
  ? (require("expo-image") as typeof ExpoImageModule).Image
  : null;

interface RemoteImageProps {
  /** Absolute, or API-relative for the server's own media. */
  url: string;
  style?: StyleProp<ImageStyle>;
  contentFit?: "cover" | "contain";
  /**
   * Whether an animated image plays. Off by default so nothing loops at
   * rest; lists turn it on only while the image is on screen.
   */
  animate?: boolean;
  onSize?: (width: number, height: number) => void;
  /** The image could not be fetched or decoded. */
  onError?: () => void;
  accessibilityLabel?: string;
}

export function RemoteImage({
  url,
  style,
  contentFit = "cover",
  animate = false,
  onSize,
  onError,
  accessibilityLabel,
}: RemoteImageProps) {
  const ref = useRef<ExpoImageModule.Image>(null);
  // A stable source, so a re-render never restarts the load.
  const source = useMemo(() => mediaSource(url), [url]);

  useEffect(() => {
    const image = ref.current;
    if (!image) return;
    // A recycled or unmounted row's native view can be gone by now; nothing
    // to animate then, so the rejection is expected.
    (animate ? image.startAnimating() : image.stopAnimating()).catch(() => {});
  }, [animate]);

  if (ExpoImage) {
    return (
      <ExpoImage
        ref={ref}
        source={source}
        style={style}
        contentFit={contentFit}
        autoplay={animate}
        cachePolicy="disk"
        recyclingKey={url}
        transition={0}
        accessibilityLabel={accessibilityLabel}
        accessibilityIgnoresInvertColors
        onLoad={(event) => onSize?.(event.source.width, event.source.height)}
        onError={onError}
      />
    );
  }
  return (
    <RNImage
      source={source}
      style={style}
      resizeMode={contentFit}
      accessibilityLabel={accessibilityLabel}
      accessibilityIgnoresInvertColors
      onError={onError}
      onLoad={(event) =>
        onSize?.(
          event.nativeEvent.source.width,
          event.nativeEvent.source.height,
        )
      }
    />
  );
}
