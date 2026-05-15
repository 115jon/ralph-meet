import { useCallback, useEffect, useRef, useState } from "react";
import { RALPH_AUTH_PUBLISHABLE_KEY } from "@/lib/ralph-auth-config";

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

const TOKEN_KEY = "desktop_auth_token";

function isTauriRuntime(): boolean {
  return (
    typeof window !== "undefined" &&
    "__TAURI_INTERNALS__" in window
  );
}

export function getStoredRalphAuthSessionToken(): string | null {
  if (typeof localStorage === "undefined" || !RALPH_AUTH_PUBLISHABLE_KEY) {
    return null;
  }
  return localStorage.getItem(`ralph-auth:${RALPH_AUTH_PUBLISHABLE_KEY}:session-token`);
}

export function setStoredRalphAuthSessionToken(token: string) {
  if (typeof localStorage === "undefined" || !RALPH_AUTH_PUBLISHABLE_KEY) {
    return;
  }
  localStorage.setItem(`ralph-auth:${RALPH_AUTH_PUBLISHABLE_KEY}:session-token`, token);
}

export function setDesktopToken(token: string) {
  if (isTauriRuntime() && typeof localStorage !== "undefined") {
    console.info("[DesktopAuth] Persisting desktop token", {
      tokenLength: token.length,
    });
    localStorage.setItem(TOKEN_KEY, token);
  }
}

export function getDesktopToken(): string | null {
  if (isTauriRuntime() && typeof localStorage !== "undefined") {
    return localStorage.getItem(TOKEN_KEY);
  }
  return null;
}

export function getDesktopAuthHandoffToken(): string | null {
  return getDesktopToken() ?? getStoredRalphAuthSessionToken();
}

export async function waitForDesktopToken(timeoutMs = 1500): Promise<string | null> {
  const existing = getDesktopToken();
  if (existing || typeof window === "undefined") return existing;

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    const token = getDesktopToken();
    if (token) return token;
  }

  return getDesktopToken();
}

export function clearDesktopToken() {
  if (isTauriRuntime() && typeof localStorage !== "undefined") {
    console.info("[DesktopAuth] Clearing desktop token");
    localStorage.removeItem(TOKEN_KEY);
  }
}

export function isDesktopAuthenticated(): boolean {
  return !!getDesktopToken();
}

type TokenRefresher = () => Promise<string | null>;
let tokenRefresher: TokenRefresher | null = null;

export function registerTokenRefresher(fn: TokenRefresher) {
  tokenRefresher = fn;
}

export async function refreshDesktopToken(): Promise<string | null> {
  if (!tokenRefresher) return null;
  try {
    const token = await tokenRefresher();
    if (token) {
      setDesktopToken(token);
      return token;
    }
  } catch {
    // Auth not ready or session expired.
  }
  return null;
}

export function useRalphAuthTokenSync(
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
      console.info("[DesktopAuth] Token sync tick", {
        isLoaded,
        isSignedIn,
        hasToken: !!token,
        existingDesktopToken: !!getDesktopToken(),
      });
      if (token) {
        setDesktopToken(token);
        setTokenReady(true);
      } else if (isSignedIn) {
        setTokenReady(!!getDesktopToken());
      } else if (isLoaded) {
        // A desktop deep-link session is bearer-token based. The Ralph Auth
        // provider may still report signed-out because it has no browser cookie,
        // so passive sync must not erase a valid token received from the OS link.
        setTokenReady(!!getDesktopToken());
      } else {
        setTokenReady(!!getDesktopToken());
      }
    } catch (error) {
      console.warn("[DesktopAuth] Token sync failed", error);
      setTokenReady(!!getDesktopToken());
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
