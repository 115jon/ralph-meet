/**
 * Display type for the public frame (type-mockups variant C, "Access"):
 * Bricolage 800 with optical sizing, 44 to 68px fluid, leading 0.9,
 * tracking -0.04em, balanced. `PublicTitle size="display"` uses the class;
 * the Kova card title (auth-card-appearance.ts) takes the same numbers as
 * inline styles, since the SDK styles its own <h1>. Later states in a flow
 * use the dialog-title step (28/32).
 */

export const PUBLIC_DISPLAY = {
  fontSize: "clamp(2.75rem, 2.2rem + 2.6vw, 4.25rem)",
  lineHeight: 0.9,
  letterSpacing: "-0.04em",
} as const;

const FACE =
  "font-display [font-weight:800] [font-kerning:normal] [font-optical-sizing:auto]";

export const PUBLIC_DISPLAY_CLASS = `${FACE} text-[length:clamp(2.75rem,2.2rem+2.6vw,4.25rem)] leading-[0.9] tracking-[-0.04em]`;

export const PUBLIC_TITLE_CLASS = `${FACE} text-[28px] leading-8 tracking-[-0.03em]`;
