import type { CSSProperties } from "react";

export const PROFILE_COLOR_SWATCHES = [
  "#FFFFFF",
  "#F4E6D4",
  "#FFD0BF",
  "#FCA5A5",
  "#F472B6",
  "#C084FC",
  "#60A5FA",
  "#34D399",
] as const;

export const DISPLAY_NAME_COLOR_SWATCHES = [
  "#F8FAFC",
  "#FDE68A",
  "#FB7185",
  "#F472B6",
  "#C084FC",
  "#38BDF8",
  "#4ADE80",
  "#F97316",
] as const;

export type DisplayNameFontId =
  | "gg-sans"
  | "tempo"
  | "sakura"
  | "jellybean"
  | "modern"
  | "medieval"
  | "eight-bit"
  | "vampyre";

export type DisplayNameEffectId = "solid" | "gradient" | "neon" | "toon" | "pop";

export interface DisplayNameStyle {
  font: DisplayNameFontId;
  effect: DisplayNameEffectId;
  primaryColor: string;
  secondaryColor: string;
}

export interface HsvColor {
  h: number;
  s: number;
  v: number;
}

export interface ProfileCustomizationInput {
  profile_accent_color?: string | null;
  profile_background_color?: string | null;
  profile_banner_color?: string | null;
}

export const DEFAULT_DISPLAY_NAME_STYLE: DisplayNameStyle = {
  font: "gg-sans",
  effect: "solid",
  primaryColor: "#F8FAFC",
  secondaryColor: "#FB7185",
};

const DISPLAY_NAME_FONT_SET = new Set<DisplayNameFontId>([
  "gg-sans",
  "tempo",
  "sakura",
  "jellybean",
  "modern",
  "medieval",
  "eight-bit",
  "vampyre",
]);

const DISPLAY_NAME_EFFECT_SET = new Set<DisplayNameEffectId>([
  "solid",
  "gradient",
  "neon",
  "toon",
  "pop",
]);

const HEX_COLOR_RE = /^#?(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function normalizeHexColor(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!HEX_COLOR_RE.test(trimmed)) return null;
  const hex = trimmed.startsWith("#") ? trimmed.slice(1) : trimmed;
  const expanded = hex.length === 3
    ? hex.split("").map(char => `${char}${char}`).join("")
    : hex;
  return `#${expanded.toUpperCase()}`;
}

function hexToRgb(hex: string) {
  const normalized = normalizeHexColor(hex);
  if (!normalized) {
    return { r: 0, g: 0, b: 0 };
  }

  const value = normalized.slice(1);
  return {
    r: Number.parseInt(value.slice(0, 2), 16),
    g: Number.parseInt(value.slice(2, 4), 16),
    b: Number.parseInt(value.slice(4, 6), 16),
  };
}

function rgbToHex(r: number, g: number, b: number) {
  return `#${[r, g, b]
    .map(channel => clamp(Math.round(channel), 0, 255).toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase()}`;
}

export function hexToHsv(hex: string): HsvColor {
  const { r, g, b } = hexToRgb(hex);
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;

  let hue = 0;
  if (delta !== 0) {
    if (max === red) {
      hue = 60 * (((green - blue) / delta) % 6);
    } else if (max === green) {
      hue = 60 * (((blue - red) / delta) + 2);
    } else {
      hue = 60 * (((red - green) / delta) + 4);
    }
  }

  if (hue < 0) {
    hue += 360;
  }

  return {
    h: hue,
    s: max === 0 ? 0 : delta / max,
    v: max,
  };
}

export function hsvToHex(hue: number, saturation: number, value: number) {
  const normalizedHue = ((hue % 360) + 360) % 360;
  const normalizedSaturation = clamp(saturation, 0, 1);
  const normalizedValue = clamp(value, 0, 1);
  const chroma = normalizedValue * normalizedSaturation;
  const intermediate = chroma * (1 - Math.abs(((normalizedHue / 60) % 2) - 1));
  const match = normalizedValue - chroma;

  let red = 0;
  let green = 0;
  let blue = 0;

  if (normalizedHue < 60) {
    red = chroma;
    green = intermediate;
  } else if (normalizedHue < 120) {
    red = intermediate;
    green = chroma;
  } else if (normalizedHue < 180) {
    green = chroma;
    blue = intermediate;
  } else if (normalizedHue < 240) {
    green = intermediate;
    blue = chroma;
  } else if (normalizedHue < 300) {
    red = intermediate;
    blue = chroma;
  } else {
    red = chroma;
    blue = intermediate;
  }

  return rgbToHex(
    (red + match) * 255,
    (green + match) * 255,
    (blue + match) * 255,
  );
}

export function withAlpha(hex: string, alpha: number) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${clamp(alpha, 0, 1)})`;
}

export function mixHexColors(baseHex: string, targetHex: string, targetWeight: number) {
  const weight = clamp(targetWeight, 0, 1);
  const base = hexToRgb(baseHex);
  const target = hexToRgb(targetHex);
  return rgbToHex(
    base.r + (target.r - base.r) * weight,
    base.g + (target.g - base.g) * weight,
    base.b + (target.b - base.b) * weight,
  );
}

function getRelativeLuminance(hex: string) {
  const { r, g, b } = hexToRgb(hex);
  const channels = [r, g, b].map((value) => {
    const normalized = value / 255;
    return normalized <= 0.03928
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  });

  return (0.2126 * channels[0]) + (0.7152 * channels[1]) + (0.0722 * channels[2]);
}

export function getContrastTextColor(hex: string) {
  return getRelativeLuminance(hex) > 0.47 ? "#12131A" : "#F8FAFC";
}

export function normalizeDisplayNameStyle(value: unknown): DisplayNameStyle | null {
  if (value == null) return null;

  let parsed: unknown = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      return null;
    }
  }

  if (!parsed || typeof parsed !== "object") return null;

  const raw = parsed as Record<string, unknown>;
  const font = raw.font;
  const effect = raw.effect;
  const primaryColor = normalizeHexColor(raw.primaryColor);
  const secondaryColor = normalizeHexColor(raw.secondaryColor);

  if (
    typeof font !== "string" ||
    typeof effect !== "string" ||
    !DISPLAY_NAME_FONT_SET.has(font as DisplayNameFontId) ||
    !DISPLAY_NAME_EFFECT_SET.has(effect as DisplayNameEffectId) ||
    !primaryColor ||
    !secondaryColor
  ) {
    return null;
  }

  return {
    font: font as DisplayNameFontId,
    effect: effect as DisplayNameEffectId,
    primaryColor,
    secondaryColor,
  };
}

export function serializeDisplayNameStyle(style: DisplayNameStyle | null | undefined) {
  const normalized = normalizeDisplayNameStyle(style);
  return normalized ? JSON.stringify(normalized) : null;
}

export const DISPLAY_NAME_FONT_OPTIONS: Array<{
  id: DisplayNameFontId;
  label: string;
  sample: string;
  style: CSSProperties;
}> = [
  {
    id: "gg-sans",
    label: "gg sans",
    sample: "Jon",
    style: {
      fontFamily: "var(--font-sans), Inter, system-ui, sans-serif",
      fontWeight: 700,
      letterSpacing: "-0.04em",
    },
  },
  {
    id: "tempo",
    label: "Tempo",
    sample: "Hype",
    style: {
      fontFamily: "\"Bungee\", \"Trebuchet MS\", var(--font-sans), sans-serif",
      fontWeight: 600,
      letterSpacing: "0.02em",
      textTransform: "uppercase",
    },
  },
  {
    id: "sakura",
    label: "Sakura",
    sample: "Bloom",
    style: {
      fontFamily: "\"Permanent Marker\", \"Segoe Print\", cursive",
      fontWeight: 400,
      letterSpacing: "0.01em",
      transform: "rotate(-2deg)",
    },
  },
  {
    id: "jellybean",
    label: "Jellybean",
    sample: "Soft",
    style: {
      fontFamily: "\"Fredoka\", \"Arial Rounded MT Bold\", var(--font-sans), sans-serif",
      fontWeight: 700,
      letterSpacing: "-0.04em",
    },
  },
  {
    id: "modern",
    label: "Modern",
    sample: "Muse",
    style: {
      fontFamily: "\"Cormorant Garamond\", Georgia, serif",
      fontWeight: 700,
      fontStyle: "italic",
      letterSpacing: "-0.025em",
    },
  },
  {
    id: "medieval",
    label: "Medieval",
    sample: "Crest",
    style: {
      fontFamily: "\"Cinzel\", \"Goudy Text MT\", Georgia, serif",
      fontWeight: 700,
      letterSpacing: "0.045em",
      textTransform: "uppercase",
    },
  },
  {
    id: "eight-bit",
    label: "8 Bit",
    sample: "PLAY",
    style: {
      fontFamily: "\"Press Start 2P\", \"Courier New\", monospace",
      fontWeight: 400,
      letterSpacing: "0.02em",
      lineHeight: 1,
      textTransform: "uppercase",
    },
  },
  {
    id: "vampyre",
    label: "Vampyre",
    sample: "Noct",
    style: {
      fontFamily: "\"UnifrakturMaguntia\", \"Old English Text MT\", Georgia, serif",
      fontWeight: 400,
      letterSpacing: "0.02em",
    },
  },
];

export const DISPLAY_NAME_EFFECT_OPTIONS: Array<{
  id: DisplayNameEffectId;
  label: string;
}> = [
  { id: "solid", label: "Solid" },
  { id: "gradient", label: "Gradient" },
  { id: "neon", label: "Neon" },
  { id: "toon", label: "Toon" },
  { id: "pop", label: "Pop" },
];

export function getDisplayNameFontStyle(font: DisplayNameFontId): CSSProperties {
  return DISPLAY_NAME_FONT_OPTIONS.find(option => option.id === font)?.style ?? DISPLAY_NAME_FONT_OPTIONS[0].style;
}

export function getDisplayNameEffectStyle(style: DisplayNameStyle): CSSProperties {
  const primaryColor = normalizeHexColor(style.primaryColor) ?? DEFAULT_DISPLAY_NAME_STYLE.primaryColor;
  const secondaryColor = normalizeHexColor(style.secondaryColor) ?? DEFAULT_DISPLAY_NAME_STYLE.secondaryColor;
  const darkOutline = withAlpha("#111827", 0.38);
  const subtleOutline = withAlpha("#FFFFFF", 0.18);
  const brightPrimary = mixHexColors(primaryColor, "#FFFFFF", 0.18);
  const brightSecondary = mixHexColors(secondaryColor, "#FFFFFF", 0.14);
  const frostedSecondary = mixHexColors(secondaryColor, "#FFFFFF", 0.34);

  switch (style.effect) {
    case "gradient":
      return {
        color: "transparent",
        backgroundImage: `linear-gradient(135deg, ${brightPrimary} 0%, ${primaryColor} 28%, ${mixHexColors(primaryColor, secondaryColor, 0.46)} 58%, ${brightSecondary} 100%)`,
        backgroundSize: "180% 180%",
        WebkitBackgroundClip: "text",
        backgroundClip: "text",
        WebkitTextFillColor: "transparent",
        textShadow: `0 1px 0 ${withAlpha("#FFFFFF", 0.06)}`,
        filter: `drop-shadow(0 1px 1px ${withAlpha("#000000", 0.12)})`,
        animation: "rm-display-name-gradient 7.5s ease-in-out infinite",
        willChange: "background-position",
      };
    case "neon":
      return {
        color: mixHexColors(primaryColor, "#FFFFFF", 0.26),
        textShadow: `0 0 5px ${withAlpha(primaryColor, 0.58)}, 0 0 12px ${withAlpha(primaryColor, 0.34)}, 0 0 20px ${withAlpha(secondaryColor, 0.18)}, 0 1px 6px ${withAlpha("#000000", 0.18)}`,
        filter: "brightness(1.02)",
        animation: "rm-display-name-neon 2.9s ease-in-out infinite",
        willChange: "filter, opacity",
      };
    case "toon":
      return {
        color: mixHexColors(primaryColor, "#FFFFFF", 0.08),
        WebkitTextStroke: `1.15px ${withAlpha(frostedSecondary, 0.98)}`,
        paintOrder: "stroke fill",
        textShadow: `0 1px 0 ${withAlpha("#FFFFFF", 0.18)}, 1px 2px 0 ${secondaryColor}, 2px 3px 0 ${withAlpha(secondaryColor, 0.7)}, 0 7px 16px ${withAlpha("#000000", 0.16)}`,
      };
    case "pop":
      return {
        color: mixHexColors(primaryColor, "#FFFFFF", 0.22),
        textShadow: `0 1px 0 ${subtleOutline}, 0 2px 0 ${withAlpha(secondaryColor, 0.94)}, 0 4px 0 ${withAlpha(secondaryColor, 0.58)}, 0 8px 16px ${withAlpha(secondaryColor, 0.22)}, 0 2px 10px ${withAlpha("#000000", 0.16)}`,
        animation: "rm-display-name-pop 2.35s cubic-bezier(0.33, 1, 0.68, 1) infinite",
        willChange: "translate",
      };
    case "solid":
    default:
      return {
        color: primaryColor,
        textShadow: `0 1px 0 ${darkOutline}, 0 6px 14px ${withAlpha(secondaryColor, 0.14)}`,
      };
  }
}

export function getDisplayNameStyleLabel(style: DisplayNameStyle | null | undefined) {
  const normalized = normalizeDisplayNameStyle(style);
  if (!normalized) return "Default";

  const fontLabel = DISPLAY_NAME_FONT_OPTIONS.find(option => option.id === normalized.font)?.label ?? "Style";
  const effectLabel = DISPLAY_NAME_EFFECT_OPTIONS.find(option => option.id === normalized.effect)?.label ?? "Solid";
  return `${fontLabel} + ${effectLabel}`;
}

export function createRandomDisplayNameStyle() {
  const font = DISPLAY_NAME_FONT_OPTIONS[Math.floor(Math.random() * DISPLAY_NAME_FONT_OPTIONS.length)]?.id ?? DEFAULT_DISPLAY_NAME_STYLE.font;
  const effect = DISPLAY_NAME_EFFECT_OPTIONS[Math.floor(Math.random() * DISPLAY_NAME_EFFECT_OPTIONS.length)]?.id ?? DEFAULT_DISPLAY_NAME_STYLE.effect;
  const primaryColor = DISPLAY_NAME_COLOR_SWATCHES[Math.floor(Math.random() * DISPLAY_NAME_COLOR_SWATCHES.length)] ?? DEFAULT_DISPLAY_NAME_STYLE.primaryColor;
  let secondaryColor = DISPLAY_NAME_COLOR_SWATCHES[Math.floor(Math.random() * DISPLAY_NAME_COLOR_SWATCHES.length)] ?? DEFAULT_DISPLAY_NAME_STYLE.secondaryColor;

  if (secondaryColor === primaryColor) {
    secondaryColor = DISPLAY_NAME_COLOR_SWATCHES[(DISPLAY_NAME_COLOR_SWATCHES.indexOf(primaryColor) + 3) % DISPLAY_NAME_COLOR_SWATCHES.length] ?? DEFAULT_DISPLAY_NAME_STYLE.secondaryColor;
  }

  return {
    font,
    effect,
    primaryColor,
    secondaryColor,
  } satisfies DisplayNameStyle;
}

export function getProfileThemeVariables(input: ProfileCustomizationInput): CSSProperties {
  const accent = normalizeHexColor(input.profile_accent_color);
  const background = normalizeHexColor(input.profile_background_color);
  const banner = normalizeHexColor(input.profile_banner_color);

  if (!accent && !background) {
    return {
      "--rm-profile-custom-accent": "var(--rm-accent)",
      "--rm-profile-custom-accent-muted": "var(--rm-accent-dim)",
      "--rm-profile-custom-text": "var(--rm-text-primary)",
      "--rm-profile-custom-muted": "var(--rm-text-secondary)",
      "--rm-profile-custom-ghost": "var(--rm-text-muted)",
      "--rm-profile-custom-card-bg": "rgba(0, 0, 0, 0.16)",
      "--rm-profile-custom-card-bg-strong": "rgba(0, 0, 0, 0.22)",
      "--rm-profile-custom-card-border": "rgba(255, 255, 255, 0.08)",
      "--rm-profile-custom-button-bg": "var(--rm-accent)",
      "--rm-profile-custom-button-text": "white",
      "--rm-profile-custom-button-shadow": "var(--rm-accent-dim)",
      "--rm-profile-custom-surface": "linear-gradient(180deg, transparent, transparent)",
      "--rm-profile-custom-surface-overlay": "var(--rm-profile-surface-overlay)",
      "--rm-profile-custom-surface-overlay-strong": "var(--rm-profile-surface-overlay-strong)",
      "--rm-profile-custom-banner-fallback": banner ?? "var(--rm-profile-banner-fallback)",
      "--rm-profile-custom-banner-overlay": "var(--rm-profile-banner-overlay)",
    } as CSSProperties;
  }

  const resolvedBackground = background ?? "#161A22";
  const resolvedAccent = accent ?? "#5865F2";
  const mixedSurface = mixHexColors(resolvedBackground, resolvedAccent, 0.22);
  const isLightSurface = getRelativeLuminance(mixedSurface) > 0.46;
  const text = isLightSurface ? "#16161F" : "#F8FAFC";
  const panelBase = isLightSurface ? "#FFFFFF" : "#07080D";

  const surfaceTop = mixHexColors(resolvedBackground, "#FFFFFF", isLightSurface ? 0.16 : 0.06);
  const surfaceMid = mixHexColors(resolvedBackground, resolvedAccent, isLightSurface ? 0.2 : 0.18);
  const surfaceBottom = mixHexColors(resolvedBackground, resolvedAccent, isLightSurface ? 0.38 : 0.28);
  const bannerFallback = banner
    ?? `linear-gradient(135deg, ${mixHexColors(resolvedAccent, "#FFFFFF", isLightSurface ? 0.22 : 0.08)}, ${mixHexColors(resolvedBackground, resolvedAccent, isLightSurface ? 0.34 : 0.18)} 58%, ${mixHexColors(resolvedBackground, "#000000", 0.14)} 100%)`;

  return {
    "--rm-profile-custom-accent": resolvedAccent,
    "--rm-profile-custom-accent-muted": withAlpha(resolvedAccent, isLightSurface ? 0.16 : 0.24),
    "--rm-profile-custom-text": text,
    "--rm-profile-custom-muted": withAlpha(text, 0.74),
    "--rm-profile-custom-ghost": withAlpha(text, 0.52),
    "--rm-profile-custom-card-bg": withAlpha(panelBase, isLightSurface ? 0.56 : 0.26),
    "--rm-profile-custom-card-bg-strong": withAlpha(panelBase, isLightSurface ? 0.68 : 0.34),
    "--rm-profile-custom-card-border": withAlpha(text, isLightSurface ? 0.1 : 0.12),
    "--rm-profile-custom-button-bg": resolvedAccent,
    "--rm-profile-custom-button-text": getContrastTextColor(resolvedAccent),
    "--rm-profile-custom-button-shadow": withAlpha(resolvedAccent, isLightSurface ? 0.28 : 0.34),
    "--rm-profile-custom-surface": `linear-gradient(180deg, ${surfaceTop} 0%, ${surfaceMid} 56%, ${surfaceBottom} 100%)`,
    "--rm-profile-custom-surface-overlay": `radial-gradient(circle at top, ${withAlpha("#FFFFFF", isLightSurface ? 0.36 : 0.08)}, transparent 34%), linear-gradient(180deg, ${withAlpha("#FFFFFF", isLightSurface ? 0.08 : 0.02)}, ${withAlpha("#000000", isLightSurface ? 0.04 : 0.2)} 100%)`,
    "--rm-profile-custom-surface-overlay-strong": `radial-gradient(circle at top, ${withAlpha("#FFFFFF", isLightSurface ? 0.42 : 0.1)}, transparent 32%), linear-gradient(180deg, ${withAlpha("#FFFFFF", isLightSurface ? 0.12 : 0.04)}, ${withAlpha("#000000", isLightSurface ? 0.06 : 0.28)} 100%)`,
    "--rm-profile-custom-banner-fallback": bannerFallback,
    "--rm-profile-custom-banner-overlay": `linear-gradient(180deg, ${withAlpha("#FFFFFF", isLightSurface ? 0.04 : 0.02)}, ${withAlpha("#000000", isLightSurface ? 0.18 : 0.28)}), linear-gradient(90deg, ${withAlpha("#000000", isLightSurface ? 0.1 : 0.18)}, transparent 56%, ${withAlpha("#000000", isLightSurface ? 0.16 : 0.24)})`,
  } as CSSProperties;
}
