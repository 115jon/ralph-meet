import { getRequestHeader } from "@tanstack/react-start/server";
import { env } from "cloudflare:workers";

import {
  DEFAULT_KOVA_AUTH_PUBLISHABLE_KEY,
  DEFAULT_KOVA_AUTH_URL,
} from "@/lib/site-defaults";

export interface KovaAuthUser {
  id: string;
  name?: string | null;
  email?: string | null;
  image?: string | null;
  imageUrl?: string | null;
  username?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  bio?: string | null;
  primaryEmailAddress?: { emailAddress?: string | null } | null;
}

export interface KovaAuthSession {
  id?: string;
  token?: string;
  userId?: string;
  expiresAt?: string | number | Date;
  createdAt?: string | number | Date;
  updatedAt?: string | number | Date;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/**
 * What Kova said about a request's credentials. `unavailable` means it could
 * not say (unreachable, timed out, 5xx, 429, or an unreadable body): that is
 * not "signed out", and callers must not treat it as one.
 */
export type KovaSessionCheck =
  | { status: "signed-in"; user: KovaAuthUser; session: KovaAuthSession }
  | { status: "signed-out" }
  | { status: "unavailable"; reason: string };

/** A hung Kova must not hang every API request behind it. */
const KOVA_SESSION_TIMEOUT_MS = 8000;

/** Statuses that mean "try again", not "no session". */
export function isKovaUnavailableStatus(status: number): boolean {
  return status >= 500 || status === 429 || status === 408;
}

export async function checkKovaAuthSession(
  headers?: Headers,
): Promise<KovaSessionCheck> {
  const authEnv = env as unknown as CloudflareEnv & {
    KOVA_AUTH_URL?: string;
    VITE_KOVA_AUTH_PUBLISHABLE_KEY?: string;
  };
  const authUrl = (authEnv.KOVA_AUTH_URL ?? DEFAULT_KOVA_AUTH_URL).replace(
    /\/$/,
    "",
  );
  // Under `vite dev` the define from vite.config.ts comes first: it is the
  // client's key too, and .dev.vars cannot override it (lib/dev-auth-target).
  const publishableKey: string =
    import.meta.env.RALPH_DEV_KOVA_KEY ??
    authEnv.VITE_KOVA_AUTH_PUBLISHABLE_KEY ??
    DEFAULT_KOVA_AUTH_PUBLISHABLE_KEY;
  const reqHeaders = new Headers();
  const authHeader =
    headers?.get("authorization") ?? getRequestHeader("authorization");
  const cookie = headers?.get("cookie") ?? getRequestHeader("cookie");
  if (authHeader) reqHeaders.set("authorization", authHeader);
  if (cookie) reqHeaders.set("cookie", cookie);
  if (publishableKey) reqHeaders.set("x-publishable-key", publishableKey);

  let res: Response;
  try {
    res = await fetch(`${authUrl}/api/auth/get-session`, {
      headers: reqHeaders,
      signal: AbortSignal.timeout(KOVA_SESSION_TIMEOUT_MS),
    });
  } catch (error) {
    return {
      status: "unavailable",
      reason: error instanceof Error ? error.name : "fetch failed",
    };
  }

  if (isKovaUnavailableStatus(res.status)) {
    return { status: "unavailable", reason: `HTTP ${res.status}` };
  }
  // Any other refusal (401, 403, 400...) is Kova's answer: no session.
  if (!res.ok) return { status: "signed-out" };

  let data: { user?: KovaAuthUser; session?: KovaAuthSession } | null;
  try {
    data = (await res.json()) as typeof data;
  } catch {
    // A 2xx that is not JSON is a proxy or edge error page, not an answer.
    return { status: "unavailable", reason: "unreadable body" };
  }
  return data?.user && data?.session
    ? { status: "signed-in", user: data.user, session: data.session }
    : { status: "signed-out" };
}

/** The session, or null when there is none or Kova could not be reached. */
export async function getKovaAuthSession(
  headers?: Headers,
): Promise<{ user: KovaAuthUser; session: KovaAuthSession } | null> {
  const check = await checkKovaAuthSession(headers);
  return check.status === "signed-in"
    ? { user: check.user, session: check.session }
    : null;
}

export async function auth() {
  const check = await checkKovaAuthSession();
  const signedIn = check.status === "signed-in" ? check : null;
  return {
    userId: signedIn?.user.id ?? null,
    sessionId: signedIn?.session.id ?? null,
    /** Kova could not answer: the user may well be signed in. */
    unavailable: check.status === "unavailable",
  };
}

export async function getCurrentUser(headers?: Headers) {
  return (await getKovaAuthSession(headers))?.user ?? null;
}

/** Check a bearer token (desktop app token, or a `?token=` query param). */
export async function checkToken(token: string): Promise<KovaSessionCheck> {
  return checkKovaAuthSession(
    new Headers({ authorization: `Bearer ${token}` }),
  );
}
