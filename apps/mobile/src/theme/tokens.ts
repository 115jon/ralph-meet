/**
 * Talk Tree themes, ported from the web app's src/styles/tokens.css. The
 * `INPUTS` table holds the literal values; `buildTheme` derives the role names
 * components use (ply-*, ink-*, tint-*, line*, LED colours). RN has no
 * color-mix(), so every tint is resolved to an rgba string here, once.
 */

export const THEME_IDS = [
  "dark",
  "light",
  "miku-dark",
  "miku-light",
  "spiderman-dark",
  "spiderman-light",
] as const;

export type ThemeId = (typeof THEME_IDS)[number];
export type Scheme = "dark" | "light";

export const THEME_LABELS: Record<ThemeId, string> = {
  dark: "Dark",
  light: "Light",
  "miku-dark": "Miku Dark",
  "miku-light": "Miku Light",
  "spiderman-dark": "Spider-Man Dark",
  "spiderman-light": "Spider-Man Light",
};

interface ThemeInput {
  scheme: Scheme;
  ply: readonly [string, string, string, string, string];
  /** ink-1, ink-2, ink-3, ink-off */
  ink: readonly [string, string, string, string];
  primaryFill: string;
  onPrimary: string;
  accentInk: string;
  brand: string;
  brand2: string;
  shadowRgb: readonly [number, number, number];
}

interface SchemeInput {
  accentTintMix: number;
  shadowAlpha: number;
  lineMix: number;
  lineStrongMix: number;
  lineFieldMix: number;
  guideMix: number;
  scrim: number;
  talk: string;
  onTalk: string;
  live: string;
  dangerFill: string;
  onDanger: string;
  dangerInk: string;
  dangerTintMix: number;
  idle: string;
  badge: string;
  onBadge: string;
}

// LED hues are fixed across colourways; only lightness moves per scheme.
const SCHEMES: Record<Scheme, SchemeInput> = {
  dark: {
    accentTintMix: 16,
    shadowAlpha: 1,
    lineMix: 8,
    lineStrongMix: 14,
    lineFieldMix: 40,
    guideMix: 12,
    scrim: 0.56,
    talk: "#3ddc84",
    onTalk: "#000000",
    live: "#4cc2ff",
    dangerFill: "#d4343a",
    onDanger: "#ffffff",
    dangerInk: "#ff6b6b",
    dangerTintMix: 14,
    idle: "#f5b83d",
    badge: "#d42f33",
    onBadge: "#ffffff",
  },
  light: {
    accentTintMix: 12,
    shadowAlpha: 0.34,
    lineMix: 9,
    lineStrongMix: 16,
    lineFieldMix: 48,
    guideMix: 18,
    scrim: 0.28,
    talk: "#1a9a52",
    onTalk: "#000000",
    live: "#0a7ec2",
    dangerFill: "#c8282e",
    onDanger: "#ffffff",
    dangerInk: "#c4262b",
    dangerTintMix: 10,
    idle: "#a86b0c",
    badge: "#c8282e",
    onBadge: "#ffffff",
  },
};

const INPUTS: Record<ThemeId, ThemeInput> = {
  dark: {
    scheme: "dark",
    ply: ["#000000", "#0b0b0d", "#141417", "#1b1b1f", "#232328"],
    ink: ["#f2f2f3", "#b4b4ba", "#8b8b92", "#55555c"],
    primaryFill: "#f2f2f3",
    onPrimary: "#000000",
    accentInk: "#a5adff",
    brand: "#f2f2f3",
    brand2: "#a5adff",
    shadowRgb: [0, 0, 0],
  },
  light: {
    scheme: "light",
    ply: ["#f4f4f5", "#fafafa", "#ffffff", "#ffffff", "#f0f0f2"],
    ink: ["#0b0b0d", "#4a4a52", "#6b6b73", "#a1a1a8"],
    primaryFill: "#0b0b0d",
    onPrimary: "#ffffff",
    accentInk: "#4a54d4",
    brand: "#0b0b0d",
    brand2: "#4a54d4",
    shadowRgb: [0, 0, 0],
  },
  "miku-dark": {
    scheme: "dark",
    ply: ["#06060b", "#0d0c15", "#15141f", "#1c1b28", "#252433"],
    ink: ["#f1f0f7", "#b6b4c8", "#8e8ba4", "#57546a"],
    primaryFill: "#39c5bb",
    onPrimary: "#06060b",
    accentInk: "#4fd3c8",
    brand: "#39c5bb",
    brand2: "#f872a5",
    shadowRgb: [0, 0, 0],
  },
  "miku-light": {
    scheme: "light",
    ply: ["#f1f3f7", "#f8f9fc", "#ffffff", "#ffffff", "#ebeef4"],
    ink: ["#10132a", "#454a66", "#62667f", "#a0a3b8"],
    primaryFill: "#007a72",
    onPrimary: "#ffffff",
    accentInk: "#00756d",
    brand: "#00a399",
    brand2: "#e04f8a",
    shadowRgb: [16, 19, 42],
  },
  "spiderman-dark": {
    scheme: "dark",
    ply: ["#02030a", "#0a0c16", "#12141f", "#191c28", "#222533"],
    ink: ["#f0f2f8", "#b3b8c9", "#8b91a5", "#545a6e"],
    primaryFill: "#2563eb",
    onPrimary: "#ffffff",
    accentInk: "#7fa8ff",
    brand: "#e50914",
    brand2: "#2563eb",
    shadowRgb: [0, 0, 0],
  },
  "spiderman-light": {
    scheme: "light",
    ply: ["#f2f4f8", "#f9fafc", "#ffffff", "#ffffff", "#ebeef5"],
    ink: ["#0b1020", "#454b5e", "#626879", "#a0a5b5"],
    primaryFill: "#1d4ed8",
    onPrimary: "#ffffff",
    accentInk: "#1d4ed8",
    brand: "#d0101c",
    brand2: "#1d4ed8",
    shadowRgb: [11, 16, 32],
  },
};

/** `hex` (6 digits) at `percent` opacity, as an rgba() string. */
function mix(hex: string, percent: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const alpha = Number((percent / 100).toFixed(3));
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

export interface Theme {
  id: ThemeId;
  scheme: Scheme;
  ply0: string;
  ply1: string;
  ply2: string;
  ply3: string;
  ply4: string;
  ink1: string;
  ink2: string;
  ink3: string;
  inkOff: string;
  tint1: string;
  tint2: string;
  tint3: string;
  line: string;
  lineStrong: string;
  lineField: string;
  guide: string;
  primaryFill: string;
  onPrimary: string;
  accentInk: string;
  accentTint: string;
  talk: string;
  onTalk: string;
  talkTint: string;
  live: string;
  dangerFill: string;
  onDanger: string;
  dangerInk: string;
  dangerTint: string;
  idle: string;
  badge: string;
  onBadge: string;
  brand: string;
  brand2: string;
  scrim: string;
  /** Shadow colour for floats (ply-3 and above) only. */
  shadow: string;
}

function buildTheme(id: ThemeId): Theme {
  const t = INPUTS[id];
  const s = SCHEMES[t.scheme];
  const [ply0, ply1, ply2, ply3, ply4] = t.ply;
  const [ink1, ink2, ink3, inkOff] = t.ink;
  const [r, g, b] = t.shadowRgb;
  return {
    id,
    scheme: t.scheme,
    ply0,
    ply1,
    ply2,
    ply3,
    ply4,
    ink1,
    ink2,
    ink3,
    inkOff,
    tint1: mix(ink1, 6),
    tint2: mix(ink1, 10),
    tint3: mix(ink1, 16),
    line: mix(ink1, s.lineMix),
    lineStrong: mix(ink1, s.lineStrongMix),
    lineField: mix(ink1, s.lineFieldMix),
    guide: mix(ink1, s.guideMix),
    primaryFill: t.primaryFill,
    onPrimary: t.onPrimary,
    accentInk: t.accentInk,
    accentTint: mix(t.accentInk, s.accentTintMix),
    talk: s.talk,
    onTalk: s.onTalk,
    talkTint: mix(s.talk, 14),
    live: s.live,
    dangerFill: s.dangerFill,
    onDanger: s.onDanger,
    dangerInk: s.dangerInk,
    dangerTint: mix(s.dangerInk, s.dangerTintMix),
    idle: s.idle,
    badge: s.badge,
    onBadge: s.onBadge,
    brand: t.brand,
    brand2: t.brand2,
    scrim: `rgba(0, 0, 0, ${s.scrim})`,
    shadow: `rgba(${r}, ${g}, ${b}, ${Number((0.6 * s.shadowAlpha).toFixed(3))})`,
  };
}

export const THEMES: Record<ThemeId, Theme> = Object.fromEntries(
  THEME_IDS.map((id) => [id, buildTheme(id)]),
) as Record<ThemeId, Theme>;

/** Radii shared by every theme: 2px corners, 4px sheet top, square avatars. */
export const RADIUS = 2;
export const SHEET_TOP_RADIUS = 4;
