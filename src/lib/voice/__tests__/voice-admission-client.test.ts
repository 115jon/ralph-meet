import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/desktop-auth", () => ({
  getDesktopToken: () => null,
  getStoredKovaAuthSessionToken: () => null,
}));
vi.mock("@/lib/kova-auth-config", () => ({
  KOVA_AUTH_PUBLISHABLE_KEY: "",
}));
vi.mock("@/lib/platform", () => ({
  getApiBaseUrl: () => "https://meet.test",
  isTauri: () => false,
}));

import {
  beginCallAdmission,
  clearVoiceAdmissionsForTests,
  PREFETCH_MAX_AGE_MS,
  prefetchVoiceAdmission,
  prefetchVoiceChannelJoin,
  takeRoomSocketTicket,
  takeVoiceSocketTicket,
} from "../voice-admission-client";
import {
  clearVoiceMoveGrant,
  rememberVoiceMoveGrant,
} from "../voice-move-grants";

const target = {
  channelId: "channel",
  roomSlug: "voice-server-channel",
  serverId: "server",
};

type Body = {
  sockets: string[];
  media: boolean;
  participantId?: string;
  moveGrant?: string;
  roomSlug: string;
};

let issued = 0;
const bodies: Body[] = [];

function respond(body: Body) {
  issued += 1;
  const participant =
    body.media && body.sockets.includes("room")
      ? `participant-${issued}`
      : body.participantId;
  return Response.json({
    access_mode: "authenticated",
    room_slug: body.roomSlug,
    expires_at: Date.now() + 60_000,
    ...(participant ? { participant_id: participant } : {}),
    ...(body.sockets.includes("room") ? { room_ticket: `room-${issued}` } : {}),
    ...(body.sockets.includes("voice")
      ? { voice_ticket: `voice-${issued}` }
      : {}),
    ...(body.media
      ? {
          media: {
            participant_id: participant,
            voice_token: `token-${issued}`,
            ice_servers: [
              {
                urls: ["turn:example.test:3478?transport=udp"],
                username: "turn-user",
                credential: "turn-secret",
              },
            ],
          },
        }
      : {}),
  });
}

function ticketOf(protocols: string[]): string {
  return protocols[1].slice("ralph.ticket.".length);
}

beforeEach(() => {
  clearVoiceAdmissionsForTests();
  clearVoiceMoveGrant();
  issued = 0;
  bodies.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe("https://meet.test/api/voice/admission");
      const body = JSON.parse(String(init.body)) as Body;
      bodies.push(body);
      return respond(body);
    }),
  );
});

afterEach(() => {
  vi.useRealTimers();
});

describe("a join's admission", () => {
  it("gives the room and voice sockets their tickets from one request", async () => {
    beginCallAdmission(target);
    const [room, voice] = await Promise.all([
      takeRoomSocketTicket(target),
      takeVoiceSocketTicket(target, null),
    ]);

    expect(fetch).toHaveBeenCalledOnce();
    expect(bodies[0]).toMatchObject({
      sockets: ["room", "voice"],
      media: true,
      channelId: "channel",
      serverId: "server",
    });
    expect(ticketOf(room.protocols)).toBe("room-1");
    expect(ticketOf(voice)).toBe("voice-1");
    expect(room.mediaBootstrap).toEqual({
      participantId: "participant-1",
      voiceToken: "token-1",
      iceServers: [
        {
          urls: ["turn:example.test:3478?transport=udp"],
          username: "turn-user",
          credential: "turn-secret",
        },
      ],
    });
  });

  it("asks for only the reconnecting socket's ticket, with no credentials", async () => {
    beginCallAdmission(target);
    await Promise.all([
      takeRoomSocketTicket(target),
      takeVoiceSocketTicket(target, null),
    ]);

    const room = await takeRoomSocketTicket(target);
    expect(room.mediaBootstrap).toBeUndefined();
    expect(bodies[1]).toMatchObject({ sockets: ["room"], media: false });
    expect(bodies[1].participantId).toBeUndefined();

    const voice = await takeVoiceSocketTicket(target, "participant-1");
    expect(ticketOf(voice)).toBe("voice-3");
    expect(bodies[2]).toMatchObject({
      sockets: ["voice"],
      media: false,
      participantId: "participant-1",
    });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("does not hand the voice socket a ticket bound to another participant", async () => {
    beginCallAdmission(target);
    await takeRoomSocketTicket(target);
    const voice = await takeVoiceSocketTicket(target, "participant-0");
    expect(ticketOf(voice)).toBe("voice-2");
    expect(bodies[1]).toMatchObject({
      sockets: ["voice"],
      participantId: "participant-0",
    });
  });

  it("uses the hover prefetch for the join, once", async () => {
    prefetchVoiceChannelJoin({ serverId: "server", channelId: "channel" });
    prefetchVoiceChannelJoin({ serverId: "server", channelId: "channel" });
    expect(fetch).toHaveBeenCalledOnce();

    beginCallAdmission(target);
    const room = await takeRoomSocketTicket(target);
    const voice = await takeVoiceSocketTicket(target, null);
    expect(fetch).toHaveBeenCalledOnce();
    expect(room.mediaBootstrap?.participantId).toBe("participant-1");
    expect(ticketOf(voice)).toBe("voice-1");

    // Single use: the next join asks again.
    beginCallAdmission(target);
    const next = await takeRoomSocketTicket(target);
    expect(next.mediaBootstrap?.participantId).toBe("participant-2");
  });

  it("drops a prefetch older than the prefetch window", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    prefetchVoiceAdmission(target);
    vi.setSystemTime(Date.now() + PREFETCH_MAX_AGE_MS);

    beginCallAdmission(target);
    const room = await takeRoomSocketTicket(target);
    expect(room.mediaBootstrap?.participantId).toBe("participant-2");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("falls back to one fresh join request when the prefetch failed", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 503 }));
    prefetchVoiceAdmission(target);
    beginCallAdmission(target);
    const [room, voice] = await Promise.all([
      takeRoomSocketTicket(target),
      takeVoiceSocketTicket(target, null),
    ]);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(room.mediaBootstrap?.participantId).toBe("participant-1");
    expect(ticketOf(voice)).toBe("voice-1");
  });

  it("does not repeat a failed prefetch until it ages out", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 429 }));
    prefetchVoiceAdmission(target);
    await Promise.resolve();
    prefetchVoiceAdmission(target);
    prefetchVoiceAdmission(target);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("keeps prefetches per room", async () => {
    prefetchVoiceAdmission(target);
    const other = { ...target, roomSlug: "voice-server-other" };
    beginCallAdmission(other);
    await takeRoomSocketTicket(other);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("carries a move grant on the join's own request, never on a prefetch", async () => {
    rememberVoiceMoveGrant("channel", "vm1.grant.sig", Date.now() + 60_000);
    prefetchVoiceAdmission(target);
    expect(bodies[0].moveGrant).toBeUndefined();

    clearVoiceAdmissionsForTests();
    beginCallAdmission(target);
    await Promise.all([
      takeRoomSocketTicket(target),
      takeVoiceSocketTicket(target, null),
    ]);
    expect(bodies[1]).toMatchObject({
      sockets: ["room", "voice"],
      moveGrant: "vm1.grant.sig",
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("retries a failed join admission per socket", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 503 }));
    beginCallAdmission(target);
    await expect(takeRoomSocketTicket(target)).rejects.toMatchObject({
      status: 503,
    });
    await expect(takeVoiceSocketTicket(target, null)).rejects.toMatchObject({
      status: 503,
    });
    expect(fetch).toHaveBeenCalledOnce();

    // (The refused request never reached respond(), so this is room-1.)
    const room = await takeRoomSocketTicket(target);
    expect(ticketOf(room.protocols)).toBe("room-1");
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(bodies).toEqual([
      expect.objectContaining({ sockets: ["room"], media: false }),
    ]);
  });
});
