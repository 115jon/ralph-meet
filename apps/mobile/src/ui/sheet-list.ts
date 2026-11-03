import { createContext, use } from "react";

/** What TrueSheet needs from a list to hand scrolling and drags between them. */
export interface SheetScrollable {
  getScrollableNode(): object | number | null | undefined;
}
export type SheetScrollRef = (node: SheetScrollable | null) => void;

export const SheetScrollContext = createContext<SheetScrollRef | null>(null);

/**
 * For the one list (ScrollView or FlatList) in a `fill` sheet: pass it as the
 * list's `ref` so the native sheet drives it — the list scrolls once the sheet
 * is at full height, pulling down from its top drags the sheet, and the
 * keyboard insets it. Outside a sheet it is undefined.
 */
export function useSheetScroll(): SheetScrollRef | undefined {
  return use(SheetScrollContext) ?? undefined;
}
