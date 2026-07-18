import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  getDB: vi.fn(),
  executeBroadcast: vi.fn(),
  broadcastToUser: vi.fn(),
  getOrCreateDM: vi.fn(),
  sendFriendRequest: vi.fn(),
  acceptFriendRequest: vi.fn(),
  blockUser: vi.fn(),
  removeRelationship: vi.fn(),
  updatePresence: vi.fn(),
  listNotifications: vi.fn(),
  markNotificationsRead: vi.fn(),
}));

vi.mock("@/lib/api-helpers", () => ({
  apiError: (error: string, status = 400, code?: string) =>
    Response.json({ error, code }, { status }),
  apiSuccess: (data: unknown, status = 200) => Response.json(data, { status }),
  broadcastToUser: mocks.broadcastToUser,
  getDB: mocks.getDB,
  requireAuth: mocks.requireAuth,
}));

vi.mock("@/services/service-helpers", () => ({
  executeBroadcast: mocks.executeBroadcast,
}));

vi.mock("@/services/social.service", () => ({
  acceptFriendRequest: mocks.acceptFriendRequest,
  blockUser: mocks.blockUser,
  getOrCreateDM: mocks.getOrCreateDM,
  removeRelationship: mocks.removeRelationship,
  sendFriendRequest: mocks.sendFriendRequest,
}));

vi.mock("@/services/presence.service", () => ({
  updatePresence: mocks.updatePresence,
}));

vi.mock("@/services/notification.service", () => ({
  listNotifications: mocks.listNotifications,
  markNotificationsRead: mocks.markNotificationsRead,
}));

import { POST as postDM } from "../dms";
import {
  DELETE as deleteFriend,
  POST as postFriend,
  PUT as putFriend,
} from "../friends";
import { PATCH as patchNotifications } from "../notifications";
import { POST as postPresence } from "../presence";

type SocialHandler = (args: {
  request: Request;
  params: Record<string, string>;
}) => Promise<Response>;

function jsonRequest(body: unknown): Request {
  return new Request("https://meet.test/api/social", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function invalidJsonRequest(): Request {
  return new Request("https://meet.test/api/social", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{not json",
  });
}

const handlers: Record<string, SocialHandler> = {
  dm: (args) => postDM(args),
  friendPost: (args) => postFriend(args),
  friendPut: (args) => putFriend(args),
  friendDelete: (args) => deleteFriend(args),
  presence: (args) => postPresence(args),
  notifications: (args) => patchNotifications(args),
};

describe("social request body validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAuth.mockResolvedValue({ userId: "user-1" });
    mocks.getDB.mockReturnValue({});
    mocks.executeBroadcast.mockResolvedValue(undefined);
    mocks.getOrCreateDM.mockResolvedValue({
      isNew: false,
      dm: {},
      broadcasts: [],
    });
    mocks.sendFriendRequest.mockResolvedValue({
      user: {},
      type: 1,
      broadcasts: [],
    });
    mocks.acceptFriendRequest.mockResolvedValue({ type: 0, broadcasts: [] });
    mocks.blockUser.mockResolvedValue({ type: 1, broadcasts: [] });
    mocks.removeRelationship.mockResolvedValue({ broadcasts: [] });
    mocks.updatePresence.mockResolvedValue({
      status: "online",
      custom_status: null,
      broadcasts: [],
    });
    mocks.markNotificationsRead.mockResolvedValue(undefined);
  });

  it.each([
    ["dm", { target_user_id: 123 }],
    ["friendPost", { username: 123 }],
    ["friendPut", { target_user_id: "user-2", action: 123 }],
    ["friendDelete", { target_user_id: 123 }],
    ["presence", { status: 123 }],
    ["notifications", { ids: ["notification-1", 123] }],
  ])(
    "rejects a structurally invalid %s body with INVALID_BODY",
    async (name, body) => {
      const response = await handlers[name]({
        request: jsonRequest(body),
        params: {},
      });

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        code: "INVALID_BODY",
      });
    },
  );

  it.each(Object.keys(handlers))(
    "rejects malformed JSON for %s with INVALID_JSON",
    async (name) => {
      const response = await handlers[name]({
        request: invalidJsonRequest(),
        params: {},
      });

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        code: "INVALID_JSON",
      });
    },
  );

  it.each([
    ["dm", { target_user_id: "user-2" }],
    ["friendPost", { username: "friend" }],
    ["friendPut", { target_user_id: "user-2", action: "accept" }],
    ["friendDelete", { target_user_id: "user-2" }],
    ["presence", { status: "online", custom_status: null }],
    ["notifications", { ids: ["notification-1"] }],
  ])("accepts a representative valid %s structure", async (name, body) => {
    const response = await handlers[name]({
      request: jsonRequest(body),
      params: {},
    });

    expect(response.status).not.toBe(400);
  });
});
