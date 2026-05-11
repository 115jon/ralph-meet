import { useCallback, useEffect, useRef, useState } from "react";
import { RALPH_AUTH_PUBLISHABLE_KEY } from "@/lib/ralph-auth-config";

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

const TOKEN_KEY = "desktop_auth_token";

function getSdkSessionToken(): string | null {
  if (typeof localStorage === "undefined" || !RALPH_AUTH_PUBLISHABLE_KEY) {
    return null;
  }
  return localStorage.getItem(`ralph-auth:${RALPH_AUTH_PUBLISHABLE_KEY}:session-token`);
}

export function setDesktopToken(token: string) {
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(TOKEN_KEY, token);
  }
}

export function getDesktopToken(): string | null {
  if (typeof localStorage !== "undefined") {
    return localStorage.getItem(TOKEN_KEY) ?? getSdkSessionToken();
  }
  return null;
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
  if (typeof localStorage !== "undefined") {
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
  isSignedIn: boolean,
): { tokenReady: boolean } {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [tokenReady, setTokenReady] = useState(() => !!getDesktopToken());

  const sync = useCallback(async () => {
    try {
      const token = await getToken();
      if (token) {
        setDesktopToken(token);
        setTokenReady(true);
      } else if (isSignedIn) {
        setTokenReady(!!getDesktopToken());
      } else {
        clearDesktopToken();
        setTokenReady(true);
      }
    } catch {
      setTokenReady(!!getDesktopToken());
    }
  }, [getToken, isSignedIn]);

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
