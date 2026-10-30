/**
 * Stage grid sizing (talk-tree-spec §3: "fit the grid to the viewport
 * height; nine tiles fit at 1280×720 without scrolling; 8px gaps").
 *
 * `fitGrid` picks the column count that gives the largest 16:9 tile that
 * fits BOTH the width and the height of the stage box. Below the minimum
 * tile width the grid stops shrinking and scrolls instead.
 */
export const GRID_GAP = 8;
export const MIN_TILE_W = 200;
/** One person alone gets a modest tile, not a 1000px wall. */
export const SOLO_MAX_TILE_W = 640;

/**
 * Phone calls: below this stage width, 2–4 people fill the stage's height.
 * Two people stack in one column, three or four sit in a 2×2 grid, and the
 * tiles take whatever shape the stage gives them (8px gaps), instead of a
 * width-sized grid floating in an empty stage.
 */
export const PHONE_GRID_MAX_W = 560;

export type TileAspect = "video" | "fill";

export interface GridFit {
  cols: number;
  tileW: number;
  /** Fixed row height for `fill` tiles; 16:9 tiles size from their width. */
  tileH?: number;
  /** True when even the minimum tile can't fit the height: the grid scrolls. */
  scrolls: boolean;
  /** 16:9 (`video`), or `fill`: small calls on a phone fill the stage. */
  aspect: TileAspect;
}

/** Whether a call this size, on a stage this wide, fills the stage. */
export function usesPhoneFill(width: number, count: number): boolean {
  return width > 0 && width < PHONE_GRID_MAX_W && count >= 2 && count <= 4;
}

export function fitGrid(
  width: number,
  height: number,
  count: number,
  gap = GRID_GAP,
): GridFit {
  const n = Math.max(1, count);
  if (width <= 0 || height <= 0) {
    return {
      cols: Math.min(n, 2),
      tileW: MIN_TILE_W,
      scrolls: false,
      aspect: "video",
    };
  }
  if (usesPhoneFill(width, n)) {
    // Fit by height: the rows share the stage's height, the columns its
    // width. Never scrolls: two rows always hold a usable tile.
    const cols = n === 2 ? 1 : 2;
    const rows = Math.ceil(n / cols);
    const tileW = Math.max(0, Math.floor((width - (cols - 1) * gap) / cols));
    const tileH = Math.max(0, Math.floor((height - (rows - 1) * gap) / rows));
    return { cols, tileW, tileH, scrolls: false, aspect: "fill" };
  }
  let best: GridFit = { cols: 1, tileW: 0, scrolls: false, aspect: "video" };
  for (let cols = 1; cols <= n; cols += 1) {
    const rows = Math.ceil(n / cols);
    const byWidth = (width - (cols - 1) * gap) / cols;
    const byHeight = ((height - (rows - 1) * gap) / rows) * (16 / 9);
    const tileW = Math.floor(Math.min(byWidth, byHeight));
    if (tileW > best.tileW) {
      best = { cols, tileW, scrolls: false, aspect: "video" };
    }
  }
  if (n === 1) {
    best.tileW = Math.min(best.tileW, SOLO_MAX_TILE_W);
  }
  if (best.tileW < MIN_TILE_W) {
    // Too many people for the box: keep tiles legible and scroll.
    const cols = Math.max(
      1,
      Math.min(n, Math.floor((width + gap) / (MIN_TILE_W + gap))),
    );
    const tileW = Math.floor((width - (cols - 1) * gap) / cols);
    return { cols, tileW: Math.max(tileW, 0), scrolls: true, aspect: "video" };
  }
  return best;
}

/**
 * Server render / first paint before the stage is measured: columns from
 * the stage's own width (a container query), capped by the head count.
 */
export function gridColumnsClass(count: number): string {
  if (count <= 1) return "grid-cols-1 mx-auto max-w-[640px]";
  // 2–4 are two columns at every width (on a phone, two people stack), so
  // the first paint matches the measured fit.
  if (count === 2) return "grid-cols-1 @min-[560px]:grid-cols-2";
  if (count <= 4) return "grid-cols-2";
  if (count <= 9)
    return "grid-cols-1 @min-[560px]:grid-cols-2 @min-[800px]:grid-cols-3";
  if (count <= 16)
    return "grid-cols-2 @min-[720px]:grid-cols-3 @min-[1200px]:grid-cols-4";
  return "grid-cols-2 @min-[720px]:grid-cols-3 @min-[1000px]:grid-cols-4 @min-[1280px]:grid-cols-5 @min-[1536px]:grid-cols-6";
}

/**
 * Tile aspect class. `fill` tiles drop the 16:9 ratio and take the row's
 * height. Before the first measurement a container query picks 3:4 below
 * 560px for 3–4 people (two stacked people stay 16:9), close to what
 * `fitGrid` will choose.
 */
export function tileAspectClass(
  fit: GridFit | null,
  count: number,
): string | undefined {
  if (fit) return fit.aspect === "fill" ? "aspect-auto" : undefined;
  return count >= 3 && count <= 4 ? "@max-[559px]:aspect-3/4" : undefined;
}
