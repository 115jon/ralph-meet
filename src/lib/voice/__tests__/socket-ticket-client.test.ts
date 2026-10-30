import { beforeEach, describe, expect, it, vi } from "vitest";

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

import { fetchSocketTicketBundle } from "../socket-ticket-client";

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
