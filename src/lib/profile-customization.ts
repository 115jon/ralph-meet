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

export type DisplayNameEffectId =
  | "solid"
  | "gradient"
  | "neon"
  | "toon"
  | "pop";

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

export interface DisplayNameContrastOptions {
  backgroundColor?: string | null;
  fallbackTextColor?: string | null;
  minContrastRatio?: number;
}

export interface ResolvedProfileTheme {
  variables: CSSProperties;
  backgroundColor: string | null;
  textColor: string | null;
  accentColor: string | null;
  isLightSurface: boolean | null;
}

export const DEFAULT_PROFILE_THEME = {
  accent: "#5865F2",
  background: "#161A22",
} as const;

const LEGACY_DEFAULT_PROFILE_THEME = {
  accent: "#0B0BE6",
  background: "#0055FE",
} as const;

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
const RGB_COLOR_RE =
  /^rgba?\(\s*(\d{1,3})(?:\s*,\s*|\s+)(\d{1,3})(?:\s*,\s*|\s+)(\d{1,3})(?:(?:\s*,\s*|\s*\/\s*)([\d.]+%?))?\s*\)$/i;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function normalizeHexColor(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!HEX_COLOR_RE.test(trimmed)) return null;
  const hex = trimmed.startsWith("#") ? trimmed.slice(1) : trimmed;
  const expanded =
    hex.length === 3
      ? hex
          .split("")
          .map((char) => `${char}${char}`)
          .join("")
      : hex;
  return `#${expanded.toUpperCase()}`;
}

export function sanitizeProfileCustomizationInput(
  input: ProfileCustomizationInput,
): Required<ProfileCustomizationInput> {
  const accent = normalizeHexColor(input.profile_accent_color);
  const background = normalizeHexColor(input.profile_background_color);
  const banner = normalizeHexColor(input.profile_banner_color);

  if (
    accent === LEGACY_DEFAULT_PROFILE_THEME.accent &&
    background === LEGACY_DEFAULT_PROFILE_THEME.background
  ) {
    return {
      profile_accent_color: null,
      profile_background_color: null,
      profile_banner_color: banner,
    };
  }

  return {
    profile_accent_color: accent,
    profile_background_color: background,
    profile_banner_color: banner,
  };
}

export function applyProfileThemeDefaults(input: ProfileCustomizationInput): {
  profile_accent_color: string;
  profile_background_color: string;
  profile_banner_color: string | null;
} {
  const sanitized = sanitizeProfileCustomizationInput(input);

  return {
    profile_accent_color:
      sanitized.profile_accent_color ?? DEFAULT_PROFILE_THEME.accent,
    profile_background_color:
      sanitized.profile_background_color ?? DEFAULT_PROFILE_THEME.background,
    profile_banner_color: sanitized.profile_banner_color,
  };
}

function normalizeBrowserComputedColor(value: string) {
  if (typeof document === "undefined" || typeof window === "undefined") {
    return null;
  }

  const body = document.body;
  if (!body) return null;

  const probe = document.createElement("span");
  probe.style.color = "";
  probe.style.color = value;

  if (!probe.style.color) {
    return null;
  }

  probe.style.position = "fixed";
  probe.style.inset = "0";
  probe.style.opacity = "0";
  probe.style.pointerEvents = "none";
  body.appendChild(probe);

  const computedColor = window.getComputedStyle(probe).color;
  probe.remove();

  return computedColor && computedColor !== value ? computedColor : null;
}

export function normalizeDisplayColor(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  const normalizedHex = normalizeHexColor(trimmed);
  if (normalizedHex) return normalizedHex;

  const rgbMatch = trimmed.match(RGB_COLOR_RE);
  if (rgbMatch) {
    const [, red, green, blue, alpha] = rgbMatch;
    const alphaValue = alpha?.endsWith("%")
      ? Number.parseFloat(alpha) / 100
      : alpha
        ? Number.parseFloat(alpha)
        : 1;

    if (!Number.isFinite(alphaValue) || alphaValue <= 0) {
      return null;
    }

    return rgbToHex(
      Number.parseInt(red, 10),
      Number.parseInt(green, 10),
      Number.parseInt(blue, 10),
    );
  }

  const browserComputedColor = normalizeBrowserComputedColor(trimmed);
  return browserComputedColor
    ? normalizeDisplayColor(browserComputedColor)
    : null;
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
    .map((channel) =>
      clamp(Math.round(channel), 0, 255).toString(16).padStart(2, "0"),
    )
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
      hue = 60 * ((blue - red) / delta + 2);
    } else {
      hue = 60 * ((red - green) / delta + 4);
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

export function mixHexColors(
  baseHex: string,
  targetHex: string,
  targetWeight: number,
) {
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

  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

export function getContrastRatio(foreground: string, background: string) {
  const foregroundHex = normalizeDisplayColor(foreground);
  const backgroundHex = normalizeDisplayColor(background);

  if (!foregroundHex || !backgroundHex) {
    return 1;
  }

  const brighter = Math.max(
    getRelativeLuminance(foregroundHex),
    getRelativeLuminance(backgroundHex),
  );
  const darker = Math.min(
    getRelativeLuminance(foregroundHex),
    getRelativeLuminance(backgroundHex),
  );

  return (brighter + 0.05) / (darker + 0.05);
}

export function getContrastTextColor(hex: string) {
  return getRelativeLuminance(hex) > 0.47 ? "#12131A" : "#F8FAFC";
}

function pickReadableDisplayNameColor(
  desiredColor: string,
  backgroundColor: string,
  fallbackTextColor: string,
  minContrastRatio: number,
) {
  const normalizedDesired =
    normalizeDisplayColor(desiredColor) ?? fallbackTextColor;
  const normalizedFallback =
    normalizeDisplayColor(fallbackTextColor) ??
    getContrastTextColor(backgroundColor);
  const contrastAnchor = getContrastTextColor(backgroundColor);

  const candidates = [
    normalizedDesired,
    mixHexColors(normalizedDesired, contrastAnchor, 0.18),
    mixHexColors(normalizedDesired, contrastAnchor, 0.34),
    mixHexColors(normalizedDesired, contrastAnchor, 0.52),
    normalizedFallback,
    contrastAnchor,
  ];

  let bestCandidate = normalizedDesired;
  let bestContrast = getContrastRatio(normalizedDesired, backgroundColor);

  for (const candidate of candidates) {
    const contrast = getContrastRatio(candidate, backgroundColor);
    if (contrast > bestContrast) {
      bestCandidate = candidate;
      bestContrast = contrast;
    }
    if (contrast >= minContrastRatio) {
      return candidate;
    }
  }

  return bestCandidate;
}

export function resolveReadableDisplayNameStyle(
  style: DisplayNameStyle | string | null | undefined,
  options: DisplayNameContrastOptions = {},
) {
  const normalizedStyle = normalizeDisplayNameStyle(style);
  if (!normalizedStyle) return null;

  const backgroundColor = normalizeDisplayColor(options.backgroundColor);
  if (!backgroundColor) return normalizedStyle;

  const fallbackTextColor =
    normalizeDisplayColor(options.fallbackTextColor) ??
    getContrastTextColor(backgroundColor);
  const minContrastRatio = options.minContrastRatio ?? 3;

  return {
    ...normalizedStyle,
    primaryColor: pickReadableDisplayNameColor(
      normalizedStyle.primaryColor,
      backgroundColor,
      fallbackTextColor,
      minContrastRatio,
    ),
    secondaryColor: pickReadableDisplayNameColor(
      normalizedStyle.secondaryColor,
      backgroundColor,
      fallbackTextColor,
      minContrastRatio,
    ),
  } satisfies DisplayNameStyle;
}

export function normalizeDisplayNameStyle(
  value: unknown,
): DisplayNameStyle | null {
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

export function serializeDisplayNameStyle(
  style: DisplayNameStyle | null | undefined,
) {
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
      fontFamily: '"Bungee", "Trebuchet MS", var(--font-sans), sans-serif',
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
      fontFamily: '"Permanent Marker", "Segoe Print", cursive',
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
      fontFamily:
        '"Fredoka", "Arial Rounded MT Bold", var(--font-sans), sans-serif',
      fontWeight: 700,
      letterSpacing: "-0.04em",
    },
  },
  {
    id: "modern",
    label: "Modern",
    sample: "Muse",
    style: {
      fontFamily: '"Cormorant Garamond", Georgia, serif',
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
      fontFamily: '"Cinzel", "Goudy Text MT", Georgia, serif',
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
      fontFamily: '"Press Start 2P", "Courier New", monospace',
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
      fontFamily: '"UnifrakturMaguntia", "Old English Text MT", Georgia, serif',
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

export function getDisplayNameFontStyle(
  font: DisplayNameFontId,
): CSSProperties {
  return (
    DISPLAY_NAME_FONT_OPTIONS.find((option) => option.id === font)?.style ??
    DISPLAY_NAME_FONT_OPTIONS[0].style
  );
}

export function getDisplayNameEffectStyle(
  style: DisplayNameStyle,
): CSSProperties {
  const primaryColor =
    normalizeHexColor(style.primaryColor) ??
    DEFAULT_DISPLAY_NAME_STYLE.primaryColor;
  const secondaryColor =
    normalizeHexColor(style.secondaryColor) ??
    DEFAULT_DISPLAY_NAME_STYLE.secondaryColor;
  const primaryHighlightAnchor =
    getRelativeLuminance(primaryColor) > 0.62 ? "#111827" : "#FFFFFF";
  const secondaryHighlightAnchor =
    getRelativeLuminance(secondaryColor) > 0.62 ? "#111827" : "#FFFFFF";
  const darkOutline = withAlpha("#111827", 0.24);
  const subtleOutline = withAlpha("#FFFFFF", 0.12);
  const brightPrimary = mixHexColors(
    primaryColor,
    primaryHighlightAnchor,
    0.08,
  );
  const brightSecondary = mixHexColors(
    secondaryColor,
    secondaryHighlightAnchor,
    0.06,
  );
  const frostedSecondary = mixHexColors(
    secondaryColor,
    secondaryHighlightAnchor,
    0.18,
  );

  switch (style.effect) {
    case "gradient":
      return {
        color: "transparent",
        backgroundImage: `linear-gradient(135deg, ${brightPrimary} 0%, ${primaryColor} 24%, ${mixHexColors(primaryColor, secondaryColor, 0.52)} 58%, ${secondaryColor} 82%, ${brightSecondary} 100%)`,
        backgroundSize: "180% 180%",
        WebkitBackgroundClip: "text",
        backgroundClip: "text",
        WebkitTextFillColor: "transparent",
        textShadow: `0 1px 0 ${withAlpha("#FFFFFF", 0.04)}`,
        animation: "rm-display-name-gradient 7.5s ease-in-out infinite",
        willChange: "background-position",
      };
    case "neon":
      return {
        color: mixHexColors(primaryColor, primaryHighlightAnchor, 0.12),
        textShadow: `0 0 5px ${withAlpha(primaryColor, 0.54)}, 0 0 12px ${withAlpha(primaryColor, 0.3)}, 0 0 20px ${withAlpha(secondaryColor, 0.16)}, 0 1px 4px ${withAlpha("#000000", 0.14)}`,
        filter: "brightness(1.02)",
        animation: "rm-display-name-neon 2.9s ease-in-out infinite",
        willChange: "filter, opacity",
      };
    case "toon":
      return {
        color: mixHexColors(primaryColor, primaryHighlightAnchor, 0.04),
        WebkitTextStroke: `1.15px ${withAlpha(frostedSecondary, 0.98)}`,
        paintOrder: "stroke fill",
        textShadow: `0 1px 0 ${withAlpha("#FFFFFF", 0.14)}, 1px 2px 0 ${secondaryColor}, 2px 3px 0 ${withAlpha(secondaryColor, 0.64)}, 0 6px 14px ${withAlpha("#000000", 0.14)}`,
      };
    case "pop":
      return {
        color: mixHexColors(primaryColor, primaryHighlightAnchor, 0.1),
        textShadow: `0 1px 0 ${subtleOutline}, 0 2px 0 ${withAlpha(secondaryColor, 0.88)}, 0 4px 0 ${withAlpha(secondaryColor, 0.52)}, 0 8px 16px ${withAlpha(secondaryColor, 0.18)}, 0 2px 8px ${withAlpha("#000000", 0.14)}`,
        animation:
          "rm-display-name-pop 2.35s cubic-bezier(0.33, 1, 0.68, 1) infinite",
        willChange: "translate",
      };
    case "solid":
    default:
      return {
        color: primaryColor,
        textShadow: `0 1px 0 ${darkOutline}, 0 4px 10px ${withAlpha(secondaryColor, 0.1)}`,
      };
  }
}

export function getDisplayNameStyleLabel(
  style: DisplayNameStyle | null | undefined,
) {
  const normalized = normalizeDisplayNameStyle(style);
  if (!normalized) return "Default";

  const fontLabel =
    DISPLAY_NAME_FONT_OPTIONS.find((option) => option.id === normalized.font)
      ?.label ?? "Style";
  const effectLabel =
    DISPLAY_NAME_EFFECT_OPTIONS.find(
      (option) => option.id === normalized.effect,
    )?.label ?? "Solid";
  return `${fontLabel} + ${effectLabel}`;
}

export function createRandomDisplayNameStyle() {
  const font =
    DISPLAY_NAME_FONT_OPTIONS[
      Math.floor(Math.random() * DISPLAY_NAME_FONT_OPTIONS.length)
    ]?.id ?? DEFAULT_DISPLAY_NAME_STYLE.font;
  const effect =
    DISPLAY_NAME_EFFECT_OPTIONS[
      Math.floor(Math.random() * DISPLAY_NAME_EFFECT_OPTIONS.length)
    ]?.id ?? DEFAULT_DISPLAY_NAME_STYLE.effect;
  const primaryColor =
    DISPLAY_NAME_COLOR_SWATCHES[
      Math.floor(Math.random() * DISPLAY_NAME_COLOR_SWATCHES.length)
    ] ?? DEFAULT_DISPLAY_NAME_STYLE.primaryColor;
  let secondaryColor =
    DISPLAY_NAME_COLOR_SWATCHES[
      Math.floor(Math.random() * DISPLAY_NAME_COLOR_SWATCHES.length)
    ] ?? DEFAULT_DISPLAY_NAME_STYLE.secondaryColor;

  if (secondaryColor === primaryColor) {
    secondaryColor =
      DISPLAY_NAME_COLOR_SWATCHES[
        (DISPLAY_NAME_COLOR_SWATCHES.indexOf(primaryColor) + 3) %
          DISPLAY_NAME_COLOR_SWATCHES.length
      ] ?? DEFAULT_DISPLAY_NAME_STYLE.secondaryColor;
  }

  return {
    font,
    effect,
    primaryColor,
    secondaryColor,
  } satisfies DisplayNameStyle;
}

export function resolveProfileTheme(
  input: ProfileCustomizationInput,
): ResolvedProfileTheme {
  const {
    profile_accent_color: resolvedAccent,
    profile_background_color: resolvedBackground,
    profile_banner_color: banner,
  } = applyProfileThemeDefaults(input);
  const mixedSurface = mixHexColors(resolvedBackground, resolvedAccent, 0.22);
  const isLightSurface = getRelativeLuminance(mixedSurface) > 0.46;
  const text = isLightSurface ? "#16161F" : "#F8FAFC";
  const panelBase = isLightSurface ? "#FFFFFF" : "#07080D";

  const surfaceTop = mixHexColors(
    resolvedBackground,
    "#FFFFFF",
    isLightSurface ? 0.16 : 0.06,
  );
  const surfaceMid = mixHexColors(
    resolvedBackground,
    resolvedAccent,
    isLightSurface ? 0.2 : 0.18,
  );
  const surfaceBottom = mixHexColors(
    resolvedBackground,
    resolvedAccent,
    isLightSurface ? 0.38 : 0.28,
  );
  const bannerFallback =
    banner ??
    `linear-gradient(135deg, ${mixHexColors(resolvedAccent, "#FFFFFF", isLightSurface ? 0.22 : 0.08)}, ${mixHexColors(resolvedBackground, resolvedAccent, isLightSurface ? 0.34 : 0.18)} 58%, ${mixHexColors(resolvedBackground, "#000000", 0.14)} 100%)`;

  return {
    variables: {
      "--rm-profile-custom-accent": resolvedAccent,
      "--rm-profile-custom-accent-muted": withAlpha(
        resolvedAccent,
        isLightSurface ? 0.16 : 0.24,
      ),
      "--rm-profile-custom-text": text,
      "--rm-profile-custom-muted": withAlpha(text, 0.74),
      "--rm-profile-custom-ghost": withAlpha(text, 0.52),
      "--rm-profile-custom-card-bg": withAlpha(
        panelBase,
        isLightSurface ? 0.56 : 0.26,
      ),
      "--rm-profile-custom-card-bg-strong": withAlpha(
        panelBase,
        isLightSurface ? 0.68 : 0.34,
      ),
      "--rm-profile-custom-card-border": withAlpha(
        text,
        isLightSurface ? 0.1 : 0.12,
      ),
      "--rm-profile-custom-button-bg": resolvedAccent,
      "--rm-profile-custom-button-text": getContrastTextColor(resolvedAccent),
      "--rm-profile-custom-button-shadow": withAlpha(
        resolvedAccent,
        isLightSurface ? 0.28 : 0.34,
      ),
      "--rm-profile-custom-surface": `linear-gradient(180deg, ${surfaceTop} 0%, ${surfaceMid} 56%, ${surfaceBottom} 100%)`,
      "--rm-profile-custom-surface-overlay": `radial-gradient(circle at top, ${withAlpha("#FFFFFF", isLightSurface ? 0.36 : 0.08)}, transparent 34%), linear-gradient(180deg, ${withAlpha("#FFFFFF", isLightSurface ? 0.08 : 0.02)}, ${withAlpha("#000000", isLightSurface ? 0.04 : 0.2)} 100%)`,
      "--rm-profile-custom-surface-overlay-strong": `radial-gradient(circle at top, ${withAlpha("#FFFFFF", isLightSurface ? 0.42 : 0.1)}, transparent 32%), linear-gradient(180deg, ${withAlpha("#FFFFFF", isLightSurface ? 0.12 : 0.04)}, ${withAlpha("#000000", isLightSurface ? 0.06 : 0.28)} 100%)`,
      "--rm-profile-custom-banner-fallback": bannerFallback,
      "--rm-profile-custom-banner-overlay": `linear-gradient(180deg, ${withAlpha("#FFFFFF", isLightSurface ? 0.04 : 0.02)}, ${withAlpha("#000000", isLightSurface ? 0.18 : 0.28)}), linear-gradient(90deg, ${withAlpha("#000000", isLightSurface ? 0.1 : 0.18)}, transparent 56%, ${withAlpha("#000000", isLightSurface ? 0.16 : 0.24)})`,
    } as CSSProperties,
    backgroundColor: mixedSurface,
    textColor: text,
    accentColor: resolvedAccent,
    isLightSurface,
  };
}

export function getProfileThemeVariables(
  input: ProfileCustomizationInput,
): CSSProperties {
  return resolveProfileTheme(input).variables;
}
