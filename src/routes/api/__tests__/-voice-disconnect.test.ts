import { beforeEach, describe, expect, it, vi } from "vitest";

// The page-exit voice disconnect route: every Durable Object call it makes is
// scoped to the signed-in caller, and the voice room comes from the channel
// row, never from the request body.

const mocks = vi.hoisted(() => ({
  first: vi.fn(),
  getDB: vi.fn(),
  getEnv: vi.fn(),
  requireAuth: vi.fn(),
}));

vi.mock("@/lib/api-helpers", () => ({
  apiSuccess: (data: unknown, status = 200) => Response.json(data, { status }),
  buildVoiceChannelRoomSlug: (serverId: string, channelId: string) =>
    `voice-${serverId}-${channelId}`,
  getCorsHeaders: () => ({}),
  getDB: mocks.getDB,
  getEnv: mocks.getEnv,
  handleCorsPreflightIfNeeded: () => null,
  requireAuth: mocks.requireAuth,
}));

import { POST } from "../channels/$id/voice-disconnect";

type Call = { namespace: string; room: string; path: string; body: unknown };

let calls: Call[];

function namespace(name: string) {
  return {
    idFromName: (room: string) => room,
    get: (room: string) => ({
      fetch: async (url: string, init: RequestInit) => {
        calls.push({
          namespace: name,
          room,
          path: new URL(url).pathname,
          body: JSON.parse(String(init.body)),
        });
        return Response.json({ disconnected: false });
      },
    }),
  };
}

function post(body: Record<string, unknown>, headers: HeadersInit = {}) {
  return POST({
    request: new Request(
      "https://meet.test/api/channels/channel-1/voice-disconnect",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(body),
      },
    ),
    params: { id: "channel-1" },
  });
}

describe("POST /api/channels/:id/voice-disconnect", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    calls = [];
    mocks.requireAuth.mockResolvedValue({ userId: "user-1" });
    mocks.first.mockResolvedValue({ server_id: "server-1" });
    mocks.getDB.mockReturnValue({
      prepare: () => ({ bind: () => ({ first: mocks.first }) }),
    });
    mocks.getEnv.mockReturnValue({
      MEETING_ROOM: namespace("MEETING_ROOM"),
      VOICE_ROOM: namespace("VOICE_ROOM"),
    });
  });

  it("scopes the voice room disconnect to the signed-in caller", async () => {
    const response = await post({}, { "X-Voice-Session-Id": "participant-2" });

    expect(response.status).toBe(202);
    expect(calls).toContainEqual({
      namespace: "VOICE_ROOM",
      room: "voice-server-1-channel-1",
      path: "/disconnect-participant",
      body: { participant_id: "participant-2", user_id: "user-1" },
    });
    for (const call of calls) {
      expect(call.body).toMatchObject({ user_id: "user-1" });
    }
  });

  it("scopes the gateway session disconnect to the signed-in caller", async () => {
    await post({ gateway_session_id: "gateway-2" });

    expect(calls).toEqual([
      {
        namespace: "MEETING_ROOM",
        room: "global-gateway",
        path: "/disconnect-session",
        body: {
          user_id: "user-1",
          channel_id: "channel-1",
          session_id: "gateway-2",
        },
      },
    ]);
  });

  it("takes the voice room from the channel row, not the body", async () => {
    await post({
      server_id: "server-other",
      voice_session_id: "participant-1",
    });

    expect(calls.map((call) => call.room)).toEqual([
      "voice-server-1-channel-1",
      "voice-server-1-channel-1",
    ]);
  });

  it("does nothing for a channel without a server", async () => {
    mocks.first.mockResolvedValue(null);

    const response = await post({
      server_id: "server-other",
      voice_session_id: "participant-1",
    });

    await expect(response.json()).resolves.toEqual({ disconnected: false });
    expect(calls).toEqual([]);
  });
});
