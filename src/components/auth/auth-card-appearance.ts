/**
 * Flattens the Kova <SignIn>/<SignUp> card into the public frame's column
 * as the C access poster (type-mockups variant C, "Access"). Colours are
 * bound to Ralph's theme tokens in styles.css (`.auth-split [data-ra-root]
 * { --ra-color-*: ... }`), because the SDK only reads `variables` from the
 * provider, not from an instance; the parts inline styles can't reach (the
 * dithered rule under the title, the legend-plate labels' ground, the
 * notched Continue key and its dithered cap, hover states) are drawn there
 * too, keyed on `data-ra-element`.
 *
 * Metrics match the rest of the frame: no app logo (the frame's lockup is
 * the logo), the frame's Bricolage 800 display title, a 17/24 lead, legend-
 * plate fields (a silkscreen label printed across a 48px field's top edge),
 * Bricolage rule tabs, 48px keys with 2px corners, silkscreen divider and
 * footer.
 *
 * SDK limits: the title and subtitle text are the SDK's own ("Sign in",
 * "Welcome back. Choose your sign-in method"); there are no props for them,
 * and hiding them would also hide the SDK's later states ("Check your
 * email"). The provider icons are the SDK's.
 */
import type { Appearance } from "@kova/react";
import { PUBLIC_DISPLAY } from "./public-type";

const KEY = { height: 48, minHeight: 48, borderRadius: 2 } as const;

const SILK = {
  fontFamily: "var(--font-silk)",
  fontSize: 11,
  lineHeight: "14px",
  fontWeight: 500,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
} as const;

const CONTROL_LABEL = {
  fontFamily: "var(--font-display)",
  fontOpticalSizing: "auto",
  fontSize: 15,
  fontWeight: 600,
  lineHeight: 1,
} as const;

export const AUTH_CARD_APPEARANCE: Appearance = {
  elements: {
    card: {
      border: 0,
      boxShadow: "none",
      maxWidth: "none",
      background: "transparent",
      overflow: "visible",
      padding: 0,
    },
    cardHeader: { padding: 0, textAlign: "left" },
    appLogo: { display: "none" },
    cardTitle: {
      ...PUBLIC_DISPLAY,
      fontFamily: "var(--font-display)",
      fontWeight: 800,
      fontKerning: "normal",
      fontOpticalSizing: "auto",
      textWrap: "balance",
      color: "var(--ink-1)",
      margin: 0,
    },
    cardSubtitle: {
      // Clears the dithered rule styles.css prints under the title.
      marginTop: 24,
      maxWidth: "38ch",
      fontSize: 17,
      lineHeight: "24px",
      textWrap: "pretty",
      color: "var(--ink-2)",
    },
    cardBody: { padding: "32px 0 0" },
    formField: { position: "relative", paddingTop: 8, marginBottom: 20 },
    formFieldLabel: {
      ...SILK,
      position: "absolute",
      top: 0,
      left: 12,
      zIndex: 1,
      margin: 0,
      padding: "0 4px",
      color: "var(--ink-2)",
    },
    formFieldInput: {
      ...KEY,
      fontSize: "inherit",
      paddingInline: 16,
      background: "var(--ply-2)",
    },
    formFieldError: { fontSize: 13, lineHeight: "18px", marginTop: 6 },
    formSubmitButton: {
      ...KEY,
      ...CONTROL_LABEL,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      gap: 4,
    },
    socialButton: { ...KEY, borderWidth: 2 },
    dividerText: { ...SILK, color: "var(--ink-3)" },
    tabsRoot: {
      background: "transparent",
      padding: 0,
      gap: 20,
      borderRadius: 0,
      borderBottom: "1px solid var(--line)",
      justifyContent: "flex-start",
    },
    tab: {
      ...CONTROL_LABEL,
      height: 40,
      flex: "0 0 auto",
      padding: "0 2px",
      borderRadius: 0,
      background: "transparent",
      boxShadow: "none",
      color: "var(--ink-3)",
      borderBottom: "2px solid transparent",
      marginBottom: -1,
    },
    tabActive: {
      background: "transparent",
      boxShadow: "none",
      color: "var(--ink-1)",
      borderBottomColor: "var(--ink-1)",
    },
    cardFooter: {
      ...SILK,
      padding: "28px 0 0",
      background: "transparent",
      borderTop: 0,
      textAlign: "left",
      color: "var(--ink-3)",
    },
  },
};
