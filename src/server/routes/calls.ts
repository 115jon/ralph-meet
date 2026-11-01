// /api/calls/:id/accept and /api/calls/:id/decline on the Effect edge: the
// callee answers or declines a ringing DM call without a gateway socket, as
// a phone's call notification does with the app killed. The ring itself
// lives in the global gateway Durable Object, which checks that the caller
// of this route is the call's callee. The route files only wire these.

import { Effect, type Layer } from "effect";

import { apiError, apiSuccess } from "@/lib/api-helpers";
import { WorkerEnv } from "@/server/bindings";
import { runRoute, type RouteServices } from "@/server/edge";
import { signedInUserId } from "@/server/kova-auth";

export type CallAnswer = "accept" | "decline";

/** Call ids are UUIDs; anything else is not worth a Durable Object hop. */
const CALL_ID = /^[0-9a-f-]{8,64}$/i;

const answerCall = Effect.fn("calls.answer")(function* (
  request: Request,
  callId: string,
  answer: CallAnswer,
) {
  const userId = yield* signedInUserId(request);
  if (!CALL_ID.test(callId)) {
    return apiError("Call not found", 404, "CALL_NOT_FOUND", request);
  }

  const env = yield* WorkerEnv;
  const gateway = env.MEETING_ROOM.get(
    env.MEETING_ROOM.idFromName("global-gateway"),
  );
  const response = yield* Effect.promise(() =>
    gateway.fetch(`https://internal/call-${answer}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ call_id: callId, user_id: userId }),
    }),
  );

  if (response.ok) return apiSuccess({ ok: true }, 200, request);
  if (response.status === 403) {
    return apiError(
      "Only the person called can answer",
      403,
      "NOT_CALLEE",
      request,
    );
  }
  if (response.status === 404) {
    // Answered elsewhere, cancelled, or the ring timed out.
    return apiError(
      "The call is no longer ringing",
      404,
      "CALL_NOT_FOUND",
      request,
    );
  }
  return apiError(
    "Could not answer the call",
    502,
    "CALL_GATEWAY_FAILED",
    request,
  );
});

/** The handlers for one answer, on the given services (the live ones by default). */
export function callAnswerRoutes(
  answer: CallAnswer,
  services?: Layer.Layer<RouteServices>,
) {
  return {
    POST: ({ request, params }: { request: Request; params: { id: string } }) =>
      runRoute(
        `calls.${answer}`,
        request,
        answerCall(request, params.id, answer),
        services,
      ),
  };
}
