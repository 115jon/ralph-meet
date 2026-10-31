// /api/dms on the Effect edge. The route file only wires these handlers.

import { Effect, Schema, type Layer } from "effect";

import { apiError, apiSuccess } from "@/lib/api-helpers";
import { looseStruct, withDefault } from "@/lib/schema";
import { validateBody } from "@/lib/validate-body";
import { Database, Gateway } from "@/server/bindings";
import { runRoute, type RouteServices } from "@/server/edge";
import { service } from "@/server/errors";
import { signedInUserId } from "@/server/kova-auth";
import { getOrCreateDM, listDMs } from "@/services/social.service";

const dmCreateSchema = looseStruct({
  target_user_id: withDefault(Schema.String, ""),
});

/** GET /api/dms — list all DM channels for the authenticated user. */
export const listDms = Effect.fn("dms.list")(function* (request: Request) {
  const userId = yield* signedInUserId(request);
  const db = yield* Database;
  const dms = yield* Effect.promise(() => listDMs(db, userId));

  return apiSuccess(dms);
});

/** POST /api/dms — open or create a DM with a user. */
export const openDm = Effect.fn("dms.open")(function* (request: Request) {
  const userId = yield* signedInUserId(request);
  const body = yield* Effect.promise(() =>
    validateBody(request, dmCreateSchema, request),
  );

  if (body instanceof Response) return body;
  if (!body.target_user_id) {
    return apiError("target_user_id is required", 400);
  }

  const db = yield* Database;
  const result = yield* service(() =>
    getOrCreateDM(db, userId, body.target_user_id),
  );
  const gateway = yield* Gateway;

  for (const broadcast of result.broadcasts ?? []) {
    yield* gateway.send(broadcast);
  }

  return apiSuccess(result.dm, result.isNew ? 201 : 200);
});

/** The handlers, on the given services (the live ones by default). */
export function dmRoutes(services?: Layer.Layer<RouteServices>) {
  return {
    GET: ({ request }: { request: Request }) =>
      runRoute("dms.list", request, listDms(request), services),
    POST: ({ request }: { request: Request }) =>
      runRoute("dms.open", request, openDm(request), services),
  };
}
