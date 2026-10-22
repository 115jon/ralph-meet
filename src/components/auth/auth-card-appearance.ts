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
    appLogo: { width: 44, height: 44, margin: "0 0 18px", borderRadius: 11 },
    cardTitle: { fontSize: 24, letterSpacing: "-0.02em", lineHeight: 1.2 },
    cardSubtitle: { marginTop: 4 },
    cardBody: { padding: "18px 0 0" },
    cardFooter: {
      padding: "18px 0 0",
      background: "transparent",
      borderTop: 0,
    },
  },
};
