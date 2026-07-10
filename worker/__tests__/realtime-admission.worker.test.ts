import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import {
  appendRealtimeAdmissionHeaders,
  createRealtimeAdmissionContext,
} from "../realtime-admission";

describe("realtime admission replay protection", () => {
  it("atomically consumes a nonce once when concurrent requests race", async () => {
    const roomSlug = crypto.randomUUID();
    const context = await createRealtimeAdmissionContext({
      accessMode: "authenticated",
      audience: "voice",
      expiresAt: Date.now() + 60_000,
      nonce: crypto.randomUUID(),
      roomSlug,
      subject: "user-test",
    });
    const room = env.MEETING_ROOM.get(env.MEETING_ROOM.idFromName(roomSlug));
    const createRequest = () => room.fetch("https://internal/consume-realtime-admission", {
      method: "POST",
      headers: appendRealtimeAdmissionHeaders(new Headers(), context),
    });

    const responses = await Promise.all([createRequest(), createRequest()]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 401]);
  });

  it("rejects an expired admission before consuming its nonce", async () => {
    const roomSlug = crypto.randomUUID();
    const context = await createRealtimeAdmissionContext({
      accessMode: "authenticated",
      audience: "room",
      expiresAt: Date.now() - 1,
      nonce: crypto.randomUUID(),
      roomSlug,
      subject: "user-test",
    });
    const room = env.MEETING_ROOM.get(env.MEETING_ROOM.idFromName(roomSlug));
    const response = await room.fetch("https://internal/consume-realtime-admission", {
      method: "POST",
      headers: appendRealtimeAdmissionHeaders(new Headers(), context),
    });

    expect(response.status).toBe(401);
  });
});
