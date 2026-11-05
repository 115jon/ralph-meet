import type { TrackInfo } from "../track-info";
import type { TrackMetadata } from "partytracks/client";
import {
  BehaviorSubject,
  filter,
  firstValueFrom,
  type Observable,
  Subject,
} from "rxjs";
import { describe, expect, it } from "vitest";
import {
  negotiatedSimulcastRids,
  type PartyTracksClient,
  PartyTracksTransport,
} from "../partytracks-transport";
import { CAMERA_SIMULCAST_ENCODINGS } from "../video-layers";

type PushOptions = Parameters<PartyTracksClient["push"]>[1];
type PullOptions = Parameters<PartyTracksClient["pull"]>[1];

class FakePartyTracks implements PartyTracksClient {
  readonly peerConnection$ = new Subject<RTCPeerConnection>();
  readonly session$ = new Subject<{
    peerConnection: RTCPeerConnection;
    sessionId: string;
  }>();
  readonly peerConnectionState$ = new Subject<RTCPeerConnectionState>();
  readonly pushedMetadata$ = new Subject<TrackMetadata>();
  pushOptions: PushOptions;
  pullOptions: PullOptions;
  pulledMetadata: TrackMetadata[] = [];

  push(
    sourceTrack$: Observable<MediaStreamTrack>,
    options?: PushOptions,
  ): Observable<TrackMetadata> {
    this.pushOptions = options;
    sourceTrack$.subscribe();
    return this.pushedMetadata$;
  }

  pull(trackMetadata$: Observable<TrackMetadata>, options?: PullOptions) {
    this.pullOptions = options;
    trackMetadata$.subscribe((metadata) => this.pulledMetadata.push(metadata));
    return new Subject<MediaStreamTrack>();
  }
}

function peerConnectionSending(
  track: MediaStreamTrack,
  rids: Array<string | undefined>,
): RTCPeerConnection {
  return {
    getSenders: () => [
      {
        track,
        getParameters: () => ({ encodings: rids.map((rid) => ({ rid })) }),
      },
    ],
    setConfiguration: () => {},
    getConfiguration: () => ({}),
  } as unknown as RTCPeerConnection;
}

function setup() {
  const fake = new FakePartyTracks();
  const transport = new PartyTracksTransport(
    {
      roomSlug: "room",
      participantId: "publisher",
      voiceToken: "token",
      iceServers: [{ urls: ["stun:stun.example.test"] }],
    },
    { factory: () => fake, resolveApiUrl: (path) => path },
  );
  return { fake, transport };
}

const camera = { id: "camera", kind: "video" } as MediaStreamTrack;
const identity = {
  participantId: "publisher",
  trackName: "cam-video-publisher",
  kind: "video" as const,
};

describe("PartyTracksTransport simulcast publishing", () => {
  it("pushes the given encodings and announces the RIDs the sender negotiated", async () => {
    const { fake, transport } = setup();
    fake.peerConnection$.next(peerConnectionSending(camera, ["f", "h", "q"]));
    const announced = firstValueFrom(
      transport.push(new BehaviorSubject(camera), identity, {
        sendEncodings: CAMERA_SIMULCAST_ENCODINGS,
      }),
    );
    expect(await firstValueFrom(fake.pushOptions!.sendEncodings$!)).toEqual(
      CAMERA_SIMULCAST_ENCODINGS,
    );

    fake.pushedMetadata$.next({ trackName: "sfu-camera", sessionId: "cap" });
    expect(await announced).toEqual({
      participant_id: "publisher",
      track_name: "cam-video-publisher",
      sfu_track_name: "sfu-camera",
      session_id: "cap",
      kind: "video",
      simulcast_rids: ["f", "h", "q"],
    } satisfies TrackInfo);
  });

  it("announces a single layer when simulcast was not negotiated", async () => {
    const { fake, transport } = setup();
    fake.peerConnection$.next(peerConnectionSending(camera, [undefined]));
    const announced = firstValueFrom(
      transport.push(new BehaviorSubject(camera), identity, {
        sendEncodings: CAMERA_SIMULCAST_ENCODINGS,
      }),
    );
    fake.pushedMetadata$.next({ trackName: "sfu-camera", sessionId: "cap" });
    expect((await announced).simulcast_rids).toBeUndefined();
  });

  it("pushes other tracks without encodings or RIDs", async () => {
    const { fake, transport } = setup();
    fake.peerConnection$.next(peerConnectionSending(camera, ["f", "h", "q"]));
    const announced = firstValueFrom(
      transport.push(new BehaviorSubject(camera), identity),
    );
    expect(fake.pushOptions).toBeUndefined();
    fake.pushedMetadata$.next({ trackName: "sfu-camera", sessionId: "cap" });
    expect((await announced).simulcast_rids).toBeUndefined();
  });

  it("keeps the negotiated RIDs when the source track is replaced", async () => {
    // As in a browser: replaceTrack() resolves later, and only then does
    // sender.track change. PartyTracks re-emits the push's metadata right
    // after calling it (dist/client push(): tap(replaceTrack) then map).
    const sender = {
      track: camera as MediaStreamTrack | null,
      getParameters: () => ({
        encodings: [{ rid: "f" }, { rid: "h" }, { rid: "q" }],
      }),
      replaceTrack(next: MediaStreamTrack | null) {
        return Promise.resolve().then(() => {
          sender.track = next;
        });
      },
    };
    const pc = {
      getSenders: () => [sender],
      setConfiguration: () => {},
      getConfiguration: () => ({}),
    } as unknown as RTCPeerConnection;
    const fake = new FakePartyTracks();
    const metadata = { trackName: "sfu-camera", sessionId: "cap" };
    fake.push = (sourceTrack$) => {
      const out = new BehaviorSubject<TrackMetadata | null>(null);
      let pushed = false;
      sourceTrack$.subscribe((track) => {
        if (pushed) void sender.replaceTrack(track);
        pushed = true;
        out.next(metadata);
      });
      return out.pipe(filter((value) => value !== null));
    };
    const transport = new PartyTracksTransport(
      { roomSlug: "room", participantId: "publisher", voiceToken: "t" },
      { factory: () => fake, resolveApiUrl: (path) => path },
    );
    fake.peerConnection$.next(pc);
    const source$ = new BehaviorSubject(camera);
    const announced: TrackInfo[] = [];
    transport
      .push(source$, identity, { sendEncodings: CAMERA_SIMULCAST_ENCODINGS })
      .subscribe((track) => announced.push(track));
    expect(announced.map((track) => track.simulcast_rids)).toEqual([
      ["f", "h", "q"],
    ]);

    const switched = { id: "camera-2", kind: "video" } as MediaStreamTrack;
    source$.next(switched);
    // Announced while the sender still holds the old track.
    expect(sender.track).toBe(camera);
    expect(announced.map((track) => track.simulcast_rids)).toEqual([
      ["f", "h", "q"],
      ["f", "h", "q"],
    ]);
    await Promise.resolve();
    expect(sender.track).toBe(switched);
  });

  it("reads the RIDs again for a new SFU track", async () => {
    const { fake, transport } = setup();
    fake.peerConnection$.next(peerConnectionSending(camera, ["f", "h", "q"]));
    const announced: TrackInfo[] = [];
    transport
      .push(new BehaviorSubject(camera), identity, {
        sendEncodings: CAMERA_SIMULCAST_ENCODINGS,
      })
      .subscribe((track) => announced.push(track));
    fake.pushedMetadata$.next({ trackName: "sfu-camera", sessionId: "cap" });
    // The session was rebuilt and this time simulcast was declined.
    fake.peerConnection$.next(peerConnectionSending(camera, [undefined]));
    fake.pushedMetadata$.next({ trackName: "sfu-camera-2", sessionId: "cap2" });
    expect(announced.map((track) => track.simulcast_rids)).toEqual([
      ["f", "h", "q"],
      undefined,
    ]);
  });

  it("reads RIDs only from the sender of the announced track", () => {
    const other = { id: "other", kind: "video" } as MediaStreamTrack;
    const pc = peerConnectionSending(other, ["f", "h", "q"]);
    expect(negotiatedSimulcastRids(pc, camera)).toBeUndefined();
    expect(negotiatedSimulcastRids(pc, other)).toEqual(["f", "h", "q"]);
    expect(negotiatedSimulcastRids(null, other)).toBeUndefined();
  });
});

describe("PartyTracksTransport simulcast pulling", () => {
  const offer: TrackInfo = {
    participant_id: "publisher",
    track_name: "cam-video-publisher",
    sfu_track_name: "sfu-camera",
    session_id: "cap",
    kind: "video",
    simulcast_rids: ["f", "h", "q"],
  };

  it("hands PartyTracks the preferred RID, deduplicated, and keeps it out of the metadata", () => {
    const { fake, transport } = setup();
    const preferredRid$ = new BehaviorSubject<string | undefined>("q");
    transport.pull(new BehaviorSubject(offer), { preferredRid$ });

    const seen: Array<string | undefined> = [];
    fake.pullOptions!.simulcast!.preferredRid$.subscribe((rid) =>
      seen.push(rid),
    );
    preferredRid$.next("q");
    preferredRid$.next("f");
    preferredRid$.next("f");
    expect(seen).toEqual(["q", "f"]);
    // A layer change must not re-pull: PartyTracks re-pulls when the
    // metadata changes, so the RID never rides in it.
    expect(fake.pulledMetadata).toEqual([
      { location: "remote", trackName: "sfu-camera", sessionId: "cap" },
    ]);
  });

  it("pulls without simulcast options when no layer is chosen", () => {
    const { fake, transport } = setup();
    transport.pull(new BehaviorSubject(offer));
    expect(fake.pullOptions).toBeUndefined();
  });
});
