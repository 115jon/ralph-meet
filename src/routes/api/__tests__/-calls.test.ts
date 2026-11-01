// /api/calls/:id/accept|decline on the Effect edge: real route, an in-memory
// Kova and a stand-in for the global gateway Durable Object. No module mocks.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { callAnswerRoutes, type CallAnswer } from "@/server/routes/calls";
import { memoryAuth, testServices } from "@/server/testing";

const CALL_ID = "0b6e8f3c-5d1a-4a8e-9b2f-6c7d8e9f0a1b";
const SESSIONS = { "Bearer callee": "bob", "Bearer other": "eve" };

/** The DO answers as the real one does: only Bob may answer this call. */
function gateway() {
  const requests: { path: string; body: unknown }[] = [];
  const namespace = {
    idFromName: (name: string) => name,
    get: () => ({
      fetch: async (url: string, init: RequestInit) => {
        const body: unknown = JSON.parse(String(init.body));
        requests.push({ path: new URL(url).pathname, body });
        const { user_id, call_id } = body as {
          user_id: string;
          call_id: string;
        };
        if (call_id !== CALL_ID) {
          return Response.json({ error: "not_found" }, { status: 404 });
        }
        return user_id === "bob"
          ? Response.json({ ok: true })
          : Response.json({ error: "not_callee" }, { status: 403 });
      },
    }),
  };
  // SAFETY: the route only calls idFromName(...) and get(...).fetch(...).
  const MEETING_ROOM = namespace as unknown as DurableObjectNamespace;
  return { requests, MEETING_ROOM };
}

function answer(
  kind: CallAnswer,
  { auth = "Bearer callee", id = CALL_ID } = {},
) {
  const fake = gateway();
  const routes = callAnswerRoutes(
    kind,
    testServices({
      auth: memoryAuth(SESSIONS),
      env: { MEETING_ROOM: fake.MEETING_ROOM },
    }),
  );
  const request = new Request(`https://meet.test/api/calls/${id}/${kind}`, {
    method: "POST",
    headers: { authorization: auth },
  });
  return {
    fake,
    response: routes.POST({ request, params: { id } }),
  };
}

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe.each(["accept", "decline"] as const)(
  "POST /api/calls/:id/%s",
  (kind) => {
    it("answers for the callee, naming them from the session", async () => {
      const { fake, response } = answer(kind);

      expect((await response).status).toBe(200);
      expect(fake.requests).toEqual([
        { path: `/call-${kind}`, body: { call_id: CALL_ID, user_id: "bob" } },
      ]);
    });

    it("refuses anyone but the callee", async () => {
      const { response } = answer(kind, { auth: "Bearer other" });

      const res = await response;
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ code: "NOT_CALLEE" });
    });

    it("answers 404 once the call stopped ringing", async () => {
      const { response } = answer(kind, {
        id: "11111111-2222-3333-4444-555555555555",
      });

      const res = await response;
      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({ code: "CALL_NOT_FOUND" });
    });

    it("answers 401 without a session and never reaches the gateway", async () => {
      const { fake, response } = answer(kind, { auth: "Bearer nobody" });

      expect((await response).status).toBe(401);
      expect(fake.requests).toHaveLength(0);
    });

    it("does not forward a malformed call id", async () => {
      const { fake, response } = answer(kind, { id: "../broadcast" });

      expect((await response).status).toBe(404);
      expect(fake.requests).toHaveLength(0);
    });
  },
);
