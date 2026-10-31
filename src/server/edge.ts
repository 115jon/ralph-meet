// ── The HTTP edge ───────────────────────────────────────────────────────────
// `runRoute` runs one route program with its services and is the only place
// a typed failure becomes a Response:
//
//   Unauthenticated   401  { error: "Unauthorized" }
//   AuthUnavailable   503  { error, code: "AUTH_UNAVAILABLE" } + Retry-After
//   ServiceFailure    its status  { error, code }   (apiError)
//   defect            500  { error, code: "INTERNAL_ERROR" }, logged once
//
// All carry the desktop CORS headers for the request's origin.
//
// Layers: `liveServices` is described once per isolate (a module constant)
// and built per request by `Effect.provide`. Every constructor is a
// `Layer.succeed`/`Layer.sync` over bindings already in memory, so a build is
// a handful of allocations and no I/O. A ManagedRuntime would cache nothing
// worth caching, and a per-request build keeps requests (and tests) apart.

import { Effect, Layer } from "effect";

import {
  apiError,
  authUnavailableResponse,
  unauthorizedResponse,
} from "@/lib/api-helpers";
import { Database, Gateway, RateLimiter, WorkerEnv } from "@/server/bindings";
import type { RouteFailure } from "@/server/errors";
import { KovaAuth } from "@/server/kova-auth";
import { REQUEST_SPAN, RouteLogger } from "@/server/log";

/** The services any route on the edge may use. Tests provide their own. */
export type RouteServices =
  | KovaAuth
  | WorkerEnv
  | Database
  | Gateway
  | RateLimiter;

const liveServices: Layer.Layer<RouteServices> = Layer.mergeAll(
  KovaAuth.layer,
  Gateway.layer,
  RateLimiter.layer,
  Database.layer,
).pipe(Layer.provideMerge(WorkerEnv.layer));

/**
 * Run one route. Logs carry the route, method and duration. Auth failures
 * log a warning (`auth.unauthenticated`, `auth.unavailable` with its
 * reason); a defect logs `route.defect` at error with its cause. Service
 * failures (4xx answers) stay quiet. Never log tokens, cookies, headers or
 * bodies here.
 */
export function runRoute(
  route: string,
  request: Request,
  program: Effect.Effect<Response, RouteFailure, RouteServices>,
  services: Layer.Layer<RouteServices> = liveServices,
): Promise<Response> {
  const answered = program.pipe(
    Effect.catchTags({
      Unauthenticated: () =>
        Effect.logWarning("auth.unauthenticated").pipe(
          Effect.as(unauthorizedResponse(request)),
        ),
      AuthUnavailable: (error) =>
        Effect.logWarning("auth.unavailable").pipe(
          Effect.annotateLogs({ reason: error.reason }),
          Effect.as(authUnavailableResponse(request)),
        ),
      ServiceFailure: (error) =>
        Effect.succeed(
          apiError(error.message, error.status, error.code, request),
        ),
    }),
    // Inside the defect handler, so a layer that dies is answered too.
    Effect.provide(services),
    Effect.catchCause((cause) =>
      Effect.logError("route.defect", cause).pipe(
        Effect.annotateLogs({ status: 500 }),
        Effect.as(
          apiError("Internal server error", 500, "INTERNAL_ERROR", request),
        ),
      ),
    ),
    Effect.withLogSpan(REQUEST_SPAN),
    Effect.annotateLogs({ route, method: request.method }),
    Effect.provide(RouteLogger),
  );

  return Effect.runPromise(answered);
}
