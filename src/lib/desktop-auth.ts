import { useCallback, useEffect, useRef, useState } from "react";
import { KOVA_AUTH_PUBLISHABLE_KEY } from "@/lib/kova-auth-config";
import { clog } from "@/lib/console-logger";

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

const TOKEN_KEY = "desktop_auth_token";
const TOKEN_EVENT = "ralphmeet:desktop-token-change";
const LOGOUT_INTENT_KEY = "ralphmeet:logout-intent";
export const DEBUG_DESKTOP_AUTH = false;

const log = clog("DesktopAuth");

function kovaSessionStorageKey(): string | null {
  return KOVA_AUTH_PUBLISHABLE_KEY
    ? `kova-auth:${KOVA_AUTH_PUBLISHABLE_KEY}:session-token`
    : null;
}

function legacyRalphSessionStorageKey(): string | null {
  return KOVA_AUTH_PUBLISHABLE_KEY
    ? `ralph-auth:${KOVA_AUTH_PUBLISHABLE_KEY}:session-token`
    : null;
}

/** `kova-auth:<pk>:session-token` or `ralph-auth:<pk>:session-token`, any pk. */
const SESSION_TOKEN_STORAGE_KEY =
  /^(?:kova-auth|ralph-auth):[^:]+:session-token$/;

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/**
 * Session-token keys left under a different publishable key (the pk moved
 * from pk_dev_* to pk_live_* in 3.1.0) or under the pre-Kova `ralph-auth:`
 * prefix. Kova scopes sessions by app, not by key, so these stay valid.
 * The current pk's legacy `ralph-auth:` key comes first.
 */
function otherSessionStorageKeys(currentKey: string): string[] {
  const legacyKey = legacyRalphSessionStorageKey();
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || key === currentKey || key === legacyKey) continue;
    if (SESSION_TOKEN_STORAGE_KEY.test(key)) keys.push(key);
  }
  keys.sort();
  return legacyKey && localStorage.getItem(legacyKey) !== null
    ? [legacyKey, ...keys]
    : keys;
}

function removeOtherSessionTokens(currentKey: string) {
  for (const key of otherSessionStorageKeys(currentKey)) {
    localStorage.removeItem(key);
  }
}

export function getStoredKovaAuthSessionToken(): string | null {
  if (typeof localStorage === "undefined" || !KOVA_AUTH_PUBLISHABLE_KEY) {
    return null;
  }

  const currentKey = kovaSessionStorageKey();
  if (!currentKey) return null;
  const currentToken = localStorage.getItem(currentKey);
  if (currentToken) return currentToken;

  // Nothing under this pk: adopt a session another key left behind and move
  // it under the current key, so the SDK (which only reads its own pk's key)
  // and every later read find it.
  for (const key of otherSessionStorageKeys(currentKey)) {
    const token = localStorage.getItem(key);
    if (!token) continue;
    if (DEBUG_DESKTOP_AUTH) {
      log.info("Adopting session token from another storage key", { key });
    }
    localStorage.setItem(currentKey, token);
    removeOtherSessionTokens(currentKey);
    notifyDesktopTokenChanged(token);
    return token;
  }
  return null;
}

export function setStoredKovaAuthSessionToken(token: string) {
  if (typeof localStorage === "undefined" || !KOVA_AUTH_PUBLISHABLE_KEY) {
    return;
  }
  const currentKey = kovaSessionStorageKey();
  if (!currentKey) return;

  // Announce even when the slot already holds this token: the Kova SDK
  // writes its pk-scoped key itself before reporting the token, and that
  // write emits nothing, so this event is what tells listeners it landed.
  if (localStorage.getItem(currentKey) !== token) {
    localStorage.setItem(currentKey, token);
    removeOtherSessionTokens(currentKey);
  }
  notifyDesktopTokenChanged(token);
}

export function setDesktopAuthSession(token: string) {
  setDesktopToken(token);
  setStoredKovaAuthSessionToken(token);
}

export function clearStoredKovaAuthSessionToken() {
  if (typeof localStorage === "undefined" || !KOVA_AUTH_PUBLISHABLE_KEY) {
    return;
  }
  const currentKey = kovaSessionStorageKey();
  if (!currentKey) return;
  localStorage.removeItem(currentKey);
  // Every pk's key, or signing out would let the next read adopt one again.
  removeOtherSessionTokens(currentKey);
  notifyDesktopTokenChanged(null);
}

export function setDesktopToken(token: string) {
  if (isTauriRuntime() && typeof localStorage !== "undefined") {
    if (localStorage.getItem(TOKEN_KEY) === token) {
      notifyDesktopTokenChanged(token);
      return;
    }
    if (DEBUG_DESKTOP_AUTH) {
      log.info("Persisting desktop token", {
        tokenLength: token.length,
      });
    }
    localStorage.setItem(TOKEN_KEY, token);
    notifyDesktopTokenChanged(token);
  }
}

export function getDesktopToken(): string | null {
  if (isTauriRuntime() && typeof localStorage !== "undefined") {
    return localStorage.getItem(TOKEN_KEY);
  }
  return null;
}

export function getDesktopAuthHandoffToken(): string | null {
  return getDesktopToken() ?? getStoredKovaAuthSessionToken();
}

export async function waitForDesktopToken(
  timeoutMs = 1500,
): Promise<string | null> {
  const existing = getDesktopAuthHandoffToken();
  if (existing || typeof window === "undefined") return existing;

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    const token = getDesktopAuthHandoffToken();
    if (token) return token;
  }

  return getDesktopAuthHandoffToken();
}

export function clearDesktopToken() {
  if (isTauriRuntime() && typeof localStorage !== "undefined") {
    if (DEBUG_DESKTOP_AUTH) {
      log.info("Clearing desktop token");
    }
    localStorage.removeItem(TOKEN_KEY);
    notifyDesktopTokenChanged(null);
  }
}

export function subscribeDesktopTokenChanges(
  listener: (token: string | null) => void,
): () => void {
  if (typeof window === "undefined") return () => undefined;

  const handler = (event: Event) => {
    listener(
      (event as CustomEvent<string | null>).detail ??
        getDesktopAuthHandoffToken(),
    );
  };
  window.addEventListener(TOKEN_EVENT, handler);
  return () => window.removeEventListener(TOKEN_EVENT, handler);
}

function notifyDesktopTokenChanged(token: string | null) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(TOKEN_EVENT, { detail: token }));
}

export function clearDesktopAuthSession() {
  clearDesktopToken();
  clearStoredKovaAuthSessionToken();
}

/**
 * Record a session token the SDK produced. On desktop it always lands in
 * `desktop_auth_token` too: that key doesn't depend on the publishable key,
 * so a pk change can't orphan the session. (The SDK writes its pk-scoped key
 * before reporting the token, so checking the handoff token here would always
 * find it and skip the desktop key.) On the web, only fill an empty slot.
 *
 * Always announces the token, filled slot or not: the SDK's own pk-scoped
 * write emits no event, and this call (from `onSessionTokenChange` or the
 * token sync) is how listeners such as the chat page's auth gate learn of it.
 */
export function rememberKovaSessionToken(token: string) {
  const missing = isTauriRuntime()
    ? !getDesktopToken()
    : !getDesktopAuthHandoffToken();
  if (missing) setDesktopAuthSession(token);
  else notifyDesktopTokenChanged(token);
}

/** KovaAuthProvider's onSessionTokenChange, minus the React state. */
export function handleKovaSessionTokenChange(
  token: string | null,
  state: { seenSessionToken: boolean },
) {
  if (token) {
    state.seenSessionToken = true;
    rememberKovaSessionToken(token);
    return;
  }
  // The SDK only reports null from signOut(); a key change never does.
  if (state.seenSessionToken) {
    state.seenSessionToken = false;
    markAuthLogoutIntent();
    clearDesktopAuthSession();
  }
}

export function markAuthLogoutIntent() {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(LOGOUT_INTENT_KEY, String(Date.now()));
}

export function consumeAuthLogoutIntent(): boolean {
  if (typeof window === "undefined") return false;
  const value = window.sessionStorage.getItem(LOGOUT_INTENT_KEY);
  if (!value) return false;
  window.sessionStorage.removeItem(LOGOUT_INTENT_KEY);
  return true;
}

export function isDesktopAuthenticated(): boolean {
  return !!getDesktopAuthHandoffToken();
}

type TokenRefresher = () => Promise<string | null>;
let tokenRefresher: TokenRefresher | null = null;

export function registerTokenRefresher(fn: TokenRefresher) {
  tokenRefresher = fn;
}

export async function refreshDesktopToken(
  options: { force?: boolean } = {},
): Promise<string | null> {
  const existing = getDesktopAuthHandoffToken();
  if (existing && !options.force) return existing;
  if (!tokenRefresher) return null;
  try {
    const token = await tokenRefresher();
    if (token) {
      setDesktopAuthSession(token);
      return token;
    }
  } catch {
    // Auth not ready or session expired.
  }
  return null;
}

export function useKovaAuthTokenSync(
  getToken: () => Promise<string | null>,
  isLoaded: boolean,
  isSignedIn: boolean,
): { tokenReady: boolean } {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [tokenReady, setTokenReady] = useState(
    () => !!getDesktopAuthHandoffToken(),
  );

  const sync = useCallback(async () => {
    try {
      const token = await getToken();
      if (DEBUG_DESKTOP_AUTH) {
        log.info("Token sync tick", {
          isLoaded,
          isSignedIn,
          hasToken: !!token,
          existingDesktopToken: !!getDesktopToken(),
        });
      }
      if (token) {
        rememberKovaSessionToken(token);
        setTokenReady(true);
      } else {
        setTokenReady(!!getDesktopAuthHandoffToken());
      }
    } catch (error) {
      log.warn("Token sync failed", error);
      setTokenReady(!!getDesktopAuthHandoffToken());
    }
  }, [getToken, isLoaded, isSignedIn]);

  useEffect(() => {
    registerTokenRefresher(getToken);
    return () => registerTokenRefresher(() => Promise.resolve(null));
  }, [getToken]);

  useEffect(() => {
    const timeout = setTimeout(() => void sync(), 0);
    intervalRef.current = setInterval(() => void sync(), 50_000);

    return () => {
      clearTimeout(timeout);
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [sync]);

  return { tokenReady };
}
