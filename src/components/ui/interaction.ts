/**
 * Quiet Pro interaction building blocks, shared by every pressable primitive.
 * Literal strings so Tailwind's scanner sees every class.
 *
 * Motion rules: transform and opacity only, ease-out
 * cubic-bezier(0.23,1,0.32,1), at most 240ms, press = scale(0.97). Hover is an
 * overlay of currentColor (opacity only) and only on (hover:hover) and
 * (pointer:fine), so a tap on touch never latches a hover state.
 */

/** Press feedback plus the hover/press overlay. Needs a positioned host. */
export const PRESS =
  "relative select-none [-webkit-tap-highlight-color:transparent] transition-transform duration-150 ease-(--rm-ease-out) enabled:active:scale-[0.97] aria-busy:active:scale-100 aria-disabled:active:scale-100 motion-reduce:enabled:active:scale-100 after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:bg-current after:opacity-0 after:transition-opacity after:duration-150 after:ease-(--rm-ease-out) pointer-fine:hover:enabled:after:opacity-(--hover-o) enabled:active:after:opacity-(--press-o) aria-disabled:after:opacity-0! [--hover-o:0.08] [--press-o:0.14]";

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
 * they stay visible (or live in the long-press action sheet). Keyboard focus
 * inside the group also reveals them.
 */
export const REVEAL =
  "pointer-fine:opacity-0 pointer-fine:transition-opacity pointer-fine:duration-150 pointer-fine:ease-(--rm-ease-out) pointer-fine:group-hover:opacity-100 pointer-fine:group-focus-within:opacity-100 pointer-fine:focus-visible:opacity-100";

export const DISABLED =
  "disabled:cursor-not-allowed disabled:opacity-45 aria-disabled:cursor-not-allowed";
