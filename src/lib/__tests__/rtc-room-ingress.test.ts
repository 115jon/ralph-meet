import { beforeEach, describe, expect, it, vi } from "vitest";

const {
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
  const nextMeetingFetch = vi.fn(async () => new Response("meeting"));
  const nextRtcRoomFetch = vi.fn(async () => new Response("rtc-room"));
  const nextVoiceFetch = vi.fn(async () => new Response("voice"));

  return {
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

vi.mock("@tanstack/react-start/server", () => ({
  createStartHandler: vi.fn(() => vi.fn(async () => new Response("app"))),
  defaultStreamHandler: vi.fn(),
}));

vi.mock("cloudflare:workers", () => ({
  DurableObject: class {},
}));

vi.mock("../../logger", () => ({
  logger: { security: vi.fn() },
}));

describe("rtc-room ingress routing", () => {
  let workerModule: typeof import("../../../custom-server-entry");

  beforeEach(async () => {
    vi.clearAllMocks();
    workerModule = await import("../../../custom-server-entry");
  });

  function createEnv() {
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
    } as any;
  }

  it("routes room-scoped control sockets directly to RTC_ROOM", async () => {
    const response = await workerModule.default.fetch(
      new Request("https://example.com/api/channels/channel-1/ws", {
        headers: { Upgrade: "websocket" },
      }),
      createEnv(),
      {} as ExecutionContext,
    );

    expect(rtcRoomIdFromName).toHaveBeenCalledWith("channel-1");
    expect(rtcRoomFetch).toHaveBeenCalledTimes(1);
    expect(meetingFetch).not.toHaveBeenCalled();
    expect(voiceFetch).not.toHaveBeenCalled();
    expect(await response.text()).toBe("rtc-room");
  });

  it("routes room-scoped voice sockets directly to RTC_ROOM", async () => {
    const response = await workerModule.default.fetch(
      new Request("https://example.com/api/channels/channel-1/voice", {
        headers: { Upgrade: "websocket" },
      }),
      createEnv(),
      {} as ExecutionContext,
    );

    expect(rtcRoomIdFromName).toHaveBeenCalledWith("channel-1");
    expect(rtcRoomFetch).toHaveBeenCalledTimes(1);
    expect(meetingFetch).not.toHaveBeenCalled();
    expect(voiceFetch).not.toHaveBeenCalled();
    expect(await response.text()).toBe("rtc-room");
  });

  it("keeps the global gateway on MeetingRoom", async () => {
    const response = await workerModule.default.fetch(
      new Request("https://example.com/api/gateway", {
        headers: { Upgrade: "websocket" },
      }),
      createEnv(),
      {} as ExecutionContext,
    );

    expect(meetingIdFromName).toHaveBeenCalledWith("global-gateway");
    expect(meetingFetch).toHaveBeenCalledTimes(1);
    expect(rtcRoomFetch).not.toHaveBeenCalled();
    expect(await response.text()).toBe("meeting");
  });
});
