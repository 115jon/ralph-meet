// ── Test layers for routes on the edge ──────────────────────────────────────
// Route tests pass these to a route's handlers instead of mocking modules.
// Only tests import this file.

import { Effect, Layer } from "effect";

import type { BroadcastDescriptor } from "@/services/server.service";
import {
  Database,
  Gateway,
  RateLimiter,
  WorkerEnv,
  type WorkerBindings,
} from "@/server/bindings";
import type { RouteServices } from "@/server/edge";
import { AuthUnavailable, Unauthenticated } from "@/server/errors";
import { KovaAuth } from "@/server/kova-auth";

/**
 * Kova that knows these sessions, keyed by the exact `authorization` or
 * `cookie` header value (`"Bearer t1"`, `"kova.session=abc"`), each mapped to
 * a user id. Any other credentials are signed out.
 */
export function memoryAuth(
  sessions: Readonly<Record<string, string>>,
): Layer.Layer<KovaAuth> {
  return Layer.succeed(
    KovaAuth,
    KovaAuth.of({
      lookup: (headers) => {
        const userId =
          (headers.authorization && sessions[headers.authorization]) ||
          (headers.cookie && sessions[headers.cookie]);

        return userId
          ? Effect.succeed({
              user: { id: userId },
              session: { id: `session-${userId}` },
            })
          : Effect.fail(new Unauthenticated());
      },
    }),
  );
}

/** Kova that cannot answer, as in an outage. */
export function brokenAuth(reason = "TypeError"): Layer.Layer<KovaAuth> {
  return Layer.succeed(
    KovaAuth,
    KovaAuth.of({
      lookup: () => Effect.fail(new AuthUnavailable({ reason })),
    }),
  );
}

/** A gateway that keeps what it was asked to send. */
export function memoryGateway() {
  const sent: BroadcastDescriptor[] = [];
  const layer = Layer.succeed(
    Gateway,
    Gateway.of({
      send: (broadcast) =>
        Effect.sync(() => {
          sent.push(broadcast);
        }),
    }),
  );

  return { layer, sent };
}

/** A rate limiter that allows everything. */
const allowAllRateLimits: Layer.Layer<RateLimiter> = Layer.succeed(
  RateLimiter,
  RateLimiter.of({ check: () => Effect.succeed(null) }),
);

export interface TestServices {
  readonly auth: Layer.Layer<KovaAuth>;
  /** A D1 stand-in, e.g. `createMockD1()`. */
  readonly db?: object;
  /** Only the vars and secrets the route reads. */
  readonly env?: Partial<WorkerBindings>;
  readonly gateway?: Layer.Layer<Gateway>;
  readonly rateLimits?: Layer.Layer<RateLimiter>;
}

/** Every route service, from these parts. Unset parts are empty or permissive. */
export function testServices(
  services: TestServices,
): Layer.Layer<RouteServices> {
  // SAFETY: tests hand in only the bindings the route under test reads, and
  // a D1 stand-in with the prepare/bind/first/all/run/batch surface.
  const env = { ...services.env } as WorkerBindings;
  const db = (services.db ?? {}) as D1Database;

  return Layer.mergeAll(
    services.auth,
    Layer.succeed(WorkerEnv, env),
    Layer.succeed(Database, db),
    services.gateway ?? memoryGateway().layer,
    services.rateLimits ?? allowAllRateLimits,
  );
}
