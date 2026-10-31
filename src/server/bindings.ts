// ── Worker bindings as services ─────────────────────────────────────────────
// Routes on the edge `yield*` these instead of reading the ambient
// `cloudflare:workers` env, so a test can hand in its own.

import { env } from "cloudflare:workers";
import { Context, Effect, Layer } from "effect";

import {
  checkRateLimitDOFailClosed,
  type RateLimitOptions,
} from "@/lib/rate-limit";
import type { BroadcastDescriptor } from "@/services/server.service";
import { executeBroadcast } from "@/services/service-helpers";

/** Secrets and vars set with `wrangler secret` / `[vars]`, all optional at runtime. */
interface WorkerSecrets {
  CALLS_APP_SECRET?: string;
  REALTIME_TICKET_SECRET?: string;
  TURN_TOKEN_ID?: string;
  TURN_TOKEN_SECRET?: string;
}

export type WorkerBindings = CloudflareEnv & WorkerSecrets;

/** The Worker's env: bindings, vars and secrets. */
export class WorkerEnv extends Context.Service<WorkerEnv, WorkerBindings>()(
  "ralph-meet/server/WorkerEnv",
) {
  static readonly layer: Layer.Layer<WorkerEnv> = Layer.sync(
    WorkerEnv,
    // SAFETY: the declared env type lists bindings only; secrets are optional.
    () => env as WorkerBindings,
  );
}

/** The D1 database. */
export class Database extends Context.Service<Database, D1Database>()(
  "ralph-meet/server/Database",
) {
  /** `env.DB`. */
  static readonly layer: Layer.Layer<Database, never, WorkerEnv> = Layer.effect(
    Database,
    Effect.gen(function* () {
      return (yield* WorkerEnv).DB;
    }),
  );
}

/**
 * Fan-out to gateway subscribers through the global gateway Durable Object.
 * Delivery is best effort, as before: a failed send is logged, not raised.
 */
export class Gateway extends Context.Service<
  Gateway,
  { readonly send: (broadcast: BroadcastDescriptor) => Effect.Effect<void> }
>()("ralph-meet/server/Gateway") {
  static readonly layer: Layer.Layer<Gateway> = Layer.succeed(
    Gateway,
    Gateway.of({
      send: (broadcast) => Effect.promise(() => executeBroadcast(broadcast)),
    }),
  );
}

/**
 * The rate limiter Durable Object, failing closed. `null` means allowed;
 * otherwise the 429 (or 503 when the limiter is down) to answer with.
 */
export class RateLimiter extends Context.Service<
  RateLimiter,
  {
    readonly check: (
      shardId: string,
      action: string,
      options: RateLimitOptions,
    ) => Effect.Effect<Response | null>;
  }
>()("ralph-meet/server/RateLimiter") {
  static readonly layer: Layer.Layer<RateLimiter> = Layer.succeed(
    RateLimiter,
    RateLimiter.of({
      check: (shardId, action, options) =>
        Effect.promise(() =>
          checkRateLimitDOFailClosed(shardId, action, options),
        ),
    }),
  );
}
