import { describe, expect, it, vi } from "vitest";
import { issueVoiceToken } from "../voice-token";
import {
  handlePartyTracksProxyRequest,
  type PartyTracksProxyEnv,
  type PartyTracksRouter,
} from "../partytracks-proxy";

const env: PartyTracksProxyEnv = {
  CALLS_APP_ID: "cloudflare-app",
  CALLS_APP_SECRET: "cloudflare-secret",
  CALLS_API_URL: "https://rtc.example.test/v1",
};

const capturedFirefoxTracksNewBody = JSON.stringify({
  sessionDescription: {
    sdp: "v=0\r\no=mozilla...THIS_IS_SDPARTA-99.0 6055631488482179519 0 IN IP4 0.0.0.0\r\ns=-\r\nt=0 0\r\na=fingerprint:sha-256 6A:30:97:25:47:37:34:94:EE:E2:68:20:3D:71:D4:BD:ED:F6:8C:98:B8:5E:97:25:E9:5F:71:8B:A8:C2:83:61\r\na=group:BUNDLE 0\r\na=ice-options:trickle\r\na=msid-semantic:WMS *\r\nm=audio 9 UDP/TLS/RTP/SAVPF 109 9 0 8 101\r\nc=IN IP4 0.0.0.0\r\na=sendonly\r\na=extmap:1 urn:ietf:params:rtp-hdrext:ssrc-audio-level\r\na=extmap:2/recvonly urn:ietf:params:rtp-hdrext:csrc-audio-level\r\na=extmap:3 urn:ietf:params:rtp-hdrext:sdes:mid\r\na=extmap:7 http://www.ietf.org/id/draft-holmer-rmcat-transport-wide-cc-extensions-01\r\na=extmap-allow-mixed\r\na=fmtp:109 maxplaybackrate=48000;stereo=1;useinbandfec=1\r\na=fmtp:101 0-15\r\na=ice-pwd:749d1c2c143bfd8c1d3461d64cf748f1\r\na=ice-ufrag:ad757d3f\r\na=mid:0\r\na=msid:- {9c63f4da-8a78-4dd2-8da8-7e7c86efd26f}\r\na=rtcp-fb:109 transport-cc\r\na=rtcp-fb:9 transport-cc\r\na=rtcp-fb:0 transport-cc\r\na=rtcp-fb:8 transport-cc\r\na=rtcp-mux\r\na=rtpmap:109 opus/48000/2\r\na=rtpmap:9 G722/8000/1\r\na=rtpmap:0 PCMU/8000\r\na=rtpmap:8 PCMA/8000\r\na=rtpmap:101 telephone-event/8000/1\r\na=setup:actpass\r\na=ssrc:674030699 cname:{b3b118fe-5576-4228-9676-db509529546d}\r\n",
    type: "offer",
  },
  tracks: [
    {
      trackName: "19b5d9b1-f5d9-4bec-8611-51273bbdec5a",
      mid: "0",
      location: "local",
    },
  ],
});

async function token(participantId: string, roomSlug: string) {
  return issueVoiceToken({
    participantId,
    roomSlug,
    subject: `user-${participantId}`,
    secret: env.CALLS_APP_SECRET,
  });
}

function request(
  roomSlug: string,
  endpoint: string,
  participantId?: string,
  voiceToken?: string,
  init: RequestInit = {},
) {
  const headers = new Headers(init.headers);
  if (participantId) headers.set("X-Voice-Session-Id", participantId);
  if (voiceToken) headers.set("Authorization", `Bearer ${voiceToken}`);
  return new Request(
    `https://meet.test/api/channels/${encodeURIComponent(roomSlug)}/partytracks${endpoint}`,
    { ...init, headers },
  );
}

describe("PartyTracks proxy", () => {
  it("rejects requests without a valid room-bound voice identity", async () => {
    const route = vi.fn<PartyTracksRouter>();

    const missing = await handlePartyTracksProxyRequest(
      request("room-one", "/sessions/new"),
      env,
      route,
    );
    const wrongRoom = await handlePartyTracksProxyRequest(
      request(
        "room-two",
        "/sessions/new",
        "participant-one",
        await token("participant-one", "room-one"),
      ),
      env,
      route,
    );

    expect(missing?.status).toBe(401);
    expect(wrongRoom?.status).toBe(401);
    expect(route).not.toHaveBeenCalled();
  });

  it("hides the Cloudflare session id behind a participant-bound capability", async () => {
    const route = vi.fn<PartyTracksRouter>(async ({ request: routed }) => {
      expect(routed.headers.has("Authorization")).toBe(false);
      expect(routed.headers.has("X-Voice-Session-Id")).toBe(false);
      return Response.json({ sessionId: "cloudflare-session-one" });
    });
    const response = await handlePartyTracksProxyRequest(
      request(
        "room-one",
        "/sessions/new",
        "participant-one",
        await token("participant-one", "room-one"),
        { method: "POST" },
      ),
      env,
      route,
    );
    const payload = (await response?.json()) as { sessionId: string };

    expect(response?.status).toBe(200);
    expect(payload.sessionId).not.toContain("cloudflare-session-one");
    expect(route).toHaveBeenCalledWith(
      expect.objectContaining({
        appId: "cloudflare-app",
        token: "cloudflare-secret",
        realtimeApiBaseUrl: "https://rtc.example.test/v1",
        lockSessionToInitiator: false,
      }),
    );
  });

  it("normalizes successfully decoded PartyTracks JSON bodies before routing repeated track requests", async () => {
    const issuedSessions = [
      "cloudflare-publisher-session",
      "cloudflare-subscriber-session",
    ];
    const routedTrackRequests: Array<{
      contentType: string | null;
      pathname: string;
      sessionId: string | undefined;
    }> = [];
    const route = vi.fn<PartyTracksRouter>(async ({ request: routed }) => {
      const pathname = new URL(routed.url).pathname;
      if (pathname.endsWith("/sessions/new")) {
        const sessionId = issuedSessions.shift();
        if (!sessionId) throw new Error("No test session available");
        return Response.json({ sessionId }, { status: 201 });
      }

      const body = (await routed.json()) as {
        tracks: Array<{ sessionId?: string }>;
      };
      routedTrackRequests.push({
        contentType: routed.headers.get("Content-Type"),
        pathname,
        sessionId: body.tracks[0]?.sessionId,
      });
      return Response.json({ tracks: body.tracks });
    });
    const createSession = async (participantId: string) => {
      const response = await handlePartyTracksProxyRequest(
        request(
          "room-one",
          "/sessions/new",
          participantId,
          await token(participantId, "room-one"),
          { method: "POST" },
        ),
        env,
        route,
      );
      return (await response?.json()) as { sessionId: string };
    };
    const publisher = await createSession("publisher");
    const subscriber = await createSession("subscriber");
    const pullBody = JSON.stringify({
      tracks: [
        {
          location: "remote",
          sessionId: publisher.sessionId,
          trackName: "party-track",
        },
      ],
    });

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await handlePartyTracksProxyRequest(
        request(
          "room-one",
          `/sessions/${subscriber.sessionId}/tracks/new`,
          "subscriber",
          await token("subscriber", "room-one"),
          {
            method: "POST",
            headers: {
              "Content-Type": "text/plain;charset=UTF-8",
            },
            body: pullBody,
          },
        ),
        env,
        route,
      );
      expect(response?.status).toBe(200);
    }

    expect(routedTrackRequests).toEqual([
      {
        contentType: "application/json",
        pathname: expect.stringContaining(
          "/sessions/cloudflare-subscriber-session/tracks/new",
        ),
        sessionId: "cloudflare-publisher-session",
      },
      {
        contentType: "application/json",
        pathname: expect.stringContaining(
          "/sessions/cloudflare-subscriber-session/tracks/new",
        ),
        sessionId: "cloudflare-publisher-session",
      },
    ]);
  });

  it("forwards a captured tracks/new body through the installed PartyTracks router", async () => {
    const forwardedRequests: Array<{
      body: string | undefined;
      contentLength: string | null;
      contentType: string | null;
      url: string;
    }> = [];
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input, init) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        if (url.endsWith("/sessions/new")) {
          return Response.json(
            { sessionId: "cloudflare-captured-session" },
            { status: 201 },
          );
        }

        const headers = new Headers(init?.headers);
        const forwardedBody = init?.body
          ? await new Response(init.body).text()
          : undefined;
        forwardedRequests.push({
          body: forwardedBody,
          contentLength: headers.get("Content-Length"),
          contentType: headers.get("Content-Type"),
          url,
        });
        if (!forwardedBody) {
          return Response.json(
            {
              errorCode: "decoding_error",
              errorDescription: "Failed to decode body as JSON",
            },
            { status: 400 },
          );
        }
        return Response.json(
          {
            sessionDescription: { sdp: "answer", type: "answer" },
            tracks: [],
          },
          { status: 200 },
        );
      });

    try {
      const voiceToken = await token("captured-user", "room-one");
      const sessionResponse = await handlePartyTracksProxyRequest(
        request("room-one", "/sessions/new", "captured-user", voiceToken, {
          method: "POST",
        }),
        env,
      );
      const session = (await sessionResponse?.json()) as { sessionId: string };

      expect(
        new TextEncoder().encode(capturedFirefoxTracksNewBody),
      ).toHaveLength(1359);
      const response = await handlePartyTracksProxyRequest(
        request(
          "room-one",
          `/sessions/${session.sessionId}/tracks/new`,
          "captured-user",
          voiceToken,
          {
            method: "POST",
            headers: {
              "Content-Length": "1359",
              "Content-Type": "text/plain;charset=UTF-8",
            },
            body: capturedFirefoxTracksNewBody,
          },
        ),
        env,
      );

      expect(response?.status).toBe(200);
      expect(forwardedRequests).toEqual([
        {
          body: capturedFirefoxTracksNewBody,
          contentLength: "1359",
          contentType: "application/json",
          url: "https://rtc.example.test/v1/apps/cloudflare-app/sessions/cloudflare-captured-session/tracks/new",
        },
      ]);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("preserves the original content type when forwarding a non-JSON body", async () => {
    const routedBodies: Array<{
      body: string;
      contentType: string | null;
    }> = [];
    const route = vi.fn<PartyTracksRouter>(async ({ request: routed }) => {
      if (new URL(routed.url).pathname.endsWith("/sessions/new")) {
        return Response.json({ sessionId: "cloudflare-owner-session" });
      }

      routedBodies.push({
        body: await routed.text(),
        contentType: routed.headers.get("Content-Type"),
      });
      return new Response("ok");
    });
    const voiceToken = await token("owner", "room-one");
    const sessionResponse = await handlePartyTracksProxyRequest(
      request("room-one", "/sessions/new", "owner", voiceToken, {
        method: "POST",
      }),
      env,
      route,
    );
    const session = (await sessionResponse?.json()) as { sessionId: string };

    const response = await handlePartyTracksProxyRequest(
      request(
        "room-one",
        `/sessions/${session.sessionId}/renegotiate`,
        "owner",
        voiceToken,
        {
          method: "PUT",
          headers: { "Content-Type": "text/plain;charset=UTF-8" },
          body: "not-json",
        },
      ),
      env,
      route,
    );

    expect(response?.status).toBe(200);
    expect(routedBodies).toEqual([
      {
        body: "not-json",
        contentType: "text/plain;charset=UTF-8",
      },
    ]);
  });

  it("allows remote pulls but only lets a participant mutate its own session", async () => {
    const issuedSessions = [
      "cloudflare-publisher-session",
      "cloudflare-subscriber-session",
    ];
    const route = vi.fn<PartyTracksRouter>(async ({ request: routed }) => {
      const pathname = new URL(routed.url).pathname;
      if (pathname.endsWith("/sessions/new")) {
        const sessionId = issuedSessions.shift();
        if (!sessionId) throw new Error("No test session available");
        return Response.json({ sessionId });
      }

      expect(pathname).toContain("/sessions/cloudflare-subscriber-session/");
      const body = (await routed.json()) as {
        tracks: Array<{ sessionId: string }>;
      };
      expect(body.tracks[0]?.sessionId).toBe("cloudflare-publisher-session");
      return Response.json({ tracks: body.tracks });
    });

    const publisherResponse = await handlePartyTracksProxyRequest(
      request(
        "room-one",
        "/sessions/new",
        "publisher",
        await token("publisher", "room-one"),
        { method: "POST" },
      ),
      env,
      route,
    );
    const publisher = (await publisherResponse?.json()) as {
      sessionId: string;
    };
    const subscriberResponse = await handlePartyTracksProxyRequest(
      request(
        "room-one",
        "/sessions/new",
        "subscriber",
        await token("subscriber", "room-one"),
        { method: "POST" },
      ),
      env,
      route,
    );
    const subscriber = (await subscriberResponse?.json()) as {
      sessionId: string;
    };

    const pullResponse = await handlePartyTracksProxyRequest(
      request(
        "room-one",
        `/sessions/${subscriber.sessionId}/tracks/new`,
        "subscriber",
        await token("subscriber", "room-one"),
        {
          method: "POST",
          body: JSON.stringify({
            tracks: [
              {
                location: "remote",
                sessionId: publisher.sessionId,
                trackName: "party-track",
              },
            ],
          }),
        },
      ),
      env,
      route,
    );
    const pullPayload = (await pullResponse?.json()) as {
      tracks: Array<{ sessionId: string }>;
    };

    expect(pullResponse?.status).toBe(200);
    expect(pullPayload.tracks[0]?.sessionId).toBe(publisher.sessionId);

    const stolen = await handlePartyTracksProxyRequest(
      request(
        "room-one",
        `/sessions/${publisher.sessionId}/tracks/close`,
        "subscriber",
        await token("subscriber", "room-one"),
        { method: "PUT", body: "{}" },
      ),
      env,
      route,
    );
    expect(stolen?.status).toBe(403);
  });
});
