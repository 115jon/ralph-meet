// ── KovaAuth ────────────────────────────────────────────────────────────────
// Who is calling, as Kova sees it. A lookup either finds a session or fails
// with `Unauthenticated` (Kova's answer is "no") or `AuthUnavailable` (Kova
// could not answer). The two must never be confused: a 401 tells clients to
// stop and sign in, a 503 tells them to retry.

import { env } from "cloudflare:workers";
import { Context, Effect, Layer, Option, Schema, type Duration } from "effect";

import { looseStruct } from "@/lib/schema";
import {
  DEFAULT_KOVA_AUTH_PUBLISHABLE_KEY,
  DEFAULT_KOVA_AUTH_URL,
} from "@/lib/site-defaults";
import { AuthUnavailable, Unauthenticated } from "@/server/errors";

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

export interface KovaIdentity {
  readonly user: KovaAuthUser;
  readonly session: KovaAuthSession;
}

/** The headers Kova reads a session from. Forwarded as they are, never logged. */
export interface SessionHeaders {
  readonly authorization: string | null;
  readonly cookie: string | null;
}

/** Everything a request may prove its session with. */
export interface Credentials extends SessionHeaders {
  /** `?token=`: the desktop app's fallback where it cannot set a header. */
  readonly queryToken: string | null;
}

export interface KovaOptions {
  readonly url: string;
  readonly publishableKey: string;
  /** A hung Kova must not hang every request behind it. */
  readonly timeout: Duration.Input;
  /** Read at call time, so a test can hand in a fake Kova. */
  readonly fetch: typeof fetch;
}

export const KOVA_SESSION_TIMEOUT: Duration.Input = "5 seconds";

/** Statuses that mean "try again", not "no session". */
export function isKovaUnavailableStatus(status: number): boolean {
  return status >= 500 || status === 429 || status === 408;
}

export class KovaAuth extends Context.Service<
  KovaAuth,
  {
    /** One get-session call with these headers. */
    readonly lookup: (
      headers: SessionHeaders,
    ) => Effect.Effect<KovaIdentity, Unauthenticated | AuthUnavailable>;
  }
>()("ralph-meet/server/KovaAuth") {
  /** Kova over HTTP with these options. Tests point `fetch` at a fake Kova. */
  static layerWith(options: KovaOptions): Layer.Layer<KovaAuth> {
    return Layer.succeed(
      KovaAuth,
      KovaAuth.of({ lookup: (headers) => lookupSession(options, headers) }),
    );
  }

  /** Kova from the Worker's env, falling back to the site defaults. */
  static readonly layer: Layer.Layer<KovaAuth> = Layer.sync(KovaAuth, () => {
    const options = liveOptions();

    return KovaAuth.of({
      lookup: (headers) => lookupSession(options, headers),
    });
  });
}

function liveOptions(): KovaOptions {
  const authEnv = env as unknown as {
    KOVA_AUTH_URL?: string;
    VITE_KOVA_AUTH_PUBLISHABLE_KEY?: string;
  };

  return {
    url: (authEnv.KOVA_AUTH_URL ?? DEFAULT_KOVA_AUTH_URL).replace(/\/$/, ""),
    // Under `vite dev` the define from vite.config.ts comes first: it is the
    // client's key too, and .dev.vars cannot override it (lib/dev-auth-target).
    publishableKey:
      import.meta.env.RALPH_DEV_KOVA_KEY ??
      authEnv.VITE_KOVA_AUTH_PUBLISHABLE_KEY ??
      DEFAULT_KOVA_AUTH_PUBLISHABLE_KEY,
    timeout: KOVA_SESSION_TIMEOUT,
    fetch: (input, init) => fetch(input, init),
  };
}

// Kova's get-session answer. Only `user.id` is required; the rest of the
// user and session objects pass through as Kova sent them.
const decodeSessionBody = Schema.decodeUnknownOption(
  Schema.Struct({
    user: looseStruct({ id: Schema.String }),
    session: looseStruct({}),
  }),
);

function lookupSession(
  options: KovaOptions,
  headers: SessionHeaders,
): Effect.Effect<KovaIdentity, Unauthenticated | AuthUnavailable> {
  // No credentials: nothing to ask Kova about, and nothing it could say yes to.
  if (!headers.authorization && !headers.cookie) {
    return Effect.fail(new Unauthenticated());
  }

  const request = new Headers();

  if (headers.authorization)
    request.set("authorization", headers.authorization);
  if (headers.cookie) request.set("cookie", headers.cookie);
  if (options.publishableKey) {
    request.set("x-publishable-key", options.publishableKey);
  }

  return Effect.gen(function* () {
    const res = yield* Effect.tryPromise({
      try: (signal) =>
        options.fetch(`${options.url}/api/auth/get-session`, {
          headers: request,
          signal,
        }),
      catch: (error) =>
        new AuthUnavailable({
          reason: error instanceof Error ? error.name : "fetch failed",
        }),
    });

    if (isKovaUnavailableStatus(res.status)) {
      return yield* new AuthUnavailable({ reason: `HTTP ${res.status}` });
    }

    // Any other refusal (401, 403, 400...) is Kova's answer: no session.
    if (!res.ok) return yield* new Unauthenticated();

    // A 2xx that is not JSON is a proxy or edge error page, not an answer.
    const body: unknown = yield* Effect.tryPromise({
      try: () => res.json(),
      catch: () => new AuthUnavailable({ reason: "unreadable body" }),
    });

    const decoded = decodeSessionBody(body);

    if (Option.isNone(decoded)) return yield* new Unauthenticated();

    return {
      // SAFETY: Kova's user and session objects; only `id` is checked, the
      // other fields stay optional and are read defensively by callers.
      user: decoded.value.user as KovaAuthUser,
      session: decoded.value.session as KovaAuthSession,
    };
  }).pipe(
    // Covers the body read too: a hung stream is as bad as a hung connect.
    Effect.timeoutOrElse({
      duration: options.timeout,
      orElse: () => Effect.fail(new AuthUnavailable({ reason: "timeout" })),
    }),
  );
}

function bearerToken(authorization: string | null): string | null {
  return authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : null;
}

/** The credentials on a request: its authorization and cookie headers and `?token=`. */
export function credentialsOf(request: Request): Credentials {
  return {
    authorization: request.headers.get("authorization"),
    cookie: request.headers.get("cookie"),
    queryToken: new URL(request.url).searchParams.get("token"),
  };
}

/**
 * Who is calling. First the request's own headers; when Kova finds no
 * session there, the desktop app's bearer token (or `?token=`) alone. Either
 * lookup finding a session wins. If neither does and either could not reach
 * Kova, the answer is `AuthUnavailable`, not `Unauthenticated`.
 */
export const authenticate = Effect.fn("kova.authenticate")(function* (
  credentials: Credentials,
) {
  const kova = yield* KovaAuth;
  const token =
    bearerToken(credentials.authorization) || credentials.queryToken;

  const byToken = token
    ? kova.lookup({ authorization: `Bearer ${token}`, cookie: null })
    : Effect.fail(new Unauthenticated());

  return yield* kova
    .lookup(credentials)
    .pipe(
      Effect.catch((first) =>
        byToken.pipe(
          Effect.catchTag("Unauthenticated", () => Effect.fail(first)),
        ),
      ),
    );
});

/** The signed-in caller's user id: what `requireAuth` gave routes, as a typed lookup. */
export function signedInUserId(
  request: Request,
): Effect.Effect<string, Unauthenticated | AuthUnavailable, KovaAuth> {
  return Effect.map(
    authenticate(credentialsOf(request)),
    (identity) => identity.user.id,
  );
}
