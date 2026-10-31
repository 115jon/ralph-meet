/**
 * Talk Tree list recipes (DESIGN.md, Navigation). Literal strings so
 * Tailwind's scanner sees every class.
 *
 *   tree channel row   32 high, px-2, 16px icon, gap 8, Geist 14 500
 *   tree occupant row  28 high, 24px square avatar, 13px, LED node on the
 *                      guide (pair with <TreeLeaf>, which draws the guides)
 *   member / DM row    32 high (40 with a status line, 32px avatar)
 *
 * State is an ink tint, never a hue: hover tint-1, selected tint-2. Unread is
 * ink-1 at 600; read rows are ink-2 at 500. Hover actions overlay the row's
 * trailing edge (REVEAL in interaction.ts) instead of reserving space.
 */
import { cn } from "@/lib/utils";

/** The scrolling list that holds rows: one inset, rows 2px apart. */
export const SIDEBAR_LIST = "flex flex-col gap-0.5 px-2 py-2";

/** Member / DM row geometry and type (32). Pair with one state below. */
export const SIDEBAR_ROW =
  "group relative flex h-8 w-full min-w-0 items-center gap-2 rounded-sm px-2 text-left text-ui-row font-medium outline-none select-none [-webkit-tap-highlight-color:transparent] transition-colors duration-(--dur-1) ease-out pointer-coarse:min-h-11";

/** Rows with an avatar and a status line (DMs, members). */
const SIDEBAR_ROW_TALL = "h-10";

export const SIDEBAR_ROW_IDLE =
  "text-ink-2 pointer-fine:hover:bg-tint-1 pointer-fine:hover:text-ink-1";

export const SIDEBAR_ROW_SELECTED = "bg-tint-2 text-ink-1";

const SIDEBAR_ROW_UNREAD = "text-ink-1 font-semibold";

/** Fixed leading slot: a 16px icon centred in 20px, ink-3. */
export const SIDEBAR_ICON_SLOT =
  "flex size-5 shrink-0 items-center justify-center text-ink-3 [&_svg]:size-4";

/**
 * Unread pill: 2px wide, flush with the panel edge. Rows sit inside the
 * list's 8px inset, so the pill reaches back across it (`-left-2`).
 */
export const SIDEBAR_UNREAD_PILL =
  "pointer-events-none absolute top-1/2 -left-2 h-2 w-0.5 -translate-y-1/2 bg-ink-1";

/** Tree branch (category) label: silkscreen, ink-3, with room for a chevron. */
export const SIDEBAR_CATEGORY =
  "silkscreen flex items-center gap-1 px-2 pt-4 pb-1 text-ink-3";

/**
 * Tree branch label (category, member role group, friends group): a fixed
 * 24px silkscreen row, so every column's labels share one baseline. The
 * chevron (12px) sits in a 20px slot so the label starts on the row-name
 * edge. Put the `+` and other branch actions in ROW_ACTIONS.
 */
export const TREE_BRANCH_LABEL =
  "group/branch relative flex h-6 w-full min-w-0 items-center gap-2 rounded-sm px-2 silkscreen text-ink-3 select-none";

/** Space above a branch label: 16px, 8px for the first branch in a list. */
export const TREE_BRANCH_GAP = "pt-4 first:pt-2";

/**
 * Trailing hover actions that overlay the row instead of reserving width
 * (spec §8, Shell). Needs a `group` row. Shown on fine-pointer hover and on
 * keyboard focus inside the row; on touch the long-press sheet carries them.
 * Give the row's name ROW_NAME_FADE so the text fades under the cluster,
 * and hide trailing meta (badge, clock) with ROW_META_SWAP.
 */
export const ROW_ACTIONS =
  "absolute inset-y-0 right-1 z-20 flex items-center gap-0.5 opacity-0 transition-opacity duration-(--dur-1) ease-out pointer-fine:group-hover:opacity-100 group-focus-within:opacity-100 pointer-coarse:hidden";

/** A 24px square action inside ROW_ACTIONS (16px glyph). */
export const ROW_ACTION_BUTTON =
  "relative flex size-6 items-center justify-center rounded-sm text-ink-3 outline-none transition-colors duration-(--dur-1) ease-out pointer-fine:hover:bg-tint-2 pointer-fine:hover:text-ink-1 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-focus [&_svg]:size-4";

/**
 * Fades the row's name under ROW_ACTIONS while they show. Set
 * `--row-actions-w` (default 52px: two 24px actions) on the row for other
 * clusters.
 */
export const ROW_NAME_FADE =
  "pointer-fine:group-hover:[mask-image:linear-gradient(to_left,transparent_var(--row-actions-w,52px),#000_calc(var(--row-actions-w,52px)+16px))] group-focus-within:[mask-image:linear-gradient(to_left,transparent_var(--row-actions-w,52px),#000_calc(var(--row-actions-w,52px)+16px))]";

/** Trailing meta (mention badge, call clock) that steps aside for ROW_ACTIONS. */
export const ROW_META_SWAP =
  "transition-opacity duration-(--dur-1) ease-out pointer-fine:group-hover:opacity-0 group-focus-within:opacity-0";

/** Tree channel row: 32 high, 16px icon, text-ui-row. */
export const TREE_ROW =
  "group relative flex h-8 w-full min-w-0 items-center gap-2 rounded-sm px-2 text-left text-ui-row font-medium outline-none select-none [-webkit-tap-highlight-color:transparent] transition-colors duration-(--dur-1) ease-out pointer-coarse:min-h-11 [&_svg]:size-4";

/** Tree occupant row content: 28 high, text-ui-sm. TreeLeaf adds the guide inset. */
export const OCCUPANT_ROW =
  "group relative flex h-7 w-full min-w-0 items-center gap-2 rounded-sm pr-2 text-left text-ui-sm font-medium text-ink-2 outline-none select-none transition-colors duration-(--dur-1) ease-out pointer-fine:hover:bg-tint-1 pointer-fine:hover:text-ink-1";

export type SidebarRowOptions = {
  selected?: boolean;
  unread?: boolean;
  /** Avatar + second line rows. */
  tall?: boolean;
  /** The 28px tree channel row instead of the 32px member/DM row. */
  tree?: boolean;
  className?: string;
};

/** Class string for one row in its current state. */
export function sidebarRowClass({
  selected = false,
  unread = false,
  tall = false,
  tree = false,
  className,
}: SidebarRowOptions = {}) {
  return cn(
    tree ? TREE_ROW : SIDEBAR_ROW,
    tall && !tree && SIDEBAR_ROW_TALL,
    selected ? SIDEBAR_ROW_SELECTED : SIDEBAR_ROW_IDLE,
    unread && !selected && SIDEBAR_ROW_UNREAD,
    className,
  );
}

/**
 * Phone list row: edge-to-edge `px-4`, at least 48px, 40px avatar, primary
 * text `text-ui-base font-medium`.
 */
export const PHONE_ROW =
  "group relative flex min-h-12 w-full min-w-0 items-center gap-3 px-4 py-1.5 text-left text-ui-base font-medium text-ink-1 outline-none select-none [-webkit-tap-highlight-color:transparent] transition-colors duration-(--dur-1) ease-out active:bg-tint-2 pointer-fine:hover:bg-tint-1";

/**
 * A grouped card of phone rows separated by hairlines: ply-2 with a hairline
 * border, the same card as the DM list.
 */
export const PHONE_GROUP =
  "overflow-hidden rounded-lg border border-line bg-ply-2 divide-y divide-line";

/** Phone section label: silkscreen in ink-3, above a grouped card. */
export const PHONE_SECTION_LABEL = "silkscreen px-4 pb-2 pt-6 text-ink-3";

/** Leading 40px slot for an icon in a phone row, matching avatar rows. */
export const PHONE_ICON_SLOT =
  "flex size-10 shrink-0 items-center justify-center rounded-avatar bg-tint-2 text-ink-2";
