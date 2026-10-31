import { beforeEach, describe, expect, it, vi } from "vitest";

// Route handlers must answer a malformed body with a 400 instead of throwing
// (a 500) or reading fields off a value of the wrong type. Every case here
// stops before the route's first database read, so only auth and the
// permission gates are stubbed.

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  getDB: vi.fn(),
  requireActiveVoiceChannelSession: vi.fn(),
  requireChannelAccess: vi.fn(),
  requireChannelPermission: vi.fn(),
  requirePermission: vi.fn(),
  checkRateLimitDO: vi.fn(),
  updateVoiceChannelStatus: vi.fn(),
  createVoiceStatusMediaAsset: vi.fn(),
  createOrReuseExternalVoiceStatusMediaAsset: vi.fn(),
  createMessageShare: vi.fn(),
}));

vi.mock("@/lib/api-helpers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-helpers")>()),
  getDB: mocks.getDB,
  requireActiveVoiceChannelSession: mocks.requireActiveVoiceChannelSession,
  requireAuth: mocks.requireAuth,
}));
vi.mock("@/lib/require-channel-access", () => ({
  requireChannelAccess: mocks.requireChannelAccess,
}));
vi.mock("@/lib/require-permission", () => ({
  getUserChannelPermissions: vi.fn(),
  getUserPermissions: vi.fn(),
  requireChannelPermission: mocks.requireChannelPermission,
  requirePermission: mocks.requirePermission,
}));
vi.mock("@/lib/rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/rate-limit")>()),
  checkRateLimitDO: mocks.checkRateLimitDO,
}));
vi.mock("@/services/channel.service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/channel.service")>()),
  updateVoiceChannelStatus: mocks.updateVoiceChannelStatus,
}));
vi.mock("@/services/message-share.service", () => ({
  createMessageShare: mocks.createMessageShare,
}));
vi.mock("@/services/voice-status-media.service", () => ({
  createOrReuseExternalVoiceStatusMediaAsset:
    mocks.createOrReuseExternalVoiceStatusMediaAsset,
  createVoiceStatusMediaAsset: mocks.createVoiceStatusMediaAsset,
  listRecentVoiceStatusMediaAssets: vi.fn(),
}));

import { POST as claimAccount } from "../account-claims";
import { DELETE as deleteAvatar } from "../avatars/$";
import { DELETE as deleteCameraBackground } from "../camera-backgrounds";
import { PATCH as patchChannelReadState } from "../channels/$id/read-state";
import { PATCH as patchVoiceStatus } from "../channels/$id/voice-status";
import { POST as postVoiceStatusMedia } from "../channels/$id/voice-status-media";
import { PATCH as applyCollectibles } from "../collectibles/apply";
import { POST as shareMessage } from "../messages/$id/share";
import { DELETE as deleteProfileAsset } from "../profile-assets/manage";
import { PATCH as reorderChannels } from "../servers/$id/channels/reorder";
import { PATCH as patchServerSettings } from "../servers/$id/settings";
import { PATCH as patchSound } from "../servers/$id/soundboard";
import { POST as createServer } from "../servers";
import { DELETE as revokeSession } from "../sessions";
import { PATCH as patchProfile } from "../update-profile";

type Handler = (args: {
  request: Request;
  params: Record<string, string>;
}) => Promise<Response>;

function send(
  handler: Handler,
  method: string,
  body: BodyInit | null,
  params: Record<string, string> = { id: "id-1" },
  url = "https://meet.test/api/x",
) {
  return handler({
    request: new Request(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body,
    }),
    params,
  });
}

async function codeOf(response: Response) {
  return ((await response.json()) as { code?: string }).code;
}

describe("route request bodies", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAuth.mockResolvedValue({ userId: "user-1" });
    mocks.getDB.mockReturnValue({});
    mocks.requireChannelAccess.mockResolvedValue({ serverId: "server-1" });
    mocks.requireChannelPermission.mockResolvedValue({});
    mocks.requirePermission.mockResolvedValue({});
    mocks.requireActiveVoiceChannelSession.mockResolvedValue({});
    mocks.checkRateLimitDO.mockResolvedValue(null);
  });

  describe("an unparseable body is a 400 INVALID_JSON, not a thrown error", () => {
    const cases: Array<[string, Handler, string]> = [
      ["server settings", patchServerSettings, "PATCH"],
      ["server create", createServer, "POST"],
      ["channel reorder", reorderChannels, "PATCH"],
      ["profile update", patchProfile, "PATCH"],
      ["voice status", patchVoiceStatus, "PATCH"],
      ["account claim", claimAccount, "POST"],
      ["avatar delete", deleteAvatar, "DELETE"],
      ["camera background delete", deleteCameraBackground, "DELETE"],
      ["profile asset delete", deleteProfileAsset, "DELETE"],
      ["collectible apply", applyCollectibles, "PATCH"],
    ];

    it.each(cases)("%s", async (_name, handler, method) => {
      const response = await send(
        handler,
        method,
        "{not json",
        method === "DELETE" ? { _splat: "history" } : { id: "id-1" },
      );

      expect(response.status).toBe(400);
      expect(await codeOf(response)).toBe("INVALID_JSON");
    });
  });

  describe("a body of the wrong shape is a 400 INVALID_BODY", () => {
    it("voice status: null, a string status, or a non-string text", async () => {
      for (const body of [
        "null",
        JSON.stringify({ voice_status: "busy" }),
        JSON.stringify({ voice_status: { text: 5 } }),
      ]) {
        const response = await send(patchVoiceStatus, "PATCH", body);
        expect(response.status).toBe(400);
        expect(await codeOf(response)).toBe("INVALID_BODY");
      }
      expect(mocks.updateVoiceChannelStatus).not.toHaveBeenCalled();
    });

    it("voice status: a status object reaches the service unchanged", async () => {
      mocks.updateVoiceChannelStatus.mockResolvedValue({
        channel: { id: "id-1" },
        cacheKeysToInvalidate: [],
        broadcast: { type: "channel", target: "id-1", event: "CHANNEL_UPDATE" },
        auditLog: { actionType: "x" },
      });
      const executors = await import("@/services/service-helpers");
      vi.spyOn(executors, "executeInvalidation").mockResolvedValue(undefined);
      vi.spyOn(executors, "executeBroadcast").mockResolvedValue(undefined);
      vi.spyOn(executors, "executeAuditLog").mockResolvedValue(undefined);

      const response = await send(
        patchVoiceStatus,
        "PATCH",
        JSON.stringify({ voice_status: { text: "heads down", media: null } }),
      );

      expect(response.status).toBe(200);
      expect(mocks.updateVoiceChannelStatus).toHaveBeenCalledWith(
        {},
        "id-1",
        "user-1",
        { text: "heads down", media: null },
      );
    });

    it("voice status media: a non-object body, then a missing media object", async () => {
      expect((await send(postVoiceStatusMedia, "POST", "[]")).status).toBe(400);
      const response = await send(postVoiceStatusMedia, "POST", "{}");
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        error: "No valid media was provided.",
      });
    });

    it("soundboard edit: non-string name, emoji or non-numeric volume", async () => {
      for (const body of [
        { sound_name: 5 },
        { sound_emoji: ["x"] },
        { sound_volume: "loud" },
      ]) {
        const response = await send(
          patchSound,
          "PATCH",
          JSON.stringify(body),
          { id: "server-1" },
          "https://meet.test/api/servers/server-1/soundboard?soundId=sound-1",
        );
        expect(response.status).toBe(400);
        expect(await codeOf(response)).toBe("INVALID_BODY");
      }
    });

    it("account claim: a non-string legacy id no longer reaches .trim()", async () => {
      const response = await send(
        claimAccount,
        "POST",
        JSON.stringify({ legacyUserId: 42 }),
      );
      expect(response.status).toBe(400);
      expect(await codeOf(response)).toBe("INVALID_BODY");
    });

    it("session revoke: a non-string id", async () => {
      const response = await send(
        revokeSession,
        "DELETE",
        JSON.stringify({ sessionId: 1 }),
      );
      expect(response.status).toBe(400);
      expect(await codeOf(response)).toBe("INVALID_BODY");
    });

    it("profile asset delete: null body, and an unknown kind keeps its own error", async () => {
      expect((await send(deleteProfileAsset, "DELETE", "null")).status).toBe(
        400,
      );
      const response = await send(
        deleteProfileAsset,
        "DELETE",
        JSON.stringify({ kind: "avatar" }),
      );
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        error: "Invalid profile asset kind",
      });
    });

    it("collectible apply: wrong-typed selections", async () => {
      const response = await send(
        applyCollectibles,
        "PATCH",
        JSON.stringify({ selections: "avatar_decoration" }),
      );
      expect(response.status).toBe(400);
      expect(await codeOf(response)).toBe("INVALID_BODY");
    });
  });

  describe("routes that report their own errors keep them, and survive a null body", () => {
    it("profile update: null is an invalid body, not a TypeError", async () => {
      const response = await send(patchProfile, "PATCH", "null");
      expect(response.status).toBe(400);
    });

    it("profile update: an invalid field keeps its specific message", async () => {
      const response = await send(
        patchProfile,
        "PATCH",
        JSON.stringify({ bio: 12 }),
      );
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: "Invalid bio" });
    });

    it("avatar delete: a missing or blank id", async () => {
      for (const body of ["null", "{}", JSON.stringify({ id: "   " })]) {
        const response = await send(deleteAvatar, "DELETE", body, {
          _splat: "history",
        });
        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({
          error: "Invalid avatar upload id",
        });
      }
    });

    it("camera background delete: a missing or malformed id", async () => {
      for (const body of ["null", JSON.stringify({ id: "../etc" })]) {
        const response = await send(deleteCameraBackground, "DELETE", body);
        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({
          error: "Invalid background id",
        });
      }
    });

    it("read state: a null body is the usual missing-message error", async () => {
      const response = await send(patchChannelReadState, "PATCH", "null");
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: "message_id is required",
      });
    });

    it("message share: a null body means default options", async () => {
      mocks.getDB.mockReturnValue({
        prepare: () => ({
          bind: () => ({ first: async () => ({ channel_id: "channel-1" }) }),
        }),
      });
      mocks.createMessageShare.mockResolvedValue({ token: "tok" });

      const response = await send(shareMessage, "POST", "null");

      expect(response.status).toBe(201);
      expect(mocks.createMessageShare).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ expiresAt: undefined }),
      );
    });
  });
});
