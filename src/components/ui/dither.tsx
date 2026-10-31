/**
 * In-app dither (DESIGN.md, "Dither in the app"): still Bayer patterns for
 * the three places the panel allows them, a key's trailing cap, the fader
 * range and a dialog/page rule, plus the poster word.
 *
 * Contract, for every export here:
 *   - decorative: `aria-hidden`, `data-dither`, no pointer events;
 *   - still: painted once (a static mask), no rAF, no timer, no loop;
 *   - never under running text (a cap sits after the label, a rule under a
 *     title, never behind one);
 *   - hidden under forced colours (`.rm-dither` in styles/foundation.css).
 *
 * The patterns are alpha masks (SVG data URLs built once per shape) over a
 * `background-color` taken from a role variable, so they follow the theme
 * with no JS and no repaint when it changes. Only `DitherWord` reads colours,
 * because it has to prove both of its inks clear 4.5:1 before it dithers.
 */

import * as React from "react";

import {
  isLightGround,
  mixHex,
  relativeLuminance,
  resolveCssColor,
} from "@/lib/auth-art";
import { useBoxSize } from "@/components/ui/use-dither-geometry";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/* Masks                                                                */
/* ------------------------------------------------------------------ */

const BAYER4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

const BAYER8 = [
  [0, 32, 8, 40, 2, 34, 10, 42],
  [48, 16, 56, 24, 50, 18, 58, 26],
  [12, 44, 4, 36, 14, 46, 6, 38],
  [60, 28, 52, 20, 62, 30, 54, 22],
  [3, 35, 11, 43, 1, 33, 9, 41],
  [51, 19, 59, 27, 49, 17, 57, 25],
  [15, 47, 7, 39, 13, 45, 5, 37],
  [63, 31, 55, 23, 61, 29, 53, 21],
];

function svgMask(width: number, height: number, path: string): string {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${width}' height='${height}' viewBox='0 0 ${width} ${height}' preserveAspectRatio='none' shape-rendering='crispEdges'><path fill='white' d='${path}'/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

/** True when a cell at (`x`, `y`) with `coverage` (0-1) is lit (8x8 Bayer). */
export function bayerLit(x: number, y: number, coverage: number): boolean {
  return coverage * 64 > BAYER8[y % 8]![x % 8]! + 0.5;
}

/**
 * A `cols` x `rows` grid of one-unit cells as a CSS `url()` mask, one cell
 * per `true` from `lit`. Callers cache by shape; this does not.
 */
export function cellMask(
  cols: number,
  rows: number,
  lit: (x: number, y: number) => boolean,
): string {
  let d = "";
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++) if (lit(x, y)) d += `M${x} ${y}h1v1h-1z`;
  return svgMask(cols, rows, d || "M0 0h0z");
}

const tileCache = new Map<number, string>();

/** A 4x4 Bayer tile at `coverage` (0-1), as a CSS `url()` mask. */
function bayerTileMask(coverage: number): string {
  const key = Math.round(coverage * 16);
  const cached = tileCache.get(key);
  if (cached) return cached;
  let d = "";
  for (let y = 0; y < 4; y++)
    for (let x = 0; x < 4; x++)
      if (key > BAYER4[y]![x]!) d += `M${x} ${y}h1v1h-1z`;
  const mask = svgMask(4, 4, d || "M0 0h0z");
  tileCache.set(key, mask);
  return mask;
}

const rampCache = new Map<string, string>();
const RAMP_CACHE_MAX = 48;

/**
 * A ramp of `cols` x `rows` cells whose coverage runs from `from` to `to`
 * left to right (8x8 Bayer). `lift` adds coverage toward the vertical
 * middle, so a rule reads as one row of light rather than a flat band.
 */
function bayerRampMask(
  cols: number,
  rows: number,
  from: number,
  to: number,
  lift = 0,
): string {
  const key = `${cols}:${rows}:${from}:${to}:${lift}`;
  const cached = rampCache.get(key);
  if (cached) return cached;
  let d = "";
  for (let y = 0; y < rows; y++) {
    const v = rows > 1 ? y / (rows - 1) : 0.5;
    const mid = 1 - Math.abs(v - 0.5) * 2;
    for (let x = 0; x < cols; x++) {
      const u = cols > 1 ? x / (cols - 1) : 0;
      // Ease the run so most of the light sits near the leading edge.
      const run = from + (to - from) * (1 - (1 - u) ** 1.6);
      const cov = Math.min(1, Math.max(0, run + lift * mid * run));
      if (cov * 64 > BAYER8[y % 8]![x % 8]! + 0.5) d += `M${x} ${y}h1v1h-1z`;
    }
  }
  const mask = svgMask(cols, rows, d || "M0 0h0z");
  // Rules re-cut as their host resizes; keep only the recent shapes.
  if (rampCache.size >= RAMP_CACHE_MAX)
    rampCache.delete(rampCache.keys().next().value!);
  rampCache.set(key, mask);
  return mask;
}

/** Which role colour a dither is printed in. */
export type DitherInk =
  | "accent"
  | "on-primary"
  | "on-danger"
  | "ink"
  | "ink-3"
  | "ground"
  | "talk";

const INK_VAR: Record<DitherInk, string> = {
  accent: "var(--accent-ink)",
  "on-primary": "var(--on-primary)",
  "on-danger": "var(--on-danger)",
  ink: "var(--ink-1)",
  "ink-3": "var(--ink-3)",
  ground: "var(--ply-0)",
  talk: "var(--talk)",
};

function maskStyle(
  mask: string,
  size: string,
  ink: DitherInk,
  repeat = "repeat",
): React.CSSProperties {
  return {
    backgroundColor: INK_VAR[ink],
    maskImage: mask,
    WebkitMaskImage: mask,
    maskSize: size,
    WebkitMaskSize: size,
    maskRepeat: repeat,
    WebkitMaskRepeat: repeat,
  } as React.CSSProperties;
}

/**
 * The rule's mask for a `width` x `height` box: whole `cell`-px cells from
 * the top-left corner (the last row and column may run past the box and are
 * clipped), so every cell is square.
 */
export function ruleMaskStyle(
  width: number,
  height: number,
  cell: number,
  ink: DitherInk,
): React.CSSProperties {
  const cols = Math.max(8, Math.ceil(width / cell));
  const rows = Math.max(1, Math.ceil(height / cell));
  return {
    ...maskStyle(
      bayerRampMask(cols, rows, 0.95, 0.02, 0.25),
      `${cols * cell}px ${rows * cell}px`,
      ink,
      "no-repeat",
    ),
    maskPosition: "0 0",
    WebkitMaskPosition: "0 0",
  } as React.CSSProperties;
}

/* ------------------------------------------------------------------ */
/* Components                                                           */
/* ------------------------------------------------------------------ */

type DitherDotsProps = {
  ink?: DitherInk;
  /** 0-1. */
  coverage?: number;
  /** CSS px per dither cell. */
  cell?: number;
  className?: string;
  style?: React.CSSProperties;
};

/** A still dithered patch: the key cap, a time-left bar, a tag mark. */
export function DitherDots({
  ink = "accent",
  coverage = 0.5,
  cell = 2,
  className,
  style,
}: DitherDotsProps) {
  return (
    <span
      aria-hidden="true"
      data-dither=""
      className={cn("rm-dither block", className)}
      style={{
        ...maskStyle(
          bayerTileMask(coverage),
          `${cell * 4}px ${cell * 4}px`,
          ink,
        ),
        ...style,
      }}
    />
  );
}

/**
 * The fader range: a left-to-right ramp that gets denser toward the value.
 * Fills its box; the cells stretch with the box, which is the point.
 */
export function DitherRamp({
  ink = "accent",
  from = 0.3,
  to = 1,
  className,
  style,
}: {
  ink?: DitherInk;
  from?: number;
  to?: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <span
      aria-hidden="true"
      data-dither=""
      className={cn("rm-dither block", className)}
      style={{
        ...maskStyle(
          bayerRampMask(64, 4, from, to),
          "100% 100%",
          ink,
          "no-repeat",
        ),
        ...style,
      }}
    />
  );
}

/**
 * The dithered rule: one row of light that runs out from the leading edge.
 * Under a dialog or page title (and the landing headline), never behind
 * text. The host is measured into state (useBoxSize) and the mask is laid
 * out at `cell` px per cell from its top-left corner, so cells stay square
 * at any width or height; it is re-cut when the host resizes.
 */
export function DitherRule({
  className,
  cell = 2,
  ink = "accent",
}: {
  className?: string;
  cell?: number;
  ink?: DitherInk;
}) {
  const ref = React.useRef<HTMLSpanElement>(null);
  const size = useBoxSize(ref);
  const style = React.useMemo(
    () =>
      size ? ruleMaskStyle(size.width, size.height, cell, ink) : undefined,
    [size, cell, ink],
  );
  return (
    <span
      ref={ref}
      aria-hidden="true"
      data-dither=""
      data-slot="dither-rule"
      className={cn("rm-dither block h-2", className)}
      style={style}
    />
  );
}

/* ------------------------------------------------------------------ */
/* DitherWord: the poster dialog's last word                            */
/* ------------------------------------------------------------------ */

type WordGround = "ply-0" | "ply-1" | "ply-2" | "ply-3";
const WORD_GROUNDS: WordGround[] = ["ply-0", "ply-1", "ply-2", "ply-3"];
type WordRoles = { accent: string; grounds: Record<WordGround, string | null> };

function readWordRoles(): WordRoles | null {
  if (typeof document === "undefined") return null;
  const s = getComputedStyle(document.documentElement);
  const accent = resolveCssColor(s.getPropertyValue("--accent-ink").trim());
  if (!accent) return null;
  const grounds = {} as Record<WordGround, string | null>;
  for (const g of WORD_GROUNDS)
    grounds[g] = resolveCssColor(s.getPropertyValue(`--${g}`).trim());
  return { accent, grounds };
}

const sameRoles = (a: WordRoles | null, b: WordRoles | null) =>
  a?.accent === b?.accent &&
  WORD_GROUNDS.every((g) => a?.grounds[g] === b?.grounds[g]);

let roles: WordRoles | null = null;
const listeners = new Set<() => void>();
let observer: MutationObserver | null = null;

function subscribeRoles(listener: () => void) {
  listeners.add(listener);
  if (!observer && typeof MutationObserver !== "undefined") {
    roles = readWordRoles();
    observer = new MutationObserver(() => {
      const next = readWordRoles();
      if (sameRoles(next, roles)) return;
      roles = next;
      listeners.forEach((l) => l());
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style", "data-theme"],
    });
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      observer?.disconnect();
      observer = null;
    }
  };
}

const getRoles = () => roles;
const getServerRoles = () => null;

function contrast(a: string, b: string) {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort(
    (x, y) => y - x,
  ) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const TEX_W = 192;
const TEX_H = 64;
const wordCache = new Map<string, string | null>();

function wordTexture(a: string, b: string): string | null {
  const key = `${a}:${b}`;
  if (wordCache.has(key)) return wordCache.get(key)!;
  const canvas = document.createElement("canvas");
  canvas.width = TEX_W;
  canvas.height = TEX_H;
  const ctx = canvas.getContext("2d");
  let url: string | null = null;
  if (ctx) {
    for (let y = 0; y < TEX_H; y++)
      for (let x = 0; x < TEX_W; x++) {
        const u = x / TEX_W;
        const v = y / TEX_H;
        const core = Math.exp(-((u - 0.3) ** 2 * 9 + (v - 0.35) ** 2 * 6));
        const field = 0.1 + 0.5 * (1 - u) * (1 - v * 0.6) + 0.45 * core;
        ctx.fillStyle = field > (BAYER8[y % 8]![x % 8]! + 0.5) / 64 ? b : a;
        ctx.fillRect(x, y, 1, 1);
      }
    url = canvas.toDataURL("image/png");
  }
  wordCache.set(key, url);
  return url;
}

/**
 * A display word printed in two accent inks through an 8x8 Bayer field
 * (C2 poster dialogs: device approval, first run; the landing headline and
 * section numerals). Both inks must clear 4.5:1 on `ground` (the ply the
 * word sits on; the float by default) or the word stays solid accent; under
 * forced colours it is plain CanvasText. Painted once per theme.
 */
export function DitherWord({
  children,
  cell = 3,
  ground: groundPly = "ply-3",
  className,
}: {
  children: React.ReactNode;
  cell?: number;
  ground?: WordGround;
  className?: string;
}) {
  const current = React.useSyncExternalStore(
    subscribeRoles,
    getRoles,
    getServerRoles,
  );
  const url = React.useMemo(() => {
    const ground = current?.grounds[groundPly];
    if (!current || !ground) return null;
    const { accent } = current;
    const deep = isLightGround(ground)
      ? mixHex(accent, "#000000", 0.42)
      : mixHex(accent, "#ffffff", 0.62);
    if (contrast(accent, ground) < 4.5 || contrast(deep, ground) < 4.5)
      return null;
    return wordTexture(accent, deep);
  }, [current, groundPly]);
  return (
    <span
      data-slot="dither-word"
      className={cn(
        "text-accent-ink forced-colors:bg-none! forced-colors:text-[CanvasText]!",
        className,
      )}
      style={
        url
          ? {
              backgroundImage: `url(${url})`,
              backgroundSize: `${TEX_W * cell}px ${TEX_H * cell}px`,
              backgroundRepeat: "repeat",
              imageRendering: "pixelated",
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
              color: "transparent",
            }
          : undefined
      }
    >
      {children}
    </span>
  );
}
