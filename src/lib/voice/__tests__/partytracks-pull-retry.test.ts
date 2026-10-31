import { PartyTracks } from "partytracks/client";
import { of, type Subscription } from "rxjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Drives the real (patched) PartyTracks pull path. A batched pull whose
// tracks/new request fails must error the pull so PartyTracks' own
// retryWithBackoff tries again; unpatched, the failure was swallowed and the
// pull waited forever.

class FakePeerConnection extends EventTarget {
  static instances: FakePeerConnection[] = [];
  connectionState: RTCPeerConnectionState = "new";
  iceConnectionState: RTCIceConnectionState = "new";
  signalingState: RTCSignalingState = "stable";
  readonly transceivers: Array<{
    mid: string;
    receiver: { track: MediaStreamTrack };
  }> = [];

  constructor() {
    super();
    FakePeerConnection.instances.push(this);
  }

  getTransceivers() {
    return this.transceivers;
  }

  close() {
    this.connectionState = "closed";
  }
}

/** The parts of the Realtime API bodies this test sends. */
interface ApiBody {
  sessionId?: string;
  tracks?: Array<{ trackName: string; sessionId: string; mid: string }>;
  requiresImmediateRenegotiation?: boolean;
  errorCode?: string;
  errorDescription?: string;
  error?: string;
}

interface FakeResponse {
  status: number;
  clone(): FakeResponse;
  json(): Promise<ApiBody>;
}

function jsonResponse(body: ApiBody, status = 200): FakeResponse {
  const response: FakeResponse = {
    status,
    clone: () => response,
    json: async () => body,
  };
  return response;
}

const PULLED_TRACKS: ApiBody = {
  tracks: [{ trackName: "t", sessionId: "J", mid: "1" }],
  requiresImmediateRenegotiation: false,
};

function stubFetch(firstPullResponse: FakeResponse) {
  let pulls = 0;
  const fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/sessions/new")) {
      return jsonResponse({ sessionId: "L" });
    }
    if (url.includes("/sessions/L/tracks/new")) {
      pulls += 1;
      return pulls === 1 ? firstPullResponse : jsonResponse(PULLED_TRACKS);
    }
    throw new Error(`Unexpected PartyTracks request: ${url}`);
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

/** Runs due timers and the promise chains they start, at the current time. */
async function settle() {
  for (let i = 0; i < 5; i++) await vi.advanceTimersByTimeAsync(0);
}

function pullRequests(fetch: ReturnType<typeof stubFetch>): number {
  return fetch.mock.calls.filter(([input]) =>
    String(input).includes("/sessions/L/tracks/new"),
  ).length;
}

describe("patched PartyTracks bulk pull", () => {
  let subscription: Subscription | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    FakePeerConnection.instances = [];
    vi.stubGlobal("RTCPeerConnection", FakePeerConnection);
  });

  afterEach(() => {
    subscription?.unsubscribe();
    subscription = undefined;
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it.each([
    [
      "a top-level errorCode",
      jsonResponse({
        errorCode: "not_found_track_error",
        errorDescription: "x",
      }),
    ],
    ["a body without tracks", jsonResponse({ error: "Forbidden" }, 403)],
  ])("retries a pull whose tracks/new returns %s", async (_case, failure) => {
    const fetch = stubFetch(failure);
    const partyTracks = new PartyTracks({
      prefix: "/partytracks",
      iceServers: [{ urls: "stun:stun.example.test" }],
    });
    const received: MediaStreamTrack[] = [];

    subscription = partyTracks
      .pull(of({ location: "remote", trackName: "t", sessionId: "J" }))
      .subscribe((track) => received.push(track));

    // Session, batch and the failed tracks/new request.
    await vi.advanceTimersByTimeAsync(0);
    expect(pullRequests(fetch)).toBe(1);

    // retryWithBackoff({ initialDelay: 100 }) from the Ralph patch.
    for (let i = 0; i < 20; i++) {
      await vi.advanceTimersByTimeAsync(50);
      console.log("DBG", i, pullRequests(fetch), vi.getTimerCount());
    }
    expect(pullRequests(fetch)).toBe(2);

    const peerConnection = FakePeerConnection.instances[0];
    expect(peerConnection).toBeDefined();
    const remoteTrack = { id: "remote-t", kind: "audio" } as MediaStreamTrack;
    peerConnection.transceivers.push({
      mid: "1",
      receiver: { track: remoteTrack },
    });
    peerConnection.dispatchEvent(new Event("track"));
    await settle();

    expect(received).toEqual([remoteTrack]);
    expect(pullRequests(fetch)).toBe(2);
  });
});
