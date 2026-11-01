import {
  Text as RNText,
  type TextProps as RNTextProps,
  type TextStyle,
} from "react-native";

import { FONT, useTheme, type Theme } from "@/theme";

export type TextVariant =
  | "display"
  | "title"
  | "name"
  | "control"
  | "body"
  | "row"
  | "silk"
  | "num";

type Tone = "ink1" | "ink2" | "ink3" | "inkOff" | "accent";

const VARIANTS: Record<TextVariant, TextStyle> = {
  display: {
    fontFamily: FONT.display,
    fontSize: 34,
    lineHeight: 36,
    letterSpacing: -1.2,
  },
  title: {
    fontFamily: FONT.name,
    fontSize: 20,
    lineHeight: 24,
    letterSpacing: -0.2,
  },
  name: { fontFamily: FONT.name, fontSize: 15, lineHeight: 20 },
  control: { fontFamily: FONT.control, fontSize: 15, lineHeight: 18 },
  body: { fontFamily: FONT.body, fontSize: 15, lineHeight: 22 },
  row: { fontFamily: FONT.row, fontSize: 14, lineHeight: 20 },
  // 11px is the floor for any text; silkscreen is always uppercase.
  silk: {
    fontFamily: FONT.silk,
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 0.9,
    textTransform: "uppercase",
  },
  num: {
    fontFamily: FONT.silk,
    fontSize: 12,
    lineHeight: 16,
    fontVariant: ["tabular-nums"],
  },
};

const TONES: Record<Tone, keyof Theme> = {
  ink1: "ink1",
  ink2: "ink2",
  ink3: "ink3",
  inkOff: "inkOff",
  accent: "accentInk",
};

interface TextProps extends RNTextProps {
  variant?: TextVariant;
  tone?: Tone;
}

export function Text({
  variant = "body",
  tone = "ink1",
  style,
  ...props
}: TextProps) {
  const theme = useTheme();
  return (
    <RNText
      {...props}
      style={[VARIANTS[variant], { color: theme[TONES[tone]] }, style]}
    />
  );
}
