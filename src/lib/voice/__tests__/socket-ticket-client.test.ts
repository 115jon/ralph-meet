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
vi.mock("@/lib/voice/socket-ticket", () => ({
  buildSocketTicketProtocols: () => ["ralph.realtime.v1"],
}));

import {
  clearPrefetchedSocketTicketsForTests,
  fetchSocketTicketBundle,
  PREFETCH_MAX_AGE_MS,
  prefetchSocketTickets,
} from "../socket-ticket-client";

describe("fetchSocketTicketBundle", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          ticket: "ticket",
          media_bootstrap: {
            participant_id: "participant-1",
            voice_token: "voice-token",
            ice_servers: [
              {
                urls: ["turn:example.test:3478?transport=udp"],
                username: "turn-user",
                credential: "turn-secret",
              },
            ],
          },
        }),
      ),
    );
  });

  it("keeps ticket ICE servers on the media bootstrap", async () => {
    await expect(
      fetchSocketTicketBundle({
        audience: "room",
        roomSlug: "voice-room",
      }),
    ).resolves.toMatchObject({
      mediaBootstrap: {
        participantId: "participant-1",
        voiceToken: "voice-token",
        iceServers: [
          {
            urls: ["turn:example.test:3478?transport=udp"],
            username: "turn-user",
            credential: "turn-secret",
          },
        ],
      },
    });
  });
});

describe("prefetchSocketTickets", () => {
  const room = {
    audience: "room" as const,
    channelId: "channel",
    roomSlug: "voice-server-channel",
    serverId: "server",
  };
  let issued = 0;

  beforeEach(() => {
    clearPrefetchedSocketTicketsForTests();
    issued = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        issued += 1;
        return Response.json({
          ticket: `ticket-${issued}`,
          media_bootstrap: {
            participant_id: `participant-${issued}`,
            voice_token: "voice-token",
          },
        });
      }),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("hands a prefetched ticket to the join exactly once", async () => {
    prefetchSocketTickets([room]);
    prefetchSocketTickets([room]);
    expect(fetch).toHaveBeenCalledOnce();

    const first = await fetchSocketTicketBundle(room);
    expect(first.mediaBootstrap?.participantId).toBe("participant-1");
    expect(fetch).toHaveBeenCalledOnce();

    // Single use: the next join asks for a fresh ticket.
    const second = await fetchSocketTicketBundle(room);
    expect(second.mediaBootstrap?.participantId).toBe("participant-2");
  });

  it("does not hand out a ticket older than the prefetch window", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    prefetchSocketTickets([room]);
    vi.setSystemTime(Date.now() + PREFETCH_MAX_AGE_MS);

    const bundle = await fetchSocketTicketBundle(room);
    expect(bundle.mediaBootstrap?.participantId).toBe("participant-2");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("keeps prefetches per audience and room", async () => {
    prefetchSocketTickets([room, { ...room, audience: "voice" }]);
    expect(fetch).toHaveBeenCalledTimes(2);
    await fetchSocketTicketBundle({ ...room, roomSlug: "other-room" });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("falls back to a fresh request when the prefetch failed", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 503 }));
    prefetchSocketTickets([room]);
    const bundle = await fetchSocketTicketBundle(room);
    expect(bundle.mediaBootstrap?.participantId).toBe("participant-1");
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
