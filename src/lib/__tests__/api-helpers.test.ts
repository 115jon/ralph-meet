import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  rtcRoomIdFromName,
  rtcRoomFetch,
  rtcRoomGet,
} = vi.hoisted(() => {
  const nextRtcRoomFetch = vi.fn();

  return {
    rtcRoomIdFromName: vi.fn((name: string) => name),
    rtcRoomFetch: nextRtcRoomFetch,
    rtcRoomGet: vi.fn(() => ({ fetch: nextRtcRoomFetch })),
  };
});

vi.mock("cloudflare:workers", () => ({
  env: {
    RTC_ROOM: {
      idFromName: rtcRoomIdFromName,
      get: rtcRoomGet,
    },
  },
}));

import { requireActiveVoiceChannelSession } from "../api-helpers";
import {
  parseVoiceSessionCheckRequest,
  resolveVoiceSessionCheckResponse,
} from "../voice/rtc-room-session";

describe("requireActiveVoiceChannelSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retries a transient 5xx exact-session check on RTC_ROOM", async () => {
    rtcRoomFetch
      .mockResolvedValueOnce(new Response("temporary failure", { status: 503 }))
      .mockResolvedValueOnce(Response.json({ allowed: true, exact_session_matched: true }));

    const result = await requireActiveVoiceChannelSession(
      new Request("https://example.com", {
        headers: { "X-Voice-Session-Id": "session-123" },
      }),
      "user-1",
      "channel-1",
      "server-1",
    );

    expect(result).toEqual({
      sessionId: "session-123",
      exactSessionMatched: true,
    });
    expect(rtcRoomIdFromName).toHaveBeenCalledWith("voice-server-1-channel-1");
    expect(rtcRoomFetch).toHaveBeenCalledTimes(2);
  });

  it("does not downgrade RTC_ROOM exact-session checks to legacy room authorities when RTC_ROOM is failing", async () => {
    rtcRoomFetch
      .mockResolvedValueOnce(new Response("temporary failure", { status: 503 }))
      .mockResolvedValueOnce(new Response("temporary failure", { status: 503 }));

    const result = await requireActiveVoiceChannelSession(
      new Request("https://example.com", {
        headers: { "X-Voice-Session-Id": "session-123" },
      }),
      "user-1",
      "channel-1",
      "server-1",
    );

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(503);
    expect(rtcRoomFetch).toHaveBeenCalledTimes(2);
  });

  it("rejects stale RTC_ROOM sessions without downgrading to legacy room authorities", async () => {
    rtcRoomFetch.mockResolvedValueOnce(Response.json({
      allowed: false,
      connected: true,
      exact_session_matched: false,
    }));

    const result = await requireActiveVoiceChannelSession(
      new Request("https://example.com", {
        headers: { "X-Voice-Session-Id": "session-123" },
      }),
      "user-1",
      "channel-1",
      "server-1",
    );

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(403);
    expect(rtcRoomFetch).toHaveBeenCalledTimes(1);
  });

  it("rejects when RTC_ROOM shows the user is not active in the room", async () => {
    rtcRoomFetch.mockResolvedValueOnce(Response.json({
      allowed: false,
      connected: false,
      exact_session_matched: false,
    }));

    const result = await requireActiveVoiceChannelSession(
      new Request("https://example.com", {
        headers: { "X-Voice-Session-Id": "session-123" },
      }),
      "user-1",
      "channel-1",
      "server-1",
    );

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(403);
    expect(rtcRoomFetch).toHaveBeenCalledTimes(1);
  });
});

describe("voice session check helpers", () => {
  it("normalizes the lookup payload consistently", () => {
    expect(parseVoiceSessionCheckRequest({
      user_id: "user-1",
      channel_id: "channel-1",
      session_id: "  session-123  ",
      require_exact_session: true,
    })).toEqual({
      userId: "user-1",
      channelId: "channel-1",
      sessionId: "session-123",
      requireExactSession: true,
      requireChannelMatch: true,
    });
  });

  it("uses the same response rule for exact-session and user-scope checks", () => {
    expect(resolveVoiceSessionCheckResponse(true, false, false)).toEqual({
      allowed: true,
      connected: true,
      exact_session_matched: false,
    });
    expect(resolveVoiceSessionCheckResponse(true, false, true)).toEqual({
      allowed: false,
      connected: true,
      exact_session_matched: false,
    });
  });
});
