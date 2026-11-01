// /api/push-tokens on the Effect edge: the mobile app's FCM device tokens.
// The route file only wires these handlers.

import { Effect, Schema, type Layer } from "effect";

import { apiSuccess } from "@/lib/api-helpers";
import { genId } from "@/lib/id";
import { validateBody } from "@/lib/validate-body";
import { Database } from "@/server/bindings";
import { runRoute, type RouteServices } from "@/server/edge";
import { signedInUserId } from "@/server/kova-auth";
import { deletePushToken, upsertPushToken } from "@/services/push.service";

// FCM registration tokens are ~150-200 characters; the cap only stops abuse.
const PushToken = Schema.Trim.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(4096),
);

const registerSchema = Schema.Struct({
  token: PushToken,
  platform: Schema.Literals(["android", "ios"]),
  app_variant: Schema.optional(
    Schema.NullOr(Schema.String.check(Schema.isMaxLength(32))),
  ),
  push_format: Schema.optional(Schema.NullOr(Schema.Literals(["native"]))),
});

const unregisterSchema = Schema.Struct({ token: PushToken });

/** POST /api/push-tokens — register or refresh this device's token. */
const registerToken = Effect.fn("pushTokens.register")(function* (
  request: Request,
) {
  const userId = yield* signedInUserId(request);
  const body = yield* Effect.promise(() =>
    validateBody(request, registerSchema, request),
  );
  if (body instanceof Response) return body;

  const db = yield* Database;
  yield* Effect.promise(() =>
    upsertPushToken(db, userId, genId(), {
      token: body.token,
      platform: body.platform,
      appVariant: body.app_variant ?? null,
      pushFormat: body.push_format ?? null,
    }),
  );

  return apiSuccess({ registered: true });
});

/** DELETE /api/push-tokens — forget this device's token (sign-out). */
const unregisterToken = Effect.fn("pushTokens.unregister")(function* (
  request: Request,
) {
  const userId = yield* signedInUserId(request);
  const body = yield* Effect.promise(() =>
    validateBody(request, unregisterSchema, request),
  );
  if (body instanceof Response) return body;

  const db = yield* Database;
  yield* Effect.promise(() => deletePushToken(db, userId, body.token));

  return apiSuccess({ unregistered: true });
});

/** The handlers, on the given services (the live ones by default). */
export function pushTokenRoutes(services?: Layer.Layer<RouteServices>) {
  return {
    POST: ({ request }: { request: Request }) =>
      runRoute(
        "pushTokens.register",
        request,
        registerToken(request),
        services,
      ),
    DELETE: ({ request }: { request: Request }) =>
      runRoute(
        "pushTokens.unregister",
        request,
        unregisterToken(request),
        services,
      ),
  };
}
