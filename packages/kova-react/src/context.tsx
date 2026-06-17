/**
 * KovaAuthProvider + useKovaAuth context
 *
 * Appearance priority (highest wins):
 *   component-level prop > provider-level prop > server-fetched > SDK defaults
 *
 * On mount, fetches /api/pub/apps/:pk/appearance and merges:
 *  - primaryColor, backgroundColor → CSS vars
 *  - enabledProviders → filters the OAuth buttons shown (no code change needed)
 *  - faviconUrl → optionally injected into <head> when manageFavicon is true
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  createKovaAuthClient,
  type KovaAuthClient,
} from "./client";
import { resolveAuthUrl } from "./key";
import { injectAppearanceVars } from "./styles/inject";
import type {
  Appearance,
  AppearanceVariables,
  OAuthProvider,
  KovaAuthConfig,
} from "./types";

// ── Default appearance variables ─────────────────────────────────────────────

const DEFAULT_VARS: Required<AppearanceVariables> = {
  colorPrimary: "#3b82f6",
  colorPrimaryHover: "#2563eb",
  colorBackground: "#0a0a0a",
  colorSurface: "#111111",
  colorSurfaceRaised: "#1a1a1a",
  colorText: "#f5f5f5",
  colorTextSecondary: "#a0a0a0",
  colorTextTertiary: "#606060",
  colorBorder: "#2a2a2a",
  colorBorderStrong: "#3a3a3a",
  colorError: "#f87171",
  colorSuccess: "#4ade80",
  borderRadius: "8px",
  borderRadiusSm: "5px",
  fontFamily: "Inter, system-ui, -apple-system, sans-serif",
  fontFamilyMono: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
  fontSize: "14px",
};

const ALL_OAUTH_PROVIDERS: OAuthProvider[] = [
  { id: "google", label: "Google" },
  { id: "discord", label: "Discord" },
  { id: "github", label: "GitHub" },
  { id: "microsoft", label: "Microsoft" },
  { id: "apple", label: "Apple" },
  { id: "facebook", label: "Facebook" },
];
const DEFAULT_OAUTH_PROVIDERS = ALL_OAUTH_PROVIDERS.filter(p =>
  ["google", "discord", "github", "microsoft"].includes(p.id)
);

// ── Server appearance payload shape ──────────────────────────────────────────

export interface ServerAppearance {
  displayName: string;
  logoUrl: string | null;
  faviconUrl: string | null;
  primaryColor: string | null;
  backgroundColor: string | null;
  theme: "dark" | "light" | "auto";
  homeUrl: string | null;
  termsUrl: string | null;
  privacyUrl: string | null;
  /** Whether the app has paid to suppress the kova-auth badge. */
  hideBranding: boolean;
  /** Provider IDs enabled in the dashboard, e.g. ["google","github"] */
  enabledProviders: string[];
}

// ── Context value ────────────────────────────────────────────────────────────

export interface KovaAuthContextValue {
  client: KovaAuthClient;
  authUrl: string;
  /** The publishable key used to initialise this Provider instance. */
  publishableKey?: string;
  appearance: Appearance;
  vars: Required<AppearanceVariables>;
  oauthProviders: OAuthProvider[];
  /** Live server-fetched branding — null until the first fetch resolves. */
  serverAppearance: ServerAppearance | null;
  /** True once server appearance has resolved, or immediately when no publishable key is used. */
  isAppearanceLoaded: boolean;
  afterSignInUrl: string;
  afterSignUpUrl: string;
  afterSignOutUrl: string;
  mode: "live" | "test";
  isPlatformAdmin: boolean;
  /** Shared session subscription — sourced once from client.useSession(). */
  sessionResult: ReturnType<KovaAuthClient["useSession"]>;
  /** Raw Better Auth session token suitable for Authorization: Bearer. */
  sessionToken: string | null;
  /**
   * Clears the in-memory Bearer session token (cross-origin SDK sign-out).
   *
   * Calling this signs the user out **of this SDK-powered app only** without
   * invalidating the Better Auth session on the auth server. The platform
   * admin dashboard (auth.115jon.site) remains signed in. Use `client.signOut()`
   * when you also want to destroy the server-side session for everyone.
   */
  clearSessionToken: () => void;
  /**
   * True when a cross-origin Bearer token is active (OAuth transfer flow).
   * Components can use this to adjust sign-out behaviour.
   */
  hasBearerSession: boolean;
}

const KovaAuthContext = createContext<KovaAuthContextValue | null>(null);
KovaAuthContext.displayName = "KovaAuthContext";

function sessionStorageKey(publishableKey?: string) {
  return publishableKey ? `kova-auth:${publishableKey}:session-token` : null;
}

function readStoredSessionToken(publishableKey?: string) {
  if (typeof window === "undefined") return null;
  const key = sessionStorageKey(publishableKey);
  return key ? window.localStorage.getItem(key) : null;
}

function writeStoredSessionToken(publishableKey: string | undefined, token: string | null) {
  if (typeof window === "undefined") return;
  const key = sessionStorageKey(publishableKey);
  if (!key) return;
  if (token) window.localStorage.setItem(key, token);
  else window.localStorage.removeItem(key);
}

// ── Provider ─────────────────────────────────────────────────────────────────

export interface KovaAuthProviderProps extends KovaAuthConfig {
  children: ReactNode;
}

export function KovaAuthProvider({
  children,
  publishableKey,
  authUrl,
  plugins,
  appearance,
  oauthProviders,
  manageFavicon = false,
  sessionOptions,
  initialSessionToken,
  onSessionTokenChange,
  isPlatformAdmin = false,
  afterSignInUrl = "/",
  afterSignUpUrl = "/",
  afterSignOutUrl = "/sign-in",
  ...rest
}: KovaAuthProviderProps & { isPlatformAdmin?: boolean }) {
  void rest;

  // Derive mode from the publishable key prefix:
  //   pk_live_ → "live"  (production)
  //   pk_dev_ / pk_test_ → "test"  (shows Development badge)
  //   fallback (authUrl-only) → "live"
  const mode = useMemo<"live" | "test">(() => {
    if (!publishableKey) return "live";
    return publishableKey.startsWith("pk_live_") ? "live" : "test";
  }, [publishableKey]);

  const resolvedAuthUrl = useMemo(
    () => resolveAuthUrl({ publishableKey, authUrl }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [publishableKey, authUrl]
  );

  // ── Session token for cross-origin Bearer auth ───────────────────────────────
  // Declared BEFORE `client` so the useMemo below can reference it as a dep.
  // When null (normal same-origin flow), the client is created without a Bearer
  // header. When set (after exchange-code on cross-origin OAuth return), the
  // client is recreated exactly once with the Authorization header injected.
  const [sessionToken, setSessionToken] = useState<string | null>(
    () => initialSessionToken ?? readStoredSessionToken(publishableKey)
  );
  const setPersistentSessionToken = useCallback((token: string | null) => {
    writeStoredSessionToken(publishableKey, token);
    setSessionToken(token);
    onSessionTokenChange?.(token);
  }, [publishableKey, onSessionTokenChange]);
  const clearSessionToken = useCallback(() => setPersistentSessionToken(null), [setPersistentSessionToken]);

  useEffect(() => {
    if (initialSessionToken === undefined) return;
    setPersistentSessionToken(initialSessionToken);
  }, [initialSessionToken, setPersistentSessionToken]);

  // ── Auth client — recreated only when Bearer token changes ────────────────
  const client = useMemo(
    () => createKovaAuthClient({
      authUrl: resolvedAuthUrl,
      publishableKey,
      plugins,
      sessionOptions,
      ...(sessionToken
        ? { fetchOptions: { headers: { Authorization: `Bearer ${sessionToken}` } } }
        : {}),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [resolvedAuthUrl, publishableKey, sessionToken]
  );

  // ── Single session subscription — shared across all hooks ────────────────
  const sessionResult = client.useSession();

  useEffect(() => {
    if (!publishableKey || sessionToken) return;
    if (sessionResult.isPending || !sessionResult.data?.user) return;

    let cancelled = false;
    void fetch(`${resolvedAuthUrl}/api/pub/apps/${publishableKey}/session-token`, {
      method: "POST",
      credentials: "include",
      headers: { "X-Publishable-Key": publishableKey },
    })
      .then(r => r.ok ? (r.json() as Promise<{ sessionToken?: string }>) : null)
      .then(data => {
        if (!cancelled && data?.sessionToken) setPersistentSessionToken(data.sessionToken);
      })
      .catch(() => { /* best-effort: normal sign-in still redirects if needed */ });

    return () => {
      cancelled = true;
    };
  }, [publishableKey, resolvedAuthUrl, sessionResult.data, sessionResult.isPending, sessionToken, setPersistentSessionToken]);

  // ── Detect OAuth transfer code on mount ──────────────────────────────────
  // After the cross-origin OAuth flow lands at the consumer app with
  // ?kova_auth_code=xfr_..., we clean the URL immediately (prevents Referer
  // leakage) then exchange the 30s single-use code for the raw session token.
  useEffect(() => {
    if (typeof window === "undefined" || !publishableKey) return;
    const params = new URLSearchParams(window.location.search);
    const code = params.get("kova_auth_code");
    if (!code) return;

    const cleanUrl = new URL(window.location.href);
    cleanUrl.searchParams.delete("kova_auth_code");
    window.history.replaceState({}, "", cleanUrl.toString());

    void fetch(`${resolvedAuthUrl}/api/pub/apps/${publishableKey}/exchange-code`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Publishable-Key": publishableKey },
      body: JSON.stringify({ code }),
    })
      .then(r => r.ok ? (r.json() as Promise<{ sessionToken?: string }>) : null)
      .then(data => {
        if (!data?.sessionToken) return;
        setPersistentSessionToken(data.sessionToken);
        // Register the user in app_user immediately with the Bearer token.
        // The mount-time /me call fires before the token is ready and may fail
        // cross-origin (SameSite=None cookie blocked). This call is the reliable
        // fallback that runs as soon as we have a valid token.
        void fetch(`${resolvedAuthUrl}/api/pub/apps/${publishableKey}/me`, {
          method: "POST",
          credentials: "include",
          headers: { Authorization: `Bearer ${data.sessionToken}` },
        }).catch(() => { /* best-effort */ });
      })
      .catch(() => { /* best-effort */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedAuthUrl, publishableKey, setPersistentSessionToken]); // intentionally run once on mount

  useEffect(() => {
    if (!sessionToken) return;
    void sessionResult.refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionToken]);

  // ── Server appearance ─────────────────────────────────────────────────────
  const [serverAppearance, setServerAppearance] = useState<ServerAppearance | null>(null);

  useEffect(() => {
    if (!publishableKey) return;
    // Public endpoint — KV-cached server-side (5 min TTL).
    // cache: "no-store" bypasses the browser cache so we always reflect the
    // latest KV value. This prevents Cloudflare's CDN from serving a stale
    // appearance after the operator changes colors in the dashboard.
    void fetch(`${resolvedAuthUrl}/api/pub/apps/${publishableKey}/appearance`, {
      cache: "no-store",
    })
      .then(r => r.ok ? (r.json() as Promise<ServerAppearance>) : null)
      .then(data => { if (data) setServerAppearance(data); })
      .catch(() => { /* progressive enhancement — never blocks sign-in */ });

  }, [resolvedAuthUrl, publishableKey]);

  // Inject/update favicon from server only when explicitly enabled.
  // Embedded SDK components should not overwrite the host site's favicon.
  useEffect(() => {
    if (!manageFavicon) return;
    const url = serverAppearance?.faviconUrl;
    if (!url) return;
    let el = document.querySelector<HTMLLinkElement>("link[rel~='icon']");
    if (!el) {
      el = document.createElement("link");
      el.rel = "icon";
      document.head.appendChild(el);
    }
    el.href = url;
  }, [manageFavicon, serverAppearance?.faviconUrl]);

  // ── Merge: defaults → server colors → developer prop ─────────────────────
  const vars = useMemo<Required<AppearanceVariables>>(() => {
    const serverOverrides: Partial<AppearanceVariables> = serverAppearance
      ? {
        ...(serverAppearance.primaryColor ? { colorPrimary: serverAppearance.primaryColor } : {}),
        ...(serverAppearance.primaryColor ? { colorPrimaryHover: serverAppearance.primaryColor } : {}),
        ...(serverAppearance.backgroundColor ? { colorBackground: serverAppearance.backgroundColor } : {}),
      }
      : {};
    const merged = { ...DEFAULT_VARS, ...serverOverrides, ...(appearance?.variables ?? {}) };
    if (!appearance?.variables?.colorPrimaryHover && merged.colorPrimary !== DEFAULT_VARS.colorPrimary) {
      merged.colorPrimaryHover = merged.colorPrimary;
    }
    return merged;
  }, [serverAppearance, appearance?.variables]);

  const styleIdRef = useRef<string | null>(null);
  useEffect(() => {
    styleIdRef.current = injectAppearanceVars(vars, styleIdRef.current);
  }, [vars]);

  // ── OAuth providers: server list → developer override ────────────────────
  const resolvedProviders = useMemo<OAuthProvider[]>(() => {
    if (oauthProviders) return oauthProviders;
    if (serverAppearance) {
      return ALL_OAUTH_PROVIDERS.filter(p =>
        (serverAppearance.enabledProviders).includes(p.id)
      );
    }
    return DEFAULT_OAUTH_PROVIDERS;
  }, [oauthProviders, serverAppearance]);

  const value = useMemo<KovaAuthContextValue>(
    () => ({
      client, authUrl: resolvedAuthUrl,
      publishableKey,
      appearance: appearance ?? {}, vars,
      oauthProviders: resolvedProviders,
      serverAppearance,
      isAppearanceLoaded: !publishableKey || serverAppearance !== null,
      afterSignInUrl, afterSignUpUrl, afterSignOutUrl,
      mode,
      isPlatformAdmin,
      sessionResult,
      sessionToken:
        sessionToken
        ?? ((sessionResult.data?.session as unknown as Record<string, unknown> | undefined)?.["token"] as string | undefined)
        ?? null,
      clearSessionToken,
      hasBearerSession: sessionToken !== null,
    }),
    [client, resolvedAuthUrl, publishableKey, appearance, vars, resolvedProviders,
      serverAppearance, afterSignInUrl, afterSignUpUrl, afterSignOutUrl,
      mode, isPlatformAdmin, sessionResult, clearSessionToken, sessionToken]
  );

  return (
    <KovaAuthContext.Provider value={value}>
      {children}
    </KovaAuthContext.Provider>
  );
}

// ── useKovaAuth ─────────────────────────────────────────────────────────────

export function useKovaAuth(): KovaAuthContextValue {
  const ctx = useContext(KovaAuthContext);
  if (!ctx) {
    throw new Error(
      "[KovaAuth] `useKovaAuth` was called outside of <KovaAuthProvider>. " +
      "Make sure your component is a descendant of <KovaAuthProvider>."
    );
  }
  return ctx;
}

// ── mergeAppearance ───────────────────────────────────────────────────────────

export function mergeAppearance(base: Appearance, override?: Appearance): Appearance {
  if (!override) return base;
  return {
    variables: { ...base.variables, ...override.variables },
    elements: { ...base.elements, ...override.elements },
  };
}
