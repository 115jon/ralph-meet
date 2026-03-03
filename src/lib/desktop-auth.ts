// ============================================================================
// Desktop Auth Store
//
// Token-based authentication for the Tauri desktop client.
// Stores a JWT received via deep link (ralphmeet://auth?token=...)
// and provides it for all API requests.
// ============================================================================

// Static ESM imports — no dynamic require() which breaks Vite/Cloudflare ESM.
// These are always bundled, but only *called* on the non-Tauri path.
import { useAuth, useUser } from "@clerk/tanstack-react-start";

declare global {
  interface Window {
    __TAURI_INTERNALS__?: Record<string, unknown>;
  }
}

const TOKEN_KEY = "ralph-meet-desktop-token";

/** Returns true when running inside the Tauri desktop shell. */
function isTauri(): boolean {
  return typeof window !== "undefined" && !!window.__TAURI_INTERNALS__;
}

/** Get the stored auth token, or null if not authenticated. */
export function getDesktopToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}

/** Store the auth token received from the deep link callback. */
export function setDesktopToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
  // Dispatch a custom event so the app can react to the auth change
  window.dispatchEvent(
    new CustomEvent("desktop-auth-change", { detail: { authenticated: true } }),
  );
}

/** Clear the stored token (sign out). */
export function clearDesktopToken(): void {
  localStorage.removeItem(TOKEN_KEY);
  window.dispatchEvent(
    new CustomEvent("desktop-auth-change", {
      detail: { authenticated: false },
    }),
  );
}

/** Check whether the desktop client has a valid stored token. */
export function isDesktopAuthenticated(): boolean {
  return getDesktopToken() !== null;
}

/**
 * Extract token from a deep link URL and store it.
 * Expected format: ralphmeet://auth?token=<jwt>
 * Returns true if a token was successfully extracted.
 */
export function handleDeepLinkAuth(url: string): boolean {
  try {
    // Deep link URLs come as: ralphmeet://auth?token=...
    // Some systems send: ["ralphmeet://auth?token=..."]
    const cleaned = url.replace(/^\["|"\]$/g, "").replace(/^"(.*)"$/, "$1");
    const parsed = new URL(cleaned);
    const token = parsed.searchParams.get("token");
    if (token) {
      setDesktopToken(token);
      return true;
    }
  } catch (e) {
    console.error("[DesktopAuth] Failed to parse deep link URL:", url, e);
  }
  return false;
}

/** Get the user ID by decoding the desktop token JWT */
export function getDesktopUserId(): string | null {
  const token = getDesktopToken();
  if (!token) return null;
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    return payload.sub || payload.clerk_id || null;
  } catch {
    return null;
  }
}

/**
 * Safe wrapper for Clerk's useAuth hook.
 *
 * In the Tauri desktop shell there is no ClerkProvider, so we return a
 * synthetic auth object backed by the locally-stored JWT instead.
 * On the web we delegate to the real Clerk hook (static ESM import above).
 */
export function useSafeAuth() {
  if (isTauri()) {
    return {
      isLoaded: true,
      isSignedIn: isDesktopAuthenticated(),
      userId: getDesktopUserId(),
      sessionId: "desktop-session",
      getToken: async () => getDesktopToken(),
    } as ReturnType<typeof useAuth>;
  }
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return useAuth();
}

/**
 * Safe wrapper for Clerk's useUser hook.
 *
 * On Tauri we synthesise a minimal user object from the stored JWT so that
 * consumers never have to branch on the environment themselves.
 */
export function useSafeUser() {
  if (isTauri()) {
    return {
      isLoaded: true,
      isSignedIn: isDesktopAuthenticated(),
      user: isDesktopAuthenticated()
        ? ({
          id: getDesktopUserId() ?? "desktop-user",
          fullName: "User",
          imageUrl: "",
          username: "User",
          unsafeMetadata: {},
        } as any)
        : null,
    };
  }
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return useUser();
}
