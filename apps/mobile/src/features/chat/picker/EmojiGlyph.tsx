import { Text } from "react-native";

import { useTheme } from "@/theme";

import { CustomEmoji } from "../markdown/CustomEmoji";
import { parseCustomToken } from "./emoji-data";

/**
 * One emoji value as drawn in pickers and reaction chips: a Unicode glyph
 * as text, or a server emoji (`<:name:id>`) as its image. Glyphs ignore the
 * system font scale so a grid of them keeps its shape.
 */
export function EmojiGlyph({
  value,
  size,
  animate = false,
}: {
  value: string;
  size: number;
  /** A server emoji that is animated plays; off in grids. */
  animate?: boolean;
}) {
  const theme = useTheme();
  const custom = parseCustomToken(value);
  if (custom) {
    return (
      <CustomEmoji
        name={custom.name}
        id={custom.id}
        size={Math.round(size * 1.1)}
        animate={animate}
        fallbackStyle={{
          fontSize: Math.round(size * 0.55),
          lineHeight: Math.round(size * 0.8),
          color: theme.ink1,
        }}
      />
    );
  }
  return (
    <Text
      allowFontScaling={false}
      style={{
        fontSize: size,
        lineHeight: Math.round(size * 1.3),
        color: theme.ink1,
        includeFontPadding: false,
      }}
    >
      {value}
    </Text>
  );
}
