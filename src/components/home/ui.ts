/**
 * Shared class recipes for the landing page. Marketing controls are a size
 * up from the app's (44px tall, 15px label) so they clear the touch target
 * on their own, but they keep the app's radius, weight, press and hover
 * grammar from `ui/interaction` so the page reads as the product.
 */

import { PRESS } from "@/components/ui/interaction";

export const CONTAINER = "mx-auto w-full max-w-[1440px] px-6 md:px-10 lg:px-16";

const CTA_BASE = `${PRESS} inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-md px-5 text-ui-base font-medium whitespace-nowrap outline-none`;

/** The one solid accent fill on the page. */
export const CTA_PRIMARY = `${CTA_BASE} bg-primary text-primary-foreground [--hover-o:0.12]`;

/** Neutral tint: pairs with the primary without competing. */
export const CTA_SECONDARY = `${CTA_BASE} bg-rm-tint-2 text-rm-text`;

/** Outline for chrome (header) where a fill would be too loud. */
export const CTA_OUTLINE = `${CTA_BASE} h-9 border border-rm-border-strong bg-transparent px-4 text-ui-sm text-rm-text`;

/** Quiet text links in nav and footer. */
export const TEXT_LINK =
  "rounded-xs text-rm-text-secondary transition-colors duration-150 ease-(--rm-ease-out) pointer-fine:hover:text-rm-text";

/** Underlined inline link inside running copy. */
export const INLINE_LINK =
  "rounded-xs text-rm-text underline decoration-rm-border-strong underline-offset-4 transition-colors duration-150 ease-(--rm-ease-out) pointer-fine:hover:decoration-rm-text";
