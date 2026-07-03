import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  envState,
  meetingIdFromName,
  meetingFetch,
  meetingGet,
  rtcRoomIdFromName,
  rtcRoomFetch,
  rtcRoomGet,
  voiceIdFromName,
  voiceFetch,
  voiceGet,
} = vi.hoisted(() => {
  const nextMeetingFetch = vi.fn();
  const nextRtcRoomFetch = vi.fn();
  const nextVoiceFetch = vi.fn();
  const nextEnvState = {
    RTC_ROOM_AUTHORITY_MODE: "split" as string | undefined,
    RTC_ROOM_CANARY_ROOMS: "" as string | undefined,
  };

  return {
    envState: nextEnvState,
    meetingIdFromName: vi.fn((name: string) => name),
    meetingFetch: nextMeetingFetch,
    meetingGet: vi.fn(() => ({ fetch: nextMeetingFetch })),
    rtcRoomIdFromName: vi.fn((name: string) => name),
    rtcRoomFetch: nextRtcRoomFetch,
    rtcRoomGet: vi.fn(() => ({ fetch: nextRtcRoomFetch })),
    voiceIdFromName: vi.fn((name: string) => name),
    voiceFetch: nextVoiceFetch,
    voiceGet: vi.fn(() => ({ fetch: nextVoiceFetch })),
  };
});

vi.mock("cloudflare:workers", () => ({
  env: {
    get RTC_ROOM_AUTHORITY_MODE() {
      return envState.RTC_ROOM_AUTHORITY_MODE;
    },
    get RTC_ROOM_CANARY_ROOMS() {
      return envState.RTC_ROOM_CANARY_ROOMS;
    },
    MEETING_ROOM: {
      idFromName: meetingIdFromName,
      get: meetingGet,
    },
    RTC_ROOM: {
      idFromName: rtcRoomIdFromName,
      get: rtcRoomGet,
    },
    VOICE_ROOM: {
      idFromName: voiceIdFromName,
      get: voiceGet,
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
    envState.RTC_ROOM_AUTHORITY_MODE = "split";
    envState.RTC_ROOM_CANARY_ROOMS = "";
  });

  it("retries a transient 5xx exact-session check on the voice authority", async () => {
    voiceFetch
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
    expect(voiceIdFromName).toHaveBeenCalledWith("voice-server-1-channel-1");
    expect(meetingFetch).not.toHaveBeenCalled();
    expect(voiceFetch).toHaveBeenCalledTimes(2);
  });

  it("falls back to the room MeetingRoom authority when the voice authority is unavailable", async () => {
    meetingFetch.mockResolvedValueOnce(Response.json({ allowed: true, exact_session_matched: true }));
    voiceFetch.mockResolvedValueOnce(new Response("not found", { status: 404 }));

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
    expect(voiceFetch).toHaveBeenCalledTimes(1);
    expect(meetingIdFromName).toHaveBeenCalledWith("voice-server-1-channel-1");
  });

  it("uses RTC_ROOM as the local media authority when the unified room flag is enabled", async () => {
    envState.RTC_ROOM_AUTHORITY_MODE = "rtc-room";
    rtcRoomFetch.mockResolvedValueOnce(Response.json({ allowed: true, exact_session_matched: true }));

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
    expect(rtcRoomFetch).toHaveBeenCalledTimes(1);
    expect(voiceFetch).not.toHaveBeenCalled();
    expect(meetingFetch).not.toHaveBeenCalled();
  });

  it("uses RTC_ROOM only for allowlisted rooms in canary mode", async () => {
    envState.RTC_ROOM_AUTHORITY_MODE = "canary";
    envState.RTC_ROOM_CANARY_ROOMS = "voice-server-1-channel-1";
    rtcRoomFetch.mockResolvedValueOnce(Response.json({ allowed: true, exact_session_matched: true }));

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
    expect(rtcRoomFetch).toHaveBeenCalledTimes(1);
    expect(voiceFetch).not.toHaveBeenCalled();
    expect(meetingFetch).not.toHaveBeenCalled();
  });

  it("stays on the legacy voice authority for non-canary rooms", async () => {
    envState.RTC_ROOM_AUTHORITY_MODE = "canary";
    envState.RTC_ROOM_CANARY_ROOMS = "voice-server-1-some-other-channel";
    voiceFetch.mockResolvedValueOnce(Response.json({ allowed: true, exact_session_matched: true }));

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
    expect(voiceFetch).toHaveBeenCalledTimes(1);
    expect(rtcRoomFetch).not.toHaveBeenCalled();
    expect(meetingFetch).not.toHaveBeenCalled();
  });

  it("does not downgrade a unified room back to MeetingRoom when RTC_ROOM is failing", async () => {
    envState.RTC_ROOM_AUTHORITY_MODE = "rtc-room";
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
    expect(meetingFetch).not.toHaveBeenCalled();
    expect(rtcRoomFetch).toHaveBeenCalledTimes(2);
  });

  it("rejects stale unified RTC sessions without downgrading to MeetingRoom", async () => {
    envState.RTC_ROOM_AUTHORITY_MODE = "rtc-room";
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
    expect(meetingFetch).not.toHaveBeenCalled();
    expect(voiceFetch).not.toHaveBeenCalled();
  });

  it("rejects when the room-local authority shows the user is not active in the room", async () => {
    voiceFetch.mockResolvedValueOnce(Response.json({
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
    expect(meetingFetch).not.toHaveBeenCalled();
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
