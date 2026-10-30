/**
 * Shared class recipes for the landing page, "C — Poster" (DESIGN.md,
 * Public pages; approved in `/ui-fixtures?surface=type-mockups&variant=c`).
 *
 * A gig poster printed on the panel: Bricolage 800 at enormous scale (the
 * hero's last word and the section numerals in two-ink accent dither),
 * Martian silkscreen for nav, kickers and the manifest, Geist for every
 * sentence. Structure is 2px ink rules, corners are 2px key corners, and
 * the keys are the app's own (`ui/button`), a size up (48px). Colour is
 * layer-2 tokens only; the focus ring is the global `:focus-visible` rule.
 */

import { buttonVariants } from "@/components/ui/button";

export const CONTAINER = "mx-auto w-full max-w-[1440px] px-5 md:px-10";

const DISPLAY =
  "font-display text-ink-1 [font-weight:800] [font-optical-sizing:auto] [font-kerning:normal]";

/** Hero poster: 56 to 176px, leading 0.86, tracking -0.045em. */
export const DISPLAY_H1 = `${DISPLAY} text-[length:clamp(3.5rem,1rem+14vw,11rem)] leading-[0.86] tracking-[-0.045em] text-balance`;

/** Section heads: 40 to 76px. */
export const DISPLAY_H2 = `${DISPLAY} text-[length:clamp(2.5rem,1.6rem+4.4vw,4.75rem)] leading-[0.92] tracking-[-0.04em] text-balance`;

/** Feature heads: 28 to 40px. */
export const DISPLAY_H3 = `${DISPLAY} text-[length:clamp(1.75rem,1.35rem+1.2vw,2.5rem)] leading-[0.98] tracking-[-0.03em] text-balance`;

/** The oversized dithered section numeral (decorative, aria-hidden). */
export const NUMERAL = `${DISPLAY} block text-[length:clamp(5rem,3rem+9vw,10rem)] leading-[0.8] tracking-[-0.05em] select-none`;

/** A fact or kit title over a 2px rule: Bricolage 700, 18/24. */
export const FACT_TITLE =
  "font-display text-[18px] leading-6 font-bold tracking-[-0.01em] text-balance text-ink-1";

/** Lede under a display heading: 18/28, 20/32 from md, in ink-2. */
export const LEDE =
  "text-[18px] leading-7 text-pretty text-ink-2 md:text-[20px] md:leading-8";

/** Body copy under a feature head: 16/24 in ink-2. */
export const BODY = "text-ui-md text-pretty text-ink-2";

/** Silkscreen kicker over a heading (Martian 11 uppercase, ink-3). */
export const KICKER = "silkscreen text-ink-3";

/** A 3-up fact column under a 2px ink rule. */
export const RULE_COLUMN = "border-t-2 border-ink-1 pt-4 pb-6";

/** Silkscreen nav and footer links: ink-2, ink-1 on hover. */
export const SILK_LINK =
  "silkscreen inline-flex min-h-11 items-center rounded-[2px] text-ink-2 transition-colors duration-(--dur-2) ease-out pointer-fine:hover:text-ink-1";

/** Underlined inline link inside running copy. */
export const INLINE_LINK =
  "rounded-[2px] text-accent-ink underline decoration-line-strong underline-offset-4 transition-colors duration-(--dur-2) ease-out pointer-fine:hover:decoration-accent-ink";

/*
 * Key classes for links (an <a> can't take the Button's notch cap through
 * `asChild`; use `KeyLink` in ./Keys for that). The dev dither mockups also
 * read these.
 */
export const CTA_PRIMARY = buttonVariants({ variant: "primary", size: "lg" });
export const CTA_SECONDARY = buttonVariants({
  variant: "secondary",
  size: "lg",
});
export const CTA_OUTLINE = buttonVariants({ variant: "outline", size: "sm" });
