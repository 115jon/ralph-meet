import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { TrackInfo } from "@/lib/types";
import type { ApiHistoryEntry, PartyTracksConfig } from "partytracks/client";
import { BehaviorSubject, Observable, Subject, of } from "rxjs";
import { describe, expect, it, vi } from "vitest";
import {
  PartyTracksTransport,
  type PartyTracksClient,
} from "../partytracks-transport";

function mediaTrack(kind: "audio" | "video", id: string): MediaStreamTrack {
  return { id, kind } as MediaStreamTrack;
}

class FakePartyTracks implements PartyTracksClient {
  readonly peerConnection$ = new Subject<RTCPeerConnection>();
  readonly session$ = new Subject<{
    peerConnection: RTCPeerConnection;
    sessionId: string;
  }>();
  readonly peerConnectionState$ = new Subject<RTCPeerConnectionState>();
  readonly pushedMetadata$ = new Subject<{
    location?: "local" | "remote";
    trackName?: string;
    sessionId?: string;
    mid?: string | null;
  }>();
  readonly pulledTrack$ = new Subject<MediaStreamTrack>();
  readonly pushSources: Observable<MediaStreamTrack>[] = [];
  readonly pullMetadata: Observable<{
    location?: "local" | "remote";
    trackName?: string;
    sessionId?: string;
    mid?: string | null;
  }>[] = [];
  peerConnection: RTCPeerConnection | null = null;
  pushPeerConnection: RTCPeerConnection | null = null;
  pullPeerConnection: RTCPeerConnection | null = null;

  push(sourceTrack$: Observable<MediaStreamTrack>) {
    this.pushPeerConnection = this.peerConnection;
    this.pushSources.push(sourceTrack$);
    return this.pushedMetadata$;
  }

  pull(
    trackMetadata$: Observable<{
      location?: "local" | "remote";
      trackName?: string;
      sessionId?: string;
      mid?: string | null;
    }>,
  ) {
    this.pullPeerConnection = this.peerConnection;
    this.pullMetadata.push(trackMetadata$);
    return this.pulledTrack$;
  }
}

describe("PartyTracksTransport", () => {
  it("announces PartyTracks publications without waiting for outbound RTP bytes", () => {
    const source = readFileSync(
      fileURLToPath(import.meta.resolve("partytracks/client")),
      "utf8",
    );
    expect(source).not.toContain(
      "waitForTransceiverToSendData(transceiver, () => {",
    );
  });

  it("gives PartyTracks STUN when bootstrap has no ICE so it does not fetch generate-ice-servers", () => {
    const fake = new FakePartyTracks();
    const factory = vi.fn((_config: PartyTracksConfig) => fake);

    new PartyTracksTransport(
      {
        roomSlug: "room-one",
        participantId: "participant-one",
        voiceToken: "voice-token",
      },
      { factory, resolveApiUrl: (path) => path },
    );

    expect(factory).toHaveBeenCalledWith(
      expect.objectContaining({
        iceServers: [{ urls: ["stun:stun.cloudflare.com:3478"] }],
      }),
    );
  });
  it("uses one PartyTracks session for microphone publication and remote pulls", () => {
    const fake = new FakePartyTracks();
    const factory = vi.fn(() => fake);
    const transport = new PartyTracksTransport(
      {
        roomSlug: "room-one",
        participantId: "participant-one",
        voiceToken: "voice-token",
        iceServers: [{ urls: ["stun:example.test"] }],
      },
      { factory, resolveApiUrl: (path) => `https://meet.test${path}` },
    );

    const microphone$ = new BehaviorSubject(
      mediaTrack("audio", "processed-microphone"),
    );
    transport
      .push(microphone$, {
        participantId: "participant-one",
        trackName: "cam-audio-participant-one",
        kind: "audio",
      })
      .subscribe();
    transport
      .pull(
        of({
          participant_id: "participant-two",
          track_name: "cam-audio-participant-two",
          sfu_track_name: "party-track-two",
          session_id: "party-session-two",
          kind: "audio",
        }),
      )
      .subscribe();

    expect(factory).toHaveBeenCalledOnce();
    expect(fake.pushSources).toHaveLength(1);
    expect(fake.pullMetadata).toHaveLength(1);
    expect(transport.peerConnection$).toBe(fake.peerConnection$);
  });

  it("push and pull share the same RTCPeerConnection object", () => {
    const fake = new FakePartyTracks();
    const peerConnection = { id: "shared-pc" } as unknown as RTCPeerConnection;
    fake.peerConnection = peerConnection;
    const factory = vi.fn(() => fake);
    const transport = new PartyTracksTransport(
      {
        roomSlug: "room-one",
        participantId: "participant-one",
        voiceToken: "voice-token",
        iceServers: [],
      },
      { factory, resolveApiUrl: (path) => path },
    );
    const seen: RTCPeerConnection[] = [];
    transport.peerConnection$.subscribe((pc) => seen.push(pc));

    transport
      .push(of(mediaTrack("audio", "microphone")), {
        participantId: "participant-one",
        trackName: "cam-audio-participant-one",
        kind: "audio",
      })
      .subscribe();
    transport
      .pull(
        of({
          participant_id: "participant-two",
          track_name: "cam-audio-participant-two",
          sfu_track_name: "party-track-two",
          session_id: "party-session-two",
          kind: "audio",
        }),
      )
      .subscribe();
    fake.peerConnection$.next(peerConnection);

    expect(factory).toHaveBeenCalledOnce();
    expect(fake.pushPeerConnection).toBe(peerConnection);
    expect(fake.pullPeerConnection).toBe(peerConnection);
    expect(fake.pushPeerConnection).toBe(fake.pullPeerConnection);
    expect(seen).toEqual([peerConnection]);
  });

  it("keeps Ralph track aliases while translating PartyTracks metadata", () => {
    const fake = new FakePartyTracks();
    const transport = new PartyTracksTransport(
      {
        roomSlug: "room-one",
        participantId: "participant-one",
        voiceToken: "voice-token",
        iceServers: [],
      },
      { factory: () => fake, resolveApiUrl: (path) => path },
    );
    const published: TrackInfo[] = [];

    transport
      .push(of(mediaTrack("audio", "processed-microphone")), {
        participantId: "participant-one",
        trackName: "cam-audio-participant-one",
        kind: "audio",
      })
      .subscribe((track) => published.push(track));

    fake.pushedMetadata$.next({
      location: "local",
      trackName: "party-track-one",
      sessionId: "party-session-one",
    });
    fake.pushedMetadata$.next({
      location: "local",
      trackName: "party-track-one",
      sessionId: "party-session-reconnected",
    });

    expect(published).toEqual([
      {
        participant_id: "participant-one",
        track_name: "cam-audio-participant-one",
        sfu_track_name: "party-track-one",
        session_id: "party-session-one",
        kind: "audio",
      },
      {
        participant_id: "participant-one",
        track_name: "cam-audio-participant-one",
        sfu_track_name: "party-track-one",
        session_id: "party-session-reconnected",
        kind: "audio",
      },
    ]);
  });

  it("re-pulls when distributed metadata moves to a recovered publisher session", () => {
    const fake = new FakePartyTracks();
    const transport = new PartyTracksTransport(
      {
        roomSlug: "room-one",
        participantId: "participant-one",
        voiceToken: "voice-token",
        iceServers: [],
      },
      { factory: () => fake, resolveApiUrl: (path) => path },
    );
    const metadata$ = new BehaviorSubject<TrackInfo>({
      participant_id: "participant-two",
      track_name: "cam-audio-participant-two",
      sfu_track_name: "party-track-two",
      session_id: "party-session-two",
      kind: "audio",
    });
    const translated: unknown[] = [];

    transport.pull(metadata$).subscribe();
    fake.pullMetadata[0]?.subscribe((metadata) => translated.push(metadata));
    metadata$.next({
      ...metadata$.value,
      session_id: "party-session-two-reconnected",
    });

    expect(translated).toEqual([
      {
        location: "remote",
        trackName: "party-track-two",
        sessionId: "party-session-two",
      },
      {
        location: "remote",
        trackName: "party-track-two",
        sessionId: "party-session-two-reconnected",
      },
    ]);
  });

  it("publishes screen share through the same owned PartyTracks session", () => {
    const fake = new FakePartyTracks();
    const factory = vi.fn(() => fake);
    const transport = new PartyTracksTransport(
      {
        roomSlug: "room-one",
        participantId: "participant-one",
        voiceToken: "voice-token",
        iceServers: [],
      },
      { factory, resolveApiUrl: (path) => path },
    );

    transport
      .push(of(mediaTrack("audio", "microphone")), {
        participantId: "participant-one",
        trackName: "cam-audio-participant-one",
        kind: "audio",
      })
      .subscribe();
    transport
      .push(of(mediaTrack("video", "screen")), {
        participantId: "participant-one",
        trackName: "screen-video-participant-one",
        kind: "video",
      })
      .subscribe();

    expect(factory).toHaveBeenCalledOnce();
    expect(fake.pushSources).toHaveLength(2);
  });

  it("updates the authorization header without replacing the active session", () => {
    const fake = new FakePartyTracks();
    let createdConfig: PartyTracksConfig | undefined;
    const factory = vi.fn((config: PartyTracksConfig) => {
      createdConfig = config;
      return fake;
    });
    const transport = new PartyTracksTransport(
      {
        roomSlug: "room-one",
        participantId: "participant-one",
        voiceToken: "first-token",
        iceServers: [],
      },
      { factory, resolveApiUrl: (path) => path },
    );

    transport.updateVoiceToken("second-token");

    expect(createdConfig?.headers?.get("Authorization")).toBe(
      "Bearer second-token",
    );
    expect(factory).toHaveBeenCalledOnce();
  });

  it("detaches handlers and closes the active peer connection on dispose", () => {
    const fake = new FakePartyTracks();
    const transport = new PartyTracksTransport(
      {
        roomSlug: "room-one",
        participantId: "participant-one",
        voiceToken: "voice-token",
        iceServers: [],
      },
      { factory: () => fake, resolveApiUrl: (path) => path },
    );
    const peerConnection = {
      close: vi.fn(),
      onconnectionstatechange: vi.fn(),
      onicecandidate: vi.fn(),
      oniceconnectionstatechange: vi.fn(),
      ontrack: vi.fn(),
    } as unknown as RTCPeerConnection;
    fake.peerConnection$.next(peerConnection);

    transport.dispose();

    expect(peerConnection.onconnectionstatechange).toBeNull();
    expect(peerConnection.onicecandidate).toBeNull();
    expect(peerConnection.oniceconnectionstatechange).toBeNull();
    expect(peerConnection.ontrack).toBeNull();
    expect(peerConnection.close).toHaveBeenCalledOnce();
  });

  it("reads pull errors from the PartyTracks API history", () => {
    const history = Object.assign(new EventTarget(), {
      entries: [] as ApiHistoryEntry[],
    });
    const log = (entry: ApiHistoryEntry) => {
      history.entries.push(entry);
      history.dispatchEvent(new Event("logentry"));
    };
    const fake = Object.assign(new FakePartyTracks(), { history });
    const transport = new PartyTracksTransport(
      {
        roomSlug: "room-one",
        participantId: "participant-one",
        voiceToken: "voice-token",
      },
      { factory: () => fake, resolveApiUrl: (path) => path },
    );
    const errors: unknown[] = [];
    transport.pullErrors$.subscribe((error) => errors.push(error));

    const endpoint =
      "/api/channels/room-one/partytracks/sessions/S/tracks/new?";
    log({
      type: "request",
      method: "POST",
      endpoint,
      body: {
        tracks: [{ location: "remote", trackName: "t", sessionId: "J" }],
      },
    });
    log({
      type: "response",
      endpoint,
      body: { errorCode: "not_found_track_error" },
    });

    expect(errors).toEqual([
      { sessionId: "J", trackName: "t", errorCode: "not_found_track_error" },
    ]);
  });
});
