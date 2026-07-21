import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cacheDel: vi.fn(),
  cacheFetch: vi.fn(),
  checkRateLimitDO: vi.fn(),
  getEnv: vi.fn(),
  getBucket: vi.fn(),
  getDB: vi.fn(),
  getUserPermissions: vi.fn(),
  hasPermission: vi.fn(),
  loggerError: vi.fn(),
  listServerSoundboardSounds: vi.fn(),
  recordR2CleanupFailure: vi.fn(),
  requireChannelAccess: vi.fn(),
  requireAuth: vi.fn(),
  retryR2Cleanup: vi.fn(),
}));

vi.mock("@/lib/api-helpers", () => ({
  apiError: (message: string, status: number) =>
    Response.json({ error: message }, { status }),
  apiSuccess: (data: unknown, status = 200) => Response.json(data, { status }),
  genId: () => "sound-1",
  getEnv: mocks.getEnv,
  getBucket: mocks.getBucket,
  getDB: mocks.getDB,
  requireAuth: mocks.requireAuth,
}));

vi.mock("@/lib/cache", () => ({
  CacheKey: { serverSoundboard: (serverId: string) => serverId },
  cacheDel: mocks.cacheDel,
  cacheFetch: mocks.cacheFetch,
  CacheTTL: { SERVER_SOUNDBOARD: 300 },
}));

vi.mock("@/lib/logger", () => ({
  logger: { error: mocks.loggerError, info: vi.fn() },
}));

vi.mock("@/lib/permissions", () => ({
  PERMISSIONS: { ATTACH_FILES: 1, MANAGE_MESSAGES: 2 },
  hasPermission: mocks.hasPermission,
}));

vi.mock("@/lib/rate-limit", () => ({
  RATE_LIMITS: { FILE_UPLOAD: {} },
  checkRateLimitDO: mocks.checkRateLimitDO,
}));

vi.mock("@/lib/require-channel-access", () => ({
  requireChannelAccess: mocks.requireChannelAccess,
}));

vi.mock("@/lib/require-permission", () => ({
  getUserPermissions: mocks.getUserPermissions,
}));

vi.mock("@/services/soundboard.service", () => ({
  listServerSoundboardSounds: mocks.listServerSoundboardSounds,
}));

vi.mock("@/services/r2-cleanup.service", () => ({
  recordR2CleanupFailure: mocks.recordR2CleanupFailure,
  retryR2Cleanup: mocks.retryR2Cleanup,
}));

import { GET } from "../soundboard/uploads/$id";
import { GET as GET_SERVER_SOUNDBOARD } from "../servers/$id/soundboard";
import { DELETE as DELETE_SERVER_SOUNDBOARD } from "../servers/$id/soundboard";
import { POST } from "../channels/$id/messages/upload";
import {
  getSoundboardMediaCapabilityUrl,
  issueSoundboardMediaCapability,
} from "@/lib/voice/soundboard-media-capability";

describe("soundboard upload GET", () => {
  beforeEach(() => {
    mocks.getBucket.mockReset();
    mocks.getDB.mockReset();
    mocks.getEnv.mockReset();
    mocks.requireAuth.mockReset();
    mocks.cacheDel.mockReset();
    mocks.cacheFetch.mockReset();
    mocks.checkRateLimitDO.mockReset();
    mocks.getUserPermissions.mockReset();
    mocks.hasPermission.mockReset();
    mocks.loggerError.mockReset();
    mocks.listServerSoundboardSounds.mockReset();
    mocks.recordR2CleanupFailure.mockReset();
    mocks.requireChannelAccess.mockReset();
    mocks.retryR2Cleanup.mockReset();
    mocks.requireAuth.mockResolvedValue({ userId: "user-1" });
    mocks.checkRateLimitDO.mockResolvedValue(null);
    mocks.getUserPermissions.mockResolvedValue(1);
    mocks.hasPermission.mockReturnValue(true);
    mocks.requireChannelAccess.mockResolvedValue({ serverId: "server-1" });
    mocks.retryR2Cleanup.mockResolvedValue(undefined);
    mocks.getEnv.mockReturnValue({ REALTIME_TICKET_SECRET: "realtime-secret" });
  });

  it("serves a member's authenticated soundboard upload from its stored R2 key", async () => {
    const first = vi.fn().mockResolvedValue({
      file_key: "attachments/channel-1/sound-1/airhorn.mp3",
      filename: "airhorn.mp3",
      content_type: "audio/mpeg",
    });
    mocks.getDB.mockReturnValue({
      prepare: vi.fn(() => ({ bind: vi.fn(() => ({ first })) })),
    });
    const bucket = {
      head: vi.fn().mockResolvedValue({ size: 12 }),
      get: vi.fn().mockResolvedValue({
        body: new ReadableStream(),
        size: 12,
        httpMetadata: { contentType: "audio/mpeg" },
        writeHttpMetadata(headers: Headers) {
          headers.set("Content-Type", "audio/mpeg");
        },
      }),
    };
    mocks.getBucket.mockReturnValue(bucket);

    const response = await GET({
      request: new Request("https://meet.test/api/soundboard/uploads/sound-1"),
      params: { id: "sound-1" },
    });

    expect(response.status).toBe(200);
    expect(bucket.get).toHaveBeenCalledWith(
      "attachments/channel-1/sound-1/airhorn.mp3",
      undefined,
    );
    expect(response.headers.get("Content-Type")).toBe("audio/mpeg");
    expect(response.headers.get("Content-Disposition")).toContain(
      'inline; filename="airhorn.mp3"',
    );
  });

  it("serves an uploaded sound with a valid DM media capability and range", async () => {
    const capability = await issueSoundboardMediaCapability(
      {
        soundId: "sound-1",
        sourceServerId: "server-1",
        roomSlug: "dm-call-user-1-user-2",
        playbackId: "sb1:6:user-1:sound-1",
        issuerSubject: "user-1",
        expiresAt: Date.now() + 60_000,
      },
      "realtime-secret",
    );
    const first = vi.fn().mockResolvedValue({
      file_key: "attachments/channel-1/sound-1/airhorn.mp3",
      filename: "airhorn.mp3",
      content_type: "audio/mpeg",
    });
    const bind = vi.fn(() => ({ first }));
    mocks.getDB.mockReturnValue({
      prepare: vi.fn(() => ({ bind })),
    });
    const bucket = {
      head: vi.fn().mockResolvedValue({ size: 12 }),
      get: vi.fn().mockResolvedValue({
        body: new ReadableStream(),
        size: 4,
        range: { offset: 8, length: 4 },
        writeHttpMetadata(headers: Headers) {
          headers.set("Content-Type", "audio/mpeg");
        },
      }),
    };
    mocks.getBucket.mockReturnValue(bucket);
    mocks.requireAuth.mockResolvedValue(
      Response.json({ error: "membership required" }, { status: 401 }),
    );

    const response = await GET({
      request: new Request(
        `https://meet.test/api/soundboard/uploads/sound-1?cap=${encodeURIComponent(capability)}&room_slug=dm-call-user-1-user-2&playback_id=sb1%3A6%3Auser-1%3Asound-1`,
        { headers: { Range: "bytes=-4" } },
      ),
      params: { id: "sound-1" },
    });

    expect(response.status).toBe(206);
    expect(bind).toHaveBeenCalledWith("user-1", "sound-1", "server-1");
    expect(mocks.requireAuth).not.toHaveBeenCalled();
    expect(response.headers.get("Content-Range")).toBe("bytes 8-11/12");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(bucket.get).toHaveBeenCalledWith(
      "attachments/channel-1/sound-1/airhorn.mp3",
      { range: { offset: 8, length: 4 } },
    );
  });

  it("rejects an invalid soundboard media capability before reading R2", async () => {
    const first = vi.fn().mockResolvedValue({
      file_key: "attachments/channel-1/sound-1/airhorn.mp3",
      filename: "airhorn.mp3",
      content_type: "audio/mpeg",
    });
    mocks.getDB.mockReturnValue({
      prepare: vi.fn(() => ({ bind: vi.fn(() => ({ first })) })),
    });
    const bucket = { head: vi.fn(), get: vi.fn() };
    mocks.getBucket.mockReturnValue(bucket);
    mocks.requireAuth.mockResolvedValue(
      Response.json({ error: "membership required" }, { status: 401 }),
    );

    const response = await GET({
      request: new Request(
        "https://meet.test/api/soundboard/uploads/sound-1?cap=sbm1.invalid.invalid",
      ),
      params: { id: "sound-1" },
    });

    expect(response.status).toBe(404);
    expect(bucket.head).not.toHaveBeenCalled();
    expect(bucket.get).not.toHaveBeenCalled();
  });

  it("rejects an expired soundboard media capability before reading D1 or R2", async () => {
    const capability = await issueSoundboardMediaCapability(
      {
        soundId: "sound-1",
        sourceServerId: "server-1",
        roomSlug: "dm-call-user-1-user-2",
        playbackId: "sb1:6:user-1:sound-1",
        issuerSubject: "user-1",
        expiresAt: Date.now() - 1,
      },
      "realtime-secret",
    );
    const prepare = vi.fn();
    mocks.getDB.mockReturnValue({ prepare });
    const bucket = { head: vi.fn(), get: vi.fn() };
    mocks.getBucket.mockReturnValue(bucket);

    const response = await GET({
      request: new Request(
        `https://meet.test/api/soundboard/uploads/sound-1?cap=${encodeURIComponent(capability)}&room_slug=dm-call-user-1-user-2&playback_id=sb1%3A6%3Auser-1%3Asound-1`,
      ),
      params: { id: "sound-1" },
    });

    expect(response.status).toBe(404);
    expect(prepare).not.toHaveBeenCalled();
    expect(bucket.head).not.toHaveBeenCalled();
  });

  it("rejects a valid capability after its soundboard row is deleted", async () => {
    const capability = await issueSoundboardMediaCapability(
      {
        soundId: "deleted-sound",
        sourceServerId: "server-1",
        roomSlug: "dm-call-user-1-user-2",
        playbackId: "sb1:6:user-1:deleted-sound",
        issuerSubject: "user-1",
        expiresAt: Date.now() + 60_000,
      },
      "realtime-secret",
    );
    const first = vi.fn().mockResolvedValue(null);
    const prepare = vi.fn(() => ({ bind: vi.fn(() => ({ first })) }));
    mocks.getDB.mockReturnValue({ prepare });
    const bucket = { head: vi.fn(), get: vi.fn() };
    mocks.getBucket.mockReturnValue(bucket);

    const response = await GET({
      request: new Request(
        `https://meet.test/api/soundboard/uploads/deleted-sound?cap=${encodeURIComponent(capability)}&room_slug=dm-call-user-1-user-2&playback_id=sb1%3A6%3Auser-1%3Adeleted-sound`,
      ),
      params: { id: "deleted-sound" },
    });

    expect(response.status).toBe(404);
    expect(bucket.head).not.toHaveBeenCalled();
    expect(bucket.get).not.toHaveBeenCalled();
  });

  it.each([
    ["room", "wrong-room", "sb1:6:user-1:sound-1"],
    ["playback", "dm-call-user-1-user-2", "sb1:6:user-1:sound-2"],
  ])(
    "rejects a capability URL with the wrong %s context before reading D1 or R2",
    async (_field, roomSlug, playbackId) => {
      const capability = await issueSoundboardMediaCapability(
        {
          soundId: "sound-1",
          sourceServerId: "server-1",
          roomSlug: "dm-call-user-1-user-2",
          playbackId: "sb1:6:user-1:sound-1",
          issuerSubject: "user-1",
          expiresAt: Date.now() + 60_000,
        },
        "realtime-secret",
      );
      const prepare = vi.fn();
      mocks.getDB.mockReturnValue({ prepare });
      const bucket = { head: vi.fn(), get: vi.fn() };
      mocks.getBucket.mockReturnValue(bucket);

      const response = await GET({
        request: new Request(
          `https://meet.test/api/soundboard/uploads/sound-1?cap=${encodeURIComponent(capability)}&room_slug=${encodeURIComponent(roomSlug)}&playback_id=${encodeURIComponent(playbackId)}`,
        ),
        params: { id: "sound-1" },
      });

      expect(response.status).toBe(404);
      expect(prepare).not.toHaveBeenCalled();
      expect(bucket.head).not.toHaveBeenCalled();
      expect(bucket.get).not.toHaveBeenCalled();
    },
  );

  it("revokes an emitted capability after membership is removed while the attachment remains", async () => {
    const capability = await issueSoundboardMediaCapability(
      {
        soundId: "sound-1",
        sourceServerId: "server-1",
        roomSlug: "dm-call-user-1-user-2",
        playbackId: "sb1:6:user-1:sound-1",
        issuerSubject: "user-1",
        expiresAt: Date.now() + 60_000,
      },
      "realtime-secret",
    );
    const attachment = {
      file_key: "attachments/channel-1/sound-1/airhorn.mp3",
      filename: "airhorn.mp3",
      content_type: "audio/mpeg",
    };
    let membershipPresent = true;
    const first = vi
      .fn()
      .mockImplementation(async () => (membershipPresent ? attachment : null));
    const prepare = vi.fn(() => ({ bind: vi.fn(() => ({ first })) }));
    mocks.getDB.mockReturnValue({ prepare });
    const bucket = { head: vi.fn(), get: vi.fn() };
    mocks.getBucket.mockReturnValue(bucket);

    const emittedUrl = getSoundboardMediaCapabilityUrl("sound-1", capability, {
      roomSlug: "dm-call-user-1-user-2",
      playbackId: "sb1:6:user-1:sound-1",
    });
    membershipPresent = false;

    const response = await GET({
      request: new Request(`https://meet.test${emittedUrl}`),
      params: { id: "sound-1" },
    });

    expect(response.status).toBe(404);
    expect(prepare).toHaveBeenCalled();
    expect(bucket.head).not.toHaveBeenCalled();
    expect(bucket.get).not.toHaveBeenCalled();
  });

  it("does not read R2 when the soundboard upload is not found for the member", async () => {
    const first = vi.fn().mockResolvedValue(null);
    mocks.getDB.mockReturnValue({
      prepare: vi.fn(() => ({ bind: vi.fn(() => ({ first })) })),
    });
    const bucket = { get: vi.fn() };
    mocks.getBucket.mockReturnValue(bucket);

    const response = await GET({
      request: new Request("https://meet.test/api/soundboard/uploads/unknown"),
      params: { id: "unknown" },
    });

    expect(response.status).toBe(404);
    expect(bucket.get).not.toHaveBeenCalled();
  });

  it("does not read R2 for a non-member soundboard upload request", async () => {
    const first = vi.fn().mockResolvedValue(null);
    mocks.getDB.mockReturnValue({
      prepare: vi.fn(() => ({ bind: vi.fn(() => ({ first })) })),
    });
    const bucket = { head: vi.fn(), get: vi.fn() };
    mocks.getBucket.mockReturnValue(bucket);

    const response = await GET({
      request: new Request("https://meet.test/api/soundboard/uploads/sound-1"),
      params: { id: "sound-1" },
    });

    expect(response.status).toBe(404);
    expect(bucket.head).not.toHaveBeenCalled();
    expect(bucket.get).not.toHaveBeenCalled();
  });

  it("rejects a soundboard message association from another channel before reading R2", async () => {
    const first = vi.fn().mockResolvedValue(null);
    const prepare = vi.fn(() => ({ bind: vi.fn(() => ({ first })) }));
    mocks.getDB.mockReturnValue({ prepare });
    const bucket = { put: vi.fn() };
    mocks.getBucket.mockReturnValue(bucket);
    const formData = new FormData();
    formData.append(
      "file",
      new File([new Uint8Array([1, 2, 3])], "airhorn.mp3", {
        type: "audio/mpeg",
      }),
    );
    formData.append("purpose", "soundboard");
    formData.append("message_id", "message-from-another-channel");

    const response = await POST({
      request: new Request(
        "https://meet.test/api/channels/channel-1/messages/upload",
        { method: "POST", body: formData },
      ),
      params: { id: "channel-1" },
    });

    expect(response.status).toBe(400);
    expect(bucket.put).not.toHaveBeenCalled();
  });

  it("deletes the R2 object when the attachment insert fails", async () => {
    const run = vi.fn().mockRejectedValue(new Error("D1 unavailable"));
    mocks.getDB.mockReturnValue({
      prepare: vi.fn(() => ({ bind: vi.fn(() => ({ run })) })),
    });
    const bucket = {
      delete: vi.fn().mockResolvedValue(undefined),
      put: vi.fn().mockResolvedValue(undefined),
    };
    mocks.getBucket.mockReturnValue(bucket);
    const formData = new FormData();
    formData.append(
      "file",
      new File([new Uint8Array([1, 2, 3])], "airhorn.mp3", {
        type: "audio/mpeg",
      }),
    );
    formData.append("purpose", "soundboard");

    const response = await POST({
      request: new Request(
        "https://meet.test/api/channels/channel-1/messages/upload",
        { method: "POST", body: formData },
      ),
      params: { id: "channel-1" },
    });

    expect(response.status).toBe(500);
    expect(bucket.delete).toHaveBeenCalledWith(
      "attachments/channel-1/sound-1/airhorn.mp3",
    );
  });

  it("logs an R2 cleanup failure after an attachment insert failure", async () => {
    const run = vi.fn().mockRejectedValue(new Error("D1 unavailable"));
    mocks.getDB.mockReturnValue({
      prepare: vi.fn(() => ({ bind: vi.fn(() => ({ run })) })),
    });
    const bucket = {
      delete: vi.fn().mockRejectedValue(new Error("R2 unavailable")),
      put: vi.fn().mockResolvedValue(undefined),
    };
    mocks.getBucket.mockReturnValue(bucket);
    const formData = new FormData();
    formData.append(
      "file",
      new File([new Uint8Array([1, 2, 3])], "airhorn.mp3", {
        type: "audio/mpeg",
      }),
    );
    formData.append("purpose", "soundboard");

    await POST({
      request: new Request(
        "https://meet.test/api/channels/channel-1/messages/upload",
        { method: "POST", body: formData },
      ),
      params: { id: "channel-1" },
    });

    expect(mocks.loggerError).toHaveBeenCalledWith(
      "attachment_upload_cleanup_failed",
      expect.objectContaining({ attachmentId: "sound-1" }),
    );
  });

  it("normalizes stale cached attachment URLs in the server catalog", async () => {
    const first = vi.fn().mockResolvedValue({});
    mocks.getDB.mockReturnValue({
      prepare: vi.fn(() => ({ bind: vi.fn(() => ({ first })) })),
    });
    mocks.cacheFetch.mockResolvedValue([
      {
        id: "sound-1",
        server_id: "server-1",
        file_url: "/api/attachments/channel-1/sound-1/airhorn.mp3",
      },
    ]);

    const response = await GET_SERVER_SOUNDBOARD({
      request: new Request("https://meet.test/api/servers/server-1/soundboard"),
      params: { id: "server-1" },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([
      expect.objectContaining({
        id: "sound-1",
        file_url: "/api/soundboard/uploads/sound-1",
      }),
    ]);
  });

  it("returns 416 for a reversed soundboard byte range without passing a negative R2 length", async () => {
    const first = vi.fn().mockResolvedValue({
      file_key: "attachments/channel-1/sound-1/airhorn.mp3",
      filename: "airhorn.mp3",
      content_type: "audio/mpeg",
    });
    mocks.getDB.mockReturnValue({
      prepare: vi.fn(() => ({ bind: vi.fn(() => ({ first })) })),
    });
    const bucket = {
      head: vi.fn().mockResolvedValue({ size: 12 }),
      get: vi.fn().mockResolvedValue({
        body: new ReadableStream(),
        size: 12,
        writeHttpMetadata(headers: Headers) {
          headers.set("Content-Type", "audio/mpeg");
        },
      }),
    };
    mocks.getBucket.mockReturnValue(bucket);

    const response = await GET({
      request: new Request("https://meet.test/api/soundboard/uploads/sound-1", {
        headers: { Range: "bytes=8-3" },
      }),
      params: { id: "sound-1" },
    });

    expect(response.status).toBe(416);
    expect(response.headers.get("Content-Range")).toBe("bytes */12");
    expect(bucket.head).toHaveBeenCalledWith(
      "attachments/channel-1/sound-1/airhorn.mp3",
    );
    expect(bucket.get).not.toHaveBeenCalled();
  });

  it("resolves a valid soundboard suffix range against object metadata", async () => {
    const first = vi.fn().mockResolvedValue({
      file_key: "attachments/channel-1/sound-1/airhorn.mp3",
      filename: "airhorn.mp3",
      content_type: "audio/mpeg",
    });
    mocks.getDB.mockReturnValue({
      prepare: vi.fn(() => ({ bind: vi.fn(() => ({ first })) })),
    });
    const bucket = {
      head: vi.fn().mockResolvedValue({ size: 12 }),
      get: vi.fn().mockResolvedValue({
        body: new ReadableStream(),
        size: 4,
        range: { offset: 8, length: 4 },
        writeHttpMetadata(headers: Headers) {
          headers.set("Content-Type", "audio/mpeg");
        },
      }),
    };
    mocks.getBucket.mockReturnValue(bucket);

    const response = await GET({
      request: new Request("https://meet.test/api/soundboard/uploads/sound-1", {
        headers: { Range: "bytes=-4" },
      }),
      params: { id: "sound-1" },
    });

    expect(response.status).toBe(206);
    expect(response.headers.get("Content-Range")).toBe("bytes 8-11/12");
    expect(response.headers.get("Content-Length")).toBe("4");
    expect(bucket.get).toHaveBeenCalledWith(
      "attachments/channel-1/sound-1/airhorn.mp3",
      { range: { offset: 8, length: 4 } },
    );
  });

  it.each(["bytes=-0", "bytes=12-12"])(
    "rejects unsafe soundboard range %s before reading R2",
    async (range) => {
      const first = vi.fn().mockResolvedValue({
        file_key: "attachments/channel-1/sound-1/airhorn.mp3",
        filename: "airhorn.mp3",
        content_type: "audio/mpeg",
      });
      mocks.getDB.mockReturnValue({
        prepare: vi.fn(() => ({ bind: vi.fn(() => ({ first })) })),
      });
      const bucket = {
        head: vi.fn().mockResolvedValue({ size: 12 }),
        get: vi.fn(),
      };
      mocks.getBucket.mockReturnValue(bucket);

      const response = await GET({
        request: new Request(
          "https://meet.test/api/soundboard/uploads/sound-1",
          { headers: { Range: range } },
        ),
        params: { id: "sound-1" },
      });

      expect(response.status).toBe(416);
      expect(response.headers.get("Content-Range")).toBe("bytes */12");
      expect(bucket.get).not.toHaveBeenCalled();
    },
  );

  it("rejects a same-channel foreign message association for soundboard uploads", async () => {
    const first = vi.fn().mockResolvedValue({ id: "foreign-message" });
    const prepare = vi.fn(() => ({ bind: vi.fn(() => ({ first })) }));
    mocks.getDB.mockReturnValue({ prepare });
    const bucket = { put: vi.fn() };
    mocks.getBucket.mockReturnValue(bucket);
    const formData = new FormData();
    formData.append(
      "file",
      new File([new Uint8Array([1, 2, 3])], "airhorn.mp3", {
        type: "audio/mpeg",
      }),
    );
    formData.append("purpose", "soundboard");
    formData.append("message_id", "foreign-message");

    const response = await POST({
      request: new Request(
        "https://meet.test/api/channels/channel-1/messages/upload",
        { method: "POST", body: formData },
      ),
      params: { id: "channel-1" },
    });

    expect(response.status).toBe(400);
    expect(bucket.put).not.toHaveBeenCalled();
    expect(first).not.toHaveBeenCalled();
  });

  it("allows an own non-soundboard message association", async () => {
    const messageFirst = vi.fn().mockResolvedValue({
      id: "message-1",
      author_id: "user-1",
    });
    const run = vi.fn().mockResolvedValue({});
    mocks.getDB.mockReturnValue({
      prepare: vi.fn(() => ({
        bind: vi.fn(() => ({ first: messageFirst, run })),
      })),
    });
    const bucket = {
      put: vi.fn().mockResolvedValue(undefined),
    };
    mocks.getBucket.mockReturnValue(bucket);
    mocks.getUserPermissions.mockResolvedValue(1);
    mocks.hasPermission.mockImplementation(
      (_permissions: number, permission: number) => permission === 1,
    );
    const formData = new FormData();
    formData.append(
      "file",
      new File([new Uint8Array([1, 2, 3])], "note.txt", {
        type: "text/plain",
      }),
    );
    formData.append("message_id", "message-1");

    const response = await POST({
      request: new Request(
        "https://meet.test/api/channels/channel-1/messages/upload",
        { method: "POST", body: formData },
      ),
      params: { id: "channel-1" },
    });

    expect(response.status).toBe(201);
    expect(bucket.put).toHaveBeenCalled();
  });

  it("rejects a same-channel foreign message without MANAGE_MESSAGES before R2", async () => {
    const messageFirst = vi.fn().mockResolvedValue({
      id: "message-1",
      author_id: "other-user",
    });
    mocks.getDB.mockReturnValue({
      prepare: vi.fn(() => ({ bind: vi.fn(() => ({ first: messageFirst })) })),
    });
    const bucket = { put: vi.fn() };
    mocks.getBucket.mockReturnValue(bucket);
    mocks.getUserPermissions.mockResolvedValue(1);
    mocks.hasPermission.mockImplementation(
      (_permissions: number, permission: number) => permission === 1,
    );
    const formData = new FormData();
    formData.append(
      "file",
      new File([new Uint8Array([1, 2, 3])], "note.txt", {
        type: "text/plain",
      }),
    );
    formData.append("message_id", "message-1");

    const response = await POST({
      request: new Request(
        "https://meet.test/api/channels/channel-1/messages/upload",
        { method: "POST", body: formData },
      ),
      params: { id: "channel-1" },
    });

    expect(response.status).toBe(403);
    expect(bucket.put).not.toHaveBeenCalled();
  });

  it("allows a same-channel foreign message for a MANAGE_MESSAGES member", async () => {
    const messageFirst = vi.fn().mockResolvedValue({
      id: "message-1",
      author_id: "other-user",
    });
    const run = vi.fn().mockResolvedValue({});
    mocks.getDB.mockReturnValue({
      prepare: vi.fn(() => ({
        bind: vi.fn(() => ({ first: messageFirst, run })),
      })),
    });
    const bucket = { put: vi.fn().mockResolvedValue(undefined) };
    mocks.getBucket.mockReturnValue(bucket);
    mocks.getUserPermissions.mockResolvedValue(3);
    mocks.hasPermission.mockReturnValue(true);
    const formData = new FormData();
    formData.append(
      "file",
      new File([new Uint8Array([1, 2, 3])], "note.txt", {
        type: "text/plain",
      }),
    );
    formData.append("message_id", "message-1");

    const response = await POST({
      request: new Request(
        "https://meet.test/api/channels/channel-1/messages/upload",
        { method: "POST", body: formData },
      ),
      params: { id: "channel-1" },
    });

    expect(response.status).toBe(201);
    expect(bucket.put).toHaveBeenCalled();
  });

  it.each(["foreign-message", "missing-message"])(
    "rejects a %s association before R2",
    async (messageId) => {
      const messageFirst = vi.fn().mockResolvedValue(null);
      mocks.getDB.mockReturnValue({
        prepare: vi.fn(() => ({
          bind: vi.fn(() => ({ first: messageFirst })),
        })),
      });
      const bucket = { put: vi.fn() };
      mocks.getBucket.mockReturnValue(bucket);
      const formData = new FormData();
      formData.append(
        "file",
        new File([new Uint8Array([1, 2, 3])], "note.txt", {
          type: "text/plain",
        }),
      );
      formData.append("message_id", messageId);

      const response = await POST({
        request: new Request(
          "https://meet.test/api/channels/channel-1/messages/upload",
          { method: "POST", body: formData },
        ),
        params: { id: "channel-1" },
      });

      expect(response.status).toBe(400);
      expect(bucket.put).not.toHaveBeenCalled();
    },
  );

  it("deletes the persisted R2 object after deleting a soundboard row", async () => {
    const memberFirst = vi.fn().mockResolvedValue({ owner_id: "owner-1" });
    const attachmentFirst = vi.fn().mockResolvedValue({
      user_id: "user-1",
      file_key: "attachments/channel-1/sound-1/airhorn.mp3",
    });
    const run = vi.fn().mockResolvedValue({});
    const prepare = vi.fn((query: string) => {
      if (query.includes("DELETE FROM")) {
        return { bind: vi.fn(() => ({ run })) };
      }
      if (query.includes("FROM server_members")) {
        return { bind: vi.fn(() => ({ first: memberFirst })) };
      }
      if (query.includes("FROM attachments")) {
        return { bind: vi.fn(() => ({ first: attachmentFirst })) };
      }
      return { bind: vi.fn(() => ({ run })) };
    });
    mocks.getDB.mockReturnValue({ prepare });
    mocks.getUserPermissions.mockResolvedValue(0);
    mocks.hasPermission.mockReturnValue(false);
    const bucket = { delete: vi.fn().mockResolvedValue(undefined) };
    mocks.getBucket.mockReturnValue(bucket);

    const response = await DELETE_SERVER_SOUNDBOARD({
      request: new Request(
        "https://meet.test/api/servers/server-1/soundboard?soundId=sound-1",
        { method: "DELETE" },
      ),
      params: { id: "server-1" },
    });

    expect(response.status).toBe(200);
    expect(run).toHaveBeenCalled();
    expect(bucket.delete).toHaveBeenCalledWith(
      "attachments/channel-1/sound-1/airhorn.mp3",
    );
  });

  it("queues a soundboard key when per-sound R2 deletion fails", async () => {
    const fileKey = "attachments/channel-1/sound-1/airhorn.mp3";
    const memberFirst = vi.fn().mockResolvedValue({ owner_id: "owner-1" });
    const attachmentFirst = vi.fn().mockResolvedValue({
      user_id: "user-1",
      file_key: fileKey,
    });
    const run = vi.fn().mockResolvedValue({});
    const prepare = vi.fn((query: string) => {
      if (query.includes("DELETE FROM")) {
        return { bind: vi.fn(() => ({ run })) };
      }
      if (query.includes("FROM server_members")) {
        return { bind: vi.fn(() => ({ first: memberFirst })) };
      }
      if (query.includes("FROM attachments")) {
        return { bind: vi.fn(() => ({ first: attachmentFirst })) };
      }
      return { bind: vi.fn(() => ({ run })) };
    });
    mocks.getDB.mockReturnValue({ prepare });
    mocks.getUserPermissions.mockResolvedValue(0);
    mocks.hasPermission.mockReturnValue(false);
    const bucket = {
      delete: vi.fn().mockRejectedValue(new Error("R2 unavailable")),
    };
    mocks.getBucket.mockReturnValue(bucket);

    const response = await DELETE_SERVER_SOUNDBOARD({
      request: new Request(
        "https://meet.test/api/servers/server-1/soundboard?soundId=sound-1",
        { method: "DELETE" },
      ),
      params: { id: "server-1" },
    });

    expect(response.status).toBe(200);
    expect(mocks.recordR2CleanupFailure).toHaveBeenCalledWith(
      expect.anything(),
      fileKey,
      expect.any(Error),
    );
  });

  it("returns the canonical authenticated URL for a soundboard upload", async () => {
    const run = vi.fn().mockResolvedValue({});
    mocks.getDB.mockReturnValue({
      prepare: vi.fn(() => ({ bind: vi.fn(() => ({ run })) })),
    });
    mocks.getBucket.mockReturnValue({
      put: vi.fn().mockResolvedValue(undefined),
    });
    const formData = new FormData();
    formData.append(
      "file",
      new File([new Uint8Array([1, 2, 3])], "airhorn.mp3", {
        type: "audio/mpeg",
      }),
    );
    formData.append("purpose", "soundboard");
    formData.append("sound_name", "Airhorn");

    const response = await POST({
      request: new Request(
        "https://meet.test/api/channels/channel-1/messages/upload",
        {
          method: "POST",
          body: formData,
        },
      ),
      params: { id: "channel-1" },
    });

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      id: "sound-1",
      file_url: "/api/soundboard/uploads/sound-1",
    });
  });

  it("accepts a soundboard upload exactly at the 50 MB limit", async () => {
    const run = vi.fn().mockResolvedValue({});
    mocks.getDB.mockReturnValue({
      prepare: vi.fn(() => ({ bind: vi.fn(() => ({ run })) })),
    });
    mocks.getBucket.mockReturnValue({
      put: vi.fn().mockResolvedValue(undefined),
    });
    const formData = new FormData();
    formData.append(
      "file",
      new File([new Uint8Array(50 * 1024 * 1024)], "airhorn.mp3", {
        type: "audio/mpeg",
      }),
    );
    formData.append("purpose", "soundboard");

    const response = await POST({
      request: new Request(
        "https://meet.test/api/channels/channel-1/messages/upload",
        { method: "POST", body: formData },
      ),
      params: { id: "channel-1" },
    });

    expect(response.status).toBe(201);
  });
});
