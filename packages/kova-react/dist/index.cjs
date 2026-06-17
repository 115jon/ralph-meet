'use strict';

var React = require('react');
var client = require('@better-auth/api-key/client');
var client$1 = require('@better-auth/passkey/client');
var plugins = require('better-auth/client/plugins');
var react = require('better-auth/react');
var jsxRuntime = require('react/jsx-runtime');

function _interopDefault (e) { return e && e.__esModule ? e : { default: e }; }

var React__default = /*#__PURE__*/_interopDefault(React);

// src/context.tsx
function createKovaAuthClient(opts) {
  const { authUrl, publishableKey, plugins = {}, fetchOptions = {}, sessionOptions } = opts;
  const sdkHeaders = {
    "X-Kova-Auth-SDK": "kova-react",
    ...publishableKey ? { "X-Publishable-Key": publishableKey } : {}
  };
  const pluginList = buildPluginList(plugins);
  return react.createAuthClient({
    baseURL: authUrl,
    plugins: pluginList,
    ...sessionOptions ? { sessionOptions } : {},
    fetchOptions: {
      credentials: "include",
      ...fetchOptions,
      headers: {
        ...sdkHeaders,
        ...fetchOptions.headers ?? {}
      }
    }
  });
}
function buildPluginList(cfg) {
  const enabled = (key) => {
    const val = cfg[key];
    return val === void 0 ? true : val !== false;
  };
  const plugins$1 = [];
  if (enabled("admin")) {
    plugins$1.push(plugins.adminClient());
  }
  if (enabled("apiKey")) {
    plugins$1.push(client.apiKeyClient());
  }
  if (enabled("twoFactor")) {
    const tfCfg = cfg.twoFactor;
    const onRedirect = typeof tfCfg === "object" && tfCfg !== null && tfCfg.onTwoFactorRedirect ? tfCfg.onTwoFactorRedirect : () => {
    };
    plugins$1.push(plugins.twoFactorClient({ onTwoFactorRedirect: onRedirect }));
  }
  if (enabled("organization")) {
    const orgCfg = cfg.organization;
    const teams = typeof orgCfg === "object" && orgCfg !== null ? orgCfg.teams ?? true : true;
    const dac = typeof orgCfg === "object" && orgCfg !== null ? orgCfg.dynamicAccessControl ?? true : true;
    plugins$1.push(
      plugins.organizationClient({
        teams: { enabled: teams },
        dynamicAccessControl: { enabled: dac }
      })
    );
  }
  if (enabled("multiSession")) {
    plugins$1.push(plugins.multiSessionClient());
  }
  if (enabled("passkey")) {
    plugins$1.push(client$1.passkeyClient());
  }
  if (enabled("magicLink")) {
    plugins$1.push(plugins.magicLinkClient());
  }
  if (enabled("username")) {
    plugins$1.push(plugins.usernameClient());
  }
  if (enabled("genericOAuth")) {
    plugins$1.push(plugins.genericOAuthClient());
  }
  return plugins$1;
}

// src/key.ts
var PREFIX_LIVE = "pk_live_";
var PREFIX_TEST = "pk_test_";
function encodePublishableKey(authUrl, opts = {}) {
  const { mode = "live", appId } = opts;
  const payload = { v: 1, authUrl, ...appId ? { appId } : {} };
  const encoded = btoa(JSON.stringify(payload));
  return `pk_${mode}_${encoded}`;
}
function decodePublishableKey(key) {
  let mode;
  let encoded;
  if (key.startsWith(PREFIX_LIVE)) {
    mode = "live";
    encoded = key.slice(PREFIX_LIVE.length);
  } else if (key.startsWith(PREFIX_TEST)) {
    mode = "test";
    encoded = key.slice(PREFIX_TEST.length);
  } else {
    throw new Error(
      `[KovaAuth] Invalid publishable key: expected "pk_live_..." or "pk_test_...". Got: "${key.slice(0, 20)}..."`
    );
  }
  let payload;
  try {
    payload = JSON.parse(atob(encoded));
  } catch {
    throw new Error(
      "[KovaAuth] Failed to decode publishable key \u2014 base64 decode or JSON parse error."
    );
  }
  if (typeof payload !== "object" || payload === null || payload.v !== 1 || typeof payload.authUrl !== "string") {
    throw new Error(
      "[KovaAuth] Publishable key payload is invalid. Please re-generate your key from the dashboard."
    );
  }
  const { authUrl, appId } = payload;
  return {
    authUrl: authUrl.replace(/\/$/, ""),
    // strip trailing slash
    appId,
    mode
  };
}
function resolveAuthUrl(opts) {
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

// src/styles/inject.ts
var VAR_MAP = {
  colorPrimary: "--ra-color-primary",
  colorPrimaryHover: "--ra-color-primary-hover",
  colorBackground: "--ra-color-bg",
  colorSurface: "--ra-color-surface",
  colorSurfaceRaised: "--ra-color-surface-raised",
  colorText: "--ra-color-text",
  colorTextSecondary: "--ra-color-text-secondary",
  colorTextTertiary: "--ra-color-text-tertiary",
  colorBorder: "--ra-color-border",
  colorBorderStrong: "--ra-color-border-strong",
  colorError: "--ra-color-error",
  colorSuccess: "--ra-color-success",
  borderRadius: "--ra-radius",
  borderRadiusSm: "--ra-radius-sm",
  fontFamily: "--ra-font",
  fontFamilyMono: "--ra-font-mono",
  fontSize: "--ra-font-size"
};
function injectAppearanceVars(vars, prevId) {
  if (typeof document === "undefined") return "ra-vars";
  if (prevId) {
    document.getElementById(prevId)?.remove();
  }
  const id = "ra-vars";
  const declarations = Object.entries(vars).map(([key, value]) => `  ${VAR_MAP[key]}: ${value};`).join("\n");
  const css = `
:root {
${declarations}
}

/* \u2500\u2500 @kova/react base styles \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
[data-ra-root] {
  font-family: var(--ra-font);
  font-size: var(--ra-font-size);
  color: var(--ra-color-text);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  box-sizing: border-box;
}
[data-ra-root] *, [data-ra-root] *::before, [data-ra-root] *::after {
  box-sizing: inherit;
}

/* Card */
[data-ra-element="card"] {
  background: var(--ra-color-surface);
  border: 1px solid var(--ra-color-border);
  border-radius: var(--ra-radius);
  overflow: hidden;
  width: 100%;
  max-width: 420px;
  margin: 0 auto;
  box-shadow: 0 24px 48px rgba(0,0,0,0.45);
}

/* Card sections */
[data-ra-element="cardHeader"] {
  padding: 28px 28px 0;
}
[data-ra-element="appLogo"] {
  width: 38px;
  height: 38px;
  object-fit: contain;
  border-radius: var(--ra-radius-sm);
  display: block;
  margin: 0 0 16px;
}
[data-ra-element="cardBody"] {
  padding: 24px 28px;
}
[data-ra-element="cardFooter"] {
  padding: 0 28px 20px;
  text-align: center;
}

/* Card title */
[data-ra-element="cardTitle"] {
  font-family: var(--ra-font-mono);
  font-size: 1.05rem;
  font-weight: 700;
  letter-spacing: -0.025em;
  color: var(--ra-color-text);
  margin: 0 0 6px;
}

/* Card subtitle */
[data-ra-element="cardSubtitle"] {
  font-size: 0.82rem;
  color: var(--ra-color-text-secondary);
  margin: 0 0 20px;
  line-height: 1.6;
}

/* Tabs */
[data-ra-element="tabsRoot"] {
  display: flex;
  gap: 2px;
  border-bottom: 1px solid var(--ra-color-border);
  margin-bottom: 20px;
}
[data-ra-element="tab"] {
  flex: 1;
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  padding: 9px 12px;
  cursor: pointer;
  font-family: var(--ra-font-mono);
  font-size: 0.78rem;
  font-weight: 500;
  color: var(--ra-color-text-tertiary);
  letter-spacing: -0.01em;
  transition: color 0.15s, border-color 0.15s;
  white-space: nowrap;
}
[data-ra-element="tab"]:hover {
  color: var(--ra-color-text-secondary);
}
[data-ra-element="tab"][aria-selected="true"] {
  color: var(--ra-color-primary);
  border-bottom-color: var(--ra-color-primary);
}

/* Form fields */
[data-ra-element="formField"] {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 14px;
}
[data-ra-element="formFieldLabel"] {
  font-family: var(--ra-font-mono);
  font-size: 0.74rem;
  font-weight: 500;
  color: var(--ra-color-text-secondary);
  letter-spacing: -0.01em;
}
[data-ra-element="formFieldInput"] {
  width: 100%;
  background: var(--ra-color-surface-raised);
  border: 1px solid var(--ra-color-border);
  border-radius: var(--ra-radius-sm);
  padding: 9px 12px;
  font-family: var(--ra-font-mono);
  font-size: 0.84rem;
  color: var(--ra-color-text);
  outline: none;
  transition: border-color 0.15s, box-shadow 0.15s;
}
[data-ra-element="formFieldInput"]:focus {
  border-color: var(--ra-color-primary);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--ra-color-primary) 15%, transparent);
}
[data-ra-element="formFieldInput"]::placeholder {
  color: var(--ra-color-text-tertiary);
}
[data-ra-element="formFieldError"] {
  font-size: 0.75rem;
  color: var(--ra-color-error);
  display: flex;
  align-items: center;
  gap: 5px;
}

/* Submit button */
[data-ra-element="formSubmitButton"] {
  width: 100%;
  background: var(--ra-color-primary);
  color: #fff;
  border: none;
  border-radius: var(--ra-radius-sm);
  padding: 10px 16px;
  font-family: var(--ra-font-mono);
  font-size: 0.84rem;
  font-weight: 600;
  cursor: pointer;
  letter-spacing: -0.01em;
  transition: background 0.15s, opacity 0.15s, transform 0.1s;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin-top: 4px;
}
[data-ra-element="formSubmitButton"]:hover:not(:disabled) {
  background: var(--ra-color-primary-hover);
}
[data-ra-element="formSubmitButton"]:active:not(:disabled) {
  transform: scale(0.99);
}
[data-ra-element="formSubmitButton"]:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

/* Social buttons */
[data-ra-element="socialButtonsRoot"] {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 18px;
}
[data-ra-element="socialButton"] {
  width: 100%;
  background: var(--ra-color-surface-raised);
  border: 1px solid var(--ra-color-border);
  border-radius: var(--ra-radius-sm);
  padding: 9px 14px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 10px;
  font-family: var(--ra-font-mono);
  font-size: 0.82rem;
  font-weight: 500;
  color: var(--ra-color-text);
  transition: background 0.12s, border-color 0.12s;
}
[data-ra-element="socialButton"]:hover:not(:disabled) {
  background: var(--ra-color-surface);
  border-color: var(--ra-color-border-strong);
}

/* Divider */
[data-ra-element="dividerRow"] {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 16px 0;
}
[data-ra-element="dividerLine"] {
  flex: 1;
  height: 1px;
  background: var(--ra-color-border);
}
[data-ra-element="dividerText"] {
  font-family: var(--ra-font-mono);
  font-size: 0.68rem;
  color: var(--ra-color-text-tertiary);
  white-space: nowrap;
  user-select: none;
}

/* Footer link */
[data-ra-element="cardFooter"] a,
[data-ra-element="cardFooter"] button {
  font-size: 0.78rem;
  color: var(--ra-color-text-secondary);
  background: none;
  border: none;
  cursor: pointer;
  text-decoration: none;
  transition: color 0.12s;
  font-family: var(--ra-font-mono);
}
[data-ra-element="cardFooter"] a:hover,
[data-ra-element="cardFooter"] button:hover {
  color: var(--ra-color-primary);
}

/* Alert banner */
[data-ra-element="alertBanner"] {
  border-radius: var(--ra-radius-sm);
  padding: 10px 12px;
  font-size: 0.78rem;
  line-height: 1.55;
  margin-bottom: 14px;
  display: flex;
  align-items: flex-start;
  gap: 8px;
}
[data-ra-element="alertBanner"][data-variant="error"] {
  background: rgba(248,113,113,0.08);
  border: 1px solid rgba(248,113,113,0.18);
  color: var(--ra-color-error);
}
[data-ra-element="alertBanner"][data-variant="success"] {
  background: rgba(74,222,128,0.08);
  border: 1px solid rgba(74,222,128,0.18);
  color: var(--ra-color-success);
}
[data-ra-element="alertBanner"][data-variant="info"] {
  background: color-mix(in srgb, var(--ra-color-primary) 8%, transparent);
  border: 1px solid color-mix(in srgb, var(--ra-color-primary) 18%, transparent);
  color: var(--ra-color-primary);
}

/* UserButton */
[data-ra-element="userButtonTrigger"] {
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--ra-radius-sm);
  padding: 4px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  transition: background 0.12s, border-color 0.12s;
}
[data-ra-element="userButtonTrigger"]:hover {
  background: rgba(255,255,255,0.05);
  border-color: var(--ra-color-border);
}
[data-ra-element="userButtonMenu"] {
  position: absolute;
  z-index: 9999;
  min-width: 220px;
  background: var(--ra-color-surface);
  border: 1px solid var(--ra-color-border-strong);
  border-radius: var(--ra-radius-sm);
  box-shadow: 0 16px 48px rgba(0,0,0,0.6);
  padding: 4px;
  overflow: hidden;
}
[data-ra-element="userButtonMenuItem"] {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 8px 10px;
  background: transparent;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-family: var(--ra-font-mono);
  font-size: 0.78rem;
  color: var(--ra-color-text-secondary);
  transition: background 0.1s, color 0.1s;
  text-align: left;
}
[data-ra-element="userButtonMenuItem"]:hover {
  background: rgba(255,255,255,0.04);
  color: var(--ra-color-text);
}
[data-ra-element="userButtonMenuItem"][data-destructive="true"]:hover {
  background: rgba(248,113,113,0.08);
  color: var(--ra-color-error);
}

/* Spinner */
@keyframes ra-spin { to { transform: rotate(360deg); } }
[data-ra-element="spinner"] {
  display: inline-block;
  width: 14px;
  height: 14px;
  border: 2px solid rgba(255,255,255,0.25);
  border-top-color: currentColor;
  border-radius: 50%;
  animation: ra-spin 0.7s linear infinite;
  flex-shrink: 0;
}

/* Skeleton shimmer */
@keyframes ra-shimmer {
  0%   { background-position: -400px 0; }
  100% { background-position: 400px 0; }
}
[data-ra-element="skeleton"] {
  border-radius: var(--ra-radius-sm);
  background: linear-gradient(
    90deg,
    var(--ra-color-surface-raised) 25%,
    rgba(255,255,255,0.04) 50%,
    var(--ra-color-surface-raised) 75%
  );
  background-size: 800px 100%;
  animation: ra-shimmer 1.4s ease-in-out infinite;
}
`.trim();
  const el = document.createElement("style");
  el.id = id;
  el.textContent = css;
  document.head.appendChild(el);
  return id;
}
var DEFAULT_VARS = {
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
  fontSize: "14px"
};
var ALL_OAUTH_PROVIDERS = [
  { id: "google", label: "Google" },
  { id: "discord", label: "Discord" },
  { id: "github", label: "GitHub" },
  { id: "microsoft", label: "Microsoft" },
  { id: "apple", label: "Apple" },
  { id: "facebook", label: "Facebook" }
];
var DEFAULT_OAUTH_PROVIDERS = ALL_OAUTH_PROVIDERS.filter(
  (p) => ["google", "discord", "github", "microsoft"].includes(p.id)
);
var KovaAuthContext = React.createContext(null);
KovaAuthContext.displayName = "KovaAuthContext";
function sessionStorageKey(publishableKey) {
  return publishableKey ? `kova-auth:${publishableKey}:session-token` : null;
}
function readStoredSessionToken(publishableKey) {
  if (typeof window === "undefined") return null;
  const key = sessionStorageKey(publishableKey);
  return key ? window.localStorage.getItem(key) : null;
}
function writeStoredSessionToken(publishableKey, token) {
  if (typeof window === "undefined") return;
  const key = sessionStorageKey(publishableKey);
  if (!key) return;
  if (token) window.localStorage.setItem(key, token);
  else window.localStorage.removeItem(key);
}
function KovaAuthProvider({
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
}) {
  const mode = React.useMemo(() => {
    if (!publishableKey) return "live";
    return publishableKey.startsWith("pk_live_") ? "live" : "test";
  }, [publishableKey]);
  const resolvedAuthUrl = React.useMemo(
    () => resolveAuthUrl({ publishableKey, authUrl }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [publishableKey, authUrl]
  );
  const [sessionToken, setSessionToken] = React.useState(
    () => initialSessionToken ?? readStoredSessionToken(publishableKey)
  );
  const setPersistentSessionToken = React.useCallback((token) => {
    writeStoredSessionToken(publishableKey, token);
    setSessionToken(token);
    onSessionTokenChange?.(token);
  }, [publishableKey, onSessionTokenChange]);
  const clearSessionToken = React.useCallback(() => setPersistentSessionToken(null), [setPersistentSessionToken]);
  React.useEffect(() => {
    if (initialSessionToken === void 0) return;
    setPersistentSessionToken(initialSessionToken);
  }, [initialSessionToken, setPersistentSessionToken]);
  const client = React.useMemo(
    () => createKovaAuthClient({
      authUrl: resolvedAuthUrl,
      publishableKey,
      plugins,
      sessionOptions,
      ...sessionToken ? { fetchOptions: { headers: { Authorization: `Bearer ${sessionToken}` } } } : {}
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [resolvedAuthUrl, publishableKey, sessionToken]
  );
  const sessionResult = client.useSession();
  React.useEffect(() => {
    if (!publishableKey || sessionToken) return;
    if (sessionResult.isPending || !sessionResult.data?.user) return;
    let cancelled = false;
    void fetch(`${resolvedAuthUrl}/api/pub/apps/${publishableKey}/session-token`, {
      method: "POST",
      credentials: "include",
      headers: { "X-Publishable-Key": publishableKey }
    }).then((r) => r.ok ? r.json() : null).then((data) => {
      if (!cancelled && data?.sessionToken) setPersistentSessionToken(data.sessionToken);
    }).catch(() => {
    });
    return () => {
      cancelled = true;
    };
  }, [publishableKey, resolvedAuthUrl, sessionResult.data, sessionResult.isPending, sessionToken, setPersistentSessionToken]);
  React.useEffect(() => {
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
      body: JSON.stringify({ code })
    }).then((r) => r.ok ? r.json() : null).then((data) => {
      if (!data?.sessionToken) return;
      setPersistentSessionToken(data.sessionToken);
      void fetch(`${resolvedAuthUrl}/api/pub/apps/${publishableKey}/me`, {
        method: "POST",
        credentials: "include",
        headers: { Authorization: `Bearer ${data.sessionToken}` }
      }).catch(() => {
      });
    }).catch(() => {
    });
  }, [resolvedAuthUrl, publishableKey, setPersistentSessionToken]);
  React.useEffect(() => {
    if (!sessionToken) return;
    void sessionResult.refetch();
  }, [sessionToken]);
  const [serverAppearance, setServerAppearance] = React.useState(null);
  React.useEffect(() => {
    if (!publishableKey) return;
    void fetch(`${resolvedAuthUrl}/api/pub/apps/${publishableKey}/appearance`, {
      cache: "no-store"
    }).then((r) => r.ok ? r.json() : null).then((data) => {
      if (data) setServerAppearance(data);
    }).catch(() => {
    });
  }, [resolvedAuthUrl, publishableKey]);
  React.useEffect(() => {
    if (!manageFavicon) return;
    const url = serverAppearance?.faviconUrl;
    if (!url) return;
    let el = document.querySelector("link[rel~='icon']");
    if (!el) {
      el = document.createElement("link");
      el.rel = "icon";
      document.head.appendChild(el);
    }
    el.href = url;
  }, [manageFavicon, serverAppearance?.faviconUrl]);
  const vars = React.useMemo(() => {
    const serverOverrides = serverAppearance ? {
      ...serverAppearance.primaryColor ? { colorPrimary: serverAppearance.primaryColor } : {},
      ...serverAppearance.primaryColor ? { colorPrimaryHover: serverAppearance.primaryColor } : {},
      ...serverAppearance.backgroundColor ? { colorBackground: serverAppearance.backgroundColor } : {}
    } : {};
    const merged = { ...DEFAULT_VARS, ...serverOverrides, ...appearance?.variables ?? {} };
    if (!appearance?.variables?.colorPrimaryHover && merged.colorPrimary !== DEFAULT_VARS.colorPrimary) {
      merged.colorPrimaryHover = merged.colorPrimary;
    }
    return merged;
  }, [serverAppearance, appearance?.variables]);
  const styleIdRef = React.useRef(null);
  React.useEffect(() => {
    styleIdRef.current = injectAppearanceVars(vars, styleIdRef.current);
  }, [vars]);
  const resolvedProviders = React.useMemo(() => {
    if (oauthProviders) return oauthProviders;
    if (serverAppearance) {
      return ALL_OAUTH_PROVIDERS.filter(
        (p) => serverAppearance.enabledProviders.includes(p.id)
      );
    }
    return DEFAULT_OAUTH_PROVIDERS;
  }, [oauthProviders, serverAppearance]);
  const value = React.useMemo(
    () => ({
      client,
      authUrl: resolvedAuthUrl,
      publishableKey,
      appearance: appearance ?? {},
      vars,
      oauthProviders: resolvedProviders,
      serverAppearance,
      isAppearanceLoaded: !publishableKey || serverAppearance !== null,
      afterSignInUrl,
      afterSignUpUrl,
      afterSignOutUrl,
      mode,
      isPlatformAdmin,
      sessionResult,
      sessionToken: sessionToken ?? sessionResult.data?.session?.["token"] ?? null,
      clearSessionToken,
      hasBearerSession: sessionToken !== null
    }),
    [
      client,
      resolvedAuthUrl,
      publishableKey,
      appearance,
      vars,
      resolvedProviders,
      serverAppearance,
      afterSignInUrl,
      afterSignUpUrl,
      afterSignOutUrl,
      mode,
      isPlatformAdmin,
      sessionResult,
      clearSessionToken,
      sessionToken
    ]
  );
  return /* @__PURE__ */ jsxRuntime.jsx(KovaAuthContext.Provider, { value, children });
}
function useKovaAuth() {
  const ctx = React.useContext(KovaAuthContext);
  if (!ctx) {
    throw new Error(
      "[KovaAuth] `useKovaAuth` was called outside of <KovaAuthProvider>. Make sure your component is a descendant of <KovaAuthProvider>."
    );
  }
  return ctx;
}
function mergeAppearance(base, override) {
  if (!override) return base;
  return {
    variables: { ...base.variables, ...override.variables },
    elements: { ...base.elements, ...override.elements }
  };
}
function useLinkedAccounts() {
  const { client } = useKovaAuth();
  const [accounts, setAccounts] = React.useState([]);
  const [isLoaded, setIsLoaded] = React.useState(false);
  const [isUpdating, setIsUpdating] = React.useState(false);
  const [error, setError] = React.useState(null);
  const fetchAccounts = React.useCallback(async () => {
    const c = client;
    if (typeof c.listAccounts !== "function") {
      setIsLoaded(true);
      return;
    }
    try {
      const res = await c.listAccounts();
      if (res.error?.message) {
        setError(res.error.message);
      } else {
        const raw = res.data ?? [];
        setAccounts(
          raw.map(
            (a) => ({
              id: a.id,
              providerId: a.providerId,
              accountId: a.accountId,
              createdAt: normaliseDate(a.createdAt),
              accessToken: a.accessToken ?? null,
              scopes: a.scopes ?? void 0
            })
          )
        );
        setError(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load accounts");
    } finally {
      setIsLoaded(true);
    }
  }, [client]);
  React.useEffect(() => {
    void fetchAccounts();
  }, [fetchAccounts]);
  const linkAccount = React.useCallback(
    async ({
      provider,
      callbackURL = window.location.pathname
    }) => {
      setIsUpdating(true);
      setError(null);
      try {
        const c = client;
        if (typeof c.linkSocial !== "function") {
          setError("linkSocial is not available on this client build.");
          return;
        }
        const res = await c.linkSocial({ provider, callbackURL });
        if (res?.error?.message) {
          setError(res.error.message);
        }
        setIsUpdating(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to link account");
        setIsUpdating(false);
      }
    },
    [client]
  );
  return {
    accounts,
    isLoaded,
    isUpdating,
    error,
    linkAccount,
    refetch: fetchAccounts
  };
}
function normaliseDate(v) {
  if (!v) return (/* @__PURE__ */ new Date()).toISOString();
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "number") return new Date(v).toISOString();
  return v;
}
function GoogleIcon({ size = 18, style }) {
  return /* @__PURE__ */ jsxRuntime.jsxs(
    "svg",
    {
      width: size,
      height: size,
      viewBox: "0 0 24 24",
      fill: "none",
      "aria-hidden": "true",
      style,
      children: [
        /* @__PURE__ */ jsxRuntime.jsx(
          "path",
          {
            d: "M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z",
            fill: "#4285F4"
          }
        ),
        /* @__PURE__ */ jsxRuntime.jsx(
          "path",
          {
            d: "M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z",
            fill: "#34A853"
          }
        ),
        /* @__PURE__ */ jsxRuntime.jsx(
          "path",
          {
            d: "M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z",
            fill: "#FBBC05"
          }
        ),
        /* @__PURE__ */ jsxRuntime.jsx(
          "path",
          {
            d: "M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z",
            fill: "#EA4335"
          }
        )
      ]
    }
  );
}
function DiscordIcon({ size = 18, style }) {
  return /* @__PURE__ */ jsxRuntime.jsxs(
    "svg",
    {
      width: size,
      height: size,
      viewBox: "0 0 24 24",
      fill: "none",
      "aria-hidden": "true",
      style,
      children: [
        /* @__PURE__ */ jsxRuntime.jsx("rect", { width: "24", height: "24", rx: "6", fill: "#5865F2" }),
        /* @__PURE__ */ jsxRuntime.jsx(
          "path",
          {
            fill: "white",
            d: "M19.27 5.33C17.94 4.71 16.5 4.26 15 4a.09.09 0 0 0-.07.03c-.18.33-.39.76-.53 1.09a16.09 16.09 0 0 0-4.8 0 11.12 11.12 0 0 0-.54-1.09.07.07 0 0 0-.07-.03c-1.5.26-2.93.71-4.27 1.33a.06.06 0 0 0-.028.025C2.446 8.895 1.706 12.37 2.01 15.8c.001.015.01.03.02.04a16.68 16.68 0 0 0 4.99 2.52c.03.01.06 0 .07-.02.38-.52.72-1.07 1.02-1.65.02-.03.01-.07-.03-.08a10.98 10.98 0 0 1-1.56-.74c-.03-.02-.04-.06-.01-.09l.31-.24c.02-.02.05-.02.07-.01 3.28 1.5 6.83 1.5 10.07 0a.07.07 0 0 1 .07.01l.31.24c.03.03.02.07-.01.09-.5.29-1.02.54-1.56.74-.04.01-.05.05-.03.08.3.58.64 1.13 1.01 1.65.02.02.05.03.08.02a16.62 16.62 0 0 0 5-2.52c.01-.01.02-.02.02-.04.36-3.72-.6-6.95-2.55-9.83a.05.05 0 0 0-.027-.024zM8.52 13.9c-1.04 0-1.9-.95-1.9-2.12 0-1.17.84-2.12 1.9-2.12 1.07 0 1.91.96 1.9 2.12 0 1.17-.84 2.12-1.9 2.12zm7 0c-1.04 0-1.9-.95-1.9-2.12 0-1.17.84-2.12 1.9-2.12 1.07 0 1.91.96 1.9 2.12 0 1.17-.83 2.12-1.9 2.12z"
          }
        )
      ]
    }
  );
}
function GitHubIcon({ size = 18, style }) {
  return /* @__PURE__ */ jsxRuntime.jsx(
    "svg",
    {
      width: size,
      height: size,
      viewBox: "0 0 24 24",
      fill: "currentColor",
      "aria-hidden": "true",
      style,
      children: /* @__PURE__ */ jsxRuntime.jsx("path", { d: "M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844a9.59 9.59 0 0 1 2.504.337c1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0 0 22 12.017C22 6.484 17.522 2 12 2z" })
    }
  );
}
function MicrosoftIcon({ size = 18, style }) {
  return /* @__PURE__ */ jsxRuntime.jsxs(
    "svg",
    {
      width: size,
      height: size,
      viewBox: "0 0 24 24",
      fill: "none",
      "aria-hidden": "true",
      style,
      children: [
        /* @__PURE__ */ jsxRuntime.jsx("path", { d: "M11.4 11.4H2V2h9.4v9.4z", fill: "#F35325" }),
        /* @__PURE__ */ jsxRuntime.jsx("path", { d: "M22 11.4h-9.4V2H22v9.4z", fill: "#81BC06" }),
        /* @__PURE__ */ jsxRuntime.jsx("path", { d: "M11.4 22H2v-9.4h9.4V22z", fill: "#05A6F0" }),
        /* @__PURE__ */ jsxRuntime.jsx("path", { d: "M22 22h-9.4v-9.4H22V22z", fill: "#FFBA08" })
      ]
    }
  );
}
function TwitterIcon({ size = 18, style }) {
  return /* @__PURE__ */ jsxRuntime.jsx(
    "svg",
    {
      width: size,
      height: size,
      viewBox: "0 0 24 24",
      fill: "currentColor",
      "aria-hidden": "true",
      style,
      children: /* @__PURE__ */ jsxRuntime.jsx("path", { d: "M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" })
    }
  );
}
function AppleIcon({ size = 18, style }) {
  return /* @__PURE__ */ jsxRuntime.jsx(
    "svg",
    {
      width: size,
      height: size,
      viewBox: "0 0 24 24",
      fill: "currentColor",
      "aria-hidden": "true",
      style,
      children: /* @__PURE__ */ jsxRuntime.jsx("path", { d: "M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" })
    }
  );
}
function FacebookIcon({ size = 18, style }) {
  return /* @__PURE__ */ jsxRuntime.jsx(
    "svg",
    {
      width: size,
      height: size,
      viewBox: "0 0 24 24",
      fill: "#1877F2",
      "aria-hidden": "true",
      style,
      children: /* @__PURE__ */ jsxRuntime.jsx("path", { d: "M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" })
    }
  );
}
function KeyIcon({ size = 18, style }) {
  return /* @__PURE__ */ jsxRuntime.jsxs(
    "svg",
    {
      width: size,
      height: size,
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 2,
      strokeLinecap: "round",
      strokeLinejoin: "round",
      "aria-hidden": "true",
      style,
      children: [
        /* @__PURE__ */ jsxRuntime.jsx("circle", { cx: "7.5", cy: "15.5", r: "5.5" }),
        /* @__PURE__ */ jsxRuntime.jsx("path", { d: "M21 2l-9.6 9.6" }),
        /* @__PURE__ */ jsxRuntime.jsx("path", { d: "M15.5 7.5l3 3L22 7l-3-3" })
      ]
    }
  );
}
function MailIcon({ size = 18, style }) {
  return /* @__PURE__ */ jsxRuntime.jsxs(
    "svg",
    {
      width: size,
      height: size,
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 2,
      strokeLinecap: "round",
      strokeLinejoin: "round",
      "aria-hidden": "true",
      style,
      children: [
        /* @__PURE__ */ jsxRuntime.jsx("rect", { x: "2", y: "4", width: "20", height: "16", rx: "2" }),
        /* @__PURE__ */ jsxRuntime.jsx("path", { d: "m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" })
      ]
    }
  );
}
function FingerprintIcon({ size = 18, style }) {
  return /* @__PURE__ */ jsxRuntime.jsxs(
    "svg",
    {
      width: size,
      height: size,
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 2,
      strokeLinecap: "round",
      strokeLinejoin: "round",
      "aria-hidden": "true",
      style,
      children: [
        /* @__PURE__ */ jsxRuntime.jsx("path", { d: "M2 13.5V11a10 10 0 0 1 20 0v2.5" }),
        /* @__PURE__ */ jsxRuntime.jsx("path", { d: "M6 12a6 6 0 0 1 12 0" }),
        /* @__PURE__ */ jsxRuntime.jsx("path", { d: "M10 12a2 2 0 0 1 4 0c0 3-2 4-2 4" }),
        /* @__PURE__ */ jsxRuntime.jsx("path", { d: "M10 19h.01" })
      ]
    }
  );
}
function LogOutIcon({ size = 16, style }) {
  return /* @__PURE__ */ jsxRuntime.jsxs(
    "svg",
    {
      width: size,
      height: size,
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 2,
      strokeLinecap: "round",
      strokeLinejoin: "round",
      "aria-hidden": "true",
      style,
      children: [
        /* @__PURE__ */ jsxRuntime.jsx("path", { d: "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" }),
        /* @__PURE__ */ jsxRuntime.jsx("polyline", { points: "16 17 21 12 16 7" }),
        /* @__PURE__ */ jsxRuntime.jsx("line", { x1: "21", y1: "12", x2: "9", y2: "12" })
      ]
    }
  );
}
function SettingsIcon({ size = 16, style }) {
  return /* @__PURE__ */ jsxRuntime.jsxs(
    "svg",
    {
      width: size,
      height: size,
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 2,
      strokeLinecap: "round",
      strokeLinejoin: "round",
      "aria-hidden": "true",
      style,
      children: [
        /* @__PURE__ */ jsxRuntime.jsx("path", { d: "M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" }),
        /* @__PURE__ */ jsxRuntime.jsx("circle", { cx: "12", cy: "12", r: "3" })
      ]
    }
  );
}
function UserIcon({ size = 16, style }) {
  return /* @__PURE__ */ jsxRuntime.jsxs(
    "svg",
    {
      width: size,
      height: size,
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 2,
      strokeLinecap: "round",
      strokeLinejoin: "round",
      "aria-hidden": "true",
      style,
      children: [
        /* @__PURE__ */ jsxRuntime.jsx("path", { d: "M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" }),
        /* @__PURE__ */ jsxRuntime.jsx("circle", { cx: "12", cy: "7", r: "4" })
      ]
    }
  );
}
function BuildingIcon({ size = 16, style }) {
  return /* @__PURE__ */ jsxRuntime.jsxs(
    "svg",
    {
      width: size,
      height: size,
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 2,
      strokeLinecap: "round",
      strokeLinejoin: "round",
      "aria-hidden": "true",
      style,
      children: [
        /* @__PURE__ */ jsxRuntime.jsx("rect", { x: "3", y: "3", width: "18", height: "18", rx: "2" }),
        /* @__PURE__ */ jsxRuntime.jsx("path", { d: "M3 9h18" }),
        /* @__PURE__ */ jsxRuntime.jsx("path", { d: "M9 21V9" })
      ]
    }
  );
}
function CheckIcon({ size = 14, style }) {
  return /* @__PURE__ */ jsxRuntime.jsx(
    "svg",
    {
      width: size,
      height: size,
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 2.5,
      strokeLinecap: "round",
      strokeLinejoin: "round",
      "aria-hidden": "true",
      style,
      children: /* @__PURE__ */ jsxRuntime.jsx("path", { d: "M20 6 9 17l-5-5" })
    }
  );
}
function ChevronDownIcon({ size = 12, style }) {
  return /* @__PURE__ */ jsxRuntime.jsx(
    "svg",
    {
      width: size,
      height: size,
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 2,
      strokeLinecap: "round",
      strokeLinejoin: "round",
      "aria-hidden": "true",
      style,
      children: /* @__PURE__ */ jsxRuntime.jsx("path", { d: "m6 9 6 6 6-6" })
    }
  );
}
function LinkIcon({ size = 16, style }) {
  return /* @__PURE__ */ jsxRuntime.jsxs(
    "svg",
    {
      width: size,
      height: size,
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 2,
      strokeLinecap: "round",
      strokeLinejoin: "round",
      "aria-hidden": "true",
      style,
      children: [
        /* @__PURE__ */ jsxRuntime.jsx("path", { d: "M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" }),
        /* @__PURE__ */ jsxRuntime.jsx("path", { d: "M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" })
      ]
    }
  );
}
function ProviderIcon({ provider, size, style }) {
  switch (provider.toLowerCase()) {
    case "google":
      return /* @__PURE__ */ jsxRuntime.jsx(GoogleIcon, { size, style });
    case "discord":
      return /* @__PURE__ */ jsxRuntime.jsx(DiscordIcon, { size, style });
    case "github":
      return /* @__PURE__ */ jsxRuntime.jsx(GitHubIcon, { size, style });
    case "microsoft":
      return /* @__PURE__ */ jsxRuntime.jsx(MicrosoftIcon, { size, style });
    case "apple":
      return /* @__PURE__ */ jsxRuntime.jsx(AppleIcon, { size, style });
    case "facebook":
      return /* @__PURE__ */ jsxRuntime.jsx(FacebookIcon, { size, style });
    case "twitter":
    case "x":
      return /* @__PURE__ */ jsxRuntime.jsx(TwitterIcon, { size, style });
    default:
      return /* @__PURE__ */ jsxRuntime.jsx(KeyIcon, { size, style });
  }
}
function providerLabel(id) {
  const labels = {
    google: "Google",
    discord: "Discord",
    github: "GitHub",
    microsoft: "Microsoft",
    apple: "Apple",
    facebook: "Facebook",
    twitter: "Twitter / X"
  };
  return labels[id.toLowerCase()] ?? id.charAt(0).toUpperCase() + id.slice(1);
}
function Spinner({ size = 14, style }) {
  return /* @__PURE__ */ jsxRuntime.jsx(
    "span",
    {
      "data-ra-element": "spinner",
      style: { width: size, height: size, borderWidth: size / 7, ...style },
      "aria-label": "Loading",
      role: "status"
    }
  );
}
function Skeleton({
  width,
  height,
  style
}) {
  return /* @__PURE__ */ jsxRuntime.jsx(
    "div",
    {
      "data-ra-element": "skeleton",
      style: { width, height: height ?? 16, ...style }
    }
  );
}
function Alert({
  variant,
  children,
  style
}) {
  if (!children) return null;
  return /* @__PURE__ */ jsxRuntime.jsx(
    "div",
    {
      "data-ra-element": "alertBanner",
      "data-variant": variant,
      role: variant === "error" ? "alert" : "status",
      style,
      children
    }
  );
}
function RateLimitBanner({
  secondsRemaining,
  totalSeconds
}) {
  if (secondsRemaining <= 0) return null;
  const safeTotal = Math.max(1, totalSeconds);
  const progress = Math.min(1, secondsRemaining / safeTotal);
  const message = secondsRemaining === 1 ? "Too many attempts. Try again in 1 second." : `Too many attempts. Try again in ${secondsRemaining}s.`;
  return /* @__PURE__ */ jsxRuntime.jsxs(
    "div",
    {
      "data-ra-element": "rateLimitBanner",
      role: "alert",
      "aria-live": "polite",
      "aria-atomic": "true",
      style: {
        borderRadius: "var(--ra-border-radius-sm)",
        border: "1px solid color-mix(in srgb, var(--ra-color-error) 40%, transparent)",
        background: "color-mix(in srgb, var(--ra-color-error) 10%, var(--ra-color-surface))",
        padding: "10px 12px",
        display: "flex",
        flexDirection: "column",
        gap: 8,
        margin: "4px 0"
      },
      children: [
        /* @__PURE__ */ jsxRuntime.jsxs(
          "div",
          {
            style: {
              display: "flex",
              alignItems: "center",
              gap: 8
            },
            children: [
              /* @__PURE__ */ jsxRuntime.jsxs(
                "svg",
                {
                  role: "img",
                  "aria-hidden": "true",
                  width: "14",
                  height: "14",
                  viewBox: "0 0 24 24",
                  fill: "none",
                  stroke: "var(--ra-color-error)",
                  strokeWidth: "2",
                  strokeLinecap: "round",
                  strokeLinejoin: "round",
                  style: { flexShrink: 0 },
                  children: [
                    /* @__PURE__ */ jsxRuntime.jsx("rect", { x: "3", y: "11", width: "18", height: "11", rx: "2", ry: "2" }),
                    /* @__PURE__ */ jsxRuntime.jsx("path", { d: "M7 11V7a5 5 0 0 1 10 0v4" })
                  ]
                }
              ),
              /* @__PURE__ */ jsxRuntime.jsx(
                "span",
                {
                  style: {
                    fontSize: "0.8rem",
                    color: "var(--ra-color-error)",
                    fontFamily: "var(--ra-font-family)",
                    fontWeight: 500,
                    lineHeight: 1.3
                  },
                  children: message
                }
              )
            ]
          }
        ),
        /* @__PURE__ */ jsxRuntime.jsx(
          "div",
          {
            role: "progressbar",
            "aria-valuenow": secondsRemaining,
            "aria-valuemin": 0,
            "aria-valuemax": safeTotal,
            "aria-label": `Rate limit countdown: ${secondsRemaining} seconds remaining`,
            style: {
              height: 3,
              borderRadius: 2,
              background: "color-mix(in srgb, var(--ra-color-error) 20%, var(--ra-color-border))",
              overflow: "hidden"
            },
            children: /* @__PURE__ */ jsxRuntime.jsx(
              "div",
              {
                style: {
                  height: "100%",
                  width: `${progress * 100}%`,
                  background: "var(--ra-color-error)",
                  borderRadius: 2,
                  transition: "width 0.2s linear"
                }
              }
            )
          }
        )
      ]
    }
  );
}
function Divider({
  label = "or",
  elements
}) {
  return /* @__PURE__ */ jsxRuntime.jsxs("div", { "data-ra-element": "dividerRow", style: elements?.dividerRow, children: [
    /* @__PURE__ */ jsxRuntime.jsx("div", { "data-ra-element": "dividerLine", style: elements?.dividerLine }),
    /* @__PURE__ */ jsxRuntime.jsx("span", { "data-ra-element": "dividerText", style: elements?.dividerText, children: label }),
    /* @__PURE__ */ jsxRuntime.jsx("div", { "data-ra-element": "dividerLine", style: elements?.dividerLine })
  ] });
}
function FormField({
  id,
  label,
  type = "text",
  value,
  onChange,
  placeholder,
  required,
  autoComplete,
  error,
  disabled,
  elements
}) {
  return /* @__PURE__ */ jsxRuntime.jsxs("div", { "data-ra-element": "formField", style: elements?.formField, children: [
    /* @__PURE__ */ jsxRuntime.jsx(
      "label",
      {
        htmlFor: id,
        "data-ra-element": "formFieldLabel",
        style: elements?.formFieldLabel,
        children: label
      }
    ),
    /* @__PURE__ */ jsxRuntime.jsx(
      "input",
      {
        id,
        type,
        value,
        onChange: (e) => onChange(e.target.value),
        placeholder,
        required,
        autoComplete,
        disabled,
        "aria-invalid": !!error,
        "aria-describedby": error ? `${id}-error` : void 0,
        "data-ra-element": "formFieldInput",
        style: {
          ...error ? { borderColor: "var(--ra-color-error)" } : {},
          ...elements?.formFieldInput
        }
      }
    ),
    error && /* @__PURE__ */ jsxRuntime.jsx(
      "span",
      {
        id: `${id}-error`,
        "data-ra-element": "formFieldError",
        style: elements?.formFieldError,
        role: "alert",
        children: error
      }
    )
  ] });
}
function SubmitButton({
  isLoading,
  children,
  disabled,
  elements,
  style
}) {
  return /* @__PURE__ */ jsxRuntime.jsx(
    "button",
    {
      type: "submit",
      disabled: disabled ?? isLoading,
      "data-ra-element": "formSubmitButton",
      style: { ...elements?.formSubmitButton, ...style },
      children: isLoading ? /* @__PURE__ */ jsxRuntime.jsxs(jsxRuntime.Fragment, { children: [
        /* @__PURE__ */ jsxRuntime.jsx(Spinner, { size: 13, style: { borderTopColor: "#fff" } }),
        "Loading\u2026"
      ] }) : children
    }
  );
}
function Avatar({
  src,
  name,
  size = 32,
  style
}) {
  const [imgError, setImgError] = React__default.default.useState(false);
  const initials = name ? name.trim().split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("") : "?";
  const base = {
    width: size,
    height: size,
    borderRadius: "50%",
    flexShrink: 0,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    fontFamily: "var(--ra-font-mono)",
    fontWeight: 700,
    fontSize: size * 0.38,
    ...style
  };
  if (src && !imgError) {
    return /* @__PURE__ */ jsxRuntime.jsx("span", { style: base, children: /* @__PURE__ */ jsxRuntime.jsx(
      "img",
      {
        src,
        alt: name ?? "Avatar",
        width: size,
        height: size,
        style: { width: size, height: size, objectFit: "cover", borderRadius: "50%" },
        onError: () => setImgError(true),
        referrerPolicy: "no-referrer"
      }
    ) });
  }
  return /* @__PURE__ */ jsxRuntime.jsx(
    "span",
    {
      style: {
        ...base,
        background: "var(--ra-color-primary)",
        color: "#fff"
      },
      children: initials
    }
  );
}
function KovaAuthBranding() {
  const { serverAppearance } = useKovaAuth();
  if (serverAppearance?.hideBranding) return null;
  return /* @__PURE__ */ jsxRuntime.jsxs(
    "a",
    {
      href: "https://auth.115jon.site",
      target: "_blank",
      rel: "noopener noreferrer",
      "data-ra-element": "brandingBadge",
      style: {
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        fontFamily: "var(--ra-font-mono)",
        fontSize: "0.68rem",
        color: "var(--ra-color-text-tertiary)",
        textDecoration: "none",
        opacity: 0.75,
        transition: "opacity 0.15s",
        marginTop: 8
      },
      onMouseEnter: (e) => {
        e.currentTarget.style.opacity = "1";
      },
      onMouseLeave: (e) => {
        e.currentTarget.style.opacity = "0.75";
      },
      children: [
        /* @__PURE__ */ jsxRuntime.jsxs("svg", { width: "12", height: "12", viewBox: "0 0 24 24", fill: "none", "aria-hidden": "true", children: [
          /* @__PURE__ */ jsxRuntime.jsx("circle", { cx: "12", cy: "12", r: "10", fill: "var(--ra-color-primary)", opacity: "0.9" }),
          /* @__PURE__ */ jsxRuntime.jsx("path", { d: "M8 16V8h5a3 3 0 0 1 0 6H8", stroke: "#fff", strokeWidth: "2", strokeLinecap: "round" })
        ] }),
        "Secured by kova-auth"
      ]
    }
  );
}
function DevModeBadge() {
  const { mode } = useKovaAuth();
  if (mode !== "test") return null;
  return /* @__PURE__ */ jsxRuntime.jsxs(
    "div",
    {
      "data-ra-element": "devModeBadge",
      style: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        padding: "6px 0 0",
        borderTop: "1px dashed color-mix(in srgb, var(--ra-color-border-strong) 60%, transparent)",
        marginTop: 10,
        width: "100%"
      },
      children: [
        /* @__PURE__ */ jsxRuntime.jsx("span", { style: {
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: "#f59e0b",
          flexShrink: 0,
          boxShadow: "0 0 5px #f59e0b88"
        } }),
        /* @__PURE__ */ jsxRuntime.jsx("span", { style: {
          fontFamily: "var(--ra-font-mono)",
          fontSize: "0.65rem",
          color: "#f59e0b",
          letterSpacing: "0.04em",
          fontWeight: 600
        }, children: "DEVELOPMENT INSTANCE" })
      ]
    }
  );
}
function Card({
  children,
  elements,
  style,
  className
}) {
  return /* @__PURE__ */ jsxRuntime.jsx(
    "div",
    {
      "data-ra-element": "card",
      "data-ra-root": true,
      style: { ...elements?.card, ...style },
      className,
      children
    }
  );
}
function CardHeader({
  title,
  subtitle,
  elements
}) {
  const { serverAppearance } = useKovaAuth();
  const logoUrl = serverAppearance?.logoUrl;
  const logoAlt = `${serverAppearance?.displayName ?? "Application"} logo`;
  return /* @__PURE__ */ jsxRuntime.jsxs("div", { "data-ra-element": "cardHeader", style: elements?.cardHeader, children: [
    logoUrl && /* @__PURE__ */ jsxRuntime.jsx(
      "img",
      {
        src: logoUrl,
        alt: logoAlt,
        "data-ra-element": "appLogo",
        style: elements?.appLogo
      }
    ),
    /* @__PURE__ */ jsxRuntime.jsx("h1", { "data-ra-element": "cardTitle", style: elements?.cardTitle, children: title }),
    subtitle && /* @__PURE__ */ jsxRuntime.jsx("p", { "data-ra-element": "cardSubtitle", style: elements?.cardSubtitle, children: subtitle })
  ] });
}
function CardBody({
  children,
  elements
}) {
  return /* @__PURE__ */ jsxRuntime.jsx("div", { "data-ra-element": "cardBody", style: elements?.cardBody, children });
}
function CardFooter({
  children,
  elements
}) {
  return /* @__PURE__ */ jsxRuntime.jsxs("div", { "data-ra-element": "cardFooter", style: elements?.cardFooter, children: [
    children,
    /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { display: "flex", flexDirection: "column", alignItems: "center" }, children: [
      /* @__PURE__ */ jsxRuntime.jsx(KovaAuthBranding, {}),
      /* @__PURE__ */ jsxRuntime.jsx(DevModeBadge, {})
    ] })
  ] });
}
function Tabs({
  tabs,
  active,
  onSelect,
  elements
}) {
  return /* @__PURE__ */ jsxRuntime.jsx(
    "div",
    {
      role: "tablist",
      "data-ra-element": "tabsRoot",
      style: elements?.tabsRoot,
      children: tabs.map((tab) => /* @__PURE__ */ jsxRuntime.jsx(
        "button",
        {
          role: "tab",
          type: "button",
          "aria-selected": active === tab.id,
          onClick: () => onSelect(tab.id),
          "data-ra-element": "tab",
          style: active === tab.id ? { ...elements?.tab, ...elements?.tabActive } : elements?.tab,
          children: tab.label
        },
        tab.id
      ))
    }
  );
}
var KNOWN_PROVIDERS = [
  "credential",
  "google",
  "discord",
  "github",
  "microsoft",
  "apple",
  "facebook"
];
function displayLabel(providerId) {
  if (providerId === "credential") return "Password / Email";
  return providerLabel(providerId);
}
function ProviderDisplayIcon({ provider }) {
  if (provider === "credential") {
    return /* @__PURE__ */ jsxRuntime.jsx(KeyIcon, { size: 15, style: { color: "var(--ra-color-text-secondary)" } });
  }
  return /* @__PURE__ */ jsxRuntime.jsx(ProviderIcon, { provider, size: 15 });
}
function ConnectedAccounts({
  providers = [...KNOWN_PROVIDERS],
  callbackURL,
  elements,
  layout = "compact"
}) {
  const { oauthProviders } = useKovaAuth();
  const { accounts, isLoaded, isUpdating, error, linkAccount } = useLinkedAccounts();
  const [linkingProvider, setLinkingProvider] = React.useState(null);
  const handleLink = React.useCallback(
    async (providerId) => {
      setLinkingProvider(providerId);
      await linkAccount({
        provider: providerId,
        callbackURL: callbackURL ?? window.location.pathname
      });
      setLinkingProvider(null);
    },
    [linkAccount, callbackURL]
  );
  const activeOAuthIds = new Set(oauthProviders.map((p) => p.id));
  const visibleProviders = providers.filter(
    (p) => p === "credential" || activeOAuthIds.has(p)
  );
  const connectedIds = new Set(accounts.map((a) => a.providerId));
  if (!isLoaded) {
    return /* @__PURE__ */ jsxRuntime.jsx(
      "div",
      {
        "data-ra-element": "connectedAccountsSection",
        style: {
          display: "flex",
          flexDirection: "column",
          gap: 6,
          padding: "8px 0",
          ...elements?.connectedAccountsSection
        },
        children: [0, 1, 2].map((i) => /* @__PURE__ */ jsxRuntime.jsx(
          "div",
          {
            "data-ra-element": "skeleton",
            style: { height: 32, borderRadius: 6, opacity: 0.3 + i * 0.1 }
          },
          i
        ))
      }
    );
  }
  const gridStyle = layout === "wide" ? {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
    gap: 6
  } : {
    display: "flex",
    flexDirection: "column",
    gap: 4
  };
  return /* @__PURE__ */ jsxRuntime.jsxs(
    "div",
    {
      "data-ra-element": "connectedAccountsSection",
      style: { ...elements?.connectedAccountsSection },
      children: [
        error && /* @__PURE__ */ jsxRuntime.jsx(Alert, { variant: "error", style: { marginBottom: 8, fontSize: "0.75rem" }, children: error }),
        /* @__PURE__ */ jsxRuntime.jsx("div", { style: gridStyle, children: visibleProviders.map((providerId) => {
          const isConnected = connectedIds.has(providerId);
          const isLinking = linkingProvider === providerId;
          const busy = isUpdating || !!linkingProvider;
          return /* @__PURE__ */ jsxRuntime.jsxs(
            "div",
            {
              "data-ra-element": "connectedAccountsItem",
              style: {
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "5px 0",
                ...elements?.connectedAccountsItem
              },
              children: [
                /* @__PURE__ */ jsxRuntime.jsx(ProviderDisplayIcon, { provider: providerId }),
                /* @__PURE__ */ jsxRuntime.jsx(
                  "span",
                  {
                    "data-ra-element": "connectedAccountsItemLabel",
                    style: {
                      flex: 1,
                      fontFamily: "var(--ra-font-mono)",
                      fontSize: "0.76rem",
                      color: isConnected ? "var(--ra-color-text)" : "var(--ra-color-text-secondary)",
                      ...elements?.connectedAccountsItemLabel
                    },
                    children: displayLabel(providerId)
                  }
                ),
                isConnected ? /* @__PURE__ */ jsxRuntime.jsxs(
                  "span",
                  {
                    style: {
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 3,
                      fontFamily: "var(--ra-font-mono)",
                      fontSize: "0.64rem",
                      color: "var(--ra-color-success)",
                      fontWeight: 600
                    },
                    title: "Connected",
                    children: [
                      /* @__PURE__ */ jsxRuntime.jsx(CheckIcon, { size: 11 }),
                      "Connected"
                    ]
                  }
                ) : providerId === "credential" ? (
                  // credential = password — can't link via OAuth redirect
                  /* @__PURE__ */ jsxRuntime.jsx(
                    "span",
                    {
                      style: {
                        fontFamily: "var(--ra-font-mono)",
                        fontSize: "0.64rem",
                        color: "var(--ra-color-text-tertiary)"
                      },
                      children: "Not set"
                    }
                  )
                ) : /* @__PURE__ */ jsxRuntime.jsxs(
                  "button",
                  {
                    type: "button",
                    "data-ra-element": "connectedAccountsConnectButton",
                    disabled: busy,
                    onClick: () => void handleLink(providerId),
                    style: {
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      padding: "3px 8px",
                      borderRadius: "var(--ra-radius-sm, 5px)",
                      border: "1px solid var(--ra-color-border-strong)",
                      background: "transparent",
                      color: "var(--ra-color-primary)",
                      fontFamily: "var(--ra-font-mono)",
                      fontSize: "0.64rem",
                      fontWeight: 600,
                      cursor: busy ? "not-allowed" : "pointer",
                      opacity: busy ? 0.6 : 1,
                      transition: "opacity 0.15s, border-color 0.15s",
                      ...elements?.connectedAccountsConnectButton
                    },
                    "aria-label": `Connect ${displayLabel(providerId)}`,
                    children: [
                      isLinking ? /* @__PURE__ */ jsxRuntime.jsx(Spinner, { size: 10 }) : null,
                      isLinking ? "Connecting\u2026" : "Connect"
                    ]
                  }
                )
              ]
            },
            providerId
          );
        }) })
      ]
    }
  );
}

// src/hooks/use-organization.ts
function useOrganization() {
  const { client } = useKovaAuth();
  const orgResult = client.useActiveOrganization?.();
  if (!orgResult) {
    return { organization: null, membership: null, isLoaded: true };
  }
  const isLoaded = !orgResult.isPending;
  const raw = orgResult.data;
  const organization = raw ? {
    id: raw.id,
    name: raw.name,
    slug: raw.slug,
    logo: raw.logo ?? null,
    metadata: raw.metadata ?? null,
    createdAt: new Date(raw.createdAt ?? Date.now())
  } : null;
  const membership = raw?.membership ? {
    id: raw.membership.id,
    userId: raw.membership.userId,
    organizationId: raw.membership.organizationId,
    role: raw.membership.role,
    createdAt: new Date(raw.membership.createdAt ?? Date.now())
  } : null;
  return { organization, membership, isLoaded };
}
function OrgAvatar({
  name,
  logo,
  size = 24
}) {
  const [imgError, setImgError] = React.useState(false);
  const initial = name[0]?.toUpperCase() ?? "O";
  const base = {
    width: size,
    height: size,
    borderRadius: 4,
    flexShrink: 0,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden"
  };
  if (logo && !imgError) {
    return /* @__PURE__ */ jsxRuntime.jsx("span", { style: base, children: /* @__PURE__ */ jsxRuntime.jsx(
      "img",
      {
        src: logo,
        alt: name,
        width: size,
        height: size,
        style: { width: size, height: size, objectFit: "cover", borderRadius: 4 },
        onError: () => setImgError(true),
        referrerPolicy: "no-referrer"
      }
    ) });
  }
  return /* @__PURE__ */ jsxRuntime.jsx(
    "span",
    {
      style: {
        ...base,
        background: "var(--ra-color-primary)",
        fontFamily: "var(--ra-font-mono)",
        fontWeight: 700,
        fontSize: size * 0.44,
        color: "#fff"
      },
      children: initial
    }
  );
}
function OrgSwitcher({
  hideWhenLoading = false,
  hideWhenNoOrgs = false,
  appearance: instanceAppearance,
  className
}) {
  const { client, appearance: providerAppearance } = useKovaAuth();
  const merged = mergeAppearance(providerAppearance, instanceAppearance);
  const el = merged.elements ?? {};
  const { organization: activeOrg, isLoaded } = useOrganization();
  const [open, setOpen] = React.useState(false);
  const [switching, setSwitching] = React.useState(null);
  const [orgs, setOrgs] = React.useState(null);
  React.useEffect(() => {
    const orgClient = client;
    orgClient.organization?.list().then((res) => {
      const raw = res.data ?? [];
      setOrgs(
        raw.map((o) => ({
          id: o.id,
          name: o.name,
          slug: o.slug,
          logo: o.logo ?? null,
          metadata: o.metadata ?? null,
          createdAt: new Date(o.createdAt ?? Date.now())
        }))
      );
    }).catch(() => setOrgs([]));
  }, [client]);
  const ref = React.useRef(null);
  React.useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);
  const handleSetActive = React.useCallback(
    async (orgId) => {
      if (orgId === (activeOrg?.id ?? null) || switching) return;
      setSwitching(orgId ?? "__personal__");
      try {
        const orgClient = client;
        await orgClient.organization?.setActive({ organizationId: orgId });
        await client.getSession();
      } finally {
        setSwitching(null);
        setOpen(false);
      }
    },
    [client, activeOrg?.id, switching]
  );
  if (!isLoaded && hideWhenLoading) return null;
  if (!isLoaded) {
    return /* @__PURE__ */ jsxRuntime.jsx(
      "div",
      {
        "data-ra-root": true,
        "data-ra-element": "skeleton",
        style: { height: 38, borderRadius: "var(--ra-radius-sm)", width: "100%" }
      }
    );
  }
  if (orgs !== null && orgs.length === 0 && hideWhenNoOrgs) return null;
  return /* @__PURE__ */ jsxRuntime.jsxs(
    "div",
    {
      ref,
      "data-ra-root": true,
      style: { position: "relative" },
      className,
      children: [
        /* @__PURE__ */ jsxRuntime.jsxs(
          "button",
          {
            type: "button",
            "aria-haspopup": "listbox",
            "aria-expanded": open,
            "data-ra-element": "orgSwitcherTrigger",
            style: {
              ...el.orgSwitcherTrigger,
              width: "100%",
              display: "flex",
              alignItems: "center",
              gap: 8,
              background: open ? "var(--ra-color-surface-raised)" : "transparent",
              border: "1px solid",
              borderColor: open ? "var(--ra-color-border)" : "transparent",
              borderRadius: "var(--ra-radius-sm)",
              padding: "6px 8px",
              cursor: "pointer",
              transition: "background 0.12s, border-color 0.12s"
            },
            onClick: () => setOpen((v) => !v),
            children: [
              activeOrg ? /* @__PURE__ */ jsxRuntime.jsx(OrgAvatar, { name: activeOrg.name, logo: activeOrg.logo }) : /* @__PURE__ */ jsxRuntime.jsx(
                "span",
                {
                  style: {
                    width: 24,
                    height: 24,
                    borderRadius: 4,
                    flexShrink: 0,
                    background: "var(--ra-color-surface-raised)",
                    border: "1px solid var(--ra-color-border)",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center"
                  },
                  children: /* @__PURE__ */ jsxRuntime.jsx(BuildingIcon, { size: 12, style: { color: "var(--ra-color-text-tertiary)" } })
                }
              ),
              /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { flex: 1, minWidth: 0, textAlign: "left" }, children: [
                /* @__PURE__ */ jsxRuntime.jsx(
                  "p",
                  {
                    style: {
                      fontFamily: "var(--ra-font-mono)",
                      fontSize: "0.78rem",
                      fontWeight: 600,
                      color: "var(--ra-color-text)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      letterSpacing: "-0.01em",
                      margin: 0
                    },
                    children: activeOrg?.name ?? "Select organization"
                  }
                ),
                activeOrg && /* @__PURE__ */ jsxRuntime.jsx(
                  "p",
                  {
                    style: {
                      fontFamily: "var(--ra-font-mono)",
                      fontSize: "0.64rem",
                      color: "var(--ra-color-text-tertiary)",
                      margin: 0
                    },
                    children: activeOrg.slug
                  }
                )
              ] }),
              /* @__PURE__ */ jsxRuntime.jsx(
                ChevronDownIcon,
                {
                  size: 10,
                  style: {
                    color: "var(--ra-color-text-tertiary)",
                    flexShrink: 0,
                    transform: open ? "rotate(180deg)" : "none",
                    transition: "transform 0.15s"
                  }
                }
              )
            ]
          }
        ),
        open && /* @__PURE__ */ jsxRuntime.jsxs(
          "div",
          {
            role: "listbox",
            "data-ra-element": "orgSwitcherMenu",
            style: {
              ...el.orgSwitcherMenu,
              position: "absolute",
              top: "calc(100% + 4px)",
              left: 0,
              right: 0,
              zIndex: 9999,
              background: "var(--ra-color-surface)",
              border: "1px solid var(--ra-color-border-strong)",
              borderRadius: "var(--ra-radius-sm)",
              padding: 4,
              boxShadow: "0 16px 40px rgba(0,0,0,0.6)"
            },
            children: [
              /* @__PURE__ */ jsxRuntime.jsx(
                "p",
                {
                  style: {
                    fontFamily: "var(--ra-font-mono)",
                    fontSize: "0.58rem",
                    color: "var(--ra-color-text-tertiary)",
                    fontWeight: 600,
                    letterSpacing: "0.1em",
                    textTransform: "uppercase",
                    padding: "5px 8px 3px",
                    margin: 0
                  },
                  children: "Switch organization"
                }
              ),
              /* @__PURE__ */ jsxRuntime.jsx(
                OrgOption,
                {
                  label: "Personal account",
                  sublabel: "No organization",
                  isActive: activeOrg === null,
                  isSwitching: switching === "__personal__",
                  icon: /* @__PURE__ */ jsxRuntime.jsx(UserIcon, { size: 13, style: { color: "var(--ra-color-text-tertiary)" } }),
                  onSelect: () => void handleSetActive(null),
                  el
                }
              ),
              orgs === null ? /* @__PURE__ */ jsxRuntime.jsxs(
                "div",
                {
                  style: {
                    padding: "10px 8px",
                    display: "flex",
                    alignItems: "center",
                    gap: 8
                  },
                  children: [
                    /* @__PURE__ */ jsxRuntime.jsx(Spinner, { size: 13 }),
                    /* @__PURE__ */ jsxRuntime.jsx(
                      "span",
                      {
                        style: {
                          fontFamily: "var(--ra-font-mono)",
                          fontSize: "0.75rem",
                          color: "var(--ra-color-text-tertiary)"
                        },
                        children: "Loading\u2026"
                      }
                    )
                  ]
                }
              ) : orgs.map((org) => /* @__PURE__ */ jsxRuntime.jsx(
                OrgOption,
                {
                  label: org.name,
                  sublabel: org.slug,
                  isActive: org.id === activeOrg?.id,
                  isSwitching: switching === org.id,
                  icon: /* @__PURE__ */ jsxRuntime.jsx(OrgAvatar, { name: org.name, logo: org.logo, size: 22 }),
                  onSelect: () => void handleSetActive(org.id),
                  el
                },
                org.id
              ))
            ]
          }
        )
      ]
    }
  );
}
function OrgOption({
  label,
  sublabel,
  isActive,
  isSwitching,
  icon,
  onSelect,
  el
}) {
  return /* @__PURE__ */ jsxRuntime.jsxs(
    "button",
    {
      type: "button",
      role: "option",
      "aria-selected": isActive,
      disabled: isSwitching,
      onClick: onSelect,
      "data-ra-element": "orgSwitcherOrgItem",
      style: {
        ...el.orgSwitcherOrgItem,
        width: "100%",
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 8px",
        borderRadius: 4,
        cursor: isActive ? "default" : "pointer",
        background: isActive ? "rgba(59,130,246,0.08)" : "transparent",
        border: isActive ? "1px solid rgba(59,130,246,0.15)" : "1px solid transparent",
        transition: "background 0.1s",
        marginBottom: 1,
        opacity: isSwitching ? 0.6 : 1
      },
      children: [
        isSwitching ? /* @__PURE__ */ jsxRuntime.jsx(Spinner, { size: 14 }) : icon,
        /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { flex: 1, minWidth: 0, textAlign: "left" }, children: [
          /* @__PURE__ */ jsxRuntime.jsx(
            "p",
            {
              style: {
                fontFamily: "var(--ra-font-mono)",
                fontSize: "0.78rem",
                fontWeight: 600,
                color: isActive ? "var(--ra-color-primary)" : "var(--ra-color-text)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                letterSpacing: "-0.01em",
                margin: 0
              },
              children: isSwitching ? "Switching\u2026" : label
            }
          ),
          sublabel && /* @__PURE__ */ jsxRuntime.jsx(
            "p",
            {
              style: {
                fontFamily: "var(--ra-font-mono)",
                fontSize: "0.64rem",
                color: "var(--ra-color-text-tertiary)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                margin: 0
              },
              children: sublabel
            }
          )
        ] }),
        isActive && /* @__PURE__ */ jsxRuntime.jsx(CheckIcon, { size: 11, style: { color: "var(--ra-color-primary)", flexShrink: 0 } })
      ]
    }
  );
}
function useAuth() {
  const { client, authUrl, publishableKey, afterSignOutUrl, sessionResult, clearSessionToken, hasBearerSession, sessionToken } = useKovaAuth();
  const result = sessionResult;
  const isLoaded = !result.isPending;
  const session = result.data;
  const user = session?.user ?? null;
  const rawSession = session?.session ?? null;
  const signOut = React.useCallback(
    async (callbackURL) => {
      const dest = callbackURL ?? afterSignOutUrl;
      if (hasBearerSession) {
        if (sessionToken && publishableKey) {
          try {
            await fetch(`${authUrl}/api/pub/apps/${publishableKey}/revoke-session`, {
              method: "POST",
              headers: { Authorization: `Bearer ${sessionToken}` }
            });
          } catch {
          }
        }
        clearSessionToken();
        try {
          await createKovaAuthClient({
            authUrl,
            publishableKey
          }).signOut();
        } catch {
        }
        if (typeof window !== "undefined") {
          window.location.href = dest;
        }
      } else {
        if (rawSession?.token && client.multiSession) {
          await client.multiSession.revokeDeviceSession({ sessionToken: rawSession.token });
        } else {
          try {
            await client.signOut();
          } catch {
          }
        }
        if (typeof window !== "undefined") {
          window.location.href = dest;
        }
      }
    },
    [client, authUrl, publishableKey, afterSignOutUrl, clearSessionToken, hasBearerSession, sessionToken, rawSession?.token]
  );
  const activeOrgId = rawSession?.activeOrganizationId ?? null;
  return {
    isLoaded,
    isSignedIn: !!user,
    userId: user?.id ?? null,
    sessionId: sessionToken ?? rawSession?.token ?? null,
    orgId: activeOrgId,
    orgRole: null,
    getToken: async () => sessionToken ?? rawSession?.token ?? null,
    signOut
  };
}
function useUser() {
  const { client, sessionResult } = useKovaAuth();
  const result = sessionResult;
  const isLoaded = !result.isPending;
  const rawUser = result.data?.user ?? null;
  const user = rawUser ? (() => {
    const u = rawUser;
    const toDate = (v) => v instanceof Date ? v : new Date(v ?? Date.now());
    return {
      id: rawUser.id,
      name: rawUser.name,
      fullName: rawUser.name ?? null,
      email: rawUser.email,
      emailVerified: !!u["emailVerified"],
      image: u["image"] ?? null,
      imageUrl: u["image"] ?? void 0,
      role: u["role"] ?? null,
      banned: !!u["banned"],
      createdAt: toDate(u["createdAt"]),
      updatedAt: toDate(u["updatedAt"]),
      username: u["username"] ?? null,
      twoFactorEnabled: !!u["twoFactorEnabled"],
      primaryEmailAddress: rawUser.email ? { emailAddress: rawUser.email } : null,
      unsafeMetadata: u["unsafeMetadata"] ?? {},
      reload: async () => {
        await result.refetch();
      }
    };
  })() : null;
  const updateUser = React.useCallback(
    async (data) => {
      await client.updateUser(data);
      result.refetch();
    },
    [client, result]
  );
  return {
    user,
    isLoaded,
    isSignedIn: !!user,
    updateUser
  };
}
function Protect({
  condition = "signed-in",
  role,
  fallback = null,
  loading = null,
  children
}) {
  const { isLoaded, isSignedIn } = useAuth();
  const { user } = useUser();
  if (!isLoaded) return /* @__PURE__ */ jsxRuntime.jsx(jsxRuntime.Fragment, { children: loading });
  let conditionMet;
  if (condition === "signed-out") {
    conditionMet = !isSignedIn;
  } else {
    conditionMet = isSignedIn;
    if (conditionMet && role) {
      const userRoles = (user?.role ?? "").split(",").map((r) => r.trim()).filter((r) => r.length > 0);
      conditionMet = userRoles.includes(role);
    }
  }
  if (!conditionMet) return /* @__PURE__ */ jsxRuntime.jsx(jsxRuntime.Fragment, { children: fallback });
  return /* @__PURE__ */ jsxRuntime.jsx(jsxRuntime.Fragment, { children });
}
var TICK_INTERVAL_MS = 200;
function useRateLimit() {
  const [expiresAt, setExpiresAt] = React.useState(null);
  const [secondsRemaining, setSecondsRemaining] = React.useState(0);
  const intervalRef = React.useRef(null);
  const stopTimer = React.useCallback(() => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);
  React.useEffect(() => {
    if (expiresAt === null) {
      stopTimer();
      setSecondsRemaining(0);
      return;
    }
    const tick = () => {
      const remaining = Math.max(0, expiresAt - Date.now());
      const secs = Math.ceil(remaining / 1e3);
      setSecondsRemaining(secs);
      if (remaining <= 0) {
        setExpiresAt(null);
      }
    };
    tick();
    stopTimer();
    intervalRef.current = setInterval(tick, TICK_INTERVAL_MS);
    return () => {
      stopTimer();
    };
  }, [expiresAt, stopTimer]);
  const recordRateLimit = React.useCallback((retryAfterSeconds) => {
    const clampedSecs = Math.max(1, Math.ceil(retryAfterSeconds));
    setExpiresAt(Date.now() + clampedSecs * 1e3);
  }, []);
  const clearRateLimit = React.useCallback(() => {
    setExpiresAt(null);
  }, []);
  return {
    isRateLimited: expiresAt !== null && secondsRemaining > 0,
    secondsRemaining,
    recordRateLimit,
    clearRateLimit
  };
}
function extractRetryAfter(err) {
  if (!err || typeof err !== "object") return null;
  const asAny = err;
  const response = asAny["response"];
  if (response instanceof Response) {
    return parseRetryAfterResponse(response);
  }
  if (asAny["status"] === 429) {
    const rh = asAny["headers"];
    if (rh && typeof rh.get === "function") {
      return parseRetryAfterHeaders(rh);
    }
    const pre = asAny["retryAfter"];
    if (typeof pre === "number" && pre > 0) return pre;
  }
  const inner = asAny["error"];
  if (inner && typeof inner === "object") {
    if (inner["status"] === 429) {
      const ih = inner["headers"];
      if (ih && typeof ih.get === "function") {
        return parseRetryAfterHeaders(ih);
      }
      const pre = inner["retryAfter"];
      if (typeof pre === "number" && pre > 0) return pre;
    }
  }
  return null;
}
function parseRetryAfterResponse(response) {
  return parseRetryAfterHeaders(response.headers);
}
function parseRetryAfterHeaders(headers) {
  const ra = headers.get("retry-after") ?? headers.get("Retry-After");
  if (!ra) {
    const reset = headers.get("x-ratelimit-reset");
    if (reset) {
      const epochSec = parseInt(reset, 10);
      if (!isNaN(epochSec)) {
        const nowSec = Math.floor(Date.now() / 1e3);
        const delta = epochSec - nowSec;
        return delta > 0 ? delta : 1;
      }
    }
    return null;
  }
  const asNum = parseInt(ra, 10);
  if (!isNaN(asNum) && asNum >= 0) return Math.max(1, asNum);
  const dateSec = Date.parse(ra);
  if (!isNaN(dateSec)) {
    const delta = Math.ceil((dateSec - Date.now()) / 1e3);
    return delta > 0 ? delta : 1;
  }
  return null;
}
function rateLimitMessage(secondsRemaining) {
  if (secondsRemaining <= 0) return "You can try again now.";
  if (secondsRemaining === 1) return "Too many attempts. Try again in 1 second.";
  return `Too many attempts. Try again in ${secondsRemaining}s.`;
}
function extractMessage(err) {
  if (!err) return "An unexpected error occurred.";
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message;
  if (typeof err.message === "string")
    return err.message;
  if (typeof err.error?.message === "string")
    return err.error.message;
  return "An unexpected error occurred.";
}
function is429(err) {
  if (!err || typeof err !== "object") return false;
  const a = err;
  if (a["status"] === 429) return true;
  const inner = a["error"];
  if (inner?.["status"] === 429) return true;
  const msg = extractMessage(err).toLowerCase();
  if (msg.includes("too many") || msg.includes("rate limit")) return true;
  return false;
}
function useSignIn() {
  const { client, afterSignInUrl } = useKovaAuth();
  const [isLoading, setLoading] = React.useState(false);
  const [error, setError] = React.useState(null);
  const [twoFactorRequired, setTwoFactorRequired] = React.useState(false);
  const [retryAfterSeconds, setRetryAfterSeconds] = React.useState(null);
  const clearError = React.useCallback(() => setError(null), []);
  const run = React.useCallback(
    async (fn) => {
      setLoading(true);
      setError(null);
      try {
        return await fn();
      } catch (err) {
        setError(extractMessage(err));
        if (is429(err)) {
          const secs = extractRetryAfter(err);
          setRetryAfterSeconds(secs);
        } else {
          setRetryAfterSeconds(null);
        }
        throw err;
      } finally {
        setLoading(false);
      }
    },
    []
  );
  const signInEmail = React.useCallback(
    async (opts) => {
      return run(async () => {
        const res = await client.signIn.email({
          email: opts.email,
          password: opts.password,
          rememberMe: opts.rememberMe ?? true,
          callbackURL: opts.callbackURL ?? afterSignInUrl,
          fetchOptions: {
            onSuccess() {
              setTwoFactorRequired(false);
              setRetryAfterSeconds(null);
            },
            onError(ctx) {
              const msg = ctx.error.message ?? "";
              if (msg.toLowerCase().includes("two factor") || ctx.error.status === 403) {
                setTwoFactorRequired(true);
              }
              if (ctx.error.status === 429 && ctx.response) {
                const secs = extractRetryAfter({ response: ctx.response });
                if (secs !== null) setRetryAfterSeconds(secs);
              }
            }
          }
        });
        const body = res?.data;
        if (body?.twoFactorRedirect) {
          setTwoFactorRequired(true);
          return { twoFactorRequired: true };
        }
        return {};
      });
    },
    [client, afterSignInUrl, run]
  );
  const signInMagicLink = React.useCallback(
    async (opts) => {
      await run(async () => {
        await client.signIn.magicLink({
          email: opts.email,
          callbackURL: opts.callbackURL ?? afterSignInUrl
        });
        setRetryAfterSeconds(null);
      });
    },
    [client, afterSignInUrl, run]
  );
  const signInSocial = React.useCallback(
    async (opts) => {
      await run(async () => {
        await client.signIn.social({
          provider: opts.provider,
          callbackURL: opts.callbackURL ?? afterSignInUrl,
          errorCallbackURL: opts.errorCallbackURL
        });
        setRetryAfterSeconds(null);
      });
    },
    [client, afterSignInUrl, run]
  );
  const signInPasskey = React.useCallback(
    async (opts = {}) => {
      await run(async () => {
        await client.signIn.passkey({
          callbackURL: opts.callbackURL ?? afterSignInUrl
        });
        setRetryAfterSeconds(null);
      });
    },
    [client, afterSignInUrl, run]
  );
  const signInTotp = React.useCallback(
    async (opts) => {
      await run(async () => {
        await client.twoFactor.verifyTotp({
          code: opts.code,
          callbackURL: afterSignInUrl
        });
        setTwoFactorRequired(false);
        setRetryAfterSeconds(null);
      });
    },
    [client, afterSignInUrl, run]
  );
  const signInEmailOtp = React.useCallback(
    async (opts) => {
      await run(async () => {
        await client.twoFactor.verifyOtp({ code: opts.otp });
        setTwoFactorRequired(false);
        setRetryAfterSeconds(null);
      });
    },
    [client, run]
  );
  return {
    signIn: {
      email: signInEmail,
      magicLink: signInMagicLink,
      social: signInSocial,
      passkey: signInPasskey,
      totp: signInTotp,
      emailOtp: signInEmailOtp
    },
    isLoading,
    error,
    clearError,
    twoFactorRequired,
    retryAfterSeconds
  };
}
var OAUTH_HANDOFF_STORAGE_KEY = "kova-auth:oauth-handoff";
function resolveAbsoluteUrl(authUrl, path) {
  const input = path ?? "/";
  try {
    new URL(input);
    return input;
  } catch {
    const appOrigin = typeof window !== "undefined" ? window.location.origin : authUrl.replace(/\/$/, "");
    const segment = input.startsWith("/") ? input : `/${input}`;
    return `${appOrigin}${segment}`;
  }
}
function buildSdkBounceUrl(authUrl, publishableKey, redirectUri) {
  const bounce = new URL(`${authUrl}/api/hosted/oauth-complete`);
  bounce.searchParams.set("mode", "sdk");
  bounce.searchParams.set("pk", publishableKey);
  bounce.searchParams.set("redirect_uri", redirectUri);
  return bounce.toString();
}
function buildSdkOAuthStartUrl(authUrl, publishableKey, provider, redirectUri, errorCallbackURL) {
  const start = new URL(`${authUrl}/api/pub/apps/${publishableKey}/oauth/start`);
  start.searchParams.set("provider", provider);
  start.searchParams.set("redirect_uri", redirectUri);
  start.searchParams.set("error_callback_url", errorCallbackURL);
  return start.toString();
}
function oauthErrorMessage(code, fallback) {
  if (code === "redirect_uri_not_allowed") {
    return "This application's redirect URI is not configured correctly. A developer needs to add this URL to the app's allowed redirect URIs in the kova-auth dashboard.";
  }
  if (code === "origin_not_allowed") {
    return "This origin is not in the application's allowed origins list. A developer needs to add it in the kova-auth dashboard.";
  }
  return fallback ?? "OAuth sign-in failed. Please try again.";
}
function SocialButtons({
  callbackURL,
  errorCallbackURL,
  elements
}) {
  const { oauthProviders, client, authUrl, publishableKey } = useKovaAuth();
  const [oauthError, setOauthError] = React.useState(null);
  const [loadingProvider, setLoadingProvider] = React.useState(null);
  if (!oauthProviders.length) return null;
  const absCallback = resolveAbsoluteUrl(authUrl, callbackURL);
  const absError = resolveAbsoluteUrl(authUrl, errorCallbackURL ?? "/sign-in?error=oauth");
  const finalCallback = publishableKey ? buildSdkBounceUrl(authUrl, publishableKey, absCallback) : absCallback;
  const handleSocial = async (providerId) => {
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
            startedAt: Date.now()
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
        errorCallbackURL: absError
      });
      const r = result;
      if (r?.error) {
        setOauthError(oauthErrorMessage(r.error.error ?? "", r.error.message));
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "OAuth sign-in failed. Please try again.";
      setOauthError(msg);
    } finally {
      setLoadingProvider(null);
    }
  };
  return /* @__PURE__ */ jsxRuntime.jsxs("div", { "data-ra-element": "socialButtonsRoot", style: elements?.socialButtonsRoot, children: [
    oauthError && /* @__PURE__ */ jsxRuntime.jsx(Alert, { variant: "error", children: oauthError }),
    oauthProviders.map((p) => /* @__PURE__ */ jsxRuntime.jsxs(
      "button",
      {
        type: "button",
        "data-ra-element": "socialButton",
        style: elements?.socialButton,
        disabled: loadingProvider !== null,
        onClick: () => void handleSocial(p.id),
        children: [
          /* @__PURE__ */ jsxRuntime.jsx(ProviderIcon, { provider: p.id, size: 18 }),
          loadingProvider === p.id ? "Connecting\u2026" : `Continue with ${p.label ?? providerLabel(p.id)}`
        ]
      },
      p.id
    ))
  ] });
}
function PasskeyButton({
  elements,
  callbackURL
}) {
  const { client, authUrl } = useKovaAuth();
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState(null);
  const handlePasskey = async () => {
    setLoading(true);
    setError(null);
    try {
      await client.signIn.passkey({ callbackURL: resolveAbsoluteUrl(authUrl, callbackURL) });
    } catch (err) {
      if (err instanceof DOMException && err.name === "NotAllowedError") return;
      setError("Passkey authentication failed. Try another method.");
    } finally {
      setLoading(false);
    }
  };
  return /* @__PURE__ */ jsxRuntime.jsxs(jsxRuntime.Fragment, { children: [
    error && /* @__PURE__ */ jsxRuntime.jsx(Alert, { variant: "error", children: error }),
    /* @__PURE__ */ jsxRuntime.jsxs(
      "button",
      {
        type: "button",
        "data-ra-element": "socialButton",
        style: elements?.socialButton,
        disabled: loading,
        onClick: () => void handlePasskey(),
        children: [
          /* @__PURE__ */ jsxRuntime.jsx(FingerprintIcon, { size: 18 }),
          loading ? "Authenticating\u2026" : "Sign in with passkey"
        ]
      }
    )
  ] });
}
function EmailPasswordForm({
  afterSignInUrl,
  elements
}) {
  const { signIn, isLoading, error, twoFactorRequired, retryAfterSeconds } = useSignIn();
  const { authUrl } = useKovaAuth();
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [totp, setTotp] = React.useState("");
  const [fieldErrors, setFieldErrors] = React.useState({});
  const {
    isRateLimited,
    secondsRemaining,
    recordRateLimit
  } = useRateLimit();
  const [prevRetryAfter, setPrevRetryAfter] = React.useState(null);
  if (retryAfterSeconds !== null && retryAfterSeconds !== prevRetryAfter) {
    setPrevRetryAfter(retryAfterSeconds);
    recordRateLimit(retryAfterSeconds);
  }
  const absCallbackUrl = resolveAbsoluteUrl(authUrl, afterSignInUrl);
  const validate = () => {
    const errs = {};
    if (!email.trim()) errs["email"] = "Email is required.";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      errs["email"] = "Enter a valid email address.";
    if (!password) errs["password"] = "Password is required.";
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  };
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (isRateLimited) return;
    if (twoFactorRequired) {
      await signIn.totp({ code: totp }).catch(() => null);
      return;
    }
    if (!validate()) return;
    await signIn.email({ email, password, callbackURL: absCallbackUrl }).catch(() => null);
  };
  if (twoFactorRequired) {
    return /* @__PURE__ */ jsxRuntime.jsxs("form", { onSubmit: (e) => void handleSubmit(e), noValidate: true, children: [
      /* @__PURE__ */ jsxRuntime.jsx(Alert, { variant: "info", children: "Two-factor authentication required. Enter your 6-digit code." }),
      error && /* @__PURE__ */ jsxRuntime.jsx(Alert, { variant: "error", children: error }),
      isRateLimited && /* @__PURE__ */ jsxRuntime.jsx(
        RateLimitBanner,
        {
          secondsRemaining,
          totalSeconds: retryAfterSeconds ?? secondsRemaining
        }
      ),
      /* @__PURE__ */ jsxRuntime.jsx(
        FormField,
        {
          id: "ra-totp",
          label: "Authenticator Code",
          type: "text",
          value: totp,
          onChange: setTotp,
          placeholder: "000000",
          autoComplete: "one-time-code",
          required: true,
          disabled: isRateLimited,
          elements
        }
      ),
      /* @__PURE__ */ jsxRuntime.jsx(SubmitButton, { isLoading, disabled: isRateLimited, elements, children: "Verify Code" })
    ] });
  }
  return /* @__PURE__ */ jsxRuntime.jsxs("form", { onSubmit: (e) => void handleSubmit(e), noValidate: true, children: [
    error && !isRateLimited && /* @__PURE__ */ jsxRuntime.jsx(Alert, { variant: "error", children: error }),
    isRateLimited && /* @__PURE__ */ jsxRuntime.jsx(
      RateLimitBanner,
      {
        secondsRemaining,
        totalSeconds: retryAfterSeconds ?? secondsRemaining
      }
    ),
    /* @__PURE__ */ jsxRuntime.jsx(
      FormField,
      {
        id: "ra-email",
        label: "Email address",
        type: "email",
        value: email,
        onChange: setEmail,
        placeholder: "you@example.com",
        autoComplete: "email",
        required: true,
        disabled: isRateLimited,
        error: fieldErrors["email"],
        elements
      }
    ),
    /* @__PURE__ */ jsxRuntime.jsx(
      FormField,
      {
        id: "ra-password",
        label: "Password",
        type: "password",
        value: password,
        onChange: setPassword,
        placeholder: "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022",
        autoComplete: "current-password",
        required: true,
        disabled: isRateLimited,
        error: fieldErrors["password"],
        elements
      }
    ),
    /* @__PURE__ */ jsxRuntime.jsx(SubmitButton, { isLoading, disabled: isRateLimited, elements, children: "Continue" })
  ] });
}
function MagicLinkForm({
  afterSignInUrl,
  elements
}) {
  const { signIn, isLoading, error, retryAfterSeconds } = useSignIn();
  const { authUrl } = useKovaAuth();
  const [email, setEmail] = React.useState("");
  const [sent, setSent] = React.useState(false);
  const [fieldError, setFieldError] = React.useState(null);
  const {
    isRateLimited,
    secondsRemaining,
    recordRateLimit
  } = useRateLimit();
  const [prevRetryAfter, setPrevRetryAfter] = React.useState(null);
  if (retryAfterSeconds !== null && retryAfterSeconds !== prevRetryAfter) {
    setPrevRetryAfter(retryAfterSeconds);
    recordRateLimit(retryAfterSeconds);
  }
  const absCallbackUrl = resolveAbsoluteUrl(authUrl, afterSignInUrl);
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (isRateLimited) return;
    setFieldError(null);
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setFieldError("Enter a valid email address.");
      return;
    }
    try {
      await signIn.magicLink({ email, callbackURL: absCallbackUrl });
      setSent(true);
    } catch {
    }
  };
  if (sent) {
    return /* @__PURE__ */ jsxRuntime.jsx(Alert, { variant: "success", children: "\u2709\uFE0F Magic link sent! Check your email and click the link to sign in." });
  }
  return /* @__PURE__ */ jsxRuntime.jsxs("form", { onSubmit: (e) => void handleSubmit(e), noValidate: true, children: [
    error && !isRateLimited && /* @__PURE__ */ jsxRuntime.jsx(Alert, { variant: "error", children: error }),
    isRateLimited && /* @__PURE__ */ jsxRuntime.jsx(
      RateLimitBanner,
      {
        secondsRemaining,
        totalSeconds: retryAfterSeconds ?? secondsRemaining
      }
    ),
    /* @__PURE__ */ jsxRuntime.jsx(
      FormField,
      {
        id: "ra-magic-email",
        label: "Email address",
        type: "email",
        value: email,
        onChange: setEmail,
        placeholder: "you@example.com",
        autoComplete: "email",
        required: true,
        disabled: isRateLimited,
        error: fieldError,
        elements
      }
    ),
    /* @__PURE__ */ jsxRuntime.jsxs(SubmitButton, { isLoading, disabled: isRateLimited, elements, children: [
      /* @__PURE__ */ jsxRuntime.jsx(MailIcon, { size: 15 }),
      "Send sign-in link"
    ] })
  ] });
}
var TABS = [
  { id: "email", label: "Password" },
  { id: "magic-link", label: "Magic Link" },
  { id: "passkey", label: "Passkey" }
];
function SignIn({
  afterSignInUrl,
  signUpUrl = "/sign-up",
  defaultTab = "email",
  appearance: instanceAppearance,
  className
}) {
  const { appearance: providerAppearance, afterSignInUrl: providerAfterSignIn, oauthProviders, isAppearanceLoaded } = useKovaAuth();
  const merged = mergeAppearance(providerAppearance, instanceAppearance);
  const el = merged.elements ?? {};
  const resolvedUrl = afterSignInUrl ?? providerAfterSignIn;
  const [activeTab, setActiveTab] = React.useState(defaultTab);
  if (!isAppearanceLoaded) {
    return /* @__PURE__ */ jsxRuntime.jsxs(Card, { elements: el, className, children: [
      /* @__PURE__ */ jsxRuntime.jsx(CardHeader, { title: "Sign in", subtitle: "Welcome back. Choose your sign-in method.", elements: el }),
      /* @__PURE__ */ jsxRuntime.jsxs(CardBody, { elements: el, children: [
        /* @__PURE__ */ jsxRuntime.jsxs("div", { "data-ra-element": "socialButtonsRoot", style: el.socialButtonsRoot, children: [
          /* @__PURE__ */ jsxRuntime.jsx(Skeleton, { height: 38 }),
          /* @__PURE__ */ jsxRuntime.jsx(Skeleton, { height: 38 }),
          /* @__PURE__ */ jsxRuntime.jsx(Skeleton, { height: 38 })
        ] }),
        /* @__PURE__ */ jsxRuntime.jsx(Divider, { elements: el }),
        /* @__PURE__ */ jsxRuntime.jsx(Skeleton, { height: 42, style: { marginBottom: 20 } }),
        /* @__PURE__ */ jsxRuntime.jsx(Skeleton, { height: 36, style: { marginBottom: 14 } }),
        /* @__PURE__ */ jsxRuntime.jsx(Skeleton, { height: 36, style: { marginBottom: 14 } }),
        /* @__PURE__ */ jsxRuntime.jsx(Skeleton, { height: 40 })
      ] })
    ] });
  }
  return /* @__PURE__ */ jsxRuntime.jsxs(Card, { elements: el, className, children: [
    /* @__PURE__ */ jsxRuntime.jsx(
      CardHeader,
      {
        title: "Sign in",
        subtitle: "Welcome back. Choose your sign-in method.",
        elements: el
      }
    ),
    /* @__PURE__ */ jsxRuntime.jsxs(CardBody, { elements: el, children: [
      oauthProviders.length > 0 && /* @__PURE__ */ jsxRuntime.jsxs(jsxRuntime.Fragment, { children: [
        /* @__PURE__ */ jsxRuntime.jsx(
          SocialButtons,
          {
            elements: el,
            callbackURL: resolvedUrl,
            errorCallbackURL: "/sign-in?error=oauth"
          }
        ),
        /* @__PURE__ */ jsxRuntime.jsx(Divider, { elements: el })
      ] }),
      /* @__PURE__ */ jsxRuntime.jsx(
        Tabs,
        {
          tabs: TABS,
          active: activeTab,
          onSelect: (id) => setActiveTab(id),
          elements: el
        }
      ),
      activeTab === "email" && /* @__PURE__ */ jsxRuntime.jsx(EmailPasswordForm, { afterSignInUrl: resolvedUrl, elements: el }),
      activeTab === "magic-link" && /* @__PURE__ */ jsxRuntime.jsx(MagicLinkForm, { afterSignInUrl: resolvedUrl, elements: el }),
      activeTab === "passkey" && /* @__PURE__ */ jsxRuntime.jsx(PasskeyButton, { elements: el, callbackURL: resolvedUrl })
    ] }),
    /* @__PURE__ */ jsxRuntime.jsxs(CardFooter, { elements: el, children: [
      /* @__PURE__ */ jsxRuntime.jsxs("span", { style: { color: "var(--ra-color-text-tertiary)" }, children: [
        "Don't have an account?",
        " "
      ] }),
      /* @__PURE__ */ jsxRuntime.jsx("a", { href: signUpUrl, children: "Sign up" })
    ] })
  ] });
}
function extractMessage2(err) {
  if (!err) return "An unexpected error occurred.";
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message;
  if (typeof err.message === "string")
    return err.message;
  if (typeof err.error?.message === "string")
    return err.error.message;
  return "An unexpected error occurred.";
}
function is4292(err) {
  if (!err || typeof err !== "object") return false;
  const a = err;
  if (a["status"] === 429) return true;
  const inner = a["error"];
  if (inner?.["status"] === 429) return true;
  const msg = extractMessage2(err).toLowerCase();
  if (msg.includes("too many") || msg.includes("rate limit")) return true;
  return false;
}
function useSignUp() {
  const { client, afterSignUpUrl } = useKovaAuth();
  const [isLoading, setLoading] = React.useState(false);
  const [error, setError] = React.useState(null);
  const [verificationPending, setVerificationPending] = React.useState(false);
  const [retryAfterSeconds, setRetryAfterSeconds] = React.useState(null);
  const clearError = React.useCallback(() => setError(null), []);
  const signUpEmail = React.useCallback(
    async (opts) => {
      setLoading(true);
      setError(null);
      try {
        const res = await client.signUp.email({
          email: opts.email,
          password: opts.password,
          name: opts.name,
          // username is an optional plugin field — pass through if provided
          ...opts.username ? { username: opts.username } : {},
          callbackURL: opts.callbackURL ?? afterSignUpUrl
        });
        const data = res?.data;
        if (data?.requiresEmailVerification) {
          setVerificationPending(true);
        }
        setRetryAfterSeconds(null);
      } catch (err) {
        setError(extractMessage2(err));
        if (is4292(err)) {
          const secs = extractRetryAfter(err);
          setRetryAfterSeconds(secs);
        } else {
          setRetryAfterSeconds(null);
        }
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [client, afterSignUpUrl]
  );
  return {
    signUp: { email: signUpEmail },
    isLoading,
    error,
    clearError,
    verificationPending,
    retryAfterSeconds
  };
}
var PASSWORD_RULES = [
  { label: "12+ characters", test: (p) => p.length >= 12 },
  { label: "Uppercase letter", test: (p) => /[A-Z]/.test(p) },
  { label: "Number", test: (p) => /\d/.test(p) },
  { label: "Special character", test: (p) => /[^A-Za-z\d]/.test(p) }
];
function PasswordStrength({ password }) {
  if (!password) return null;
  const passed = PASSWORD_RULES.filter((r) => r.test(password)).length;
  const colors = ["#f87171", "#f97316", "#facc15", "#4ade80"];
  const color = colors[Math.max(0, passed - 1)] ?? "#f87171";
  return /* @__PURE__ */ jsxRuntime.jsxs(
    "div",
    {
      style: {
        marginTop: -8,
        marginBottom: 12,
        display: "flex",
        flexDirection: "column",
        gap: 6
      },
      children: [
        /* @__PURE__ */ jsxRuntime.jsx(
          "div",
          {
            style: {
              height: 3,
              borderRadius: 2,
              background: "var(--ra-color-border)",
              overflow: "hidden"
            },
            children: /* @__PURE__ */ jsxRuntime.jsx(
              "div",
              {
                style: {
                  width: `${passed / PASSWORD_RULES.length * 100}%`,
                  height: "100%",
                  background: color,
                  transition: "width 0.25s, background 0.25s",
                  borderRadius: 2
                }
              }
            )
          }
        ),
        /* @__PURE__ */ jsxRuntime.jsx(
          "div",
          {
            style: {
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "3px 12px"
            },
            children: PASSWORD_RULES.map((r) => /* @__PURE__ */ jsxRuntime.jsxs(
              "span",
              {
                style: {
                  fontFamily: "var(--ra-font-mono)",
                  fontSize: "0.68rem",
                  color: r.test(password) ? "var(--ra-color-success)" : "var(--ra-color-text-tertiary)",
                  transition: "color 0.15s"
                },
                children: [
                  r.test(password) ? "\u2713" : "\u25CB",
                  " ",
                  r.label
                ]
              },
              r.label
            ))
          }
        )
      ]
    }
  );
}
function SignUp({
  afterSignUpUrl,
  signInUrl = "/sign-in",
  appearance: instanceAppearance,
  className
}) {
  const {
    appearance: providerAppearance,
    afterSignUpUrl: providerUrl,
    oauthProviders,
    authUrl,
    isAppearanceLoaded
  } = useKovaAuth();
  const merged = mergeAppearance(providerAppearance, instanceAppearance);
  const el = merged.elements ?? {};
  const resolvedUrl = afterSignUpUrl ?? providerUrl;
  const { signUp, isLoading, error, verificationPending, retryAfterSeconds } = useSignUp();
  const {
    isRateLimited,
    secondsRemaining,
    recordRateLimit
  } = useRateLimit();
  const [prevRetryAfter, setPrevRetryAfter] = React.useState(null);
  if (retryAfterSeconds !== null && retryAfterSeconds !== prevRetryAfter) {
    setPrevRetryAfter(retryAfterSeconds);
    recordRateLimit(retryAfterSeconds);
  }
  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [fieldErrors, setFieldErrors] = React.useState({});
  const absCallbackUrl = resolveAbsoluteUrl(authUrl, resolvedUrl);
  if (!isAppearanceLoaded) {
    return /* @__PURE__ */ jsxRuntime.jsxs(Card, { elements: el, className, children: [
      /* @__PURE__ */ jsxRuntime.jsx(
        CardHeader,
        {
          title: "Create an account",
          subtitle: "Get started for free \u2014 no credit card required.",
          elements: el
        }
      ),
      /* @__PURE__ */ jsxRuntime.jsxs(CardBody, { elements: el, children: [
        /* @__PURE__ */ jsxRuntime.jsxs("div", { "data-ra-element": "socialButtonsRoot", style: el.socialButtonsRoot, children: [
          /* @__PURE__ */ jsxRuntime.jsx(Skeleton, { height: 38 }),
          /* @__PURE__ */ jsxRuntime.jsx(Skeleton, { height: 38 }),
          /* @__PURE__ */ jsxRuntime.jsx(Skeleton, { height: 38 })
        ] }),
        /* @__PURE__ */ jsxRuntime.jsx(Divider, { elements: el }),
        /* @__PURE__ */ jsxRuntime.jsx(Skeleton, { height: 36, style: { marginBottom: 14 } }),
        /* @__PURE__ */ jsxRuntime.jsx(Skeleton, { height: 36, style: { marginBottom: 14 } }),
        /* @__PURE__ */ jsxRuntime.jsx(Skeleton, { height: 36, style: { marginBottom: 14 } }),
        /* @__PURE__ */ jsxRuntime.jsx(Skeleton, { height: 40 })
      ] })
    ] });
  }
  const validate = () => {
    const errs = {};
    if (!name.trim()) errs["name"] = "Full name is required.";
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      errs["email"] = "Enter a valid email address.";
    const allRules = PASSWORD_RULES.every((r) => r.test(password));
    if (!allRules)
      errs["password"] = "Password does not meet all requirements.";
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  };
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (isRateLimited) return;
    if (!validate()) return;
    await signUp.email({ name, email, password, callbackURL: absCallbackUrl }).catch(() => null);
  };
  if (verificationPending) {
    return /* @__PURE__ */ jsxRuntime.jsxs(Card, { elements: el, className, children: [
      /* @__PURE__ */ jsxRuntime.jsx(
        CardHeader,
        {
          title: "Check your email",
          subtitle: `We sent a verification link to ${email}. Click it to activate your account.`,
          elements: el
        }
      ),
      /* @__PURE__ */ jsxRuntime.jsx(CardBody, { elements: el, children: /* @__PURE__ */ jsxRuntime.jsxs(Alert, { variant: "info", children: [
        "Didn't get it? Check your spam folder, or",
        " ",
        /* @__PURE__ */ jsxRuntime.jsx(
          "button",
          {
            type: "button",
            onClick: () => void signUp.email({ name, email, password, callbackURL: absCallbackUrl }),
            style: {
              background: "none",
              border: "none",
              color: "var(--ra-color-primary)",
              cursor: "pointer",
              fontFamily: "var(--ra-font-mono)",
              fontSize: "inherit",
              padding: 0
            },
            children: "resend the email"
          }
        ),
        "."
      ] }) }),
      /* @__PURE__ */ jsxRuntime.jsx(CardFooter, { elements: el, children: /* @__PURE__ */ jsxRuntime.jsx("a", { href: signInUrl, children: "Back to sign in" }) })
    ] });
  }
  return /* @__PURE__ */ jsxRuntime.jsxs(Card, { elements: el, className, children: [
    /* @__PURE__ */ jsxRuntime.jsx(
      CardHeader,
      {
        title: "Create an account",
        subtitle: "Get started for free \u2014 no credit card required.",
        elements: el
      }
    ),
    /* @__PURE__ */ jsxRuntime.jsxs(CardBody, { elements: el, children: [
      oauthProviders.length > 0 && /* @__PURE__ */ jsxRuntime.jsx(
        SocialButtons,
        {
          callbackURL: resolvedUrl,
          errorCallbackURL: "/sign-up?error=oauth",
          elements: el
        }
      ),
      oauthProviders.length > 0 && /* @__PURE__ */ jsxRuntime.jsx(Divider, { elements: el }),
      /* @__PURE__ */ jsxRuntime.jsxs("form", { onSubmit: (e) => void handleSubmit(e), noValidate: true, children: [
        error && !isRateLimited && /* @__PURE__ */ jsxRuntime.jsx(Alert, { variant: "error", children: error }),
        isRateLimited && /* @__PURE__ */ jsxRuntime.jsx(
          RateLimitBanner,
          {
            secondsRemaining,
            totalSeconds: retryAfterSeconds ?? secondsRemaining
          }
        ),
        /* @__PURE__ */ jsxRuntime.jsx(
          FormField,
          {
            id: "ra-signup-name",
            label: "Full name",
            type: "text",
            value: name,
            onChange: setName,
            placeholder: "Jane Smith",
            autoComplete: "name",
            required: true,
            disabled: isRateLimited,
            error: fieldErrors["name"],
            elements: el
          }
        ),
        /* @__PURE__ */ jsxRuntime.jsx(
          FormField,
          {
            id: "ra-signup-email",
            label: "Email address",
            type: "email",
            value: email,
            onChange: setEmail,
            placeholder: "you@example.com",
            autoComplete: "email",
            required: true,
            disabled: isRateLimited,
            error: fieldErrors["email"],
            elements: el
          }
        ),
        /* @__PURE__ */ jsxRuntime.jsx(
          FormField,
          {
            id: "ra-signup-password",
            label: "Password",
            type: "password",
            value: password,
            onChange: setPassword,
            placeholder: "Min. 12 characters",
            autoComplete: "new-password",
            required: true,
            disabled: isRateLimited,
            error: fieldErrors["password"],
            elements: el
          }
        ),
        /* @__PURE__ */ jsxRuntime.jsx(PasswordStrength, { password }),
        /* @__PURE__ */ jsxRuntime.jsx(SubmitButton, { isLoading, disabled: isRateLimited, elements: el, children: "Create account" })
      ] })
    ] }),
    /* @__PURE__ */ jsxRuntime.jsxs(CardFooter, { elements: el, children: [
      /* @__PURE__ */ jsxRuntime.jsxs("span", { style: { color: "var(--ra-color-text-tertiary)" }, children: [
        "Already have an account?",
        " "
      ] }),
      /* @__PURE__ */ jsxRuntime.jsx("a", { href: signInUrl, children: "Sign in" })
    ] })
  ] });
}
function MultiSessionSection({
  currentUserId,
  onClose
}) {
  const { client } = useKovaAuth();
  const [sessions, setSessions] = React.useState([]);
  const [switching, setSwitching] = React.useState(null);
  React.useEffect(() => {
    const ms = client;
    ms.multiSession?.listDeviceSessions().then((res) => {
      setSessions(res.data ?? []);
    }).catch(() => setSessions([]));
  }, [client]);
  const others = sessions.filter((s) => s.user.id !== currentUserId);
  if (others.length === 0) return null;
  const handleSwitch = async (token) => {
    setSwitching(token);
    try {
      const ms = client;
      await ms.multiSession?.setActive({ sessionToken: token });
      window.location.reload();
    } catch {
      setSwitching(null);
    } finally {
      onClose();
    }
  };
  return /* @__PURE__ */ jsxRuntime.jsxs(jsxRuntime.Fragment, { children: [
    /* @__PURE__ */ jsxRuntime.jsx(
      "div",
      {
        style: {
          height: 1,
          background: "var(--ra-color-border)",
          margin: "4px 0"
        }
      }
    ),
    /* @__PURE__ */ jsxRuntime.jsx(
      "p",
      {
        style: {
          fontFamily: "var(--ra-font-mono)",
          fontSize: "0.6rem",
          color: "var(--ra-color-text-tertiary)",
          fontWeight: 600,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          padding: "5px 10px 3px"
        },
        children: "Switch account"
      }
    ),
    others.map((s) => /* @__PURE__ */ jsxRuntime.jsxs(
      "button",
      {
        type: "button",
        "data-ra-element": "userButtonMenuItem",
        disabled: !!switching,
        onClick: () => void handleSwitch(s.session.token),
        style: { opacity: switching === s.session.token ? 0.6 : 1 },
        children: [
          switching === s.session.token ? /* @__PURE__ */ jsxRuntime.jsx(Spinner, { size: 14 }) : /* @__PURE__ */ jsxRuntime.jsx(
            Avatar,
            {
              src: s.user.image,
              name: s.user.name ?? s.user.email,
              size: 20
            }
          ),
          /* @__PURE__ */ jsxRuntime.jsxs("span", { style: { flex: 1, minWidth: 0 }, children: [
            /* @__PURE__ */ jsxRuntime.jsx(
              "span",
              {
                style: {
                  display: "block",
                  fontFamily: "var(--ra-font-mono)",
                  fontSize: "0.76rem",
                  fontWeight: 600,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap"
                },
                children: s.user.name ?? s.user.email
              }
            ),
            /* @__PURE__ */ jsxRuntime.jsx(
              "span",
              {
                style: {
                  display: "block",
                  fontFamily: "var(--ra-font-mono)",
                  fontSize: "0.64rem",
                  color: "var(--ra-color-text-tertiary)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap"
                },
                children: s.user.email
              }
            )
          ] })
        ]
      },
      s.session.token
    ))
  ] });
}
function UserButton({
  afterSignOutUrl,
  showName = false,
  size = 32,
  appearance: instanceAppearance,
  className
}) {
  const { appearance: providerAppearance, afterSignOutUrl: providerUrl } = useKovaAuth();
  const merged = mergeAppearance(providerAppearance, instanceAppearance);
  const el = merged.elements ?? {};
  const { isLoaded, isSignedIn, signOut } = useAuth();
  const { user } = useUser();
  const [open, setOpen] = React.useState(false);
  const [signingOut, setSigningOut] = React.useState(false);
  const [showLinkedAccounts, setShowLinkedAccounts] = React.useState(false);
  const triggerRef = React.useRef(null);
  const menuRef = React.useRef(null);
  React.useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (triggerRef.current?.contains(e.target) || menuRef.current?.contains(e.target))
        return;
      setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);
  React.useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open]);
  const handleSignOut = React.useCallback(async () => {
    setSigningOut(true);
    setOpen(false);
    await signOut(afterSignOutUrl ?? providerUrl);
  }, [signOut, afterSignOutUrl, providerUrl]);
  if (!isLoaded) {
    return /* @__PURE__ */ jsxRuntime.jsx(
      "div",
      {
        "data-ra-root": true,
        "data-ra-element": "skeleton",
        style: { width: size, height: size, borderRadius: "50%" }
      }
    );
  }
  if (!isSignedIn || !user) return null;
  const menuStyle = {
    ...el.userButtonMenu,
    // Position will be resolved by the parent; consumers typically put this
    // in a `position: relative` container.
    right: 0,
    top: "calc(100% + 6px)"
  };
  return /* @__PURE__ */ jsxRuntime.jsxs(
    "div",
    {
      "data-ra-root": true,
      style: { position: "relative", display: "inline-flex" },
      children: [
        /* @__PURE__ */ jsxRuntime.jsxs(
          "button",
          {
            ref: triggerRef,
            type: "button",
            "data-ra-element": "userButtonTrigger",
            "aria-label": "User menu",
            "aria-haspopup": "true",
            "aria-expanded": open,
            onClick: () => setOpen((v) => !v),
            style: el.userButtonTrigger,
            className,
            children: [
              signingOut ? /* @__PURE__ */ jsxRuntime.jsx(Spinner, { size }) : /* @__PURE__ */ jsxRuntime.jsx(Avatar, { src: user.image, name: user.name, size }),
              showName && /* @__PURE__ */ jsxRuntime.jsx(
                "span",
                {
                  style: {
                    fontFamily: "var(--ra-font-mono)",
                    fontSize: "0.82rem",
                    fontWeight: 500,
                    color: "var(--ra-color-text)"
                  },
                  children: user.name
                }
              ),
              /* @__PURE__ */ jsxRuntime.jsx(
                ChevronDownIcon,
                {
                  size: 10,
                  style: {
                    color: "var(--ra-color-text-tertiary)",
                    transform: open ? "rotate(180deg)" : "none",
                    transition: "transform 0.15s"
                  }
                }
              )
            ]
          }
        ),
        open && /* @__PURE__ */ jsxRuntime.jsxs(
          "div",
          {
            ref: menuRef,
            role: "menu",
            "data-ra-element": "userButtonMenu",
            style: menuStyle,
            children: [
              /* @__PURE__ */ jsxRuntime.jsxs(
                "div",
                {
                  style: {
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "10px 12px 8px",
                    borderBottom: "1px solid var(--ra-color-border)"
                  },
                  children: [
                    /* @__PURE__ */ jsxRuntime.jsx(Avatar, { src: user.image, name: user.name, size: 36 }),
                    /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { flex: 1, minWidth: 0 }, children: [
                      /* @__PURE__ */ jsxRuntime.jsx(
                        "p",
                        {
                          style: {
                            fontFamily: "var(--ra-font-mono)",
                            fontSize: "0.82rem",
                            fontWeight: 600,
                            color: "var(--ra-color-text)",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            letterSpacing: "-0.01em"
                          },
                          children: user.name
                        }
                      ),
                      /* @__PURE__ */ jsxRuntime.jsx(
                        "p",
                        {
                          style: {
                            fontFamily: "var(--ra-font-mono)",
                            fontSize: "0.68rem",
                            color: "var(--ra-color-text-secondary)",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap"
                          },
                          children: user.email
                        }
                      )
                    ] })
                  ]
                }
              ),
              /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { padding: "4px 0" }, children: [
                /* @__PURE__ */ jsxRuntime.jsxs(
                  "button",
                  {
                    type: "button",
                    role: "menuitem",
                    "data-ra-element": "userButtonMenuItem",
                    style: el.userButtonMenuItem,
                    onClick: () => {
                      setOpen(false);
                      window.location.href = "/settings";
                    },
                    children: [
                      /* @__PURE__ */ jsxRuntime.jsx(UserIcon, { size: 14 }),
                      "Manage account"
                    ]
                  }
                ),
                /* @__PURE__ */ jsxRuntime.jsxs(
                  "button",
                  {
                    type: "button",
                    role: "menuitem",
                    "data-ra-element": "userButtonMenuItem",
                    style: el.userButtonMenuItem,
                    onClick: () => {
                      setOpen(false);
                      window.location.href = "/settings";
                    },
                    children: [
                      /* @__PURE__ */ jsxRuntime.jsx(SettingsIcon, { size: 14 }),
                      "Settings"
                    ]
                  }
                ),
                /* @__PURE__ */ jsxRuntime.jsxs(
                  "button",
                  {
                    type: "button",
                    role: "menuitem",
                    "data-ra-element": "userButtonMenuItem",
                    "aria-expanded": showLinkedAccounts,
                    style: el.userButtonMenuItem,
                    onClick: () => setShowLinkedAccounts((v) => !v),
                    children: [
                      /* @__PURE__ */ jsxRuntime.jsx(LinkIcon, { size: 14 }),
                      /* @__PURE__ */ jsxRuntime.jsx("span", { style: { flex: 1 }, children: "Connected accounts" }),
                      /* @__PURE__ */ jsxRuntime.jsx(
                        ChevronDownIcon,
                        {
                          size: 10,
                          style: {
                            color: "var(--ra-color-text-tertiary)",
                            transform: showLinkedAccounts ? "rotate(180deg)" : "none",
                            transition: "transform 0.15s",
                            flexShrink: 0
                          }
                        }
                      )
                    ]
                  }
                ),
                showLinkedAccounts && /* @__PURE__ */ jsxRuntime.jsx(
                  "div",
                  {
                    style: {
                      padding: "0 12px 4px",
                      borderBottom: "1px solid var(--ra-color-border)"
                    },
                    children: /* @__PURE__ */ jsxRuntime.jsx(
                      ConnectedAccounts,
                      {
                        callbackURL: window.location.pathname,
                        elements: el
                      }
                    )
                  }
                ),
                /* @__PURE__ */ jsxRuntime.jsx(
                  MultiSessionSection,
                  {
                    currentUserId: user.id,
                    onClose: () => setOpen(false)
                  }
                ),
                /* @__PURE__ */ jsxRuntime.jsx(
                  "div",
                  {
                    style: {
                      height: 1,
                      background: "var(--ra-color-border)",
                      margin: "4px 0"
                    }
                  }
                ),
                /* @__PURE__ */ jsxRuntime.jsxs(
                  "button",
                  {
                    type: "button",
                    role: "menuitem",
                    "data-ra-element": "userButtonMenuItem",
                    "data-destructive": "true",
                    style: el.userButtonMenuItem,
                    onClick: () => void handleSignOut(),
                    children: [
                      /* @__PURE__ */ jsxRuntime.jsx(LogOutIcon, { size: 14 }),
                      "Sign out"
                    ]
                  }
                )
              ] })
            ]
          }
        )
      ]
    }
  );
}

// src/hooks/use-session.ts
function useSession() {
  const { sessionResult, client } = useKovaAuth();
  const result = sessionResult;
  const isLoaded = !result.isPending;
  const isSignedIn = !!result.data?.user && !result.error;
  const session = result.data ? {
    user: result.data.user,
    session: result.data.session
  } : null;
  return {
    session,
    isLoaded,
    isSignedIn,
    refetch: () => result.refetch()
  };
}

// src/webhook.ts
async function verifyWebhookSignature(rawBody, signature, secret, options = {}) {
  try {
    let timestamp = null;
    let expectedHex = null;
    for (const part of signature.split(",")) {
      const trimmed = part.trim();
      if (trimmed.startsWith("t=")) {
        timestamp = parseInt(trimmed.slice(2), 10);
      } else if (trimmed.startsWith("sha256=")) {
        expectedHex = trimmed.slice(7);
      }
    }
    if (!expectedHex) return false;
    if (options.maxAgeSeconds !== void 0) {
      if (timestamp === null) return false;
      const ageMs = Date.now() - timestamp;
      if (ageMs > options.maxAgeSeconds * 1e3 || ageMs < 0) return false;
    }
    const message = timestamp !== null ? `${timestamp}.${rawBody}` : rawBody;
    const actualHex = await computeHmacSha256Hex(secret, message);
    return constantTimeEqual(actualHex, expectedHex);
  } catch {
    return false;
  }
}
async function computeHmacSha256Hex(secret, message) {
  const enc = new TextEncoder();
  const key = await globalThis.crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await globalThis.crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
function constantTimeEqual(a, b) {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

exports.ConnectedAccounts = ConnectedAccounts;
exports.KovaAuthProvider = KovaAuthProvider;
exports.OrgSwitcher = OrgSwitcher;
exports.Protect = Protect;
exports.SignIn = SignIn;
exports.SignUp = SignUp;
exports.UserButton = UserButton;
exports.createKovaAuthClient = createKovaAuthClient;
exports.decodePublishableKey = decodePublishableKey;
exports.encodePublishableKey = encodePublishableKey;
exports.extractRetryAfter = extractRetryAfter;
exports.rateLimitMessage = rateLimitMessage;
exports.useAuth = useAuth;
exports.useKovaAuth = useKovaAuth;
exports.useLinkedAccounts = useLinkedAccounts;
exports.useOrganization = useOrganization;
exports.useRateLimit = useRateLimit;
exports.useSession = useSession;
exports.useSignIn = useSignIn;
exports.useSignUp = useSignUp;
exports.useUser = useUser;
exports.verifyWebhookSignature = verifyWebhookSignature;
//# sourceMappingURL=index.cjs.map
//# sourceMappingURL=index.cjs.map