import type { Transition } from "framer-motion";

/**
 * Motion shared by the device sign-in screens (DesktopLogin, CopyMorphIcon).
 * Controls come from `ui/button` and `ui/input`; this file holds no styles.
 */

/** Strong ease-out (--rm-ease-out); starts fast so the UI feels responsive. */
export const EASE_OUT = [0.23, 1, 0.32, 1] as const;

export const ENTER_TRANSITION: Transition = { duration: 0.22, ease: EASE_OUT };
export const EXIT_TRANSITION: Transition = { duration: 0.14, ease: EASE_OUT };

/** Panel crossfade: enter from scale(0.97), exit faster than enter. */
export const panelMotion = {
  initial: { opacity: 0, scale: 0.97 },
  animate: { opacity: 1, scale: 1, transition: ENTER_TRANSITION },
  exit: { opacity: 0, scale: 0.98, transition: EXIT_TRANSITION },
} as const;
