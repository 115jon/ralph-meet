import { useState } from "react";
import { Text, type TextStyle } from "react-native";

import { RemoteImage } from "@/ui";

// Ids whose asset 404d this session. A remounted row (scrolled back, or
// recycled) shows the fallback at once; the image cache may not report the
// failure a second time.
const missing = new Set<string>();

interface CustomEmojiProps {
  name: string;
  id: string;
  size: number;
  /** Drawn but invisible, inside an unrevealed spoiler. */
  hidden?: boolean;
  /** An animated one plays (the default); a picker grid holds it still. */
  animate?: boolean;
  /** For the `:name:` fallback when the image cannot be fetched. */
  fallbackStyle?: TextStyle;
}

/**
 * A server emoji from `/api/emojis/assets/:id`; animated ones play. Until
 * it loads, or if it never does, the web's fallback: `:name:` as text.
 */
export function CustomEmoji({
  name,
  id,
  size,
  hidden = false,
  animate = true,
  fallbackStyle,
}: CustomEmojiProps) {
  const [failed, setFailed] = useState(() => missing.has(id));
  if (failed) return <Text style={fallbackStyle}>{`:${name}:`}</Text>;
  return (
    <RemoteImage
      url={`/api/emojis/assets/${encodeURIComponent(id)}`}
      style={{ width: size, height: size, opacity: hidden ? 0 : 1 }}
      contentFit="contain"
      animate={animate && !hidden}
      accessibilityLabel={`:${name}:`}
      onError={() => {
        missing.add(id);
        setFailed(true);
      }}
    />
  );
}
