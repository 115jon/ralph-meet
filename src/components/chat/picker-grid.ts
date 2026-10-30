/**
 * Shared picker grid recipes (emoji, GIF, soundboard): one width, the whole
 * cell, the drawn selection ring, and arrow-key movement between cells.
 */

import type * as React from "react";

import { cn } from "@/lib/utils";

/**
 * One width for every composer picker (emoji, GIF, soundboard): 420 fits a
 * 9-column emoji grid beside a 40px category rail, two GIF columns and four
 * sound cells, and leaves the composer's send button uncovered at 1280.
 */
export const PICKER_WIDTH = 420;
export const PICKER_WIDTH_CLASS = "w-[min(420px,calc(100vw-24px))]";

/**
 * The selected or keyboard-active cell: a 2px ring drawn inside the cell in
 * --focus (accent ink). Cells pack edge to edge, so the ring is inset rather
 * than offset (an offset ring would sit on the neighbours). An outline paints
 * above the cell's own media, so it also works on GIF and image cells.
 */
export const PICKER_RING =
  "outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus data-selected:outline-2 data-selected:-outline-offset-2 data-selected:outline-focus";

/**
 * A whole-cell grid target: the cell is the hit area. Hover is an ink tint,
 * press a deeper tint; no scale (pickers are high-frequency surfaces).
 */
export const PICKER_CELL = cn(
  "relative select-none [-webkit-tap-highlight-color:transparent] transition-[background-color] duration-(--dur-1) ease-out pointer-fine:hover:bg-tint-2 active:bg-tint-3 disabled:cursor-default disabled:active:bg-transparent",
  PICKER_RING,
);

/** Marks a grid cell for `handlePickerGridKeyDown`. */
export const PICKER_CELL_ATTR = "data-picker-cell";

type CellBox = { el: HTMLElement; rect: DOMRect; cx: number; cy: number };

/**
 * Arrow-key movement between `[data-picker-cell]` targets inside `container`,
 * by geometry, so it works for row grids (emoji, sounds) and masonry columns
 * (GIFs) alike. Left/Right fall back to DOM order at a row's edge, so the
 * keys wrap; Up/Down pick the nearest cell in that direction, preferring the
 * same column. Home/End jump to the first and last cell.
 */
export function handlePickerGridKeyDown(
  event: React.KeyboardEvent<HTMLElement>,
) {
  const { key } = event;
  if (
    key !== "ArrowLeft" &&
    key !== "ArrowRight" &&
    key !== "ArrowUp" &&
    key !== "ArrowDown" &&
    key !== "Home" &&
    key !== "End"
  ) {
    return;
  }
  const active = document.activeElement;
  if (
    !(active instanceof HTMLElement) ||
    !active.hasAttribute(PICKER_CELL_ATTR)
  )
    return;
  const cells = Array.from(
    event.currentTarget.querySelectorAll<HTMLElement>(`[${PICKER_CELL_ATTR}]`),
  ).filter((el) => !(el as HTMLButtonElement).disabled);
  const index = cells.indexOf(active);
  if (index < 0) return;

  let next: HTMLElement | undefined;
  if (key === "Home") next = cells[0];
  else if (key === "End") next = cells[cells.length - 1];
  else {
    const boxes: CellBox[] = cells.map((el) => {
      const rect = el.getBoundingClientRect();
      return {
        el,
        rect,
        cx: rect.left + rect.width / 2,
        cy: rect.top + rect.height / 2,
      };
    });
    const current = boxes[index]!;
    const r = current.rect;
    let best: { el: HTMLElement; score: number } | null = null;
    for (const box of boxes) {
      if (box.el === active || box.rect.width === 0) continue;
      let along = 0;
      let across = 0;
      if (key === "ArrowDown") {
        if (box.rect.top < r.bottom - 2) continue;
        along = box.rect.top - r.bottom;
        across = Math.abs(box.cx - current.cx);
      } else if (key === "ArrowUp") {
        if (box.rect.bottom > r.top + 2) continue;
        along = r.top - box.rect.bottom;
        across = Math.abs(box.cx - current.cx);
      } else if (key === "ArrowRight") {
        if (
          box.rect.left < r.right - 2 ||
          Math.abs(box.cy - current.cy) > r.height / 2
        )
          continue;
        along = box.rect.left - r.right;
      } else {
        if (
          box.rect.right > r.left + 2 ||
          Math.abs(box.cy - current.cy) > r.height / 2
        )
          continue;
        along = r.left - box.rect.right;
      }
      // Same column first, then the nearest row.
      const score = across * 4 + along;
      if (!best || score < best.score) best = { el: box.el, score };
    }
    next =
      best?.el ??
      (key === "ArrowRight" || key === "ArrowDown"
        ? cells[index + 1]
        : cells[index - 1]);
  }
  if (!next) return;
  event.preventDefault();
  next.focus({ preventScroll: true });
  next.scrollIntoView({ block: "nearest" });
}

// The last input decides how a picker opens: a keyboard-initiated open never
// scales (talk-tree-spec §6). One pair of capture listeners for the app.
let lastInputWasKeyboard = false;

export function getLastInputWasKeyboard() {
  return lastInputWasKeyboard;
}
if (typeof document !== "undefined") {
  document.addEventListener(
    "keydown",
    (event) => {
      if (!event.metaKey && !event.ctrlKey && !event.altKey)
        lastInputWasKeyboard = true;
    },
    true,
  );
  document.addEventListener(
    "pointerdown",
    () => {
      lastInputWasKeyboard = false;
    },
    true,
  );
}
