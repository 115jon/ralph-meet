/**
 * Quiet Pro menu recipe, shared by the hand-rolled context menus and popover
 * menus. The highlight is tonal (a neutral tint mixed from the text colour),
 * never a solid accent fill, so the one solid fill on screen stays the
 * primary action. Danger and warning items tint their own ink.
 *
 * Highlight changes are instant: menus are high-frequency surfaces.
 */

/** Floating panel: radius 10, surface, the one place a shadow appears. */
export const MENU_PANEL =
  "rounded-[10px] border border-rm-border bg-rm-bg-surface p-1 shadow-[var(--rm-shadow-2)] dark:bg-rm-bg-elevated overscroll-contain";

/** Row geometry and ink. Pair with one highlight below. */
export const MENU_ITEM =
  "group flex min-h-8 pointer-coarse:min-h-11 w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-ui-sm font-medium outline-none select-none disabled:cursor-default disabled:opacity-45 aria-disabled:cursor-default aria-disabled:opacity-45";

export const MENU_ITEM_DEFAULT =
  "text-rm-text pointer-fine:hover:enabled:bg-rm-tint-2 focus-visible:bg-rm-tint-2";
export const MENU_ITEM_DEFAULT_ON = "bg-rm-tint-2 text-rm-text";

export const MENU_ITEM_DANGER =
  "text-rm-danger-ink pointer-fine:hover:enabled:bg-rm-danger-tint focus-visible:bg-rm-danger-tint";
export const MENU_ITEM_DANGER_ON = "bg-rm-danger-tint text-rm-danger-ink";

export const MENU_ITEM_WARNING =
  "text-rm-warning-ink pointer-fine:hover:enabled:bg-[color-mix(in_oklab,var(--rm-warning-ink)_14%,transparent)] focus-visible:bg-[color-mix(in_oklab,var(--rm-warning-ink)_14%,transparent)]";
export const MENU_ITEM_WARNING_ON =
  "bg-[color-mix(in_oklab,var(--rm-warning-ink)_14%,transparent)] text-rm-warning-ink";

/** Leading icon: subdued in the neutral row, inherits ink in danger rows. */
export const MENU_ICON = "shrink-0 text-rm-text-muted group-hover:text-current";

export const MENU_SEPARATOR = "-mx-1 my-1 h-px shrink-0 bg-rm-border";

export const MENU_LABEL =
  "px-2 pt-1.5 pb-1 text-ui-xs font-medium text-rm-text-muted";
