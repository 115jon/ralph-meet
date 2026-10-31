// ── Typed failures on the Worker request path ───────────────────────────────
// Every failure a route may answer with. `runRoute` (./edge.ts) turns each
// into its Response in one place; anything else is a defect and answers 500.

import { Effect, Schema } from "effect";

import { ServiceError } from "@/lib/service-error";

/**
 * Nobody is signed in: no credentials, or Kova looked and found no session
 * (a 2xx with no user, or a 401/403). Answers 401. Clients treat that as
 * "sign in again", so only a definitive answer may become this.
 */
export class Unauthenticated extends Schema.TaggedError<Unauthenticated>()(
  "Unauthenticated",
  {},
) {}

/**
 * Kova could not say who is calling: unreachable, timed out, a 5xx, 408 or
 * 429, or a 2xx body that is not JSON. Answers 503 with a Retry-After; the
 * user may well be signed in, and clients retry on their normal backoff.
 * `reason` is for the log (an error name or `HTTP 503`), never a credential.
 */
export class AuthUnavailable extends Schema.TaggedError<AuthUnavailable>()(
  "AuthUnavailable",
  { reason: Schema.String },
) {}

/**
 * A `ServiceError` thrown by the service layer, as a typed failure. Answers
 * its own status and code through `apiError`, as the routes did by hand.
 */
export class ServiceFailure extends Schema.TaggedError<ServiceFailure>()(
  "ServiceFailure",
  {
    message: Schema.String,
    status: Schema.Number,
    code: Schema.optional(Schema.String),
  },
) {
  static fromServiceError(error: ServiceError): ServiceFailure {
    return new ServiceFailure({
      message: error.message,
      status: error.status,
      code: error.code,
    });
  }
}

/** What a route program may fail with. */
export type RouteFailure = Unauthenticated | AuthUnavailable | ServiceFailure;

/**
 * Run a service call that keeps the `throw ServiceError` contract. A thrown
 * `ServiceError` becomes a `ServiceFailure`; any other throw stays a defect
 * (500, logged once by the edge), as an unhandled throw was before.
 */
export function service<A>(
  run: () => Promise<A>,
): Effect.Effect<A, ServiceFailure> {
  return Effect.tryPromise({ try: run, catch: (cause) => cause }).pipe(
    Effect.catch((cause) =>
      cause instanceof ServiceError
        ? Effect.fail(ServiceFailure.fromServiceError(cause))
        : Effect.die(cause),
    ),
  );
}
