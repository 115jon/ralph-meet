// /api/dms on the Effect edge: real route, real service, a D1 stand-in and
// test layers for Kova and the gateway. No module mocks.

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";

import { createMockD1 } from "@/lib/__tests__/mock-d1";
import { KovaAuth } from "@/server/kova-auth";
import { memoryAuth, memoryGateway, testServices } from "@/server/testing";
import { dmRoutes } from "@/server/routes/dms";

const TOKEN = "Bearer good-token";
const SESSIONS = { [TOKEN]: "user-1" };

function request(): Request {
  return new Request("https://meet.test/api/dms", {
    headers: { authorization: TOKEN },
  });
}

function post(body: unknown, headers?: Record<string, string>): Request {
  return new Request("https://meet.test/api/dms", {
    method: "POST",
    headers: { authorization: TOKEN, ...headers },
    body: JSON.stringify(body),
  });
}

/** Kova over HTTP, answered by `answer`: the live lookup behind a fake server. */
function kovaAnswering(answer: () => Promise<Response>) {
  return KovaAuth.layerWith({
    url: "https://kova.test",
    publishableKey: "pk_test",
    timeout: "20 millis",
    fetch: () => answer(),
  });
}

let errorLog: MockInstance<typeof console.error>;
let warnLog: MockInstance<typeof console.warn>;

beforeEach(() => {
  errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
  warnLog = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /api/dms", () => {
  it("lists the caller's DMs for a valid session", async () => {
    const db = createMockD1();
    db.mockQuery("FROM dm_recipients me", {
      results: [
        {
          id: "dm-1",
          name: null,
          channel_type: "dm",
          created_at: "2026-10-30T00:00:00.000Z",
          other_user_id: "user-2",
          other_username: "bob",
          other_display_name: null,
        },
      ],
    });
    const { GET } = dmRoutes(testServices({ auth: memoryAuth(SESSIONS), db }));

    const res = await GET({ request: request() });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject([
      { id: "dm-1", name: "bob", recipient: { id: "user-2" } },
    ]);
    db.assertCalledWith("FROM dm_recipients me", ["user-1", "user-1"]);
  });

  it("answers 401 Unauthorized when there is no session", async () => {
    const { GET } = dmRoutes(testServices({ auth: memoryAuth(SESSIONS) }));

    const res = await GET({
      request: new Request("https://meet.test/api/dms", {
        headers: { origin: "http://tauri.localhost" },
      }),
    });

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(
      "http://tauri.localhost",
    );
  });

  it("answers 401 when Kova refuses the credentials", async () => {
    const { GET } = dmRoutes(
      testServices({
        auth: kovaAnswering(async () => new Response("no", { status: 401 })),
      }),
    );

    const res = await GET({ request: request() });

    expect(res.status).toBe(401);
  });

  it.each([
    [
      "a network error",
      () => Promise.reject(new TypeError("fetch failed")),
      "TypeError",
    ],
    [
      "a Kova 500",
      async () => new Response("down", { status: 500 }),
      "HTTP 500",
    ],
    ["a Kova timeout", () => new Promise<Response>(() => {}), "timeout"],
    [
      "a 2xx with a garbage body",
      async () => new Response("<html>edge error</html>"),
      "unreadable body",
    ],
  ])(
    "answers 503 AUTH_UNAVAILABLE on %s, never 401",
    async (_label, answer, reason) => {
      const { GET } = dmRoutes(testServices({ auth: kovaAnswering(answer) }));

      const res = await GET({ request: request() });

      expect(res.status).toBe(503);
      expect(res.headers.get("Retry-After")).toBe("5");
      await expect(res.json()).resolves.toMatchObject({
        code: "AUTH_UNAVAILABLE",
      });
      expect(warnLog).toHaveBeenCalledWith(
        expect.objectContaining({
          level: "WARN",
          message: "auth.unavailable",
          route: "dms.list",
          method: "GET",
          reason,
        }),
      );
      expect(JSON.stringify(warnLog.mock.calls)).not.toContain("good-token");
    },
  );

  it("answers a defect with the generic 500 and logs it once", async () => {
    const db = {
      prepare() {
        throw new Error("D1_ERROR: database unavailable");
      },
    };
    const { GET } = dmRoutes(testServices({ auth: memoryAuth(SESSIONS), db }));

    const res = await GET({ request: request() });

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({
      error: "Internal server error",
      code: "INTERNAL_ERROR",
    });
    expect(errorLog).toHaveBeenCalledTimes(1);
    expect(errorLog.mock.calls[0]).toEqual([
      {
        level: "ERROR",
        message: "route.defect",
        timestamp: expect.any(String),
        route: "dms.list",
        method: "GET",
        status: 500,
        durationMs: expect.any(Number),
        cause: expect.stringContaining("D1_ERROR: database unavailable"),
      },
    ]);
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain("good-token");
  });
});

describe("POST /api/dms", () => {
  function routes(db = createMockD1()) {
    const gateway = memoryGateway();
    const { POST } = dmRoutes(
      testServices({
        auth: memoryAuth(SESSIONS),
        db,
        gateway: gateway.layer,
      }),
    );
    return { POST, db, sent: gateway.sent };
  }

  it("creates a DM, answers 201 and tells both users", async () => {
    const db = createMockD1();
    db.mockQuery("FROM users WHERE id = ?", { id: "user-2", username: "bob" });
    const { POST, sent } = routes(db);

    const res = await POST({ request: post({ target_user_id: "user-2" }) });

    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toMatchObject({
      channel_type: "dm",
      recipient: { id: "user-2" },
    });
    expect(sent.map((broadcast) => [broadcast.type, broadcast.target])).toEqual(
      [
        ["user", "user-1"],
        ["user", "user-2"],
      ],
    );
  });

  it("answers 200 for an existing DM without broadcasting", async () => {
    const db = createMockD1();
    db.mockQuery("FROM users WHERE id = ?", { id: "user-2", username: "bob" });
    db.mockQuery("FROM dm_recipients a", { id: "dm-1" });
    const { POST, sent } = routes(db);

    const res = await POST({ request: post({ target_user_id: "user-2" }) });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ id: "dm-1" });
    expect(sent).toEqual([]);
  });

  it.each([
    ["yourself", "user-1", 400, "Cannot DM yourself"],
    ["an unknown user", "user-404", 404, "User not found"],
  ])(
    "answers a ServiceError for %s with its status",
    async (_label, target, status, error) => {
      const { POST } = routes();

      const res = await POST({
        request: post(
          { target_user_id: target },
          { origin: "http://tauri.localhost" },
        ),
      });

      expect(res.status).toBe(status);
      await expect(res.json()).resolves.toEqual({ error });
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe(
        "http://tauri.localhost",
      );
      expect(errorLog).not.toHaveBeenCalled();
    },
  );

  it("rejects a non-string target_user_id with a structured 400", async () => {
    const { POST, db } = routes();

    const res = await POST({ request: post({ target_user_id: 123 }) });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ code: "INVALID_BODY" });
    expect(db.calls).toHaveLength(0);
  });

  it("rejects malformed JSON with INVALID_JSON", async () => {
    const { POST } = routes();

    const res = await POST({
      request: new Request("https://meet.test/api/dms", {
        method: "POST",
        headers: { authorization: TOKEN },
        body: "{not json",
      }),
    });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ code: "INVALID_JSON" });
  });

  it("requires target_user_id", async () => {
    const { POST } = routes();

    const res = await POST({ request: post({}) });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: "target_user_id is required",
    });
  });

  it("answers 401 before reading the body", async () => {
    const { POST, db } = routes();

    const res = await POST({
      request: new Request("https://meet.test/api/dms", {
        method: "POST",
        body: "{not json",
      }),
    });

    expect(res.status).toBe(401);
    expect(db.calls).toHaveLength(0);
  });
});
