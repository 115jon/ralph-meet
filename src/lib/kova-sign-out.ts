import { createKovaAuthClient } from "@kova/react";
import { getKovaAuthConfig } from "@/lib/kova-auth-config";

/** Long enough for a slow sign-out (about 1 s in production), short enough not to strand the user. */
const BROWSER_SIGN_OUT_TIMEOUT_MS = 4000;

/**
 * Ends this browser's Kova session on the auth domain (the HttpOnly SSO
 * cookie), before the SDK's own signOut runs.
 *
 * The SDK's signOut revokes the app token and clears it first, and only then
 * signs the cookie out. In that gap the provider, now without a token, mints
 * a new app token from the still-valid cookie (`/session-token`, and
 * `get-session` with the publishable key) and stores it. That token outlives
 * the cookie, so /sign-in finds it and signs the same account straight back
 * in. With the cookie gone first, those mints fail and nothing comes back.
 *
 * A fresh client on purpose: the provider's client sends the app token as
 * Bearer, which would sign out that token instead of the cookie session.
 * Best effort and bounded: the SDK signs the cookie out again afterwards.
 */
export async function endKovaBrowserSession(): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      createKovaAuthClient(getKovaAuthConfig()).signOut(),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, BROWSER_SIGN_OUT_TIMEOUT_MS);
      }),
    ]);
  } catch {
    // Offline or already signed out: the SDK's signOut still runs.
  } finally {
    clearTimeout(timer);
  }
}
