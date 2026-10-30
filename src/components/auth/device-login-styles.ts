/** Duration (s) + cubic-bezier: the subset of a motion transition used here. */
type Transition = {
  duration: number;
  ease: readonly [number, number, number, number];
};

/**
 * Motion shared by the device sign-in screens (DesktopLogin, CopyMorphIcon).
 * Controls come from `ui/button` and `ui/input`; this file holds no styles.
 * Plain data, no animation library: the desktop entry ships no
 * framer-motion (performance-motion P1-9); screens render it with CSS.
 */

/** Strong ease-out (--rm-ease-out); starts fast so the UI feels responsive. */
export const EASE_OUT = [0.23, 1, 0.32, 1] as const;

export const ENTER_TRANSITION: Transition = { duration: 0.2, ease: EASE_OUT };
export const EXIT_TRANSITION: Transition = { duration: 0.14, ease: EASE_OUT };

/**
 * Panel crossfade: fade with a 4px rise, exit faster than enter. No scale,
 * so text never shimmers; the frame is top-aligned, so the column grows
 * downward instead of re-centring.
 */
export const panelMotion = {
  initial: { opacity: 0, transform: "translateY(4px)" },
  animate: {
    opacity: 1,
    transform: "translateY(0px)",
    transition: ENTER_TRANSITION,
  },
  exit: { opacity: 0, transition: EXIT_TRANSITION },
} as const;
