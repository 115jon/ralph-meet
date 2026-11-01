// ── App session recovery ────────────────────────────────────────────────────
// Ralph's bearer is a Kova app-scoped session token, minted from the auth
// domain's cookie session (POST /api/pub/apps/:pk/session-token). The Kova SDK
// makes that call only when it holds no token at all. When the stored token
// is revoked server-side while the cookie session lives on, nothing asks
// again: Kova's get-session answers 200 null for the dead bearer, every Ralph
// call answers 401, and the app sits there until a reload.
//
// This module asks again. A refused token (a Ralph 401, or the SDK finding
// no session behind its bearer) triggers one mint, shared by every caller
// that was refused at the same time and spaced out by a cooldown. The new
// token is stored and announced like any other (the root layout hands it to
// the SDK, which refetches the session), so the user id, the API and the
// realtime sockets all come back on their own.
//
// If Kova has no cookie session either, the session really is gone: the dead
// token is cleared and the state turns "signed-out", which the connection UI
// shows as a sign-in prompt instead of an endless "Reconnecting". The page
// coming back (wake) checks again, so signing in in another tab heals this
// one too. Desktop uses the same path; its webview usually has no cookie
// session, so a refused desktop token ends at the device-code sign-in.

import { useSyncExternalStore } from "react";
import { clog } from "@/lib/console-logger";
import {
  clearDesktopAuthSession,
  clearSessionTokenRejected,
  getDesktopAuthHandoffToken,
  hasRecentAuthLogoutIntent,
  isSessionTokenRejected,
  markSessionTokenRejected,
  resetRejectedSessionTokensForTests,
  setDesktopAuthSession,
  subscribeDesktopTokenChanges,
} from "@/lib/desktop-auth";
import {
  getKovaAuthUrl,
  KOVA_AUTH_PUBLISHABLE_KEY,
} from "@/lib/kova-auth-config";

const log = clog("SessionRecovery");

/**
 * - `active`: no known problem.
 * - `unverified`: a token was refused and Kova could not be asked (offline,
 *   5xx). The next wake asks again.
 * - `signed-out`: Kova has no session to mint from. Needs a sign-in.
 */
export type AppSessionState = "active" | "unverified" | "signed-out";

/** At most one mint per this window, however many calls are refused. */
export const SESSION_RECOVERY_COOLDOWN_MS = 15_000;

let state: AppSessionState = "active";
const listeners = new Set<() => void>();
let inFlight: Promise<string | null> | null = null;
let lastAttemptAt = Number.NEGATIVE_INFINITY;
let stopWatchingTokens: (() => void) | null = null;

function setState(next: AppSessionState): void {
  if (state === next) return;
  state = next;
  if (next === "active") {
    stopWatchingTokens?.();
    stopWatchingTokens = null;
  } else {
    // Any usable token (a sign-in in this tab, another tab's mint landing on
    // a wake) ends the problem state.
    stopWatchingTokens ??= subscribeDesktopTokenChanges((token) => {
      if (token && !isSessionTokenRejected(token)) setState("active");
    });
  }
  for (const listener of [...listeners]) listener();
}

export function getAppSessionState(): AppSessionState {
  return state;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useAppSessionState(): AppSessionState {
  return useSyncExternalStore(subscribe, getAppSessionState, () => "active");
}

/**
 * A token was refused (`rejectedToken`), or the caller wants the session
 * checked (`null`). Resolves to a token worth retrying with, or null.
 *
 * - A usable token already stored (another caller recovered first) is
 *   returned without asking Kova.
 * - Concurrent callers share one mint.
 * - Within the cooldown of the last mint, resolves null without asking: a
 *   token minted moments ago that is refused again would only loop.
 */
export function recoverAppSession(
  rejectedToken: string | null,
): Promise<string | null> {
  if (rejectedToken) markSessionTokenRejected(rejectedToken);
  const current = getDesktopAuthHandoffToken();
  if (current && !isSessionTokenRejected(current)) {
    return Promise.resolve(current);
  }
  if (inFlight) return inFlight;
  // Signing out: a mint now could land the user straight back in.
  if (hasRecentAuthLogoutIntent()) return Promise.resolve(null);
  if (Date.now() - lastAttemptAt < SESSION_RECOVERY_COOLDOWN_MS) {
    return Promise.resolve(null);
  }
  lastAttemptAt = Date.now();
  const attempt = mintAppSessionToken().finally(() => {
    if (inFlight === attempt) inFlight = null;
  });
  inFlight = attempt;
  return attempt;
}

/** The page came back: check again if the session was in trouble. */
export function recheckAppSession(): void {
  if (state === "active") return;
  void recoverAppSession(null);
}

async function mintAppSessionToken(): Promise<string | null> {
  const pk = KOVA_AUTH_PUBLISHABLE_KEY;
  if (!pk) {
    setState("unverified");
    return null;
  }

  log.warn("Session token refused; minting a new one from the Kova session");
  let response: Response;
  try {
    // The SDK's own mint (KovaAuthProvider), from the auth-domain cookie.
    response = await fetch(
      `${getKovaAuthUrl()}/api/pub/apps/${encodeURIComponent(pk)}/session-token`,
      {
        method: "POST",
        credentials: "include",
        headers: { "X-Publishable-Key": pk },
      },
    );
  } catch (error) {
    log.warn("Could not reach Kova to mint a session token", error);
    setState("unverified");
    return null;
  }

  if (response.status === 401) {
    log.warn("Kova has no session to mint from: signed out");
    // Clear the dead token, unless a usable one landed meanwhile.
    const current = getDesktopAuthHandoffToken();
    if (!current || isSessionTokenRejected(current)) clearDesktopAuthSession();
    setState("signed-out");
    return null;
  }
  if (!response.ok) {
    log.warn("Kova could not mint a session token", {
      status: response.status,
    });
    setState("unverified");
    return null;
  }

  const data: unknown = await response.json().catch(() => null);
  const token =
    data !== null &&
    typeof data === "object" &&
    "sessionToken" in data &&
    typeof data.sessionToken === "string" &&
    data.sessionToken
      ? data.sessionToken
      : null;
  if (!token) {
    setState("unverified");
    return null;
  }
  if (isSessionTokenRejected(token)) {
    // Kova still vouches for the token that was refused, so there is no
    // newer one to try. Keep it; retrying the same token would only loop.
    clearSessionTokenRejected(token);
    setState("active");
    return null;
  }

  setDesktopAuthSession(token);
  log.info("Minted a new session token");
  setState("active");
  return token;
}

export function resetAppSessionRecoveryForTests(): void {
  state = "active";
  inFlight = null;
  lastAttemptAt = Number.NEGATIVE_INFINITY;
  stopWatchingTokens?.();
  stopWatchingTokens = null;
  listeners.clear();
  resetRejectedSessionTokensForTests();
}
