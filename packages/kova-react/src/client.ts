/**
 * createKovaAuthClient
 *
 * A typed, opinionated wrapper around `better-auth/react`'s `createAuthClient`
 * that pre-configures every kova-auth plugin. Consumers never need to know
 * that Better Auth exists under the hood.
 *
 * Usage (imperative, outside React):
 * ```ts
 * export const authClient = createKovaAuthClient({
 *   authUrl: "https://auth.example.com",
 * });
 * await authClient.signIn.email({ email, password });
 * ```
 *
 * Or inside the provider (automatic):
 * The <KovaAuthProvider> calls this internally — you only need it when you
 * want an imperative handle at module level.
 */

import { apiKeyClient } from "@better-auth/api-key/client";
import { passkeyClient } from "@better-auth/passkey/client";
import type { BetterAuthClientPlugin } from "better-auth/client";
import {
  adminClient,
  genericOAuthClient,
  magicLinkClient,
  multiSessionClient,
  organizationClient,
  twoFactorClient,
  usernameClient,
} from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import type { PluginConfig } from "./types";

// ── Factory ───────────────────────────────────────────────────────────────────

export interface ClientOptions {
  /**
   * Auth server base URL (without trailing slash).
   * @example "https://auth.115jon.site"
   */
  authUrl: string;

  /**
   * The publishable key identifying this SDK consumer.
   * Automatically forwarded as `X-Publishable-Key` on every request,
   * allowing the server to resolve per-app CORS and redirect URI allowlists.
   * @example "pk_dev_abc123"
   */
  publishableKey?: string;

  /** Selectively enable / configure plugins. All are enabled by default. */
  plugins?: PluginConfig;

  /**
   * Additional fetch options forwarded to every Better Auth request.
   * `credentials: "include"` is always set.
   */
  fetchOptions?: RequestInit;

  /** Better Auth session revalidation behavior. */
  sessionOptions?: {
    refetchInterval?: number;
    refetchOnWindowFocus?: boolean;
    refetchWhenOffline?: boolean;
  };
}

/**
 * Builds the underlying Better Auth client.
 * Call once at module level and share the result via context.
 */
export function createKovaAuthClient(opts: ClientOptions) {
  const { authUrl, publishableKey, plugins = {}, fetchOptions = {}, sessionOptions } = opts;

  // Merge in the X-Publishable-Key header when a key is provided.
  // This is how the server identifies which registered application is making
  // the request and enforces its per-app CORS + redirect URI allowlists.
  //
  // X-Kova-Auth-SDK signals that the request originates from official SDK
  // components. The server uses this to enforce the branding requirement on
  // free-plan apps: if the header is absent on a sign-in/sign-up call, the
  // server rejects it, making it impractical to build a custom login UI
  // without showing the "Secured by kova-auth" badge (same model as Clerk).
  const sdkHeaders: Record<string, string> = {
    "X-Kova-Auth-SDK": "kova-react",
    ...(publishableKey ? { "X-Publishable-Key": publishableKey } : {}),
  };

  const pluginList = buildPluginList(plugins);

  return createAuthClient({
    baseURL: authUrl,
    plugins: pluginList,
    ...(sessionOptions ? { sessionOptions } : {}),
    fetchOptions: {
      credentials: "include",
      ...fetchOptions,
      headers: {
        ...sdkHeaders,
        ...(fetchOptions.headers as Record<string, string> | undefined ?? {}),
      },
    },
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Maps `PluginConfig` flags onto the concrete Better Auth client plugin
 * instances. Defaults to enabling all plugins.
 */
function buildPluginList(cfg: PluginConfig) {
  // Determine effective defaults: if the user passed no plugin config at all,
  // we enable everything. If they passed a partial config, we fill missing
  // keys with `true`.
  const enabled = (key: keyof PluginConfig): boolean => {
    const val = cfg[key];
    return val === undefined ? true : val !== false;
  };

  const plugins: BetterAuthClientPlugin[] = [];

  // ── admin ──────────────────────────────────────────────────────────────
  if (enabled("admin")) {
    plugins.push(adminClient());
  }

  // ── apiKey ─────────────────────────────────────────────────────────────
  if (enabled("apiKey")) {
    plugins.push(apiKeyClient());
  }

  // ── twoFactor ──────────────────────────────────────────────────────────
  if (enabled("twoFactor")) {
    const tfCfg = cfg.twoFactor;
    const onRedirect =
      typeof tfCfg === "object" && tfCfg !== null && tfCfg.onTwoFactorRedirect
        ? tfCfg.onTwoFactorRedirect
        : () => {
          // No-op: allow the calling component to manage the 2FA flow
        };
    plugins.push(twoFactorClient({ onTwoFactorRedirect: onRedirect }));
  }

  // ── organization ───────────────────────────────────────────────────────
  if (enabled("organization")) {
    const orgCfg = cfg.organization;
    const teams =
      typeof orgCfg === "object" && orgCfg !== null
        ? (orgCfg.teams ?? true)
        : true;
    const dac =
      typeof orgCfg === "object" && orgCfg !== null
        ? (orgCfg.dynamicAccessControl ?? true)
        : true;
    plugins.push(
      organizationClient({
        teams: { enabled: teams },
        dynamicAccessControl: { enabled: dac },
      })
    );
  }

  // ── multiSession ───────────────────────────────────────────────────────
  if (enabled("multiSession")) {
    plugins.push(multiSessionClient());
  }

  // ── passkey ────────────────────────────────────────────────────────────
  if (enabled("passkey")) {
    plugins.push(passkeyClient());
  }

  // ── magicLink ──────────────────────────────────────────────────────────
  if (enabled("magicLink")) {
    plugins.push(magicLinkClient());
  }

  // ── username ───────────────────────────────────────────────────────────
  if (enabled("username")) {
    plugins.push(usernameClient());
  }

  // ── genericOAuth (custom OIDC / OAuth2 providers) ──────────────
  if (enabled("genericOAuth")) {
    plugins.push(genericOAuthClient());
  }

  return plugins;
}

// ── Inferred client type ──────────────────────────────────────────────────────

/** The resolved type of the auth client returned by `createKovaAuthClient`. */
export type KovaAuthClient = ReturnType<typeof createKovaAuthClient>;
