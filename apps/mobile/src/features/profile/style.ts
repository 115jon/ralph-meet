import { Option, Schema } from "effect";

import { contrast, mixHex, normalizeHex, readableOn, withAlpha } from "./color";
import {
  AvatarDisplaySchema,
  DisplayNameStyleSchema,
  type Collectibles,
  type DisplayNameStyle,
} from "./schema";

// How a profile's own choices show on a phone: the display-name style, the
// profile theme's colours and the collectibles, each read loosely (a value
// this build does not understand is ignored, never an error).

const decodeStyle = Schema.decodeUnknownOption(DisplayNameStyleSchema);
const decodeDisplay = Schema.decodeUnknownOption(AvatarDisplaySchema);

/** `value` decoded, reading a JSON string first (member rows carry one). */
function decodeLoose<A>(
  decode: (input: unknown) => Option.Option<A>,
  value: unknown,
): A | null {
  if (typeof value !== "string") return Option.getOrNull(decode(value));
  try {
    return Option.getOrNull(decode(JSON.parse(value)));
  } catch {
    return null;
  }
}

/** The style a name was given: a JSON string (member rows) or an object. */
export function parseDisplayNameStyle(value: unknown): DisplayNameStyle | null {
  const style = decodeLoose(decodeStyle, value);
  if (!style) return null;
  const primaryColor = normalizeHex(style.primaryColor);
  const secondaryColor = normalizeHex(style.secondaryColor);
  if (!primaryColor || !secondaryColor) return null;
  return { ...style, primaryColor, secondaryColor };
}

export interface NameLook {
  readonly color: string;
  readonly textShadowColor?: string;
  readonly textShadowOffset?: { width: number; height: number };
  readonly textShadowRadius?: number;
}

/**
 * A styled name on `background`, after the web's getDisplayNameEffectStyle
 * at rest. React Native draws one shadow and no gradient fill, so each
 * effect keeps its strongest cue: neon its glow, toon and pop their offset
 * shadow in the second colour, gradient its first colour with the second
 * as a glow. The fonts are not bundled: every style sets in Bricolage.
 * Colours are nudged to 3:1, as the web's resolveReadableDisplayNameStyle.
 */
export function nameLook(
  style: DisplayNameStyle,
  background: string,
): NameLook {
  const primary = readableOn(style.primaryColor, background, 3);
  const secondary = readableOn(style.secondaryColor, background, 3);
  switch (style.effect) {
    case "neon":
      return {
        color: primary,
        textShadowColor: withAlpha(style.primaryColor, 0.6),
        textShadowOffset: { width: 0, height: 0 },
        textShadowRadius: 8,
      };
    case "toon":
      return {
        color: primary,
        textShadowColor: secondary,
        textShadowOffset: { width: 1, height: 2 },
        textShadowRadius: 0.1,
      };
    case "pop":
      return {
        color: primary,
        textShadowColor: withAlpha(secondary, 0.88),
        textShadowOffset: { width: 0, height: 2 },
        textShadowRadius: 0.1,
      };
    case "gradient":
      return {
        color: primary,
        textShadowColor: withAlpha(secondary, 0.5),
        textShadowOffset: { width: 0, height: 0 },
        textShadowRadius: 6,
      };
    case "solid":
      return { color: primary };
  }
}

/** A role colour on `background`, at body-text contrast (4.5:1). */
export function roleColor(
  color: string | null | undefined,
  background: string,
): string | null {
  const hex = normalizeHex(color);
  if (!hex || hex === "#000000") return null;
  return readableOn(hex, background, 4.5);
}

// src/lib/profile-customization.ts: a stored pair equal to these means
// "no custom colours" (the server writes them as defaults).
const DEFAULT_THEMES = [
  { accent: "#5865F2", background: "#161A22" },
  { accent: "#0B0BE6", background: "#0055FE" },
] as const;

export interface ProfileColors {
  /** The sheet's ground: their background colour, or the app's float. */
  readonly surface: string;
  /** Behind a missing banner. */
  readonly banner: string;
  /** Text on the surface. */
  readonly ink: string;
  readonly ink2: string;
  /** The surface is theirs, not the app's. */
  readonly custom: boolean;
}

/**
 * The profile theme on a phone sheet: their background tints the sheet when
 * the app's ink still reads on it at 4.5:1 (else it is mixed toward the
 * float until it does), and their banner colour fills a missing banner.
 */
export function profileColors(
  user: {
    profile_accent_color?: string | null;
    profile_background_color?: string | null;
    profile_banner_color?: string | null;
  },
  app: { ply3: string; ply2: string; ink1: string; ink2: string },
): ProfileColors {
  const accent = normalizeHex(user.profile_accent_color);
  const background = normalizeHex(user.profile_background_color);
  const banner = normalizeHex(user.profile_banner_color);
  const isDefault = DEFAULT_THEMES.some(
    (d) => d.accent === accent && d.background === background,
  );
  let surface = app.ply3;
  if (background && !isDefault) {
    surface = background;
    for (const step of [0.25, 0.5, 0.75, 1]) {
      if (contrast(app.ink1, surface) >= 4.5) break;
      surface = mixHex(background, app.ply3, step);
    }
  }
  const custom = surface !== app.ply3;
  return {
    surface,
    banner: banner ?? (custom ? mixHex(surface, app.ink1, 0.08) : app.ply2),
    ink: app.ink1,
    ink2: custom ? readableOn(app.ink2, surface, 4.5) : app.ink2,
    custom,
  };
}

/** The collectibles a profile wears, if any this build can show. */
export function parseCollectibles(value: unknown): Collectibles | null {
  const display = decodeLoose(decodeDisplay, value);
  return display?.collectibles ?? null;
}

/** The effect's layers in paint order, from `effects` or bare `effectUrls`. */
export function effectLayers(
  effect: NonNullable<Collectibles["profileEffect"]>,
): { src: string; start: number; duration: number | null }[] {
  const layers = effect.effects?.length
    ? [...effect.effects].sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0))
    : (effect.effectUrls ?? []).map((src) => ({ src }));
  return layers.map((layer) => ({
    src: layer.src,
    start: "start" in layer ? (layer.start ?? 0) : 0,
    duration: "duration" in layer ? (layer.duration ?? null) : null,
  }));
}
