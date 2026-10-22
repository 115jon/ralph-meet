/**
 * The dithered field behind Ralph Meet's auth pages. Same system as Kova's
 * hosted pages: a tiny greyscale 2D field (one dominant lit form, a dimmer
 * echo, a ridge, a shadow sweep over deep ground) that ditherwave snaps to a
 * coarse Bayer grid and maps onto a six-step ink ramp.
 *
 * Pure helpers only; the React side lives in components/auth/AuthArtPanel.
 * Colours come from the active theme's `--rm-accent` and `--rm-bg-primary`,
 * so light themes get a light ground with accent-ink cores and dark themes
 * get the inverse.
 */

export type ArtInks = [string, string, string, string, string, string];

export const SOURCE_SIZE = 104;
const STILL_TIME = 11;

export interface ThemeColors {
  accent: string;
  background: string;
}

function channels(hex: string): [number, number, number] {
  const h = hex.slice(1);
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [
    number,
    number,
    number,
  ];
}

function toHex(rgb: [number, number, number]): string {
  return `#${rgb
    .map((v) =>
      Math.max(0, Math.min(255, Math.round(v)))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

/** "#abc" / "#AABBCC" / "rgb(a, b, c)" → "#aabbcc"; anything else → null. */
export function normalizeHex(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  if (/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(v)) {
    const h = v.slice(1).toLowerCase();
    return `#${
      h.length === 3
        ? h
            .split("")
            .map((c) => c + c)
            .join("")
        : h
    }`;
  }
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(v);
  if (rgb) return toHex([+rgb[1]!, +rgb[2]!, +rgb[3]!]);
  return null;
}

export function relativeLuminance(hex: string): number {
  const [r, g, b] = channels(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function mixHex(a: string, b: string, t: number): string {
  const ca = channels(a);
  const cb = channels(b);
  const k = Math.max(0, Math.min(1, t));
  return toHex([
    ca[0] + (cb[0] - ca[0]) * k,
    ca[1] + (cb[1] - ca[1]) * k,
    ca[2] + (cb[2] - ca[2]) * k,
  ]);
}

export function isLightGround(background: string): boolean {
  return relativeLuminance(background) > 0.3;
}

/**
 * Ink ramp indexed by source luminance (index 0 = ground, 5 = the lit core).
 * Dark ground: ground → accent → accent tints. Light ground: ground → accent
 * → accent shades, so the cores stay the darkest, most saturated marks.
 */
export function artInks({ accent, background }: ThemeColors): ArtInks {
  if (isLightGround(background)) {
    return [
      background,
      mixHex(background, accent, 0.22),
      mixHex(background, accent, 0.5),
      accent,
      mixHex(accent, "#000000", 0.22),
      mixHex(accent, "#000000", 0.45),
    ];
  }
  return [
    background,
    mixHex(background, accent, 0.26),
    mixHex(background, accent, 0.58),
    accent,
    mixHex(accent, "#ffffff", 0.3),
    mixHex(accent, "#ffffff", 0.6),
  ];
}

/** Dither cells across the square canvas: 5 CSS px on desktop panels, 4 on the phone band. */
export function cellResolution(cssSize: number): number {
  const cell = cssSize >= 600 ? 5 : 4;
  return Math.max(64, Math.min(256, Math.round(cssSize / cell)));
}

interface Light {
  cx: number;
  cy: number;
  ax: number;
  ay: number;
  wx: number;
  wy: number;
  phase: number;
  r: number;
  a: number;
}

const LIGHTS: Light[] = [
  {
    cx: 0.6,
    cy: 0.36,
    ax: 0.07,
    ay: 0.06,
    wx: 0.12,
    wy: 0.09,
    phase: 0.6,
    r: 0.54,
    a: 0.82,
  },
  {
    cx: 0.26,
    cy: 0.8,
    ax: 0.1,
    ay: 0.06,
    wx: 0.08,
    wy: 0.11,
    phase: 2.4,
    r: 0.36,
    a: 0.5,
  },
];

export function lightPosition(
  light: Light,
  t: number,
  size: number,
): { x: number; y: number } {
  return {
    x: (light.cx + light.ax * Math.sin(t * light.wx + light.phase)) * size,
    y:
      (light.cy + light.ay * Math.cos(t * light.wy + light.phase * 0.7)) * size,
  };
}

function paintRidge(ctx: CanvasRenderingContext2D, size: number, t: number) {
  const angle = -0.62 + 0.06 * Math.sin(t * 0.05);
  const offset = 0.08 * Math.sin(t * 0.07 + 1.1) * size;
  const cx = size * 0.38 + offset;
  const cy = size * 0.66;
  const nx = Math.cos(angle);
  const ny = Math.sin(angle);
  const half = size * 0.95;
  const band = ctx.createLinearGradient(
    cx - nx * half,
    cy - ny * half,
    cx + nx * half,
    cy + ny * half,
  );
  band.addColorStop(0, "rgba(255,255,255,0)");
  band.addColorStop(0.42, "rgba(255,255,255,0)");
  band.addColorStop(0.5, "rgba(255,255,255,0.3)");
  band.addColorStop(0.56, "rgba(255,255,255,0.44)");
  band.addColorStop(0.64, "rgba(255,255,255,0.12)");
  band.addColorStop(0.74, "rgba(255,255,255,0)");
  band.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = band;
  ctx.fillRect(0, 0, size, size);
}

function paintShadow(ctx: CanvasRenderingContext2D, size: number, t: number) {
  const angle = 0.95 + 0.05 * Math.sin(t * 0.06 + 0.8);
  const nx = Math.cos(angle);
  const ny = Math.sin(angle);
  const cx = size * (0.44 + 0.03 * Math.sin(t * 0.08));
  const cy = size * 0.58;
  const half = size * 0.6;
  const band = ctx.createLinearGradient(
    cx - nx * half,
    cy - ny * half,
    cx + nx * half,
    cy + ny * half,
  );
  band.addColorStop(0, "rgba(0,0,0,0)");
  band.addColorStop(0.36, "rgba(0,0,0,0)");
  band.addColorStop(0.5, "rgba(0,0,0,0.82)");
  band.addColorStop(0.62, "rgba(0,0,0,0.5)");
  band.addColorStop(0.8, "rgba(0,0,0,0)");
  band.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = band;
  ctx.fillRect(0, 0, size, size);
}

/** Paints the greyscale field at time t (seconds). The still frame uses STILL_TIME. */
export function paintField(
  ctx: CanvasRenderingContext2D,
  size: number,
  t: number = STILL_TIME,
): void {
  ctx.globalCompositeOperation = "source-over";
  const ground = ctx.createLinearGradient(0, size * 0.2, size, size * 0.8);
  ground.addColorStop(0, "#000000");
  ground.addColorStop(0.55, "#060606");
  ground.addColorStop(1, "#141414");
  ctx.fillStyle = ground;
  ctx.fillRect(0, 0, size, size);

  ctx.globalCompositeOperation = "lighter";
  paintRidge(ctx, size, t);
  for (const light of LIGHTS) {
    const { x, y } = lightPosition(light, t, size);
    const radius = light.r * size;
    const glow = ctx.createRadialGradient(x, y, 0, x, y, radius);
    glow.addColorStop(0, `rgba(255,255,255,${light.a})`);
    glow.addColorStop(0.12, `rgba(255,255,255,${light.a * 0.7})`);
    glow.addColorStop(0.4, `rgba(255,255,255,${light.a * 0.3})`);
    glow.addColorStop(0.75, `rgba(255,255,255,${light.a * 0.06})`);
    glow.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }
  ctx.globalCompositeOperation = "source-over";
  paintShadow(ctx, size, t);
}

/**
 * Resolve any CSS colour (hex, rgb, oklch, color-mix…) to "#rrggbb" by
 * letting a 2D canvas parse it. Returns null when it cannot be parsed.
 */
export function resolveCssColor(
  value: string,
  canvas?: HTMLCanvasElement,
): string | null {
  const direct = normalizeHex(value);
  if (direct) return direct;
  if (typeof document === "undefined") return null;
  const probe = canvas ?? document.createElement("canvas");
  probe.width = 1;
  probe.height = 1;
  const ctx = probe.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.fillStyle = "#000";
  ctx.fillStyle = value;
  ctx.clearRect(0, 0, 1, 1);
  ctx.fillRect(0, 0, 1, 1);
  try {
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    return toHex([r!, g!, b!]);
  } catch {
    return null;
  }
}

/** Theme colours from the document's current `--rm-*` tokens. */
export function readThemeColors(
  element: Element,
  fallback: ThemeColors = { accent: "#5865f2", background: "#070709" },
): ThemeColors {
  if (typeof getComputedStyle !== "function") return fallback;
  const style = getComputedStyle(element);
  const accent = resolveCssColor(style.getPropertyValue("--rm-accent").trim());
  const background = resolveCssColor(
    style.getPropertyValue("--rm-bg-primary").trim(),
  );
  return {
    accent: accent ?? fallback.accent,
    background: background ?? fallback.background,
  };
}
