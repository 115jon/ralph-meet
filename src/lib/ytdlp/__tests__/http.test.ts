import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  requireActiveVoiceRoomSession: vi.fn(),
  getYtDlpUpstreamStatus: vi.fn(),
  syncYtDlpUpstream: vi.fn(),
  resolveYouTubePlayback: vi.fn(),
}));

vi.mock("@/lib/api-helpers", () => ({
  requireAuth: mocks.requireAuth,
  requireActiveVoiceRoomSession: mocks.requireActiveVoiceRoomSession,
}));
vi.mock("../upstream", () => ({
  getYtDlpUpstreamStatus: mocks.getYtDlpUpstreamStatus,
  syncYtDlpUpstream: mocks.syncYtDlpUpstream,
}));
vi.mock("../youtube", () => ({
  resolveYouTubePlayback: mocks.resolveYouTubePlayback,
}));

import { handleYtDlpRequest } from "../http";

const ctx = { waitUntil: vi.fn() };

function resolve(body: BodyInit) {
  return handleYtDlpRequest(
    new Request("https://meet.test/api/ytdlp/resolve", {
      method: "POST",
      body,
    }),
    ctx,
  );
}

describe("POST /api/ytdlp/resolve body", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAuth.mockResolvedValue({ userId: "user-1" });
    mocks.getYtDlpUpstreamStatus.mockResolvedValue({
      syncedAt: new Date().toISOString(),
    });
    mocks.resolveYouTubePlayback.mockResolvedValue({ url: "https://cdn.test" });
  });

  it("passes well-typed options through", async () => {
    const response = await resolve(
      JSON.stringify({
        url: " https://youtu.be/abc ",
        preferredKind: "video",
        preferredContainer: "webm",
        includeFormats: true,
      }),
    );

    expect(response?.status).toBe(200);
    expect(mocks.resolveYouTubePlayback).toHaveBeenCalledWith(
      "https://youtu.be/abc",
      {
        preferredKind: "video",
        preferredContainer: "webm",
        includeFormats: true,
      },
    );
  });

  it("ignores options of the wrong type instead of forwarding them", async () => {
    const response = await resolve(
      JSON.stringify({
        videoId: "abc",
        preferredKind: "everything",
        preferredContainer: 3,
        includeFormats: "yes",
      }),
    );

    expect(response?.status).toBe(200);
    expect(mocks.resolveYouTubePlayback).toHaveBeenCalledWith("abc", {
      preferredKind: "audio",
      preferredContainer: undefined,
      includeFormats: undefined,
    });
  });

  it.each(["{not json", "null", "[]", '"text"', JSON.stringify({ url: 5 })])(
    "answers %s with the missing-source 400 instead of throwing",
    async (body) => {
      const response = await resolve(body);

      expect(response?.status).toBe(400);
      await expect(response?.json()).resolves.toEqual({
        error: "Missing url or videoId",
      });
      expect(mocks.resolveYouTubePlayback).not.toHaveBeenCalled();
    },
  );
});
