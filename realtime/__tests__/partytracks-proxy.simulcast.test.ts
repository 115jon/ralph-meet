import { describe, expect, it, vi } from "vitest";
import { issueVoiceToken } from "../voice-token";
import {
  handlePartyTracksProxyRequest,
  issuePartyTracksSessionCapability,
  remotePullsWithoutLayer,
  withSimulcastFallback,
  type PartyTracksProxyEnv,
  type PartyTracksRouter,
} from "../partytracks-proxy";

const env: PartyTracksProxyEnv = {
  CALLS_APP_ID: "cloudflare-app",
  CALLS_APP_SECRET: "cloudflare-secret",
};

const joined = { authorizeRemotePull: async () => true };

async function capability(participantId: string, sessionId: string) {
  return issuePartyTracksSessionCapability(
    { roomSlug: "room-one", participantId, sessionId },
    env.CALLS_APP_SECRET,
  );
}

async function viewerRequest(path: string, method: string, body: unknown) {
  const voiceToken = await issueVoiceToken({
    participantId: "viewer",
    roomSlug: "room-one",
    subject: "user-viewer",
    secret: env.CALLS_APP_SECRET,
  });
  const viewerSession = await capability("viewer", "cloudflare-viewer");
  return new Request(
    `https://meet.test/api/channels/room-one/partytracks/sessions/${encodeURIComponent(viewerSession)}${path}`,
    {
      method,
      headers: {
        Authorization: `Bearer ${voiceToken}`,
        "X-Voice-Session-Id": "viewer",
      },
      body: JSON.stringify(body),
    },
  );
}

describe("PartyTracks proxy simulcast fallback", () => {
  it("asks the SFU to fall back between layers on a layer switch (tracks/update)", async () => {
    const routed: unknown[] = [];
    const route = vi.fn<PartyTracksRouter>(async ({ request }) => {
      const body = await request.json();
      routed.push(body);
      return Response.json(body);
    });
    const publisher = await capability("publisher", "cloudflare-publisher");

    const response = await handlePartyTracksProxyRequest(
      await viewerRequest("/tracks/update", "PUT", {
        tracks: [
          {
            location: "remote",
            sessionId: publisher,
            trackName: "sfu-camera",
            mid: "3",
            simulcast: { preferredRid: "h" },
          },
        ],
      }),
      env,
      route,
      joined,
    );

    expect(response?.status).toBe(200);
    expect(routed).toEqual([
      {
        tracks: [
          {
            location: "remote",
            sessionId: "cloudflare-publisher",
            trackName: "sfu-camera",
            mid: "3",
            simulcast: {
              preferredRid: "h",
              priorityOrdering: "asciibetical",
              ridNotAvailable: "asciibetical",
            },
          },
        ],
      },
    ]);
    expect(new URL(route.mock.calls[0]![0].request.url).pathname).toBe(
      "/api/channels/room-one/partytracks/sessions/cloudflare-viewer/tracks/update",
    );
  });

  it("leaves pulls without a layer alone (single-layer tracks, audio)", async () => {
    const routed: unknown[] = [];
    const route = vi.fn<PartyTracksRouter>(async ({ request }) => {
      routed.push(await request.json());
      return Response.json({});
    });
    const publisher = await capability("publisher", "cloudflare-publisher");

    await handlePartyTracksProxyRequest(
      await viewerRequest("/tracks/new", "POST", {
        tracks: [
          { location: "remote", sessionId: publisher, trackName: "mic" },
        ],
      }),
      env,
      route,
      joined,
    );

    expect(routed).toEqual([
      {
        tracks: [
          {
            location: "remote",
            sessionId: "cloudflare-publisher",
            trackName: "mic",
          },
        ],
      },
    ]);
  });
});

describe("PartyTracks proxy pulls from clients older than simulcast", () => {
  it("pulls a simulcast camera at its top layer, falling back down", async () => {
    const routed: unknown[] = [];
    const route = vi.fn<PartyTracksRouter>(async ({ request }) => {
      routed.push(await request.json());
      return Response.json({});
    });
    const publisher = await capability("publisher", "cloudflare-publisher");
    const authorizeRemotePull = vi.fn(async () => ({
      authorized: true,
      simulcast: [
        {
          sessionId: publisher,
          trackName: "sfu-camera",
          rids: ["f", "h", "q"],
        },
      ],
    }));

    const response = await handlePartyTracksProxyRequest(
      await viewerRequest("/tracks/new", "POST", {
        tracks: [
          { location: "remote", sessionId: publisher, trackName: "sfu-camera" },
          { location: "remote", sessionId: publisher, trackName: "sfu-mic" },
        ],
      }),
      env,
      route,
      { authorizeRemotePull },
    );

    expect(response?.status).toBe(200);
    // The VoiceRoom is asked by the capability the publisher announced.
    expect(authorizeRemotePull).toHaveBeenCalledWith(
      expect.objectContaining({
        participantId: "viewer",
        tracks: [
          { sessionId: publisher, trackName: "sfu-camera" },
          { sessionId: publisher, trackName: "sfu-mic" },
        ],
      }),
      env,
    );
    expect(routed).toEqual([
      {
        tracks: [
          {
            location: "remote",
            sessionId: "cloudflare-publisher",
            trackName: "sfu-camera",
            simulcast: {
              preferredRid: "f",
              priorityOrdering: "asciibetical",
              ridNotAvailable: "asciibetical",
            },
          },
          {
            location: "remote",
            sessionId: "cloudflare-publisher",
            trackName: "sfu-mic",
          },
        ],
      },
    ]);
  });

  it("asks nothing for pulls that name a layer, and keeps their choice", async () => {
    const routed: unknown[] = [];
    const route = vi.fn<PartyTracksRouter>(async ({ request }) => {
      routed.push(await request.json());
      return Response.json({});
    });
    const publisher = await capability("publisher", "cloudflare-publisher");
    const authorizeRemotePull = vi.fn(async () => true);

    await handlePartyTracksProxyRequest(
      await viewerRequest("/tracks/new", "POST", {
        tracks: [
          {
            location: "remote",
            sessionId: publisher,
            trackName: "sfu-camera",
            simulcast: { preferredRid: "q" },
          },
        ],
      }),
      env,
      route,
      { authorizeRemotePull },
    );

    expect(authorizeRemotePull).toHaveBeenCalledWith(
      expect.not.objectContaining({ tracks: expect.anything() }),
      env,
    );
    expect(routed).toEqual([
      {
        tracks: [
          {
            location: "remote",
            sessionId: "cloudflare-publisher",
            trackName: "sfu-camera",
            simulcast: {
              preferredRid: "q",
              priorityOrdering: "asciibetical",
              ridNotAvailable: "asciibetical",
            },
          },
        ],
      },
    ]);
  });

  it("finds legacy pulls only among remote tracks", () => {
    expect(
      remotePullsWithoutLayer({
        tracks: [
          { location: "local", trackName: "mine", mid: "0" },
          { location: "remote", sessionId: "s", trackName: "a" },
          {
            location: "remote",
            sessionId: "s",
            trackName: "b",
            simulcast: { preferredRid: "h" },
          },
          null,
        ],
      }),
    ).toEqual([{ index: 1, ref: { sessionId: "s", trackName: "a" } }]);
    expect(remotePullsWithoutLayer({ sessionDescription: {} })).toEqual([]);
  });
});

describe("withSimulcastFallback", () => {
  it("keeps a policy the client set", () => {
    expect(
      withSimulcastFallback({
        tracks: [
          {
            trackName: "camera",
            simulcast: { preferredRid: "f", ridNotAvailable: "none" },
          },
        ],
      }),
    ).toEqual({
      tracks: [
        {
          trackName: "camera",
          simulcast: {
            preferredRid: "f",
            priorityOrdering: "asciibetical",
            ridNotAvailable: "none",
          },
        },
      ],
    });
  });

  it("passes through bodies it does not recognize", () => {
    const sdp = { sessionDescription: { type: "offer", sdp: "v=0" } };
    expect(withSimulcastFallback(sdp)).toBe(sdp);
    expect(withSimulcastFallback(null)).toBeNull();
    expect(withSimulcastFallback([1])).toEqual([1]);
    expect(
      withSimulcastFallback({ tracks: [null, { simulcast: {} }] }),
    ).toEqual({ tracks: [null, { simulcast: {} }] });
  });
});
