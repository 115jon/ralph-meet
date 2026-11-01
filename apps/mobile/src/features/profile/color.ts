// Colour maths for colours people pick (role colours, profile themes,
// display-name styles), ported from the web's src/lib/profile-customization.ts
// so a name or a tinted sheet reads the same on both: a picked colour is
// kept when it clears the contrast floor, else nudged toward legibility.

const HEX = /^#?(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/** `#RRGGBB` in upper case, or null for anything that is not a hex colour. */
export function normalizeHex(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!HEX.test(trimmed)) return null;
  const hex = trimmed.startsWith("#") ? trimmed.slice(1) : trimmed;
  const full =
    hex.length === 3
      ? hex
          .split("")
          .map((c) => c + c)
          .join("")
      : hex;
  return `#${full.toUpperCase()}`;
}

function channels(hex: string): readonly [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex(r: number, g: number, b: number): string {
  return `#${[r, g, b]
    .map((c) =>
      Math.min(255, Math.max(0, Math.round(c)))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")
    .toUpperCase()}`;
}

/** `base` moved `weight` (0..1) of the way to `target`. */
export function mixHex(base: string, target: string, weight: number): string {
  const [r1, g1, b1] = channels(base);
  const [r2, g2, b2] = channels(target);
  const w = Math.min(1, Math.max(0, weight));
  return toHex(r1 + (r2 - r1) * w, g1 + (g2 - g1) * w, b1 + (b2 - b1) * w);
}

/** `hex` at `alpha` (0..1) as an rgba() string. */
export function withAlpha(hex: string, alpha: number): string {
  const [r, g, b] = channels(hex);
  return `rgba(${r}, ${g}, ${b}, ${Math.min(1, Math.max(0, alpha))})`;
}

export function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((value) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** The web's anchor: near-black on light grounds, near-white on dark ones. */
function anchorFor(background: string): string {
  return luminance(background) > 0.47 ? "#12131A" : "#F8FAFC";
}

/**
 * `desired` if it clears `min` contrast on `background`, else the first
 * step toward the readable anchor that does (the web's
 * pickReadableDisplayNameColor), else the best one tried.
 */
export function readableOn(
  desired: string,
  background: string,
  min: number,
): string {
  const anchor = anchorFor(background);
  const candidates = [
    desired,
    mixHex(desired, anchor, 0.18),
    mixHex(desired, anchor, 0.34),
    mixHex(desired, anchor, 0.52),
    anchor,
  ];
  let best = desired;
  let bestRatio = 0;
  for (const candidate of candidates) {
    const ratio = contrast(candidate, background);
    if (ratio >= min) return candidate;
    if (ratio > bestRatio) {
      best = candidate;
      bestRatio = ratio;
    }
  }
  return best;
}
