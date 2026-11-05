import { beforeEach, describe, expect, it, vi } from "vitest";

// DELETE /api/servers/:id/members/@me through the real handler: the caller
// leaves, the broadcasts and cache keys the service returned are executed, and
// a refused leave (the owner) is a ServiceError response with no side effects.

const mocks = vi.hoisted(() => ({
  executeAuditLog: vi.fn(),
  executeBroadcast: vi.fn(),
  executeInvalidation: vi.fn(),
  getDB: vi.fn(),
  kickMember: vi.fn(),
  leaveServer: vi.fn(),
  requireAuth: vi.fn(),
}));

vi.mock("@/lib/api-helpers", () => ({
  apiError: (message: string, status: number) =>
    Response.json({ error: message }, { status }),
  apiSuccess: (data: unknown, status = 200) => Response.json(data, { status }),
  getDB: mocks.getDB,
  requireAuth: mocks.requireAuth,
}));
vi.mock("@/services/server.service", () => ({
  kickMember: mocks.kickMember,
  leaveServer: mocks.leaveServer,
}));
vi.mock("@/services/service-helpers", () => ({
  executeAuditLog: mocks.executeAuditLog,
  executeBroadcast: mocks.executeBroadcast,
  executeInvalidation: mocks.executeInvalidation,
}));

import { ServiceError } from "@/lib/service-error";
import { DELETE } from "../servers/$id/members/$userId";

function del(userId: string) {
  return DELETE({
    request: new Request(
      `https://meet.test/api/servers/server-1/members/${userId}`,
      { method: "DELETE" },
    ),
    params: { id: "server-1", userId },
  });
}

describe("DELETE /api/servers/:id/members/@me", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.requireAuth.mockResolvedValue({ userId: "user-1" });
    mocks.getDB.mockReturnValue({});
  });

  it("leaves as the signed-in user and executes the dispatches", async () => {
    const broadcasts = [
      { type: "server", target: "server-1", event: "GUILD_MEMBER_REMOVE" },
      { type: "user", target: "user-1", event: "GUILD_DELETE" },
    ];
    mocks.leaveServer.mockResolvedValue({
      left: true,
      cacheKeysToInvalidate: ["k1"],
      broadcasts,
    });

    const response = await del("@me");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ left: true });
    expect(mocks.leaveServer).toHaveBeenCalledWith({}, "server-1", "user-1");
    expect(mocks.kickMember).not.toHaveBeenCalled();
    expect(mocks.executeInvalidation).toHaveBeenCalledWith(["k1"]);
    expect(mocks.executeBroadcast.mock.calls).toEqual(
      broadcasts.map((broadcast) => [broadcast]),
    );
  });

  it("returns the owner refusal as a 403 with its message", async () => {
    mocks.leaveServer.mockRejectedValue(
      ServiceError.forbidden("Server owners can't leave."),
    );

    const response = await del("@me");

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: "Server owners can't leave.",
    });
    expect(mocks.executeBroadcast).not.toHaveBeenCalled();
  });

  it("still routes another user's id to the kick", async () => {
    mocks.kickMember.mockResolvedValue({
      kicked: true,
      cacheKeysToInvalidate: [],
      broadcasts: [],
      auditLog: {},
    });

    const response = await del("user-2");

    expect(response.status).toBe(200);
    expect(mocks.kickMember).toHaveBeenCalledWith(
      {},
      "server-1",
      "user-1",
      "user-2",
    );
    expect(mocks.leaveServer).not.toHaveBeenCalled();
  });
});
