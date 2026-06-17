/**
 * Publishable key utilities.
 *
 * A publishable key is a **client-side URL encoding convenience** — it encodes
 * the auth server URL in a Clerk-compatible format so consumers don't have to
 * manage raw URLs directly:
 *
 *   pk_live_<base64(JSON.stringify(payload))>
 *   pk_test_<base64(JSON.stringify(payload))>
 *
 * Payload: `{ v: 1, authUrl: string, appId?: string }`
 *
 * ⚠️  IMPORTANT: The kova-auth server does NOT validate, register, or enforce
 *    publishable keys. There is no key-generation API or key-lookup endpoint.
 *    The key is simply a way to encode the server URL into a single opaque string.
 *    It contains NO secrets and is safe to embed in client-side code.
 *
 * If you prefer simplicity, pass `authUrl` directly to `<KovaAuthProvider>`.
 */

const PREFIX_LIVE = "pk_live_";
const PREFIX_TEST = "pk_test_";

interface KeyPayload {
  /** Payload schema version. */
  v: 1;
  /** Absolute base URL of the kova-auth auth server. */
  authUrl: string;
  /** Optional human-readable app name (for debugging). */
  appId?: string;
}

// ── Encode ────────────────────────────────────────────────────────────────────

/**
 * Creates a publishable key from an auth server URL.
 *
 * @example
 * ```ts
 * const key = encodePublishableKey("https://auth.example.com");
 * // → "pk_live_eyJ2IjoxLCJhdXRoVXJsIjoiaHR0cHM6Ly9hdXRoLmV4YW1wbGUuY29tIn0="
 * ```
 */
export function encodePublishableKey(
  authUrl: string,
  opts: { mode?: "live" | "test"; appId?: string } = {}
): string {
  const { mode = "live", appId } = opts;
  const payload: KeyPayload = { v: 1, authUrl, ...(appId ? { appId } : {}) };
  const encoded = btoa(JSON.stringify(payload));
  return `pk_${mode}_${encoded}`;
}

// ── Decode ────────────────────────────────────────────────────────────────────

export interface DecodedKey {
  authUrl: string;
  appId: string | undefined;
  mode: "live" | "test";
}

/**
 * Decodes a publishable key back to its constituent parts.
 *
 * @throws {Error} If the key is malformed or has an unknown payload version.
 */
export function decodePublishableKey(key: string): DecodedKey {
  let mode: "live" | "test";
  let encoded: string;

  if (key.startsWith(PREFIX_LIVE)) {
    mode = "live";
    encoded = key.slice(PREFIX_LIVE.length);
  } else if (key.startsWith(PREFIX_TEST)) {
    mode = "test";
    encoded = key.slice(PREFIX_TEST.length);
  } else {
    throw new Error(
      `[KovaAuth] Invalid publishable key: expected "pk_live_..." or "pk_test_...". ` +
      `Got: "${key.slice(0, 20)}..."`
    );
  }

  let payload: unknown;
  try {
    payload = JSON.parse(atob(encoded));
  } catch {
    throw new Error(
      "[KovaAuth] Failed to decode publishable key — base64 decode or JSON parse error."
    );
  }

  if (
    typeof payload !== "object" ||
    payload === null ||
    (payload as KeyPayload).v !== 1 ||
    typeof (payload as KeyPayload).authUrl !== "string"
  ) {
    throw new Error(
      "[KovaAuth] Publishable key payload is invalid. " +
      "Please re-generate your key from the dashboard."
    );
  }

  const { authUrl, appId } = payload as KeyPayload;

  return {
    authUrl: authUrl.replace(/\/$/, ""), // strip trailing slash
    appId,
    mode,
  };
}

// ── Resolve ───────────────────────────────────────────────────────────────────

/**
 * Resolves the auth URL from either a publishable key or a direct URL.
 * Throws a descriptive error if neither is provided.
 */
export function resolveAuthUrl(opts: {
  publishableKey?: string;
  authUrl?: string;
}): string {
  if (opts.authUrl) {
    return opts.authUrl.replace(/\/$/, "");
  }
  if (opts.publishableKey) {
    return decodePublishableKey(opts.publishableKey).authUrl;
  }
  throw new Error(
    "[KovaAuth] You must provide either `publishableKey` or `authUrl` to <KovaAuthProvider>."
  );
}
