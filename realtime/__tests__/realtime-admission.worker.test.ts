import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import {
  appendRealtimeAdmissionHeaders,
  createRealtimeAdmissionContext,
  type RealtimeAdmissionContext,
} from "../realtime-admission";

type Audience = "room" | "voice";

async function admission(
  audience: Audience,
  roomSlug: string,
  expiresAt = Date.now() + 60_000,
): Promise<RealtimeAdmissionContext> {
  return createRealtimeAdmissionContext({
    accessMode: "authenticated",
    audience,
    expiresAt,
    nonce: crypto.randomUUID(),
    roomSlug,
    subject: "user-test",
  });
}

/** The upgrade the worker forwards to the object that accepts the socket. */
function upgrade(audience: Audience, context: RealtimeAdmissionContext) {
  const namespace = audience === "room" ? env.MEETING_ROOM : env.VOICE_ROOM;
  const path = audience === "room" ? "ws" : "voice";
  return namespace
    .get(namespace.idFromName(context.roomSlug))
    .fetch(`https://internal/api/channels/${context.roomSlug}/${path}?v=1`, {
      headers: appendRealtimeAdmissionHeaders(
        new Headers({ Upgrade: "websocket" }),
        context,
      ),
    });
}

function closeSockets(responses: Response[]) {
  for (const response of responses) {
    const socket = response.webSocket;
    if (!socket) continue;
    socket.accept();
    socket.close(1000, "test done");
  }
}

describe.each<Audience>(["room", "voice"])(
  "%s socket replay protection",
  (audience) => {
    it("accepts a ticket once when concurrent upgrades race with it", async () => {
      const context = await admission(audience, crypto.randomUUID());

      const responses = await Promise.all([
        upgrade(audience, context),
        upgrade(audience, context),
      ]);
      expect(responses.map((response) => response.status).sort()).toEqual([
        101, 401,
      ]);
      closeSockets(responses);
    });

    it("refuses a ticket that was already used", async () => {
      const context = await admission(audience, crypto.randomUUID());

      const first = await upgrade(audience, context);
      expect(first.status).toBe(101);
      const replay = await upgrade(audience, context);
      expect(replay.status).toBe(401);
      closeSockets([first, replay]);
    });

    it("refuses an expired ticket", async () => {
      const context = await admission(
        audience,
        crypto.randomUUID(),
        Date.now() - 1,
      );

      const response = await upgrade(audience, context);
      expect(response.status).toBe(401);
    });
  },
);

describe("ticket audiences", () => {
  it("keeps a room ticket and a voice ticket for the same room independent", async () => {
    const roomSlug = crypto.randomUUID();
    const room = await upgrade("room", await admission("room", roomSlug));
    const voice = await upgrade("voice", await admission("voice", roomSlug));
    expect([room.status, voice.status]).toEqual([101, 101]);
    closeSockets([room, voice]);
  });

  it("does not let a room ticket open a voice socket", async () => {
    // The upgrade goes to the voice room, but the ticket names the room socket.
    const response = await upgrade(
      "voice",
      await admission("room", crypto.randomUUID()),
    );
    expect(response.status).toBe(401);
  });
});
