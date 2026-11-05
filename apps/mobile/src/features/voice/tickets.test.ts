import { Schema } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Body = {
  sockets: string[];
  media: boolean;
  participantId?: string;
};

const bodies: Body[] = [];
let issued = 0;

vi.mock("@/lib/api", () => ({
  apiJson: vi.fn(
    async (
      path: string,
      schema: Schema.ConstraintDecoder<unknown>,
      init: RequestInit,
    ) => {
      expect(path).toBe("/api/voice/admission");
      const body = JSON.parse(String(init.body)) as Body;
      bodies.push(body);
      issued += 1;
      const participant =
        body.media && body.sockets.includes("room")
          ? `participant-${issued}`
          : body.participantId;
      return Schema.decodeUnknownSync(schema)({
        ...(participant ? { participant_id: participant } : {}),
        ...(body.sockets.includes("room")
          ? { room_ticket: `room-${issued}` }
          : {}),
        ...(body.sockets.includes("voice")
          ? { voice_ticket: `voice-${issued}` }
          : {}),
        ...(body.media
          ? {
              media: {
                participant_id: participant,
                voice_token: `token-${issued}`,
                ice_servers: [{ urls: ["turn:example.test:3478"] }],
              },
            }
          : {}),
      });
    },
  ),
}));
vi.mock("@/features/realtime/ticket", () => ({
  socketUrl: (path: string) => `wss://meet.test${path}`,
  ticketProtocols: (ticket: string) => ["ralph.realtime.v1", ticket],
}));

import {
  acquireRoomTicket,
  acquireVoiceTicket,
  beginCallAdmission,
  clearCallAdmissionsForTests,
} from "./tickets";

const target = { serverId: "s", channelId: "c", roomSlug: "voice-s-c" };

describe("call admission", () => {
  beforeEach(() => {
    clearCallAdmissionsForTests();
    bodies.length = 0;
    issued = 0;
  });

  it("opens both sockets of a join with one request", async () => {
    beginCallAdmission(target);
    const [room, voice] = await Promise.all([
      acquireRoomTicket(target),
      acquireVoiceTicket(target, null),
    ]);

    expect(bodies).toEqual([
      {
        channelId: "c",
        serverId: "s",
        roomSlug: "voice-s-c",
        sockets: ["room", "voice"],
        media: true,
      },
    ]);
    expect(room.protocols[1]).toBe("room-1");
    expect(room.mediaBootstrap).toMatchObject({
      participantId: "participant-1",
      voiceToken: "token-1",
    });
    expect(voice.protocols[1]).toBe("voice-1");
  });

  it("asks for only the reconnecting socket, minting nothing", async () => {
    beginCallAdmission(target);
    await Promise.all([
      acquireRoomTicket(target),
      acquireVoiceTicket(target, null),
    ]);

    const room = await acquireRoomTicket(target);
    expect(room.mediaBootstrap).toBeUndefined();
    const voice = await acquireVoiceTicket(target, "participant-1");
    expect(voice.protocols[1]).toBe("voice-3");
    expect(bodies.slice(1)).toEqual([
      expect.objectContaining({ sockets: ["room"], media: false }),
      expect.objectContaining({
        sockets: ["voice"],
        media: false,
        participantId: "participant-1",
      }),
    ]);
  });
});
