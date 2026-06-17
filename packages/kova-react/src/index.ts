/**
 * @kova/react
 *
 * Drop-in React SDK for kova-auth — the self-hosted Clerk alternative.
 *
 * Quick start:
 * ```tsx
 * import { KovaAuthProvider, SignIn, useUser } from "@kova/react";
 *
 * // Wrap your app:
 * <KovaAuthProvider publishableKey="pk_live_..." afterSignInUrl="/dashboard">
 *   <App />
 * </KovaAuthProvider>
 *
 * // Drop-in sign-in card:
 * <SignIn afterSignInUrl="/dashboard" />
 *
 * // Access the current user anywhere:
 * const { user, isSignedIn } = useUser();
 * ```
 */

// ── Provider ─────────────────────────────────────────────────────────────────
export { KovaAuthProvider } from "./context";
export type { KovaAuthProviderProps } from "./context";

// ── Components ───────────────────────────────────────────────────────────────
// UI building-blocks that can also be embedded in custom profile pages.
export { ConnectedAccounts } from "./components/ConnectedAccounts";
export { OrgSwitcher } from "./components/OrgSwitcher";
export { Protect } from "./components/Protect";
export { SignIn } from "./components/SignIn";
export { SignUp } from "./components/SignUp";
export { UserButton } from "./components/UserButton";

// ── Hooks ─────────────────────────────────────────────────────────────────────
export { useAuth } from "./hooks/use-auth";
export type { UseAuthReturn } from "./hooks/use-auth";

export { useLinkedAccounts } from "./hooks/use-linked-accounts";

export { useOrganization } from "./hooks/use-organization";
export { useSession } from "./hooks/use-session";
export { useSignIn } from "./hooks/use-sign-in";
export type { UseSignInReturn } from "./hooks/use-sign-in";
export { useSignUp } from "./hooks/use-sign-up";
export type { UseSignUpReturn } from "./hooks/use-sign-up";
export { useUser } from "./hooks/use-user";

/**
 * Rate-limit countdown hook + utilities.
 *
 * Use `useRateLimit()` to build custom forms that react to 429 responses.
 * Use `extractRetryAfter()` to parse `Retry-After` from any Better Auth error shape.
 */
export { extractRetryAfter, rateLimitMessage, useRateLimit } from "./hooks/use-rate-limit";
export type { UseRateLimitReturn } from "./hooks/use-rate-limit";

/**
 * Low-level context access — prefer the purpose-built hooks above.
 */
export { useKovaAuth } from "./context";

// ── Client factory ────────────────────────────────────────────────────────────
export { createKovaAuthClient } from "./client";
export type { ClientOptions, KovaAuthClient } from "./client";

// ── Key utilities ─────────────────────────────────────────────────────────────
export { decodePublishableKey, encodePublishableKey } from "./key";
export type { DecodedKey } from "./key";

// ── Webhook verification ───────────────────────────────────────────────────────
export { verifyWebhookSignature } from "./webhook";
export type { VerifyOptions, WebhookEvent } from "./webhook";

// ── Types (all public interfaces) ─────────────────────────────────────────────
export type {
  // Appearance
  Appearance,
  AppearanceElements,
  AppearanceVariables,
  // Domain models (linked accounts)
  LinkedAccount, OAuthProvider,
  OrgSwitcherProps,
  PluginConfig,
  ProtectProps,
  // Config
  KovaAuthConfig, KovaMembership,
  KovaOrganization,
  KovaSession,
  KovaUser,
  // Component props
  SignInProps,
  SignInTab,
  SignUpProps,
  // Hook returns
  UseLinkedAccountsReturn,
  UseOrganizationReturn, UserButtonProps, UseSessionReturn,
  UseUserReturn
} from "./types";

