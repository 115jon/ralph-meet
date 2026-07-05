import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  meetingFetch,
  meetingGet,
  meetingIdFromName,
  rtcFetch,
  rtcRoomGet,
  rtcRoomIdFromName,
  voiceFetch,
  voiceGet,
  voiceIdFromName,
  createStartHandler,
  defaultStreamHandler,
} = vi.hoisted(() => {
  const nextMeetingFetch = vi.fn(async () => new Response("meeting"));
  const nextRtcFetch = vi.fn(async () => new Response("rtc"));
  const nextVoiceFetch = vi.fn(async () => new Response("voice"));

  return {
    meetingFetch: nextMeetingFetch,
    meetingIdFromName: vi.fn((name: string) => name),
    meetingGet: vi.fn(() => ({ fetch: nextMeetingFetch })),
    rtcFetch: nextRtcFetch,
    rtcRoomIdFromName: vi.fn((name: string) => name),
    rtcRoomGet: vi.fn(() => ({ fetch: nextRtcFetch })),
    voiceFetch: nextVoiceFetch,
    voiceIdFromName: vi.fn((name: string) => name),
    voiceGet: vi.fn(() => ({ fetch: nextVoiceFetch })),
    createStartHandler: vi.fn(() => vi.fn(async () => new Response("start"))),
    defaultStreamHandler: vi.fn(),
  };
});

function makeEnv() {
  return {
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
  };
}

async function fetchChannelRoute(pathname: string) {
  return handler.fetch(
    new Request(`https://example.com${pathname}`, {
      headers: { Upgrade: "websocket" },
    }),
    makeEnv() as never,
    undefined as never,
  );
}

vi.mock("cloudflare:workers", () => ({
  DurableObject: class {},
  env: {
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

vi.mock("@tanstack/react-start/server", () => ({
  createStartHandler,
  defaultStreamHandler,
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    security: vi.fn(),
  },
}));

vi.mock("./src/lib/api-helpers", () => ({
  getCorsHeaders: vi.fn(() => ({})),
  handleCorsPreflightIfNeeded: vi.fn(() => null),
}));

vi.mock("./src/lib/healthz", () => ({
  buildHealthzPayload: vi.fn(() => ({ ok: true })),
}));

vi.mock("./worker/rate-limiter", () => ({
  RateLimiter: class {
    check() {
      return { allowed: true, resetMs: 0 };
    }
  },
}));

import handler from "../../custom-server-entry";

describe("custom-server-entry routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("routes ws and voice endpoints to RTC_ROOM", async () => {
    const roomSlug = "voice-server-1-channel-1";
    await fetchChannelRoute(`/api/channels/${roomSlug}/ws`);
    await fetchChannelRoute(`/api/channels/${roomSlug}/voice`);

    expect(rtcRoomIdFromName).toHaveBeenNthCalledWith(1, roomSlug);
    expect(rtcRoomIdFromName).toHaveBeenNthCalledWith(2, roomSlug);
    expect(rtcRoomGet).toHaveBeenNthCalledWith(1, roomSlug);
    expect(rtcRoomGet).toHaveBeenNthCalledWith(2, roomSlug);
    expect(rtcFetch).toHaveBeenCalledTimes(2);
    expect(meetingIdFromName).not.toHaveBeenCalled();
    expect(meetingGet).not.toHaveBeenCalled();
    expect(meetingFetch).not.toHaveBeenCalled();
    expect(voiceIdFromName).not.toHaveBeenCalled();
    expect(voiceGet).not.toHaveBeenCalled();
    expect(voiceFetch).not.toHaveBeenCalled();
  });
});
