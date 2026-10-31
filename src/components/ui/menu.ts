/**
 * C1 panel menu (DESIGN.md, Menus), shared by DropdownMenu, Select, the
 * hand-rolled context menus and popover menus.
 *
 *   panel  2px corners, p-1, ply-3, a line-strong edge with a 2px ink-1 top
 *          rule, shadow-float; width 200..280
 *   row    36 high (44 on coarse pointers), 2px corners, px-3, gap 12,
 *          Geist 14 500, a fixed 16px icon column in ink-2
 *   label  silkscreen title row, 32 high, ink-3
 *   hint   Martian 11 in ink-3, right-aligned (an outline key cap when it is
 *          a <Kbd>); toggle rows carry an LED in the hint slot
 *
 * Highlight is a neutral ink tint (tint-2) and changes instantly: menus are
 * high-frequency surfaces. Danger rows tint their own ink.
 */

/** Floating panel. Base UI popups add `rm-presence` for the open motion. */
export const MENU_PANEL =
  "rounded-[2px] border border-line-strong border-t-2 border-t-ink-1 bg-ply-3 p-1 text-ink-1 shadow-float overscroll-contain [&_[data-slot=kbd]]:border [&_[data-slot=kbd]]:border-line-strong [&_[data-slot=kbd]]:border-b [&_[data-slot=kbd]]:bg-transparent [&_[data-slot=kbd]]:text-ink-2";

/** Row geometry and ink. Pair with one highlight below. */
export const MENU_ITEM =
  "group flex min-h-9 pointer-coarse:min-h-11 w-full items-center gap-3 rounded-[2px] px-3 py-1.5 text-left text-ui-row font-medium outline-none select-none disabled:cursor-default disabled:opacity-45 aria-disabled:cursor-default aria-disabled:opacity-45";

export const MENU_ITEM_DEFAULT =
  "text-ink-1 pointer-fine:hover:enabled:bg-tint-2 focus-visible:bg-tint-2";
export const MENU_ITEM_DEFAULT_ON = "bg-tint-2 text-ink-1";

export const MENU_ITEM_DANGER =
  "text-danger-ink pointer-fine:hover:enabled:bg-danger-tint focus-visible:bg-danger-tint";

/** Leading icon: ink-2 in the neutral row, inherits ink on hover and in danger rows. */
export const MENU_ICON =
  "flex size-4 shrink-0 items-center justify-center text-ink-2 pointer-fine:group-hover:text-current group-data-highlighted:text-current [&_svg]:size-4";

/** Trailing hint (shortcut, value): Martian 11 in ink-3. */
export const MENU_HINT = "ms-auto shrink-0 pl-3 text-num-xs text-ink-3";

export const MENU_SEPARATOR = "-mx-1 my-1 h-px shrink-0 bg-line";

/** Title / group label: a silkscreen row in ink-3. */
export const MENU_LABEL =
  "silkscreen flex min-h-8 items-center px-3 text-ink-3";
