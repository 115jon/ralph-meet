import { PartyTracks, type TrackMetadata } from "partytracks/client";
import { of, Subscription } from "rxjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  observePullErrors,
  type PartyTracksPullError,
} from "../partytracks-pull-errors";

// Drives the real (patched) PartyTracks pull path. A batched pull whose
// tracks/new request fails must error the pull so PartyTracks' own
// retryWithBackoff tries again; unpatched, the failure was swallowed and the
// pull waited forever.

interface FakeDescription {
  type: string;
  sdp: string;
}

class FakeSessionDescription {
  readonly type: string;
  readonly sdp: string;

  constructor(init: FakeDescription) {
    this.type = init.type;
    this.sdp = init.sdp;
  }
}

const SFU_ANSWER: FakeDescription = { type: "answer", sdp: "sfu-answer" };
const SFU_OFFER: FakeDescription = { type: "offer", sdp: "sfu-offer" };

/** State the next fake peer connection starts in. */
interface PeerConnectionStart {
  connectionState: RTCPeerConnectionState;
  remoteDescription: FakeDescription | null;
}

class FakePeerConnection extends EventTarget {
  static instances: FakePeerConnection[] = [];
  static startAs: PeerConnectionStart = {
    connectionState: "new",
    remoteDescription: null,
  };

  connectionState: RTCPeerConnectionState;
  iceConnectionState: RTCIceConnectionState = "new";
  signalingState: RTCSignalingState = "stable";
  remoteDescription: FakeDescription | null;
  currentLocalDescription: FakeDescription | null = null;
  /** connectionstatechange listeners added and removed (the session adds one). */
  connectionListenersAdded = 0;
  connectionListenersRemoved = 0;
  readonly transceivers: Array<{
    mid: string;
    receiver: { track: MediaStreamTrack };
    stop(): void;
  }> = [];

  constructor() {
    super();
    this.connectionState = FakePeerConnection.startAs.connectionState;
    this.remoteDescription = FakePeerConnection.startAs.remoteDescription;
    FakePeerConnection.instances.push(this);
  }

  override addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: AddEventListenerOptions | boolean,
  ): void {
    if (type === "connectionstatechange") this.connectionListenersAdded += 1;
    super.addEventListener(type, listener, options);
  }

  override removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: EventListenerOptions | boolean,
  ): void {
    if (type === "connectionstatechange") this.connectionListenersRemoved += 1;
    super.removeEventListener(type, listener, options);
  }

  getTransceivers() {
    return this.transceivers;
  }

  addTransceiver() {
    return { mid: "0", sender: { transport: null } };
  }

  async createOffer(): Promise<FakeDescription> {
    return { type: "offer", sdp: "client-offer" };
  }

  async createAnswer(): Promise<FakeDescription> {
    return { type: "answer", sdp: "client-answer" };
  }

  async setLocalDescription(description: FakeDescription) {
    this.currentLocalDescription = description;
  }

  async setRemoteDescription(description: FakeDescription) {
    this.remoteDescription = description;
  }

  setConnectionState(state: RTCPeerConnectionState) {
    this.connectionState = state;
    this.dispatchEvent(new Event("connectionstatechange"));
  }

  /** Delivers the pulled track on `mid`, as ontrack would. */
  deliverTrack(mid: string, track: MediaStreamTrack) {
    this.transceivers.push({ mid, receiver: { track }, stop: () => {} });
    this.dispatchEvent(new Event("track"));
  }

  close() {
    this.connectionState = "closed";
  }
}

/** The parts of the Realtime API bodies this test sends. */
interface ApiBody {
  sessionId?: string;
  tracks?: Array<{
    trackName: string;
    sessionId: string;
    mid?: string;
    errorCode?: string;
    errorDescription?: string;
  }>;
  requiresImmediateRenegotiation?: boolean;
  sessionDescription?: FakeDescription;
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

/**
 * An SFU that answers pushes and asks every pull to renegotiate. Sessions are
 * S1, S2, ... in creation order; `calls` lists "<session> push|pull|renegotiate".
 */
function stubRenegotiatingSfu() {
  let sessions = 0;
  const calls: string[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/sessions/new")) {
      sessions += 1;
      return jsonResponse({ sessionId: `S${sessions}` });
    }
    const session = /\/sessions\/([^/]+)\//.exec(url)?.[1] ?? "?";
    if (url.includes("/tracks/new")) {
      if (String(init?.body).includes('"sessionDescription"')) {
        calls.push(`${session} push`);
        return jsonResponse({
          tracks: [{ trackName: "local", sessionId: session, mid: "0" }],
          sessionDescription: SFU_ANSWER,
        });
      }
      calls.push(`${session} pull`);
      return jsonResponse({
        tracks: [{ trackName: "t", sessionId: "J", mid: "1" }],
        requiresImmediateRenegotiation: true,
        sessionDescription: SFU_OFFER,
      });
    }
    if (url.includes("/renegotiate")) {
      calls.push(`${session} renegotiate`);
      return jsonResponse({});
    }
    if (url.includes("/tracks/close")) {
      return jsonResponse({ sessionDescription: SFU_ANSWER });
    }
    throw new Error(`Unexpected PartyTracks request: ${url}`);
  });
  vi.stubGlobal("fetch", fetch);
  return { fetch, calls };
}

function makePartyTracks() {
  return new PartyTracks({
    prefix: "/partytracks",
    iceServers: [{ urls: "stun:stun.example.test" }],
  });
}

const REMOTE_TRACK: TrackMetadata = {
  location: "remote",
  trackName: "t",
  sessionId: "J",
};

/** Runs due timers and the promise chains they start, at the current time. */
async function settle() {
  for (let i = 0; i < 5; i++) await vi.advanceTimersByTimeAsync(0);
}

function pullRequests(fetch: ReturnType<typeof stubFetch>): number {
  return fetch.mock.calls.filter(([input]) =>
    String(input).includes("/sessions/L/tracks/new"),
  ).length;
}

/** Pull waits started on this peer connection so far. */
function pullWaits(peerConnection: FakePeerConnection): number {
  // The session adds one listener of its own.
  return peerConnection.connectionListenersAdded - 1;
}

describe("patched PartyTracks bulk pull", () => {
  let subscription: Subscription | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    FakePeerConnection.instances = [];
    FakePeerConnection.startAs = {
      connectionState: "new",
      remoteDescription: null,
    };
    vi.stubGlobal("RTCPeerConnection", FakePeerConnection);
    vi.stubGlobal("RTCSessionDescription", FakeSessionDescription);
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
    const partyTracks = makePartyTracks();
    const received: MediaStreamTrack[] = [];

    subscription = partyTracks
      .pull(of(REMOTE_TRACK))
      .subscribe((track) => received.push(track));

    // Session, batch and the failed tracks/new request.
    await vi.advanceTimersByTimeAsync(0);
    expect(pullRequests(fetch)).toBe(1);

    // retryWithBackoff({ initialDelay: 100 }) from the Ralph patch.
    for (let i = 0; i < 20; i++) await vi.advanceTimersByTimeAsync(50);
    expect(pullRequests(fetch)).toBe(2);

    const peerConnection = FakePeerConnection.instances[0];
    expect(peerConnection).toBeDefined();
    const remoteTrack = { id: "remote-t", kind: "audio" } as MediaStreamTrack;
    peerConnection.transceivers.push({
      mid: "1",
      receiver: { track: remoteTrack },
      stop: () => {},
    });
    peerConnection.dispatchEvent(new Event("track"));
    await settle();

    expect(received).toEqual([remoteTrack]);
    expect(pullRequests(fetch)).toBe(2);
  });

  // A pull renegotiates. Landing before the publisher's peer connection first
  // connects (a pull queued behind the push that negotiated it) made the SFU
  // drop the pushed track for good, so the patch holds such pulls until
  // "connected".

  it("holds a pull on a negotiated peer connection until it connects", async () => {
    FakePeerConnection.startAs = {
      connectionState: "connecting",
      remoteDescription: SFU_ANSWER,
    };
    const sfu = stubRenegotiatingSfu();
    const received: MediaStreamTrack[] = [];

    subscription = makePartyTracks()
      .pull(of(REMOTE_TRACK))
      .subscribe((track) => received.push(track));
    await settle();

    expect(sfu.calls).toEqual([]);

    const peerConnection = FakePeerConnection.instances[0];
    peerConnection.setConnectionState("connected");
    await settle();

    expect(sfu.calls).toEqual(["S1 pull", "S1 renegotiate"]);
    expect(peerConnection.currentLocalDescription?.type).toBe("answer");

    const remoteTrack = { id: "remote-t", kind: "audio" } as MediaStreamTrack;
    peerConnection.deliverTrack("1", remoteTrack);
    await settle();

    expect(received).toEqual([remoteTrack]);
  });

  it("does not pull until the push that negotiated the connection connects", async () => {
    const sfu = stubRenegotiatingSfu();
    const partyTracks = makePartyTracks();
    const received: MediaStreamTrack[] = [];
    const micTrack = { id: "mic", kind: "audio" } as MediaStreamTrack;

    subscription = new Subscription();
    subscription.add(partyTracks.push(of(micTrack)).subscribe());
    subscription.add(
      partyTracks
        .pull(of(REMOTE_TRACK))
        .subscribe((track) => received.push(track)),
    );
    await settle();

    // The push answer is applied; ICE has not even started ("new").
    const peerConnection = FakePeerConnection.instances[0];
    expect(sfu.calls).toEqual(["S1 push"]);
    expect(peerConnection.remoteDescription?.sdp).toBe(SFU_ANSWER.sdp);

    peerConnection.setConnectionState("connecting");
    await settle();
    expect(sfu.calls).toEqual(["S1 push"]);

    peerConnection.setConnectionState("connected");
    await settle();
    expect(sfu.calls).toEqual(["S1 push", "S1 pull", "S1 renegotiate"]);

    const remoteTrack = { id: "remote-t", kind: "audio" } as MediaStreamTrack;
    peerConnection.deliverTrack("1", remoteTrack);
    await settle();
    expect(received).toEqual([remoteTrack]);
  });

  it("retries a pull whose peer connection does not connect in 5 s", async () => {
    FakePeerConnection.startAs = {
      connectionState: "connecting",
      remoteDescription: SFU_ANSWER,
    };
    const sfu = stubRenegotiatingSfu();
    const received: MediaStreamTrack[] = [];

    subscription = makePartyTracks()
      .pull(of(REMOTE_TRACK))
      .subscribe((track) => received.push(track));
    await settle();
    const peerConnection = FakePeerConnection.instances[0];
    expect(pullWaits(peerConnection)).toBe(1);

    // Times out at 5 s, retryWithBackoff waits 100 ms, the retry waits again.
    // (+10 ms: a 0 ms timer set from inside a fake timer is due 1 ms later.)
    await vi.advanceTimersByTimeAsync(5_000);
    await settle();
    await vi.advanceTimersByTimeAsync(110);
    await settle();
    expect(pullWaits(peerConnection)).toBe(2);

    // Second timeout, then a 200 ms backoff.
    await vi.advanceTimersByTimeAsync(5_000);
    await settle();
    await vi.advanceTimersByTimeAsync(210);
    await settle();
    expect(pullWaits(peerConnection)).toBe(3);
    expect(sfu.calls).toEqual([]);

    peerConnection.setConnectionState("connected");
    await settle();
    expect(sfu.calls).toEqual(["S1 pull", "S1 renegotiate"]);
    // Every wait removed its listener: timed out twice, resolved once.
    expect(peerConnection.connectionListenersRemoved).toBe(3);

    const remoteTrack = { id: "remote-t", kind: "audio" } as MediaStreamTrack;
    peerConnection.deliverTrack("1", remoteTrack);
    await settle();
    expect(received).toEqual([remoteTrack]);
  });

  it.each([
    [
      "connectionState failed",
      (peerConnection: FakePeerConnection) =>
        peerConnection.setConnectionState("failed"),
    ],
    [
      // The session closes the peer connection from this event, and a closed
      // RTCPeerConnection fires no connectionstatechange.
      "iceConnectionState failed",
      (peerConnection: FakePeerConnection) => {
        peerConnection.iceConnectionState = "failed";
        peerConnection.dispatchEvent(new Event("iceconnectionstatechange"));
      },
    ],
  ])("drops a held pull without fetching when %s", async (_case, fail) => {
    FakePeerConnection.startAs = {
      connectionState: "connecting",
      remoteDescription: SFU_ANSWER,
    };
    const sfu = stubRenegotiatingSfu();

    subscription = makePartyTracks().pull(of(REMOTE_TRACK)).subscribe();
    await settle();
    expect(sfu.calls).toEqual([]);

    // The replacement session's peer connection has negotiated nothing.
    FakePeerConnection.startAs = {
      connectionState: "new",
      remoteDescription: null,
    };
    fail(FakePeerConnection.instances[0]);
    await settle();

    // The session retries after 250 ms. The held pull released the shared
    // task queue at once, so the new session's pull is not stuck behind its
    // 5 s timeout, and S1 was never asked for the track.
    await vi.advanceTimersByTimeAsync(300);
    await settle();
    expect(FakePeerConnection.instances).toHaveLength(2);
    expect(sfu.calls).toEqual(["S2 pull", "S2 renegotiate"]);
  });

  // PartyTracks retries a failed pull itself and never surfaces the SFU's
  // error code; Ralph reads it from PartyTracks' API history instead.
  it.each([
    [
      "a top-level errorCode",
      jsonResponse({
        errorCode: "not_found_track_error",
        errorDescription: "Track not found",
      }),
    ],
    [
      "a per-track errorCode",
      jsonResponse({
        tracks: [
          {
            trackName: "t",
            sessionId: "J",
            errorCode: "not_found_track_error",
            errorDescription: "Track not found",
          },
        ],
        requiresImmediateRenegotiation: false,
      }),
    ],
  ])(
    "reports the not-found answer of a retried pull with %s",
    async (_case, failure) => {
      stubFetch(failure);
      const partyTracks = makePartyTracks();
      const errors: PartyTracksPullError[] = [];
      subscription = observePullErrors(partyTracks.history).subscribe((error) =>
        errors.push(error),
      );
      subscription.add(partyTracks.pull(of(REMOTE_TRACK)).subscribe());

      await vi.advanceTimersByTimeAsync(0);
      expect(errors).toEqual([
        {
          sessionId: "J",
          trackName: "t",
          errorCode: "not_found_track_error",
        },
      ]);

      // The retry succeeds: nothing more to report.
      for (let i = 0; i < 20; i++) await vi.advanceTimersByTimeAsync(50);
      expect(errors).toHaveLength(1);
    },
  );
});
