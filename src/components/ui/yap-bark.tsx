/**
 * YapBark: Yappy, the Yap mark, printed on a 32-cell grid through the
 * accent dither, barking while something loads.
 *
 * The drawing is the master icon's geometry (branding/yappy-master.svg,
 * drawn on the same 32-unit grid): ear, skull, snout, neck and a lower jaw,
 * with the eye, nose and inner ear cut out. The jaw has three frames,
 * closed, half and open (the master pose), and two short "yap" ticks
 * show beside the open mouth.
 *
 * At rest it is one still frame, the open jaw of the icon. With `barking`
 * the jaw steps closed, half, open, half twice ("yap yap"), then rests
 * shut, on a stepped timeline (no easing; motion.css `rm-bark`). It barks
 * only while its caller is loading, and stops for reduced motion (the
 * still frame stays). Same contract as `ui/dither`: aria-hidden, no
 * pointer events, alpha masks over the accent role colour, and gone under
 * forced colours (`.rm-dither`), where the words beside it carry the state.
 */

import * as React from "react";

import { bayerLit, cellMask } from "@/components/ui/dither";
import { cn } from "@/lib/utils";

export const YAP_CELLS = 32;

type Cell = (x: number, y: number) => boolean;

const rect =
  (x0: number, y0: number, w: number, h: number): Cell =>
  (x, y) =>
    x >= x0 && x < x0 + w && y >= y0 && y < y0 + h;

// The master's polygons, sampled at cell centres.
const ear: Cell = (x, y) => x >= 2 && y < 10 && x < y + 2;
const innerEar: Cell = (x, y) => x >= 4 && y >= 5 && y < 9 && x < y - 1;
const skull = rect(2, 10, 19, 14);
const snout = rect(21, 12, 11, 7);
const neck = rect(4, 24, 14, 8);
const eye = rect(13, 13, 4, 4);
const nose = rect(29, 12, 3, 3);

/** The lower jaw per frame: it rises and lengthens as it shuts. */
const JAW = {
  closed: rect(17, 19, 13, 4),
  half: rect(17, 20, 12, 4),
  open: rect(17, 22, 11, 4),
} as const;

/** Two 45-degree ticks off the snout and the jaw tip. */
const TICK_CELLS = [
  [29, 10],
  [30, 9],
  [31, 8],
  [29, 28],
  [30, 29],
  [31, 30],
] as const;
const ticks: Cell = (x, y) =>
  TICK_CELLS.some(([tx, ty]) => tx === x && ty === y);

const cutout: Cell = (x, y) => innerEar(x, y) || eye(x, y) || nose(x, y);

/** The head and neck without the jaw, features cut out. */
const yapBody: Cell = (x, y) =>
  (ear(x, y) || skull(x, y) || snout(x, y) || neck(x, y)) && !cutout(x, y);

/** Light across the mark: dense at the ear, thinning toward the jaw tip. */
function light(x: number, y: number): number {
  const d = (x + y) / (2 * (YAP_CELLS - 1));
  return 0.98 - d * 0.3;
}

const lit =
  (region: Cell): Cell =>
  (x, y) =>
    region(x, y) && !cutout(x, y) && bayerLit(x, y, light(x, y));

const masks = new Map<string, string>();
function mask(key: string, build: () => Cell): string {
  let m = masks.get(key);
  if (!m) {
    m = cellMask(YAP_CELLS, YAP_CELLS, build());
    masks.set(key, m);
  }
  return m;
}

const LAYERS = [
  ["body", () => lit(yapBody)],
  ["closed", () => lit(JAW.closed)],
  ["half", () => lit(JAW.half)],
  ["open", () => lit(JAW.open)],
  ["ticks", () => ticks],
] as const;

type YapBarkProps = {
  /** Bark (a stepped loop) while true; a still frame otherwise. */
  barking?: boolean;
  /** Cell size in px. Without it the mark fills its box. */
  cell?: number;
  className?: string;
};

function YapBark({ barking = false, cell, className }: YapBarkProps) {
  const px = cell ? YAP_CELLS * cell : undefined;
  return (
    <span
      aria-hidden="true"
      data-dither=""
      data-slot="yap-bark"
      data-barking={barking ? "" : undefined}
      className={cn(
        "rm-dither rm-bark relative block shrink-0",
        !px && "aspect-square w-full",
        className,
      )}
      style={px ? { width: px, height: px } : undefined}
    >
      {LAYERS.map(([part, cells]) => {
        const m = mask(part, cells);
        return (
          <span
            key={part}
            data-part={part}
            className="absolute inset-0"
            style={
              {
                backgroundColor: "var(--accent-ink)",
                maskImage: m,
                WebkitMaskImage: m,
                maskSize: "100% 100%",
                WebkitMaskSize: "100% 100%",
                maskRepeat: "no-repeat",
                WebkitMaskRepeat: "no-repeat",
              } as React.CSSProperties
            }
          />
        );
      })}
    </span>
  );
}

export { YapBark };
