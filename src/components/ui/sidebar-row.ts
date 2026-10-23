/**
 * Quiet Pro sidebar list recipe (design-system 12.3): channel, DM and member
 * rows in the 240px desktop sidebars. Literal strings so Tailwind's scanner
 * sees every class.
 *
 * Geometry: the list insets `px-2 py-2`; a row is `h-8` (32) on fine
 * pointers and at least 44 on coarse ones, `px-2 gap-2.5`, `rounded-md`, with
 * a fixed `size-5` icon slot so every label starts on the same edge. Rows
 * with an avatar and a second line use the tall step (`h-10`).
 *
 * State: selected is a tint (`bg-rm-tint-2`), hover a lighter tint on fine
 * pointers only, unread a weight change plus a 2px pill flush with the
 * sidebar edge. Never the legacy `bg-rm-bg-active`/`bg-rm-bg-hover` tokens:
 * the spiderman themes paint those red, so a selected row read as danger.
 */
import { cn } from "@/lib/utils";

/** The scrolling list that holds rows: one inset, rows 2px apart. */
export const SIDEBAR_LIST = "flex flex-col gap-0.5 px-2 py-2";

/** Row geometry and type. Pair with one state below. */
export const SIDEBAR_ROW =
  "group relative flex h-8 w-full min-w-0 items-center gap-2.5 rounded-md px-2 text-left text-ui-base font-medium outline-none select-none [-webkit-tap-highlight-color:transparent] transition-colors duration-150 ease-(--rm-ease-out) pointer-coarse:min-h-11";

/** Rows with an avatar and a status line (DMs, members). */
export const SIDEBAR_ROW_TALL = "h-10";

export const SIDEBAR_ROW_IDLE =
  "text-rm-text-secondary pointer-fine:hover:bg-rm-tint-1 pointer-fine:hover:text-rm-text";

export const SIDEBAR_ROW_SELECTED = "bg-rm-tint-2 text-rm-text";

export const SIDEBAR_ROW_UNREAD = "text-rm-text font-semibold";

/** Fixed leading slot: an `md` (18px) icon centred in 20px. */
export const SIDEBAR_ICON_SLOT =
  "flex size-5 shrink-0 items-center justify-center text-rm-text-muted";

/**
 * Unread pill: 2px wide, flush with the sidebar edge. Rows sit inside the
 * list's 8px inset, so the pill reaches back across it (`-left-2`).
 */
export const SIDEBAR_UNREAD_PILL =
  "pointer-events-none absolute top-1/2 -left-2 h-2 w-0.5 -translate-y-1/2 rounded-r-full bg-rm-text";

/** Category header (eyebrow) above a group of rows. */
export const SIDEBAR_CATEGORY =
  "flex items-center gap-1 px-2 pt-4 pb-1 text-ui-2xs font-semibold uppercase tracking-[0.08em] text-rm-text-muted";

export type SidebarRowOptions = {
  selected?: boolean;
  unread?: boolean;
  /** Avatar + second line rows. */
  tall?: boolean;
  className?: string;
};

/** Class string for one row in its current state. */
export function sidebarRowClass({
  selected = false,
  unread = false,
  tall = false,
  className,
}: SidebarRowOptions = {}) {
  return cn(
    SIDEBAR_ROW,
    tall && SIDEBAR_ROW_TALL,
    selected ? SIDEBAR_ROW_SELECTED : SIDEBAR_ROW_IDLE,
    unread && !selected && SIDEBAR_ROW_UNREAD,
    className,
  );
}

/**
 * Phone list row (12.4): edge-to-edge `px-4`, at least 48px, 40px avatar,
 * primary text `text-ui-base font-medium`. Rows divide inside a tinted group
 * or sit edge-to-edge.
 */
export const PHONE_ROW =
  "group relative flex min-h-12 w-full min-w-0 items-center gap-3 px-4 py-1.5 text-left text-ui-base font-medium text-rm-text outline-none select-none [-webkit-tap-highlight-color:transparent] transition-colors duration-150 ease-(--rm-ease-out) active:bg-rm-tint-2 pointer-fine:hover:bg-rm-tint-1";

/** A tinted group of phone rows separated by hairlines. */
export const PHONE_GROUP =
  "overflow-hidden rounded-lg bg-rm-tint-1 divide-y divide-rm-border";

/** Leading 40px slot for an icon in a phone row, matching avatar rows. */
export const PHONE_ICON_SLOT =
  "flex size-10 shrink-0 items-center justify-center rounded-full bg-rm-tint-2 text-rm-text-secondary";
