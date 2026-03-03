// ============================================================================
// Desktop Auth Helpers
//
// With tauri-plugin-clerk, Clerk works natively on desktop — real sessions,
// auto-refresh, persistence. This module provides:
//
// 1. Legacy JWT deep-link helpers (localStorage token for apiFetch)
// 2. useClerkTokenSync — hook that periodically refreshes the JWT
//    from Clerk's session into localStorage so apiFetch can use it
//
// Call sites should import useAuth/useUser directly from
// "@clerk/tanstack-react-start" (which on desktop resolves to
// @clerk/clerk-react via the Vite shim).
// ============================================================================

import { useAuth } from "@clerk/tanstack-react-start";
import { useCallback, useEffect, useRef, useState } from "react";
import { isTauri } from "./platform";

declare global {
  interface Window {
    __TAURI_INTERNALS__?: any;
  }
}

// ── Legacy JWT deep-link helpers (kept for fallback) ────────────────────────

const TOKEN_KEY = "desktop_auth_token";

/** Store a JWT from the deep-link auth flow (legacy fallback). */
export function setDesktopToken(token: string) {
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(TOKEN_KEY, token);
  }
}

/** Retrieve stored JWT (legacy fallback). */
export function getDesktopToken(): string | null {
  if (typeof localStorage !== "undefined") {
    return localStorage.getItem(TOKEN_KEY);
  }
  return null;
}

/** Clear stored JWT on sign-out. */
export function clearDesktopToken() {
  if (typeof localStorage !== "undefined") {
    localStorage.removeItem(TOKEN_KEY);
  }
}

/** Check if there's a legacy JWT in localStorage. */
export function isDesktopAuthenticated(): boolean {
  return !!getDesktopToken();
}

/** Decode the user ID from a stored JWT (legacy). */
export function getDesktopUserId(): string | null {
  const token = getDesktopToken();
  if (!token) return null;
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    return payload.sub ?? payload.userId ?? null;
  } catch {
    return null;
  }
}

// ── Token sync hook ─────────────────────────────────────────────────────────

/**
 * Hook that syncs Clerk's session token into localStorage so that
 * the non-hook `apiFetch()` / `apiUpload()` can read it.
 *
 * Must be rendered inside a component tree that has `ClerkProvider`.
 * On web this is a no-op (web uses Clerk cookies for API auth).
 * On desktop, refreshes the token every 50s (Clerk tokens expire in 60s).
 *
 * Returns `tokenReady` — true once the first sync has completed (or on web).
 */
export function useClerkTokenSync(): { tokenReady: boolean } {
  const { getToken, isSignedIn } = useAuth();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [tokenReady, setTokenReady] = useState(!isTauri()); // web is always ready

  const sync = useCallback(async () => {
    if (!isTauri()) return;
    try {
      const token = await getToken();
      if (token) {
        setDesktopToken(token);
        setTokenReady(true);
      } else {
        clearDesktopToken();
      }
    } catch {
      // Clerk not ready yet — ignore
    }
  }, [getToken, isSignedIn]);

  useEffect(() => {
    if (!isTauri()) return;

    // Initial sync
    sync();

    // Refresh every 50 seconds (tokens expire in 60s)
    intervalRef.current = setInterval(sync, 50_000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [sync, isSignedIn]);

  return { tokenReady };
}
