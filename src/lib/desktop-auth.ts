import { useCallback, useEffect, useRef, useState } from "react";
import { KOVA_AUTH_PUBLISHABLE_KEY } from "@/lib/kova-auth-config";

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

const TOKEN_KEY = "desktop_auth_token";
const TOKEN_EVENT = "ralphmeet:desktop-token-change";
const LOGOUT_INTENT_KEY = "ralphmeet:logout-intent";
export const DEBUG_DESKTOP_AUTH = false;

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

function isTauriRuntime(): boolean {
  return (
    typeof window !== "undefined" &&
    "__TAURI_INTERNALS__" in window
  );
}

export function getStoredKovaAuthSessionToken(): string | null {
  if (typeof localStorage === "undefined" || !KOVA_AUTH_PUBLISHABLE_KEY) {
    return null;
  }

  const currentKey = kovaSessionStorageKey();
  const currentToken = currentKey ? localStorage.getItem(currentKey) : null;
  if (currentToken) return currentToken;

  const legacyKey = legacyRalphSessionStorageKey();
  const legacyToken = legacyKey ? localStorage.getItem(legacyKey) : null;
  if (legacyToken && currentKey) {
    localStorage.setItem(currentKey, legacyToken);
    if (legacyKey) localStorage.removeItem(legacyKey);
    notifyDesktopTokenChanged(legacyToken);
  }
  return legacyToken;
}

export function setStoredKovaAuthSessionToken(token: string) {
  if (typeof localStorage === "undefined" || !KOVA_AUTH_PUBLISHABLE_KEY) {
    return;
  }
  const currentKey = kovaSessionStorageKey();
  if (!currentKey) return;

  if (localStorage.getItem(currentKey) === token) {
    return;
  }
  localStorage.setItem(currentKey, token);
  const legacyKey = legacyRalphSessionStorageKey();
  if (legacyKey) localStorage.removeItem(legacyKey);
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
  const legacyKey = legacyRalphSessionStorageKey();
  if (currentKey) localStorage.removeItem(currentKey);
  if (legacyKey) localStorage.removeItem(legacyKey);
  notifyDesktopTokenChanged(null);
}

export function setDesktopToken(token: string) {
  if (isTauriRuntime() && typeof localStorage !== "undefined") {
    if (localStorage.getItem(TOKEN_KEY) === token) {
      notifyDesktopTokenChanged(token);
      return;
    }
    if (DEBUG_DESKTOP_AUTH) {
      console.info("[DesktopAuth] Persisting desktop token", {
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

export async function waitForDesktopToken(timeoutMs = 1500): Promise<string | null> {
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
      console.info("[DesktopAuth] Clearing desktop token");
    }
    localStorage.removeItem(TOKEN_KEY);
    notifyDesktopTokenChanged(null);
  }
}

export function subscribeDesktopTokenChanges(listener: (token: string | null) => void): () => void {
  if (typeof window === "undefined") return () => undefined;

  const handler = (event: Event) => {
    listener((event as CustomEvent<string | null>).detail ?? getDesktopAuthHandoffToken());
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

export async function refreshDesktopToken(options: { force?: boolean } = {}): Promise<string | null> {
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
  const isTauri = isTauriRuntime();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [tokenReady, setTokenReady] = useState(() => !!getDesktopToken());

  const sync = useCallback(async () => {
    if (!isTauri) {
      setTokenReady(true);
      return;
    }

    try {
      const token = await getToken();
      if (DEBUG_DESKTOP_AUTH) {
        console.info("[DesktopAuth] Token sync tick", {
          isLoaded,
          isSignedIn,
          hasToken: !!token,
          existingDesktopToken: !!getDesktopToken(),
        });
      }
      if (token) {
        if (!getDesktopAuthHandoffToken()) {
          setDesktopAuthSession(token);
        }
        setTokenReady(true);
      } else if (isSignedIn) {
        setTokenReady(!!getDesktopAuthHandoffToken());
      } else if (isLoaded) {
        // A desktop deep-link session is bearer-token based. The Ralph Auth
        // provider may still report signed-out because it has no browser cookie,
        // so passive sync must not erase a valid token received from the OS link.
        setTokenReady(!!getDesktopAuthHandoffToken());
      } else {
        setTokenReady(!!getDesktopAuthHandoffToken());
      }
    } catch (error) {
      console.warn("[DesktopAuth] Token sync failed", error);
      setTokenReady(!!getDesktopAuthHandoffToken());
    }
  }, [getToken, isLoaded, isSignedIn, isTauri]);

  useEffect(() => {
    if (!isTauri) return;

    registerTokenRefresher(getToken);
    return () => registerTokenRefresher(() => Promise.resolve(null));
  }, [getToken, isTauri]);

  useEffect(() => {
    if (!isTauri) {
      setTokenReady(true);
      return;
    }

    const timeout = setTimeout(() => void sync(), 0);
    intervalRef.current = setInterval(() => void sync(), 50_000);

    return () => {
      clearTimeout(timeout);
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [sync, isTauri]);

  return { tokenReady };
}
