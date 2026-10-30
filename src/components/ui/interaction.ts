/**
 * Talk Tree interaction building blocks, shared by every pressable primitive.
 * Literal strings so Tailwind's scanner sees every class.
 *
 * Motion (talk-tree-spec §6): transform and opacity only, `--ease-out`,
 * colours at --dur-1 (100ms). Buttons press at scale(.97), icon buttons at
 * (.96); the amplitudes are CSS variables the global reduced-motion rule
 * zeroes. Hover is an ink overlay of currentColor (opacity only) on fine
 * pointers, so a tap on touch never latches a hover state.
 */

/** Press feedback plus the hover/press overlay. Needs a positioned host. */
export const PRESS =
  "relative select-none [-webkit-tap-highlight-color:transparent] transition-[scale] duration-(--dur-1) ease-out enabled:active:scale-(--motion-press) aria-busy:active:scale-100 aria-disabled:active:scale-100 after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:bg-current after:opacity-0 after:transition-opacity after:duration-(--dur-1) after:ease-out pointer-fine:hover:enabled:after:opacity-(--hover-o) enabled:active:after:opacity-(--press-o) aria-disabled:after:opacity-0! [--hover-o:0.08] [--press-o:0.14]";

/** Icon buttons press a touch deeper (.96). Pair with PRESS. */
export const PRESS_ICON = "enabled:active:scale-(--motion-press-icon)";

/**
 * 44px minimum target on coarse pointers without changing the visual size.
 * The pseudo-element sits under the control's own box, so it only extends the
 * hit area outward.
 */
export const HIT =
  "before:absolute before:left-1/2 before:top-1/2 before:h-full before:min-h-11 before:w-full before:min-w-11 before:-translate-x-1/2 before:-translate-y-1/2 before:content-[''] pointer-fine:before:hidden";

/**
 * Controls revealed on hover (a message's action bar, a row's trailing
 * buttons). Hidden only where a fine pointer can bring them back; on touch
 * they stay visible. Keyboard focus inside the group reveals them at once.
 * They overlay the row instead of reserving space (spec §8, Shell).
 */
export const REVEAL =
  "pointer-fine:opacity-0 pointer-fine:transition-opacity pointer-fine:duration-(--dur-1) pointer-fine:ease-out pointer-fine:group-hover:opacity-100 pointer-fine:group-focus-within:opacity-100 pointer-fine:focus-visible:opacity-100 pointer-fine:focus-visible:transition-none";

export const DISABLED =
  "disabled:cursor-not-allowed disabled:opacity-45 aria-disabled:cursor-not-allowed";
