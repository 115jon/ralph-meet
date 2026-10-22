import type { Transition } from "framer-motion";

/** Strong ease-out; starts fast so the UI feels responsive. */
export const EASE_OUT = [0.23, 1, 0.32, 1] as const;

export const ENTER_TRANSITION: Transition = { duration: 0.22, ease: EASE_OUT };
export const EXIT_TRANSITION: Transition = { duration: 0.14, ease: EASE_OUT };

/** Panel crossfade: enter from scale(0.96), exit faster than enter. */
export const panelMotion = {
  initial: { opacity: 0, scale: 0.96 },
  animate: { opacity: 1, scale: 1, transition: ENTER_TRANSITION },
  exit: { opacity: 0, scale: 0.98, transition: EXIT_TRANSITION },
} as const;

const pressable =
  "transition-[transform,background-color,border-color,color] duration-[160ms] ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.97] motion-reduce:active:scale-100 disabled:pointer-events-none";

export const focusRing =
  "outline-none focus-visible:ring-2 focus-visible:ring-rm-accent focus-visible:ring-offset-2 focus-visible:ring-offset-rm-bg-primary";

// `hover:` in Tailwind v4 is already gated behind (hover: hover); the
// (pointer: fine) media variant keeps hover styles off touch-first devices.
export const primaryButton = `${pressable} ${focusRing} inline-flex h-11 w-full select-none items-center justify-center gap-2 rounded-xl bg-rm-accent px-5 text-sm font-semibold text-white disabled:opacity-70 aria-disabled:cursor-default aria-disabled:opacity-80 [@media(pointer:fine)]:hover:bg-rm-accent-hover`;

export const secondaryButton = `${pressable} ${focusRing} inline-flex h-10 select-none items-center justify-center gap-1.5 rounded-lg border border-rm-border bg-rm-bg-surface px-3 text-[13px] font-medium text-rm-text-secondary [@media(pointer:fine)]:hover:bg-rm-bg-hover [@media(pointer:fine)]:hover:text-rm-text`;

export const quietButton = `${pressable} ${focusRing} inline-flex select-none items-center justify-center rounded-md px-2.5 py-1.5 text-[13px] font-medium text-rm-text-muted [@media(pointer:fine)]:hover:text-rm-text`;

export const iconButton = `${pressable} ${focusRing} inline-flex h-9 w-9 shrink-0 select-none items-center justify-center rounded-lg text-rm-text-muted [@media(pointer:fine)]:hover:bg-rm-bg-hover [@media(pointer:fine)]:hover:text-rm-text`;
