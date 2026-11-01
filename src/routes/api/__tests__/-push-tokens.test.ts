// /api/push-tokens on the Effect edge: real route, real service, a D1
// stand-in and an in-memory Kova. No module mocks.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMockD1 } from "@/lib/__tests__/mock-d1";
import { pushTokenRoutes } from "@/server/routes/push-tokens";
import { memoryAuth, testServices } from "@/server/testing";

const TOKEN = "Bearer good-token";
const SESSIONS = { [TOKEN]: "user-1" };

function call(method: "POST" | "DELETE", body: unknown, auth = TOKEN) {
  return new Request("https://meet.test/api/push-tokens", {
    method,
    headers: { authorization: auth },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/push-tokens", () => {
  it("registers the token for the caller", async () => {
    const db = createMockD1();
    const routes = pushTokenRoutes(
      testServices({ auth: memoryAuth(SESSIONS), db }),
    );

    const response = await routes.POST({
      request: call("POST", {
        token: " fcm-token ",
        platform: "android",
        app_variant: "development",
      }),
    });

    expect(response.status).toBe(200);
    db.assertCalledWith("INSERT INTO push_tokens", [
      expect.any(String),
      "user-1",
      "fcm-token",
      "android",
      "development",
      expect.any(String),
      expect.any(String),
    ]);
  });

  it("refuses an unknown platform and an empty token", async () => {
    const db = createMockD1();
    const routes = pushTokenRoutes(
      testServices({ auth: memoryAuth(SESSIONS), db }),
    );

    const badPlatform = await routes.POST({
      request: call("POST", { token: "t", platform: "web" }),
    });
    const emptyToken = await routes.POST({
      request: call("POST", { token: "  ", platform: "android" }),
    });

    expect(badPlatform.status).toBe(400);
    expect(emptyToken.status).toBe(400);
    expect(db.calls).toHaveLength(0);
  });

  it("answers 401 without a session", async () => {
    const db = createMockD1();
    const routes = pushTokenRoutes(
      testServices({ auth: memoryAuth(SESSIONS), db }),
    );

    const response = await routes.POST({
      request: call("POST", { token: "t", platform: "android" }, "Bearer no"),
    });

    expect(response.status).toBe(401);
    expect(db.calls).toHaveLength(0);
  });
});

describe("DELETE /api/push-tokens", () => {
  it("deletes the caller's token", async () => {
    const db = createMockD1();
    const routes = pushTokenRoutes(
      testServices({ auth: memoryAuth(SESSIONS), db }),
    );

    const response = await routes.DELETE({
      request: call("DELETE", { token: "fcm-token" }),
    });

    expect(response.status).toBe(200);
    db.assertCalledWith(
      "DELETE FROM push_tokens WHERE token = ? AND user_id = ?",
      ["fcm-token", "user-1"],
    );
  });
});
