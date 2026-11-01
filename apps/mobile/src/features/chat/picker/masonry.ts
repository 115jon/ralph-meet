// A GIF grid in columns of uneven tiles: each tile drops into the shortest
// column, so the order reads top to bottom roughly as the server ranked it.
// Positions are absolute, so the grid can draw only the tiles near the
// viewport (and play only the ones in it).

export interface Frame {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface MasonryLayout {
  readonly frames: readonly Frame[];
  readonly height: number;
}

/** Tiles never get flatter or taller than this, whatever the GIF says. */
const MIN_ASPECT = 0.5;
const MAX_ASPECT = 2.4;

export function layoutMasonry(
  aspects: readonly number[],
  width: number,
  columns: number,
  gap: number,
): MasonryLayout {
  const count = Math.max(1, columns);
  const tileWidth = (width - gap * (count - 1)) / count;
  const bottoms = Array.from({ length: count }, () => 0);
  const frames: Frame[] = [];
  for (const raw of aspects) {
    const aspect = Number.isFinite(raw) && raw > 0 ? raw : 1;
    const clamped = Math.min(MAX_ASPECT, Math.max(MIN_ASPECT, aspect));
    let column = 0;
    for (let index = 1; index < count; index++)
      if ((bottoms[index] ?? 0) < (bottoms[column] ?? 0)) column = index;
    const y = bottoms[column] ?? 0;
    const height = Math.round(tileWidth / clamped);
    frames.push({ x: column * (tileWidth + gap), y, width: tileWidth, height });
    bottoms[column] = y + height + gap;
  }
  const height = Math.max(0, Math.max(...bottoms) - gap);
  return { frames, height };
}

/** Indexes of the frames that overlap [top, bottom). */
export function framesBetween(
  frames: readonly Frame[],
  top: number,
  bottom: number,
): number[] {
  const hits: number[] = [];
  frames.forEach((frame, index) => {
    if (frame.y < bottom && frame.y + frame.height > top) hits.push(index);
  });
  return hits;
}
