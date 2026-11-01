/**
 * Height in px of the window chrome the desktop app draws over the top of the
 * page (`--app-chrome-top`, desktop/styles.css); 0 on the web. For overlay
 * positioning done in JS from viewport coordinates, which must keep clear of
 * the title bar. CSS positioning uses the var directly (styles.css).
 */
export function readAppChromeTop(): number {
  if (typeof document === "undefined") return 0;
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue("--app-chrome-top")
    .trim();
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Floating-UI / Radix `collisionPadding` that keeps a popover, menu or tooltip
 * `edge` px clear of the viewport on every side and clear of the title bar on
 * top, so collision handling flips or shifts it instead of tucking it under.
 */
export function collisionPaddingBelowChrome(edge = 8) {
  return {
    top: edge + readAppChromeTop(),
    right: edge,
    bottom: edge,
    left: edge,
  };
}
