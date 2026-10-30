/** Height of an inline day divider row (matches `message-row-height.ts`). */
export const DAY_DIVIDER_HEIGHT_PX = 32;

/**
 * Whether the pinned day label should show. It appears only once the inline
 * divider for the current day has scrolled above the scroller's top edge;
 * while that divider is still visible the sticky label stays hidden, so the
 * same day never renders twice.
 *
 * `scrollOffset` is the scroller offset, `startMargin` the space above the
 * virtualiser (list header), `rowTop` the topmost row's item-space offset.
 * Pure so it can be tested without a virtualiser.
 */
export function isStickyDayVisible(args: {
  scrollOffset: number;
  startMargin: number;
  rowTop: number;
  rowHasDivider: boolean;
}): boolean {
  if (!args.rowHasDivider) return true;
  const dividerBottom = args.startMargin + args.rowTop + DAY_DIVIDER_HEIGHT_PX;
  return args.scrollOffset >= dividerBottom;
}
