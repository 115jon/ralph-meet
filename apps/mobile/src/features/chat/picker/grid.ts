// The emoji grid as flat list rows: a label row per section, then rows of
// whole cells. Every row has a known height, so the list can jump to a
// section and say which one is on top without measuring anything.

/** One emoji the grid can pick. */
export interface EmojiCell {
  readonly key: string;
  /** What is inserted or reacted with: a glyph or `<:name:id>`. */
  readonly value: string;
  readonly label: string;
  /** Every skin-tone glyph, when the emoji takes tones (long-press). */
  readonly tones?: readonly string[];
}

export interface GridSection {
  readonly id: string;
  readonly label: string;
  /** Shown beside the label (Your creations). */
  readonly count?: number;
  readonly cells: readonly EmojiCell[];
}

export type GridRow =
  | {
      readonly kind: "label";
      readonly key: string;
      readonly section: string;
      readonly label: string;
      readonly count?: number;
    }
  | {
      readonly kind: "cells";
      readonly key: string;
      readonly section: string;
      readonly cells: readonly EmojiCell[];
    };

export interface GridLayout {
  readonly rows: readonly GridRow[];
  /** Top of each row, px. */
  readonly offsets: readonly number[];
  readonly heights: readonly number[];
  /** Section id → the top of its label row. */
  readonly sectionTops: ReadonlyMap<string, number>;
}

export function layoutGrid(
  sections: readonly GridSection[],
  columns: number,
  cellSize: number,
  labelHeight: number,
): GridLayout {
  const rows: GridRow[] = [];
  const offsets: number[] = [];
  const heights: number[] = [];
  const sectionTops = new Map<string, number>();
  let top = 0;
  const push = (row: GridRow, height: number) => {
    rows.push(row);
    offsets.push(top);
    heights.push(height);
    top += height;
  };
  for (const section of sections) {
    if (section.cells.length === 0) continue;
    sectionTops.set(section.id, top);
    if (section.label)
      push(
        {
          kind: "label",
          key: `label-${section.id}`,
          section: section.id,
          label: section.label,
          count: section.count,
        },
        labelHeight,
      );
    for (let start = 0; start < section.cells.length; start += columns) {
      push(
        {
          kind: "cells",
          key: `${section.id}-${start}`,
          section: section.id,
          cells: section.cells.slice(start, start + columns),
        },
        cellSize,
      );
    }
  }
  return { rows, offsets, heights, sectionTops };
}

/** The section whose rows are at the top of the viewport at `scrollY`. */
export function sectionAt(layout: GridLayout, scrollY: number): string | null {
  const { offsets, rows } = layout;
  if (rows.length === 0) return null;
  // The last row starting at or above the top edge (plus a pixel of slack).
  let low = 0;
  let high = offsets.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if ((offsets[mid] ?? 0) <= scrollY + 1) low = mid;
    else high = mid - 1;
  }
  return rows[low]?.section ?? null;
}

/** Whole cells of at least `minCell` px across `width`, stretched to fill it. */
export function gridColumns(width: number, minCell: number): number {
  return Math.max(1, Math.floor(width / minCell));
}
