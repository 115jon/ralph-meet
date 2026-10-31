/**
 * DitherGlyph: the small still art above an empty state, a picker with
 * nothing in it, the voice landing and the updater (it replaced TreeArt on
 * 2026-10-30). Each motif is a pixel drawing on a cell grid: a structure in
 * `ink-3` silkscreen cells and its light in an accent Bayer dither, the same
 * two inks as the cold-load mark (`chat/ColdLoad`), at 2, 3 or 4px cells.
 *
 *   mark    the Ralph Meet mark, printed through the dither (updater, the
 *           empty chat column, full-screen loaders)
 *   empty   a dashed slot with light pooled in one corner (empty states)
 *   screen  a monitor whose display is lit from the top-left (screen picker)
 *   voice   a still level meter with peak-hold cells (voice landing)
 *
 * `pending` prints the same drawing with its light only partly resolved
 * (about 40 percent coverage; 70 for the mark, whose features are gaps in
 * the silhouette and vanish in a sparser print), as the cold-load mark is
 * before its last step. That is the whole loading signal: nothing moves, ever. The words
 * beside it carry the state (EmptyState sets role=status when loading).
 *
 * Same contract as `ui/dither`: aria-hidden, no pointer events, painted once
 * as alpha masks over role colours (a theme change costs nothing), and gone
 * under forced colours (`.rm-dither`), where the text alone remains.
 */

import * as React from "react";

import splashLogo from "@/assets/splash-logo.svg";
import { bayerLit, cellMask } from "@/components/ui/dither";
import { cn } from "@/lib/utils";

export type GlyphMotif = "mark" | "empty" | "screen" | "voice";
type GlyphSize = "sm" | "md" | "lg";

const CELL: Record<GlyphSize, number> = { sm: 2, md: 3, lg: 4 };

/** How much of the light is printed while `pending`. */
const PENDING = 0.4;
const PENDING_MARK = 0.7;

type Drawing = {
  cols: number;
  rows: number;
  /** Structure cells, printed solid in ink-3. */
  frame?: (x: number, y: number) => boolean;
  /** Light coverage 0-1 per cell, dithered in accent ink. */
  light: (x: number, y: number) => number;
};

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** A monitor: bezel, a lit display inset one cell, a neck and a foot. */
const SCREEN: Drawing = {
  cols: 28,
  rows: 21,
  frame: (x, y) => {
    if (y <= 17) return x === 0 || x === 27 || y === 0 || y === 17;
    if (y <= 19) return x >= 12 && x <= 15;
    return x >= 7 && x <= 20;
  },
  light: (x, y) => {
    if (x < 2 || x > 25 || y < 2 || y > 15) return 0;
    const u = (x - 2) / 23;
    const v = (y - 2) / 13;
    return clamp01(1 - (u * 0.62 + v * 0.38) * 1.15) * 0.95 + 0.04;
  },
};

/** Seven meter bars (two cells wide) over a baseline, each with a peak. */
const BARS = [5, 9, 13, 16, 11, 7, 4] as const;
const VOICE: Drawing = {
  cols: 27,
  rows: 20,
  frame: (x, y) => {
    if (y === 19) return true;
    const i = Math.floor((x - 1) / 4);
    const inBar = x >= 1 && (x - 1) % 4 < 2 && i < BARS.length;
    // Peak hold: one solid cell row two above the bar's top.
    return inBar && y === 17 - BARS[i]! - 1;
  },
  light: (x, y) => {
    const i = Math.floor((x - 1) / 4);
    if (x < 1 || (x - 1) % 4 >= 2 || i >= BARS.length || y > 17) return 0;
    const top = 18 - BARS[i]!;
    if (y < top) return 0;
    // Dense at the floor, thinning toward the bar's top.
    return 0.98 - ((17 - y) / 17) * 0.5;
  },
};

/** A dashed slot with light pooled in its lower-left corner. */
const EMPTY: Drawing = {
  cols: 26,
  rows: 20,
  frame: (x, y) => {
    const edgeX = x === 0 || x === 25;
    const edgeY = y === 0 || y === 19;
    if (!edgeX && !edgeY) return false;
    // Corners stay solid; the runs between them are two on, one off.
    if (edgeX && edgeY) return true;
    const run = edgeY ? x : y;
    return run % 3 !== 0;
  },
  light: (x, y) => {
    if (x < 2 || x > 23 || y < 2 || y > 17) return 0;
    const d = Math.hypot((x - 2) / 21, (17 - y) / 15) / Math.SQRT2;
    return clamp01(1 - d * 1.35) ** 1.4 * 0.95;
  },
};

const DRAWINGS = { screen: SCREEN, voice: VOICE, empty: EMPTY } as const;

/** The mark is the logo's own silhouette over a 32-cell diagonal ramp. */
const MARK_CELLS = 32;
function markLight(x: number, y: number): number {
  const d = (x + y) / (2 * (MARK_CELLS - 1));
  return 0.98 - d * 0.5;
}

const maskCache = new Map<string, string>();
function cachedMask(key: string, build: () => string): string {
  let mask = maskCache.get(key);
  if (!mask) {
    mask = build();
    maskCache.set(key, mask);
  }
  return mask;
}

function layer(
  mask: string,
  colour: string,
  extra?: React.CSSProperties,
): React.CSSProperties {
  return {
    backgroundColor: colour,
    maskImage: mask,
    WebkitMaskImage: mask,
    maskSize: "100% 100%",
    WebkitMaskSize: "100% 100%",
    maskRepeat: "no-repeat",
    WebkitMaskRepeat: "no-repeat",
    ...extra,
  } as React.CSSProperties;
}

type DitherGlyphProps = {
  motif?: GlyphMotif;
  size?: GlyphSize;
  /** Print the light only partly resolved (a pending fetch). Still. */
  pending?: boolean;
  className?: string;
};

function DitherGlyph({
  motif = "empty",
  size = "md",
  pending = false,
  className,
}: DitherGlyphProps) {
  const cell = CELL[size];
  const scale = pending ? (motif === "mark" ? PENDING_MARK : PENDING) : 1;

  if (motif === "mark") {
    const ramp = cachedMask(`mark:${scale}`, () =>
      cellMask(MARK_CELLS, MARK_CELLS, (x, y) =>
        bayerLit(x, y, markLight(x, y) * scale),
      ),
    );
    const logo = `url("${splashLogo}")`;
    const px = MARK_CELLS * cell;
    return (
      <span
        aria-hidden="true"
        data-dither=""
        data-slot="dither-glyph"
        data-motif="mark"
        data-pending={pending ? "" : undefined}
        className={cn("rm-dither relative block shrink-0", className)}
        style={{ width: px, height: px }}
      >
        <span
          className="absolute inset-0"
          style={
            {
              backgroundColor: "var(--accent-ink)",
              maskImage: `${logo}, ${ramp}`,
              WebkitMaskImage: `${logo}, ${ramp}`,
              maskSize: "contain, 100% 100%",
              WebkitMaskSize: "contain, 100% 100%",
              maskPosition: "center, 0 0",
              WebkitMaskPosition: "center, 0 0",
              maskRepeat: "no-repeat",
              WebkitMaskRepeat: "no-repeat",
              maskComposite: "intersect",
              WebkitMaskComposite: "source-in",
            } as React.CSSProperties
          }
        />
      </span>
    );
  }

  const drawing = DRAWINGS[motif];
  const { cols, rows, frame } = drawing;
  const light = cachedMask(`${motif}:light:${scale}`, () =>
    cellMask(cols, rows, (x, y) => bayerLit(x, y, drawing.light(x, y) * scale)),
  );
  const structure = frame
    ? cachedMask(`${motif}:frame`, () => cellMask(cols, rows, frame))
    : null;
  return (
    <span
      aria-hidden="true"
      data-dither=""
      data-slot="dither-glyph"
      data-motif={motif}
      data-pending={pending ? "" : undefined}
      className={cn("rm-dither relative block shrink-0", className)}
      style={{ width: cols * cell, height: rows * cell }}
    >
      {structure ? (
        <span
          className="absolute inset-0"
          style={layer(structure, "var(--ink-3)")}
        />
      ) : null}
      <span
        className="absolute inset-0"
        style={layer(light, "var(--accent-ink)")}
      />
    </span>
  );
}

export { DitherGlyph };
