/**
 * Flattens the Kova <SignIn>/<SignUp> card into the auth form column.
 * Colours are bound to Ralph's theme tokens in styles.css
 * (`.auth-split [data-ra-root] { --ra-color-*: var(--rm-*) }`), because the
 * SDK only reads `variables` from the provider, not from an instance.
 */
import type { Appearance } from "@kova/react";

export const AUTH_CARD_APPEARANCE: Appearance = {
  elements: {
    card: {
      border: 0,
      boxShadow: "none",
      maxWidth: "none",
      background: "transparent",
      overflow: "visible",
    },
    cardHeader: { padding: 0, textAlign: "left" },
    // 4px grid, radius scale (`rounded-lg`), type scale (`text-ui-xl`, 22/28).
    appLogo: { width: 44, height: 44, margin: "0 0 16px", borderRadius: 12 },
    cardTitle: {
      fontSize: 22,
      lineHeight: "28px",
      fontWeight: 600,
      letterSpacing: "-0.01em",
    },
    cardSubtitle: { marginTop: 4, fontSize: 15, lineHeight: 1.375 },
    cardBody: { padding: "16px 0 0" },
    cardFooter: {
      padding: "16px 0 0",
      background: "transparent",
      borderTop: 0,
    },
  },
};
