// Kova session checks for code outside the Effect edge (requireAuth, the
// account and session routes, the chat route guard). The lookup itself is
// the `KovaAuth` service in `@/server/kova-auth`; this maps its typed
// failures onto the plain shapes these callers already use.

import { getRequestHeader } from "@tanstack/react-start/server";
import { Effect } from "effect";

import type { AuthUnavailable, Unauthenticated } from "@/server/errors";
import {
  authenticate,
  KovaAuth,
  type Credentials,
  type KovaAuthSession,
  type KovaAuthUser,
  type KovaIdentity,
  type SessionHeaders,
} from "@/server/kova-auth";

export type { KovaAuthSession, KovaAuthUser } from "@/server/kova-auth";

/**
 * What Kova said about a request's credentials. `unavailable` means it could
 * not say (unreachable, timed out, 5xx, 429, or an unreadable body): that is
 * not "signed out", and callers must not treat it as one.
 */
export type KovaSessionCheck =
  | { status: "signed-in"; user: KovaAuthUser; session: KovaAuthSession }
  | { status: "signed-out" }
  | { status: "unavailable"; reason: string };

function settle(
  lookup: Effect.Effect<
    KovaIdentity,
    Unauthenticated | AuthUnavailable,
    KovaAuth
  >,
): Promise<KovaSessionCheck> {
  return Effect.runPromise(
    lookup.pipe(
      Effect.map((identity): KovaSessionCheck => ({
        status: "signed-in",
        user: identity.user,
        session: identity.session,
      })),
      Effect.catchTags({
        Unauthenticated: () =>
          Effect.succeed<KovaSessionCheck>({ status: "signed-out" }),
        AuthUnavailable: (error) =>
          Effect.succeed<KovaSessionCheck>({
            status: "unavailable",
            reason: error.reason,
          }),
      }),
      Effect.provide(KovaAuth.layer),
    ),
  );
}

function lookup(headers: SessionHeaders) {
  return Effect.gen(function* () {
    const kova = yield* KovaAuth;
    return yield* kova.lookup(headers);
  });
}

/** The session headers: from `headers` when given, else the current request's. */
function sessionHeaders(headers?: Headers): SessionHeaders {
  return {
    authorization:
      headers?.get("authorization") ??
      getRequestHeader("authorization") ??
      null,
    cookie: headers?.get("cookie") ?? getRequestHeader("cookie") ?? null,
  };
}

/**
 * The credentials on `req`, falling back to the current request's headers
 * (routes that call `requireAuth()` without passing the request).
 */
export function requestCredentials(req?: Request): Credentials {
  return {
    ...sessionHeaders(req?.headers),
    queryToken: req ? new URL(req.url).searchParams.get("token") : null,
  };
}

/** One get-session call with these headers (or the current request's). */
export async function checkKovaAuthSession(
  headers?: Headers,
): Promise<KovaSessionCheck> {
  return settle(lookup(sessionHeaders(headers)));
}

/** The full check `requireAuth` makes: request headers, then the bearer or `?token=` alone. */
export async function checkCredentials(
  credentials: Credentials,
): Promise<KovaSessionCheck> {
  return settle(authenticate(credentials));
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
