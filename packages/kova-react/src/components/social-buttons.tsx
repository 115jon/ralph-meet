/**
 * Shared OAuth social buttons used by both <SignIn /> and <SignUp />.
 *
 * Handles:
 *  - Absolute callbackURL resolution (avoids Better Auth resolving relative
 *    paths against its own baseURL, which would redirect users to the auth
 *    server instead of the client app).
 *  - Per-app redirect URI / origin enforcement errors (403 responses from
 *    the kova-auth server) surfaced as inline Alert messages.
 *  - Loading state per-provider with disabled state during in-flight requests.
 */

import { useState } from "react";
import { useKovaAuth } from "../context";
import type { AppearanceElements } from "../types";
import { ProviderIcon, providerLabel } from "./icons";
import { Alert } from "./ui";

export const OAUTH_HANDOFF_STORAGE_KEY = "kova-auth:oauth-handoff";

// ── Shared utility ─────────────────────────────────────────────────────────────

/**
 * Resolves a potentially-relative path to an absolute URL rooted at the
 * client app's origin (window.location.origin in the browser).
 *
 * Better Auth uses its own `baseURL` (the auth server) to resolve relative
 * callbackURL values, which would redirect the browser to the auth server
 * after OAuth instead of back to the consuming client app.
 *
 * If the input is already an absolute URL it is returned unchanged.
 */
export function resolveAbsoluteUrl(authUrl: string, path?: string): string {
  const input = path ?? "/";
  try {
    new URL(input);
    return input;
  } catch {
    const appOrigin =
      typeof window !== "undefined"
        ? window.location.origin
        : authUrl.replace(/\/$/, "");
    const segment = input.startsWith("/") ? input : `/${input}`;
    return `${appOrigin}${segment}`;
  }
}

/**
 * Detects whether the consumer app is on a different registrable domain from
 * the auth server. When true, the OAuth callbackURL must go through the
 * oauth-complete bounce handler to avoid relying on SameSite=None cross-site
 * cookie sharing (which browsers increasingly restrict).
 *
 * Same-domain example (no bounce needed):
 *   authUrl = https://auth.115jon.site
 *   appOrigin = https://app.115jon.site   → same registrable domain (.115jon.site)
 *
 * Cross-domain example (bounce needed):
 *   authUrl = https://auth.115jon.site
 *   appOrigin = https://example.workers.dev  → different registrable domain
 */
function isCrossOriginDomain(authUrl: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    const authHostname = new URL(authUrl).hostname;
    const appHostname = window.location.hostname;
    // Extract the registrable domain: last two labels (handles .co.uk etc via simple heuristic)
    const regDomain = (h: string) => h.split(".").slice(-2).join(".");
    return regDomain(authHostname) !== regDomain(appHostname);
  } catch {
    return false;
  }
}

/**
 * Builds the intermediate `oauth-complete` bounce URL that avoids cross-domain
 * cookie sharing.  After the OAuth callback sets the session on the auth server,
 * the browser navigates to this URL (same auth server domain — no cross-site
 * restriction).  The handler reads the session, creates a 30s transfer code,
 * and redirects to `redirectUri?kova_auth_code=xxx`.
 */
function buildSdkBounceUrl(
  authUrl: string,
  publishableKey: string,
  redirectUri: string
): string {
  const bounce = new URL(`${authUrl}/api/hosted/oauth-complete`);
  bounce.searchParams.set("mode", "sdk");
  bounce.searchParams.set("pk", publishableKey);
  bounce.searchParams.set("redirect_uri", redirectUri);
  return bounce.toString();
}

function buildSdkOAuthStartUrl(
  authUrl: string,
  publishableKey: string,
  provider: string,
  redirectUri: string,
  errorCallbackURL: string
): string {
  const start = new URL(`${authUrl}/api/pub/apps/${publishableKey}/oauth/start`);
  start.searchParams.set("provider", provider);
  start.searchParams.set("redirect_uri", redirectUri);
  start.searchParams.set("error_callback_url", errorCallbackURL);
  return start.toString();
}

// ── Better Auth client response shape ─────────────────────────────────────────

interface SocialSignInResult {
  data: { url?: string; redirect?: boolean } | null;
  /** error.error holds the code from our server's JSON body */
  error: { error?: string; message?: string; status?: number } | null;
}

/** Convert a server error code to a human-readable UI message. */
function oauthErrorMessage(code: string, fallback?: string): string {
  if (code === "redirect_uri_not_allowed") {
    return (
      "This application's redirect URI is not configured correctly. " +
      "A developer needs to add this URL to the app's allowed redirect URIs in the kova-auth dashboard."
    );
  }
  if (code === "origin_not_allowed") {
    return (
      "This origin is not in the application's allowed origins list. " +
      "A developer needs to add it in the kova-auth dashboard."
    );
  }
  return fallback ?? "OAuth sign-in failed. Please try again.";
}

// ── Component ──────────────────────────────────────────────────────────────────

interface SocialButtonsProps {
  /** Absolute or relative post-auth redirect URL. */
  callbackURL?: string;
  /** URL to redirect to on OAuth error (relative or absolute). */
  errorCallbackURL?: string;
  /** Per-element appearance overrides from the parent card. */
  elements?: AppearanceElements;
}

export function SocialButtons({
  callbackURL,
  errorCallbackURL,
  elements,
}: SocialButtonsProps) {
  const { oauthProviders, client, authUrl, publishableKey } = useKovaAuth();
  const [oauthError, setOauthError] = useState<string | null>(null);
  const [loadingProvider, setLoadingProvider] = useState<string | null>(null);

  if (!oauthProviders.length) return null;

  const absCallback = resolveAbsoluteUrl(authUrl, callbackURL);
  const absError = resolveAbsoluteUrl(authUrl, errorCallbackURL ?? "/sign-in?error=oauth");

  // SDK applications always route OAuth through the bounce handler so the
  // server can mint an application-scoped session token.
  const finalCallback =
    publishableKey
      ? buildSdkBounceUrl(authUrl, publishableKey, absCallback)
      : absCallback;

  const handleSocial = async (providerId: string) => {
    setOauthError(null);
    setLoadingProvider(providerId);
    try {
      if (typeof window !== "undefined" && publishableKey) {
        window.sessionStorage.setItem(
          OAUTH_HANDOFF_STORAGE_KEY,
          JSON.stringify({
            authUrl,
            publishableKey,
            redirectUri: absCallback,
            startedAt: Date.now(),
          })
        );
        window.location.assign(
          buildSdkOAuthStartUrl(authUrl, publishableKey, providerId, absCallback, absError)
        );
        return;
      }

      const result = await client.signIn.social({
        provider: providerId,
        callbackURL: finalCallback,
        errorCallbackURL: absError,
      } as Parameters<typeof client.signIn.social>[0]);

      const r = result as SocialSignInResult | null;
      if (r?.error) {
        setOauthError(oauthErrorMessage(r.error.error ?? "", r.error.message));
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "OAuth sign-in failed. Please try again.";
      setOauthError(msg);
    } finally {
      setLoadingProvider(null);
    }
  };

  return (
    <div data-ra-element="socialButtonsRoot" style={elements?.socialButtonsRoot}>
      {oauthError && <Alert variant="error">{oauthError}</Alert>}
      {oauthProviders.map((p) => (
        <button
          key={p.id}
          type="button"
          data-ra-element="socialButton"
          style={elements?.socialButton}
          disabled={loadingProvider !== null}
          onClick={() => void handleSocial(p.id)}
        >
          <ProviderIcon provider={p.id} size={18} />
          {loadingProvider === p.id
            ? "Connecting…"
            : `Continue with ${p.label ?? providerLabel(p.id)}`}
        </button>
      ))}
    </div>
  );
}
