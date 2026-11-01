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

/**
 * Chrome (titles, silkscreen labels, numbers) stops growing at 1.3x system
 * font scale so it cannot wrap or clip its 48px rows; prose and names keep
 * scaling for whoever needs them larger.
 */
const CHROME_MAX_SCALE = 1.3;
const MAX_SCALE: Partial<Record<TextVariant, number>> = {
  display: CHROME_MAX_SCALE,
  title: CHROME_MAX_SCALE,
  silk: CHROME_MAX_SCALE,
  num: CHROME_MAX_SCALE,
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
      maxFontSizeMultiplier={MAX_SCALE[variant]}
      {...props}
      style={[VARIANTS[variant], { color: theme[TONES[tone]] }, style]}
    />
  );
}
