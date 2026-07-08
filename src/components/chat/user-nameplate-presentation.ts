import { getAvatarCollectibles } from "@/lib/avatar-display";
import { findCollectibleItem, type CollectiblesCatalog } from "@/lib/collectibles-catalog";
import type { User } from "@/lib/types";


function hslToHex(hue: number, saturation: number, lightness: number) {
  const s = saturation / 100;
  const l = lightness / 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs((hue / 60) % 2 - 1));
  const m = l - c / 2;

  let red = 0;
  let green = 0;
  let blue = 0;

  if (hue < 60) {
    red = c;
    green = x;
  } else if (hue < 120) {
    red = x;
    green = c;
  } else if (hue < 180) {
    green = c;
    blue = x;
  } else if (hue < 240) {
    green = x;
    blue = c;
  } else if (hue < 300) {
    red = x;
    blue = c;
  } else {
    red = c;
    blue = x;
  }

  const toHex = (value: number) => Math.round((value + m) * 255).toString(16).padStart(2, "0");
  return `#${toHex(red)}${toHex(green)}${toHex(blue)}`;
}

function hexToRgb(hex: string) {
  const normalized = hex.replace("#", "");
  const expanded = normalized.length === 3
    ? normalized.split("").map((part) => `${part}${part}`).join("")
    : normalized;
  const value = Number.parseInt(expanded, 16);

  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255,
  };
}

function rgba(color: { r: number; g: number; b: number }, alpha: number) {
  return `rgba(${color.r}, ${color.g}, ${color.b}, ${alpha})`;
}

function relativeLuminance(color: { r: number; g: number; b: number }) {
  const channels = [color.r, color.g, color.b].map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.03928
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

/**
 * Palette names that Discord uses which are NOT valid CSS named colors.
 * Standard CSS color names (gold, blue, red, violet, orange, pink, purple,
 * white, indigo, green, etc.) are resolved dynamically via CSS parsing below
 * and do not need entries here.
 */
const DISCORD_PALETTE_OVERRIDES: Record<string, string> = {
  // CSS has no "lemon" — bright warm yellow similar to Discord's Woody palette
  lemon: "#facc15",
  // CSS has no "arctic" — pale cool blue
  arctic: "#cdddf2",
  // CSS has no "clouds" — desaturated sky blue
  clouds: "#9ec9ff",
  // CSS has no "amethyst" — Discord's specific purple shade
  amethyst: "#9251ff",
  // CSS "base" would resolve to nothing — neutral light gray
  base: "#f5f5f5",
};

/** Cached results for CSS name resolution so we only hit the DOM once per name. */
const cssColorCache = new Map<string, string | null>();

/**
 * Attempts to resolve a color name using the browser's own CSS parser.
 * Works for any valid CSS named color (gold, violet, coral, teal, lavender…).
 * Returns null if the name is not a recognised CSS color or if DOM is unavailable.
 */
function tryResolveCssColor(name: string): string | null {
  if (typeof document === "undefined") return null;
  if (cssColorCache.has(name)) return cssColorCache.get(name)!;

  const el = document.createElement("div");
  el.style.color = name;
  if (!el.style.color) {
    cssColorCache.set(name, null);
    return null;
  }
  document.body.appendChild(el);
  const computed = getComputedStyle(el).color;
  document.body.removeChild(el);
  const m = computed.match(/\d+/g);
  if (!m || m.length < 3) {
    cssColorCache.set(name, null);
    return null;
  }
  const hex = `#${Number(m[0]).toString(16).padStart(2, "0")}${Number(m[1]).toString(16).padStart(2, "0")}${Number(m[2]).toString(16).padStart(2, "0")}`;
  cssColorCache.set(name, hex);
  return hex;
}

function accentFromPalette(palette: string | null | undefined, seed: string) {
  const key = palette?.toLowerCase().trim() ?? "";

  // 1. Discord-specific names that aren't valid CSS colors
  if (key && DISCORD_PALETTE_OVERRIDES[key]) {
    return DISCORD_PALETTE_OVERRIDES[key];
  }

  // 2. Standard CSS named colors (gold, blue, violet, coral, teal, etc.)
  if (key) {
    const cssHex = tryResolveCssColor(key);
    if (cssHex) return cssHex;
  }

  // 3. Seed-based hash for completely unknown names
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash << 5) - hash + seed.charCodeAt(index);
    hash |= 0;
  }

  return hslToHex(Math.abs(hash) % 360, 72, 62);
}

export interface NameplateTheme {
  accentHex: string;
  isLightAccent: boolean;
  foregroundColor: string;
  mutedForegroundColor: string;
  metaColor: string;
  metaFill: string;
  textShadow: string;
  identityFilter: string;
  rowBorder: string;
  rowGlow: string;
  buttonText: string;
  buttonMuted: string;
}

export interface NameplateTextColors {
  foregroundColor?: string;
  mutedForegroundColor?: string;
  metaColor?: string;
  readableFallbackColor?: string;
}

const SEMANTIC_NAMEPLATE_TEXT_PRIMARY = "var(--rm-text-primary)";
const SEMANTIC_NAMEPLATE_TEXT_SECONDARY = "var(--rm-text-secondary)";
const SEMANTIC_NAMEPLATE_TEXT_MUTED = "var(--rm-text-muted)";

export function buildNameplateTheme(palette: string | null | undefined, seed: string): NameplateTheme {
  const accentHex = accentFromPalette(palette, seed);
  const accentRgb = hexToRgb(accentHex);
  const isLightAccent = relativeLuminance(accentRgb) > 0.36;
  const foregroundColor = isLightAccent ? "#162033" : "#F8FAFC";
  const foregroundRgb = hexToRgb(foregroundColor);

  return {
    accentHex,
    isLightAccent,
    foregroundColor,
    mutedForegroundColor: rgba(foregroundRgb, isLightAccent ? 0.72 : 0.78),
    metaColor: rgba(foregroundRgb, isLightAccent ? 0.88 : 0.94),
    metaFill: rgba(foregroundRgb, isLightAccent ? 0.18 : 0.22),
    textShadow: "none",
    identityFilter: "none",
    rowBorder: rgba(accentRgb, isLightAccent ? 0.18 : 0.34),
    rowGlow: rgba(accentRgb, isLightAccent ? 0.16 : 0.24),
    buttonText: foregroundColor,
    buttonMuted: rgba(foregroundRgb, isLightAccent ? 0.78 : 0.84),
  };
}

export function getNameplateTextColors(
  theme: NameplateTheme | null | undefined,
  options?: { useThemeSemanticColors?: boolean },
): NameplateTextColors {
  if (!theme) {
    return {};
  }

  if (options?.useThemeSemanticColors) {
    return {
      foregroundColor: SEMANTIC_NAMEPLATE_TEXT_PRIMARY,
      mutedForegroundColor: SEMANTIC_NAMEPLATE_TEXT_MUTED,
      metaColor: SEMANTIC_NAMEPLATE_TEXT_SECONDARY,
      readableFallbackColor: SEMANTIC_NAMEPLATE_TEXT_PRIMARY,
    };
  }

  return {
    foregroundColor: theme.foregroundColor,
    mutedForegroundColor: theme.mutedForegroundColor,
    metaColor: theme.metaColor,
    readableFallbackColor: theme.foregroundColor,
  };
}

type NameplateSourceUser = Pick<User, "id" | "avatar_display" | "nameplate_url"> | null | undefined;

export function shouldUseNameplateIdentityFade(
  theme: NameplateTheme | null | undefined,
  options: {
    needsContrastAssist: boolean;
  },
) {
  return Boolean(theme) && options.needsContrastAssist;
}

export function getUserNameplatePresentation(
  user: NameplateSourceUser,
  collectiblesCatalog?: CollectiblesCatalog | null,
) {
  const nameplateSelection = getAvatarCollectibles(user?.avatar_display)?.nameplate;
  const hasNameplate = Boolean(user?.nameplate_url);
  const hasCollectibleNameplate = Boolean(nameplateSelection);
  const needsContrastAssist = hasNameplate && !hasCollectibleNameplate;

  if (!hasNameplate) {
    return {
      nameplateSelection,
      hasNameplate,
      hasCollectibleNameplate,
      needsContrastAssist,
      theme: null,
    };
  }

  const paletteFromDisplay = nameplateSelection?.palette;
  const paletteFromCatalog = collectiblesCatalog && nameplateSelection?.skuId
    ? findCollectibleItem(collectiblesCatalog, nameplateSelection.skuId)?.palette
    : undefined;
  const seed = nameplateSelection?.skuId ?? user?.nameplate_url ?? user?.id ?? "nameplate";

  return {
    nameplateSelection,
    hasNameplate,
    hasCollectibleNameplate,
    needsContrastAssist,
    theme: buildNameplateTheme(paletteFromDisplay ?? paletteFromCatalog, seed),
  };
}
