import { getAvatarCollectibles } from "@/lib/avatar-display";
import { findCollectibleItem, type CollectiblesCatalog } from "@/lib/collectibles-catalog";
import type { User } from "@/lib/types";

const NAMEPLATE_SWATCHES: Record<string, string> = {
  amethyst: "#9251ff",
  arctic: "#cdddf2",
  base: "#f5f5f5",
  blue: "#60a5fa",
  clouds: "#9ec9ff",
  emerald: "#34d399",
  gold: "#facc15",
  green: "#4ade80",
  indigo: "#818cf8",
  orange: "#fb923c",
  pink: "#ec7ed1",
  purple: "#b58cff",
  red: "#ef4444",
  violet: "#8b7dff",
  white: "#ffffff",
  yellow: "#facc15",
};

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

function accentFromPalette(palette: string | null | undefined, seed: string) {
  const key = palette?.toLowerCase().trim() ?? "";
  if (key && NAMEPLATE_SWATCHES[key]) {
    return NAMEPLATE_SWATCHES[key];
  }

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
  identityBackdropBg: string;
  identityBackdropBorder: string;
  rowBorder: string;
  rowGlow: string;
  buttonBg: string;
  buttonHoverBg: string;
  buttonActiveBg: string;
  buttonText: string;
  buttonMuted: string;
  buttonFilter: string;
}

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
    identityBackdropBg: isLightAccent ? "rgba(255,255,255,0.78)" : "rgba(7,10,16,0.74)",
    identityBackdropBorder: rgba(foregroundRgb, isLightAccent ? 0.12 : 0.14),
    rowBorder: rgba(accentRgb, isLightAccent ? 0.18 : 0.34),
    rowGlow: rgba(accentRgb, isLightAccent ? 0.16 : 0.24),
    buttonBg: rgba(foregroundRgb, isLightAccent ? 0.08 : 0.1),
    buttonHoverBg: rgba(foregroundRgb, isLightAccent ? 0.12 : 0.14),
    buttonActiveBg: rgba(foregroundRgb, isLightAccent ? 0.18 : 0.2),
    buttonText: foregroundColor,
    buttonMuted: rgba(foregroundRgb, isLightAccent ? 0.74 : 0.8),
    buttonFilter: "none",
  };
}

type NameplateSourceUser = Pick<User, "id" | "avatar_display" | "nameplate_url"> | null | undefined;

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
