import { VoiceOpcode, type TrackInfo, type VoiceState } from "@/lib/types";
import type {
  PartyTracksClientTransport,
  SFUClientOptions,
} from "@/lib/sfu-client";
import type { RalphPublishedTrack } from "@/lib/voice/partytracks-transport";
import { Observable, Subject } from "rxjs";
import { describe, expect, it, vi } from "vitest";
import { SFUClient } from "../sfu-client";
import {
  MockRTCPeerConnection,
  MockMediaStream,
  MockMediaStreamTrack,
  setupWebRTCMocks,
} from "./webrtc-mocks";

setupWebRTCMocks();

const FORBIDDEN_BROWSER_NATIVE_SIGNALING_OPCODES = new Set<number>([
  VoiceOpcode.SelectProtocol,
  VoiceOpcode.TracksReady,
]);

const FIRST_ICE_SERVERS = [{ urls: ["stun:first.example.test"] }];
const SECOND_ICE_SERVERS = [{ urls: ["stun:second.example.test"] }];

function voiceParticipant(
  id: string,
  overrides: Partial<VoiceState> = {},
): VoiceState {
  return {
    id,
    name: id,
    self_mute: false,
    self_deaf: false,
    self_stream: false,
    self_video: false,
    suppress: false,
    tracks: [],
    ...overrides,
  };
}

function emitMediaReady(
  client: SFUClient,
  participantId = "local-participant",
  voiceToken = "voice-token",
  iceServers = FIRST_ICE_SERVERS,
): void {
  client.roomGW.emit("media-ready", {
    participantId,
    voiceToken,
    iceServers,
  });
}

function emitMediaBootstrap(
  client: SFUClient,
  participantId: string,
  voiceToken: string,
): void {
  client.roomGW.emit("media-bootstrap", { participantId, voiceToken });
}

class TestPartyTracksTransport implements PartyTracksClientTransport {
  readonly peerConnection$ = new Subject<RTCPeerConnection>();
  readonly peerConnectionState$ = new Subject<RTCPeerConnectionState>();
  readonly operationOrder: string[] = [];
  readonly sourceTracks = new Map<string, MediaStreamTrack[]>();
  readonly publicationMetadata = new Map<string, Subject<TrackInfo>>();
  readonly pullMetadata = new Map<string, TrackInfo[]>();
  readonly remoteTracks = new Map<string, Subject<MediaStreamTrack>>();
  readonly updateVoiceToken = vi.fn();
  readonly updateIceServers = vi.fn();
  readonly dispose = vi.fn();

  readonly push = vi.fn(
    (
      sourceTrack$: Observable<MediaStreamTrack>,
      identity: RalphPublishedTrack,
    ): Observable<TrackInfo> => {
      this.operationOrder.push(`push:${identity.trackName}`);
      const tracks: MediaStreamTrack[] = [];
      sourceTrack$.subscribe((track) => tracks.push(track));
      this.sourceTracks.set(identity.trackName, tracks);
      const metadata = new Subject<TrackInfo>();
      this.publicationMetadata.set(identity.trackName, metadata);
      return metadata;
    },
  );

  pull(track$: Observable<TrackInfo>): Observable<MediaStreamTrack> {
    let trackName = "";
    const metadata: TrackInfo[] = [];
    track$.subscribe((track) => {
      trackName = track.track_name;
      metadata.push(track);
    });
    this.operationOrder.push(`pull:${trackName}`);
    this.pullMetadata.set(trackName, metadata);
    const remoteTrack = new Subject<MediaStreamTrack>();
    this.remoteTracks.set(trackName, remoteTrack);
    return remoteTrack;
  }
}

describe("SFUClient PartyTracks facade", () => {
  it("releases an early pending publication as soon as media bootstrap arrives", async () => {
    const transport = new TestPartyTracksTransport();
    const createPartyTracksTransport = vi.fn(() => transport);
    const client = new SFUClient("test-room", { createPartyTracksTransport });
    vi.spyOn(client.roomGW, "connectRoom").mockImplementation(() => {});
    vi.spyOn(client.voiceGW, "prepareVoice").mockImplementation(() => {});
    client.connect("Local participant");
    const microphone = new MockMediaStreamTrack(
      "audio",
    ) as unknown as MediaStreamTrack;
    const publication = client.publishTracks(
      new MockMediaStream([microphone]) as unknown as MediaStream,
      "cam",
    );
    void publication.catch(() => {});

    expect(createPartyTracksTransport).not.toHaveBeenCalled();
    emitMediaBootstrap(client, "reserved-participant", "bootstrap-token");
    await Promise.resolve();
    expect(createPartyTracksTransport).toHaveBeenCalledOnce();
    await publication;

    expect(transport.push).toHaveBeenCalledOnce();
    client.disconnect("component-unmount");
  });

  it("starts PartyTracks with bootstrap ICE servers", async () => {
    const transport = new TestPartyTracksTransport();
    const createPartyTracksTransport = vi.fn(() => transport);
    const client = new SFUClient("test-room", { createPartyTracksTransport });

    client.roomGW.emit("media-bootstrap", {
      participantId: "reserved-participant",
      voiceToken: "bootstrap-token",
      iceServers: FIRST_ICE_SERVERS,
    });
    await Promise.resolve();

    expect(createPartyTracksTransport).toHaveBeenCalledWith({
      roomSlug: "test-room",
      participantId: "reserved-participant",
      voiceToken: "bootstrap-token",
      iceServers: FIRST_ICE_SERVERS,
    });
    client.disconnect("component-unmount");
  });

  it("keeps a standby voice socket unidentified until promotion", async () => {
    const transport = new TestPartyTracksTransport();
    const client = new SFUClient("test-room", {
      createPartyTracksTransport: () => transport,
    });
    vi.spyOn(client.roomGW, "connectRoom").mockImplementation(() => {});
    vi.spyOn(client.voiceGW, "prepareVoice").mockImplementation(() => {});
    const promote = vi
      .spyOn(client.roomGW, "promoteStandby")
      .mockImplementation(() => {});
    const identify = vi
      .spyOn(client.voiceGW, "connectVoice")
      .mockImplementation(() => {});
    client.connect("Local", undefined, "user-1", undefined, null, null, {
      standby: true,
      channelId: "channel",
      serverId: "server",
    });
    emitMediaBootstrap(client, "local-participant", "voice-token");
    emitMediaReady(client);
    client.roomGW.emit("ready", {
      participantId: "local-participant",
      sessionId: "local-session",
      iceServers: FIRST_ICE_SERVERS,
      voiceToken: "voice-token",
      tracksToQueue: [],
      participants: [],
    });
    client.roomGW.emit("resumed", {});

    // The silent standby publication reaches the SFU...
    const silence = new MockMediaStreamTrack(
      "audio",
    ) as unknown as MediaStreamTrack;
    const published = client.publishTracks(
      new MockMediaStream([silence]) as unknown as MediaStream,
      "cam",
    );
    await published;
    transport.publicationMetadata.get("cam-audio-local-participant")?.next({
      participant_id: "local-participant",
      track_name: "cam-audio-local-participant",
      sfu_track_name: "opaque-local-audio",
      session_id: "local-session",
      kind: "audio",
    });

    // ...but the voice room never hears about this session: no identify, so
    // no track list to pull and nobody is offered the silent track.
    expect(identify).not.toHaveBeenCalled();
    expect(transport.operationOrder.some((op) => op.startsWith("pull:"))).toBe(
      false,
    );
    // The announcement waits in the unidentified socket's queue.
    expect(client.voiceGW.getDebugState().queued).toBeGreaterThan(0);

    client.promoteStandby({ selfMute: false, selfDeaf: false });
    expect(identify).toHaveBeenCalledOnce();
    expect(promote).toHaveBeenCalledOnce();

    client.voiceGW.emit("voice-ready", {
      tracks: [
        {
          participant_id: "remote-participant",
          track_name: "cam-audio-remote-participant",
          sfu_track_name: "opaque-remote-audio",
          session_id: "remote-session",
          kind: "audio",
        },
      ],
    });
    expect(transport.operationOrder).toContain(
      "pull:cam-audio-remote-participant",
    );
    client.disconnect("component-unmount");
  });

  it("identifies on the voice socket from the ticket bootstrap, before MediaReady", () => {
    const transport = new TestPartyTracksTransport();
    const client = new SFUClient("test-room", {
      createPartyTracksTransport: () => transport,
    });
    vi.spyOn(client.roomGW, "connectRoom").mockImplementation(() => {});
    vi.spyOn(client.voiceGW, "prepareVoice").mockImplementation(() => {});
    const identify = vi
      .spyOn(client.voiceGW, "connectVoice")
      .mockImplementation(() => {});
    client.connect("Local", undefined, "user-1", undefined, null, null, {
      channelId: "channel",
      serverId: "server",
    });

    emitMediaBootstrap(client, "local-participant", "bootstrap-token");

    expect(identify).toHaveBeenCalledOnce();
    expect(identify.mock.calls[0]?.slice(0, 2)).toEqual([
      "local-participant",
      "bootstrap-token",
    ]);
    client.disconnect("component-unmount");
  });

  it("drops standby tracks that stop or leave before promotion", () => {
    const transport = new TestPartyTracksTransport();
    const client = new SFUClient("test-room", {
      createPartyTracksTransport: () => transport,
    });
    vi.spyOn(client.roomGW, "connectRoom").mockImplementation(() => {});
    vi.spyOn(client.voiceGW, "prepareVoice").mockImplementation(() => {});
    vi.spyOn(client.roomGW, "promoteStandby").mockImplementation(() => {});
    client.connect("Local", undefined, "user-1", undefined, null, null, {
      standby: true,
    });
    emitMediaReady(client);
    const stopped = {
      participant_id: "remote-participant",
      track_name: "cam-audio-remote-participant",
      sfu_track_name: "opaque-remote-audio",
      session_id: "remote-session",
      kind: "audio" as const,
    };
    const left = {
      participant_id: "left-participant",
      track_name: "cam-audio-left-participant",
      sfu_track_name: "opaque-left-audio",
      session_id: "left-session",
      kind: "audio" as const,
    };
    client.voiceGW.emit("voice-ready", { tracks: [stopped, left] });
    client.voiceGW.emit("stop-tracks", {
      track_names: [stopped.track_name],
      tracks: [stopped],
    });
    client.voiceGW.emit("client-disconnect", {
      participant_id: "left-participant",
    });
    expect(transport.operationOrder).toEqual([
      "pull:cam-audio-remote-participant",
      "pull:cam-audio-left-participant",
    ]);
    client.promoteStandby();
    expect(transport.operationOrder).toEqual([
      "pull:cam-audio-remote-participant",
      "pull:cam-audio-left-participant",
    ]);
    client.disconnect("component-unmount");
  });

  it("keeps the standby roster current until promotion replays it", () => {
    const client = new SFUClient("test-room");
    vi.spyOn(client.roomGW, "connectRoom").mockImplementation(() => {});
    vi.spyOn(client.voiceGW, "prepareVoice").mockImplementation(() => {});
    client.connect("Local", undefined, "user-1", undefined, null, null, {
      standby: true,
    });
    const seated = voiceParticipant("seated", { self_video: true });
    const joined: VoiceState[][] = [];
    client.on("joined", (event) => {
      joined.push(
        event.participants.map((participant) => ({ ...participant })),
      );
    });
    client.roomGW.emit("ready", {
      participantId: "local-participant",
      sessionId: "local-session",
      iceServers: FIRST_ICE_SERVERS,
      voiceToken: "ready-token",
      tracksToQueue: [],
      participants: [seated, voiceParticipant("leaver")],
    });

    client.roomGW.emit("participant-joined", {
      participant: voiceParticipant("newcomer", { clerk_user_id: "clerk-new" }),
    });
    client.roomGW.emit("voice-state-update", {
      action: "update",
      participant: {
        id: "seated",
        self_mute: true,
        self_deaf: false,
        self_stream: false,
        self_video: false,
        suppress: false,
        tracks: [],
      },
    });
    client.roomGW.emit("participant-left", { participantId: "leaver" });

    expect(client.replayJoinedSnapshot()).toBe(true);
    expect(joined[1]?.map((participant) => participant.id)).toEqual([
      "seated",
      "newcomer",
    ]);
    expect(joined[1]?.[0]).toMatchObject({
      name: "seated",
      self_mute: true,
      self_video: false,
    });
    expect(joined[1]?.[1]?.clerk_user_id).toBe("clerk-new");
    client.disconnect("component-unmount");
  });

  it("enriches same-generation bootstrap credentials without recreating media", async () => {
    const transport = new TestPartyTracksTransport();
    const createPartyTracksTransport = vi.fn(() => transport);
    const client = new SFUClient("test-room", { createPartyTracksTransport });

    emitMediaBootstrap(client, "reserved-participant", "bootstrap-token");
    await Promise.resolve();
    expect(createPartyTracksTransport).toHaveBeenCalledOnce();
    client.roomGW.emit("ready", {
      participantId: "reserved-participant",
      sessionId: "reserved-participant",
      iceServers: FIRST_ICE_SERVERS,
      voiceToken: "ready-token",
      tracksToQueue: [],
      participants: [],
    });

    expect(createPartyTracksTransport).toHaveBeenCalledOnce();
    expect(transport.updateVoiceToken).toHaveBeenCalledWith("ready-token");
    expect(transport.updateIceServers).toHaveBeenCalledWith(FIRST_ICE_SERVERS);
    client.disconnect("component-unmount");
  });

  it("queues early publication metadata through VoiceGW exactly once", async () => {
    const transport = new TestPartyTracksTransport();
    const client = new SFUClient("test-room", {
      createPartyTracksTransport: () => transport,
    });
    const send = vi.spyOn(client.voiceGW, "send");
    const microphone = new MockMediaStreamTrack(
      "audio",
    ) as unknown as MediaStreamTrack;
    const publication = client.publishTracks(
      new MockMediaStream([microphone]) as unknown as MediaStream,
      "cam",
    );
    void publication.catch(() => {});

    emitMediaBootstrap(client, "reserved-participant", "bootstrap-token");
    await Promise.resolve();
    expect(transport.push).toHaveBeenCalledOnce();
    await publication;
    transport.publicationMetadata.get("cam-audio-reserved-participant")!.next({
      participant_id: "reserved-participant",
      track_name: "cam-audio-reserved-participant",
      sfu_track_name: "party-track",
      session_id: "party-session",
      kind: "audio",
    });
    client.roomGW.emit("ready", {
      participantId: "reserved-participant",
      sessionId: "reserved-participant",
      iceServers: FIRST_ICE_SERVERS,
      voiceToken: "ready-token",
      tracksToQueue: [],
      participants: [],
    });

    expect(
      send.mock.calls.filter(([message]) => message.op === VoiceOpcode.Video),
    ).toHaveLength(1);
    client.disconnect("component-unmount");
  });

  it("replaces stale bootstrap media once and disposes it on abort", async () => {
    const transports: TestPartyTracksTransport[] = [];
    const client = new SFUClient("test-room", {
      createPartyTracksTransport: vi.fn(() => {
        const transport = new TestPartyTracksTransport();
        transports.push(transport);
        return transport;
      }),
    });

    emitMediaBootstrap(client, "participant-a", "token-a");
    emitMediaBootstrap(client, "participant-b", "token-b");
    await Promise.resolve();

    expect(transports).toHaveLength(2);
    expect(transports[0]?.dispose).toHaveBeenCalledOnce();
    expect(transports[1]?.dispose).not.toHaveBeenCalled();
    client.disconnect("component-unmount");
    expect(transports[1]?.dispose).toHaveBeenCalledOnce();
  });

  it("rejects an early publication when bootstrap is aborted", async () => {
    const client = new SFUClient("test-room");
    vi.spyOn(client.roomGW, "connectRoom").mockImplementation(() => {});
    vi.spyOn(client.voiceGW, "prepareVoice").mockImplementation(() => {});
    client.connect("Local participant");
    const microphone = new MockMediaStreamTrack(
      "audio",
    ) as unknown as MediaStreamTrack;
    const publication = client.publishTracks(
      new MockMediaStream([microphone]) as unknown as MediaStream,
      "cam",
    );
    void publication.catch(() => {});

    client.disconnect("component-unmount");

    await expect(publication).rejects.toThrow("SFU client disconnected");
  });

  it("preserves the existing MediaReady path when bootstrap is absent", async () => {
    const transport = new TestPartyTracksTransport();
    const createPartyTracksTransport = vi.fn(() => transport);
    const client = new SFUClient("test-room", { createPartyTracksTransport });

    emitMediaReady(client);
    await Promise.resolve();

    expect(createPartyTracksTransport).toHaveBeenCalledOnce();
    client.disconnect("component-unmount");
  });

  it("keeps an established resume identity until fallback admission or a new join", () => {
    const transports: TestPartyTracksTransport[] = [];
    const client = new SFUClient("test-room", {
      createPartyTracksTransport: vi.fn(() => {
        const transport = new TestPartyTracksTransport();
        transports.push(transport);
        return transport;
      }),
    });

    client.roomGW.emit("ready", {
      participantId: "established",
      sessionId: "established",
      iceServers: FIRST_ICE_SERVERS,
      voiceToken: "established-token",
      tracksToQueue: [],
      participants: [],
    });
    emitMediaBootstrap(client, "speculative-reconnect", "speculative-token");
    expect(transports).toHaveLength(1);
    expect(client.getParticipantId()).toBe("established");

    client.roomGW.emit("media-ready", {
      participantId: "fallback-admission",
      iceServers: SECOND_ICE_SERVERS,
      voiceToken: "fallback-token",
    });
    expect(transports).toHaveLength(2);
    expect(transports[0]?.dispose).toHaveBeenCalledOnce();
    expect(client.getParticipantId()).toBe("fallback-admission");

    client.disconnect("component-unmount");
    client.connect("New join");
    emitMediaBootstrap(client, "new-join", "new-join-token");
    expect(transports).toHaveLength(3);
    expect(client.getParticipantId()).toBe("new-join");
    client.disconnect("component-unmount");
  });
  it("starts RoomGW and VoiceGW preparation in the same connect turn", () => {
    const client = new SFUClient("test-room");
    const calls: string[] = [];
    vi.spyOn(client.roomGW, "connectRoom").mockImplementation(() => {
      calls.push("room");
    });
    vi.spyOn(client.voiceGW, "prepareVoice").mockImplementation(() => {
      calls.push("voice");
    });

    client.connect("Local participant");

    expect(calls).toEqual(["room", "voice"]);
    client.disconnect("component-unmount");
  });

  it("refreshes credentials before expiry and updates the existing PartyTracks session", () => {
    vi.useFakeTimers();
    const transport = new TestPartyTracksTransport();
    const client = new SFUClient("test-room", {
      createPartyTracksTransport: vi.fn(() => transport),
    });
    vi.spyOn(client.roomGW, "isReady", "get").mockReturnValue(true);
    vi.spyOn(client.voiceGW, "connectVoice").mockImplementation(() => {});
    const requestCredentialRefresh = vi
      .spyOn(client.roomGW, "requestCredentialRefresh")
      .mockImplementation(() => {});
    const updateVoiceToken = vi.spyOn(client.voiceGW, "updateVoiceToken");
    const send = vi.spyOn(client.voiceGW, "send");

    try {
      client.roomGW.emit("ready", {
        participantId: "local-participant",
        sessionId: "local-participant",
        iceServers: FIRST_ICE_SERVERS,
        voiceToken: "voice-token-1",
        tracksToQueue: [],
        participants: [],
      });

      vi.advanceTimersByTime(45 * 60 * 1000 - 1);
      expect(requestCredentialRefresh).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(requestCredentialRefresh).toHaveBeenCalledOnce();

      client.roomGW.emit("resumed", {
        voiceToken: "voice-token-2",
        iceServers: SECOND_ICE_SERVERS,
      });

      expect(updateVoiceToken).toHaveBeenCalledWith("voice-token-2");
      expect(transport.updateVoiceToken).toHaveBeenCalledWith("voice-token-2");
      expect(transport.updateIceServers).toHaveBeenCalledWith(
        SECOND_ICE_SERVERS,
      );
      expect(
        send.mock.calls.some(([message]) =>
          FORBIDDEN_BROWSER_NATIVE_SIGNALING_OPCODES.has(message.op),
        ),
      ).toBe(false);
    } finally {
      client.disconnect("component-unmount");
      vi.useRealTimers();
    }
  });

  it("turns a remote VoiceGW disconnect into speaking-off", () => {
    const client = new SFUClient("test-room");
    const onSpeaking = vi.fn();
    client.on("speaking", onSpeaking);

    client.voiceGW.emit("speaking", {
      participantId: "remote-participant",
      speaking: 1,
    });
    client.voiceGW.emit("client-disconnect", {
      participant_id: "remote-participant",
    });

    expect(onSpeaking).toHaveBeenLastCalledWith({
      participantId: "remote-participant",
      speaking: 0,
    });
    client.disconnect("component-unmount");
  });

  it("replaces PartyTracks on a RoomGW participant generation and reconciles once", async () => {
    const transports: TestPartyTracksTransport[] = [];
    const createPartyTracksTransport = vi.fn(() => {
      const transport = new TestPartyTracksTransport();
      transports.push(transport);
      return transport;
    });
    const client = new SFUClient("test-room", {
      createPartyTracksTransport,
    });
    vi.spyOn(client.voiceGW, "connectVoice").mockImplementation(() => {});
    const send = vi.spyOn(client.voiceGW, "send");
    const microphone = new MockMediaStreamTrack(
      "audio",
    ) as unknown as MediaStreamTrack;
    const stream = new MockMediaStream([microphone]) as unknown as MediaStream;
    const reconciliationPublications: Promise<void>[] = [];
    const onReconcile = vi.fn(() => {
      reconciliationPublications.push(client.publishTracks(stream, "cam"));
    });
    client.on("voice-reconnected", onReconcile);

    emitMediaReady(client, "participant-generation-1", "voice-token-1");
    await client.publishTracks(stream, "cam");
    emitMediaReady(
      client,
      "participant-generation-2",
      "voice-token-2",
      SECOND_ICE_SERVERS,
    );
    client.voiceGW.emit("voice-ready", { tracks: [] });
    await Promise.all(reconciliationPublications);

    expect(createPartyTracksTransport).toHaveBeenCalledTimes(2);
    expect(transports[0]?.dispose).toHaveBeenCalledOnce();
    expect(transports[1]?.push).toHaveBeenCalledOnce();
    expect(onReconcile).toHaveBeenCalledOnce();
    expect(
      send.mock.calls.some(([message]) =>
        FORBIDDEN_BROWSER_NATIVE_SIGNALING_OPCODES.has(message.op),
      ),
    ).toBe(false);
    client.disconnect("component-unmount");
  });

  it("updates PartyTracks across a same-generation VoiceGW reconnect and reconciles once", async () => {
    const transport = new TestPartyTracksTransport();
    const createPartyTracksTransport = vi.fn(() => transport);
    const client = new SFUClient("test-room", {
      createPartyTracksTransport,
    });
    const connectVoice = vi
      .spyOn(client.voiceGW, "connectVoice")
      .mockImplementation(() => {});
    const microphone = new MockMediaStreamTrack(
      "audio",
    ) as unknown as MediaStreamTrack;
    const stream = new MockMediaStream([microphone]) as unknown as MediaStream;
    const reconciliationPublications: Promise<void>[] = [];
    const onReconcile = vi.fn(() => {
      reconciliationPublications.push(client.publishTracks(stream, "cam"));
    });
    client.on("voice-reconnected", onReconcile);

    emitMediaReady(client, "local-participant", "voice-token-1");
    client.voiceGW.emit("disconnected", undefined as never);
    emitMediaReady(
      client,
      "local-participant",
      "voice-token-2",
      SECOND_ICE_SERVERS,
    );
    client.voiceGW.emit("voice-ready", { tracks: [] });
    client.voiceGW.emit("voice-ready", { tracks: [] });
    await Promise.all(reconciliationPublications);

    expect(createPartyTracksTransport).toHaveBeenCalledOnce();
    expect(transport.dispose).not.toHaveBeenCalled();
    expect(transport.updateVoiceToken).toHaveBeenCalledWith("voice-token-2");
    expect(transport.updateIceServers).toHaveBeenCalledWith(SECOND_ICE_SERVERS);
    expect(connectVoice).toHaveBeenCalledTimes(2);
    expect(onReconcile).toHaveBeenCalledOnce();
    expect(transport.push).toHaveBeenCalledOnce();
    client.disconnect("component-unmount");
  });

  it("re-announces a preserved publication before replay pulls after VoiceGW reconnect", async () => {
    const transport = new TestPartyTracksTransport();
    const client = new SFUClient("test-room", {
      createPartyTracksTransport: vi.fn(() => transport),
    });
    vi.spyOn(client.voiceGW, "connectVoice").mockImplementation(() => {});
    const send = vi
      .spyOn(client.voiceGW, "send")
      .mockImplementation((message) => {
        if (message.op === VoiceOpcode.Video) {
          transport.operationOrder.push("announce:local");
        }
        return true;
      });
    const microphone = new MockMediaStreamTrack(
      "audio",
    ) as unknown as MediaStreamTrack;
    const stream = new MockMediaStream([microphone]) as unknown as MediaStream;
    const localMetadata: TrackInfo = {
      participant_id: "local-participant",
      track_name: "cam-audio-local-participant",
      sfu_track_name: "opaque-local-audio",
      session_id: "local-session-capability",
      kind: "audio",
    };
    const remoteOffer: TrackInfo = {
      participant_id: "remote-participant",
      track_name: "cam-audio-remote-participant",
      sfu_track_name: "opaque-remote-audio",
      session_id: "remote-session-capability",
      kind: "audio",
    };

    emitMediaReady(client);
    await client.publishTracks(stream, "cam");
    transport.publicationMetadata
      .get(localMetadata.track_name)
      ?.next(localMetadata);
    transport.operationOrder.length = 0;
    send.mockClear();

    client.voiceGW.emit("disconnected", undefined as never);
    client.voiceGW.emit("voice-ready", { tracks: [remoteOffer] });

    expect(transport.operationOrder).toEqual([
      "announce:local",
      "pull:cam-audio-remote-participant",
    ]);
    expect(send).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith({
      op: VoiceOpcode.Video,
      d: { tracks: [localMetadata] },
    });
    expect(transport.push).toHaveBeenCalledOnce();
    client.disconnect("component-unmount");
  });

  it("disconnects idempotently and disposes both public media lifecycles safely", async () => {
    const transport = new TestPartyTracksTransport();
    const client = new SFUClient("test-room", {
      createPartyTracksTransport: vi.fn(() => transport),
    });
    vi.spyOn(client.voiceGW, "connectVoice").mockImplementation(() => {});
    emitMediaReady(client);
    const roomSend = vi.spyOn(client.roomGW, "send");
    const voiceSend = vi.spyOn(client.voiceGW, "send");
    const roomDisconnect = vi.spyOn(client.roomGW, "disconnect");
    const voiceDisconnect = vi.spyOn(client.voiceGW, "disconnect");

    client.disconnect("user-leave");
    client.disconnect("component-unmount");

    expect(
      roomSend.mock.calls.filter(
        ([message]) => message.op === VoiceOpcode.ClientDisconnect,
      ),
    ).toHaveLength(1);
    expect(
      voiceSend.mock.calls.filter(
        ([message]) => message.op === VoiceOpcode.ClientDisconnect,
      ),
    ).toHaveLength(1);
    expect(roomDisconnect).toHaveBeenCalledOnce();
    expect(voiceDisconnect).toHaveBeenCalledOnce();
    expect(transport.dispose).toHaveBeenCalledOnce();
    expect(client.getParticipantId()).toBeNull();
    await expect(
      client.publishNativeScreenShare({
        sourceId: "screen:disposed",
        quality: "1080p",
        withAudio: false,
      }),
    ).rejects.toThrow("Native screen share transport is disposed");
  });

  it("preserves conditional replace and unpublish ownership through PartyTracks", async () => {
    const transport = new TestPartyTracksTransport();
    const client = new SFUClient("test-room", {
      createPartyTracksTransport: vi.fn(() => transport),
    });
    vi.spyOn(client.voiceGW, "connectVoice").mockImplementation(() => {});
    const send = vi.spyOn(client.voiceGW, "send");
    emitMediaReady(client);
    const original = new MockMediaStreamTrack(
      "audio",
    ) as unknown as MediaStreamTrack;
    const stale = new MockMediaStreamTrack(
      "audio",
    ) as unknown as MediaStreamTrack;
    const replacement = new MockMediaStreamTrack(
      "audio",
    ) as unknown as MediaStreamTrack;
    const trackName = "cam-audio-local-participant";
    await client.publishTracks(
      new MockMediaStream([original]) as unknown as MediaStream,
      "cam",
    );

    await expect(
      client.replaceTrackIfCurrent(trackName, stale, replacement),
    ).resolves.toBe(false);
    await expect(
      client.replaceTrackIfCurrent(trackName, original, replacement),
    ).resolves.toBe(true);
    await expect(
      client.unpublishTrackIfCurrent(trackName, original),
    ).resolves.toBe(false);
    await expect(
      client.unpublishTrackIfCurrent(trackName, replacement),
    ).resolves.toBe(true);

    expect(transport.sourceTracks.get(trackName)).toEqual([
      original,
      replacement,
    ]);
    expect(client.getPublishedTrack(trackName)).toBeNull();
    expect(
      send.mock.calls.filter(
        ([message]) => message.op === VoiceOpcode.StopTracks,
      ),
    ).toHaveLength(1);
    client.disconnect("component-unmount");
  });

  it("starts diagnostics from the PartyTracks peer connection seam", () => {
    const transport = new TestPartyTracksTransport();
    const client = new SFUClient("test-room", {
      createPartyTracksTransport: vi.fn(() => transport),
    });
    vi.spyOn(client.voiceGW, "connectVoice").mockImplementation(() => {});
    const startStatsHub = vi
      .spyOn(client.statsHub, "start")
      .mockImplementation(() => {});
    const resetInboundSentinel = vi.spyOn(
      client.audioSentinel,
      "resetMonitoring",
    );
    const resetOutboundSentinel = vi.spyOn(
      client.outboundAudioSentinel,
      "resetMonitoring",
    );
    const beginConnectionStats = vi.spyOn(
      client.stats,
      "beginConnectionStatsSession",
    );
    // The sentinels no longer own timers: the hub is the only poller.
    const startInboundSentinel = vi.spyOn(client.audioSentinel, "start");
    const startOutboundSentinel = vi.spyOn(
      client.outboundAudioSentinel,
      "start",
    );
    client.roomGW.emit("media-ready", {
      participantId: "local-participant",
      voiceToken: "voice-token",
      iceServers: [{ urls: ["stun:example.test"] }],
    });

    transport.peerConnection$.next(
      new MockRTCPeerConnection() as unknown as RTCPeerConnection,
    );

    expect(startStatsHub).toHaveBeenCalledOnce();
    expect(resetInboundSentinel).toHaveBeenCalled();
    expect(resetOutboundSentinel).toHaveBeenCalled();
    expect(beginConnectionStats).toHaveBeenCalledOnce();
    expect(startInboundSentinel).not.toHaveBeenCalled();
    expect(startOutboundSentinel).not.toHaveBeenCalled();
    client.disconnect("component-unmount");
  });

  it("fans one stats snapshot out to every consumer per hub tick", async () => {
    vi.useFakeTimers();
    try {
      const transport = new TestPartyTracksTransport();
      const client = new SFUClient("test-room", {
        createPartyTracksTransport: vi.fn(() => transport),
      });
      vi.spyOn(client.voiceGW, "connectVoice").mockImplementation(() => {});
      const pc = new MockRTCPeerConnection() as unknown as RTCPeerConnection;
      const getStats = vi.fn(
        async () => new Map() as unknown as RTCStatsReport,
      );
      (pc as unknown as { getStats: typeof getStats }).getStats = getStats;
      const trackStats = vi.spyOn(client.stats, "ingestTrackStats");
      const connectionStats = vi.spyOn(client.stats, "ingestConnectionStats");
      const inbound = vi.spyOn(client.audioSentinel, "ingest");
      const outbound = vi.spyOn(client.outboundAudioSentinel, "ingest");
      client.roomGW.emit("media-ready", {
        participantId: "local-participant",
        voiceToken: "voice-token",
        iceServers: [{ urls: ["stun:example.test"] }],
      });
      transport.peerConnection$.next(pc);

      await vi.advanceTimersByTimeAsync(0);
      expect(getStats).toHaveBeenCalledTimes(1);
      // 10 s at the healthy 2 s cadence: five more walks, not twenty.
      await vi.advanceTimersByTimeAsync(10_000);
      expect(getStats).toHaveBeenCalledTimes(6);
      for (const consumer of [trackStats, connectionStats, inbound, outbound]) {
        expect(consumer).toHaveBeenCalledTimes(6);
      }
      client.disconnect("component-unmount");
      await vi.advanceTimersByTimeAsync(10_000);
      expect(getStats).toHaveBeenCalledTimes(6);
    } finally {
      vi.useRealTimers();
    }
  });

  it("fails closed when browser publication has no PartyTracks media session", async () => {
    const client = new SFUClient("test-room");
    const send = vi.spyOn(client.voiceGW, "send");
    const microphone = new MockMediaStreamTrack(
      "audio",
    ) as unknown as MediaStreamTrack;

    await expect(
      client.publishTracks(
        new MockMediaStream([microphone]) as unknown as MediaStream,
        "cam",
      ),
    ).rejects.toThrow("PartyTracks media is unavailable");
    expect(
      send.mock.calls.some(([message]) =>
        FORBIDDEN_BROWSER_NATIVE_SIGNALING_OPCODES.has(message.op),
      ),
    ).toBe(false);
  });

  it("migrates browser publications acquired before MediaReady without entering legacy SDP", async () => {
    const transport = new TestPartyTracksTransport();
    const client = new SFUClient("test-room", {
      createPartyTracksTransport: vi.fn(() => transport),
    });
    vi.spyOn(client.roomGW, "connectRoom").mockImplementation(() => {});
    vi.spyOn(client.voiceGW, "prepareVoice").mockImplementation(() => {});
    vi.spyOn(client.voiceGW, "connectVoice").mockImplementation(() => {});
    const send = vi.spyOn(client.voiceGW, "send");
    client.connect("Local participant");

    const microphone = new MockMediaStreamTrack(
      "audio",
    ) as unknown as MediaStreamTrack;
    const camera = new MockMediaStreamTrack(
      "video",
    ) as unknown as MediaStreamTrack;
    const screenAudio = new MockMediaStreamTrack(
      "audio",
    ) as unknown as MediaStreamTrack;
    const screenVideo = new MockMediaStreamTrack(
      "video",
    ) as unknown as MediaStreamTrack;
    const camStream = new MockMediaStream([
      microphone,
      camera,
    ]) as unknown as MediaStream;
    const screenStream = new MockMediaStream([
      screenAudio,
      screenVideo,
    ]) as unknown as MediaStream;
    const reconciliationPublications: Promise<void>[] = [];
    const onVoiceReconnected = vi.fn(() => {
      reconciliationPublications.push(
        client.publishTracks(camStream, "cam"),
        client.publishTracks(screenStream, "screen"),
      );
    });
    client.on("voice-reconnected", onVoiceReconnected);
    const camPublication = client.publishTracks(camStream, "cam");
    const screenPublication = client.publishTracks(screenStream, "screen");
    await Promise.resolve();

    client.roomGW.emit("media-ready", {
      participantId: "local-participant",
      voiceToken: "voice-token",
      iceServers: [{ urls: ["stun:example.test"] }],
    });
    client.voiceGW.emit("voice-ready", { tracks: [] });
    await Promise.all([camPublication, screenPublication]);
    await Promise.all(reconciliationPublications);

    expect(onVoiceReconnected).toHaveBeenCalledOnce();
    expect(transport.push).toHaveBeenCalledTimes(4);
    expect(transport.publicationMetadata.size).toBe(4);
    expect(transport.sourceTracks).toEqual(
      new Map([
        ["cam-audio-local-participant", [microphone]],
        ["cam-video-local-participant", [camera]],
        ["screen-audio-local-participant", [screenAudio]],
        ["screen-video-local-participant", [screenVideo]],
      ]),
    );
    expect(
      send.mock.calls.some(([message]) =>
        FORBIDDEN_BROWSER_NATIVE_SIGNALING_OPCODES.has(message.op),
      ),
    ).toBe(false);
  });

  it("publishes later browser acquisitions immediately when MediaReady arrives first", async () => {
    const transport = new TestPartyTracksTransport();
    const client = new SFUClient("test-room", {
      createPartyTracksTransport: vi.fn(() => transport),
    });
    vi.spyOn(client.voiceGW, "connectVoice").mockImplementation(() => {});
    const onVoiceReconnected = vi.fn();
    client.on("voice-reconnected", onVoiceReconnected);
    client.roomGW.emit("media-ready", {
      participantId: "local-participant",
      voiceToken: "voice-token",
      iceServers: [{ urls: ["stun:example.test"] }],
    });

    const microphone = new MockMediaStreamTrack(
      "audio",
    ) as unknown as MediaStreamTrack;
    const camera = new MockMediaStreamTrack(
      "video",
    ) as unknown as MediaStreamTrack;
    const screenVideo = new MockMediaStreamTrack(
      "video",
    ) as unknown as MediaStreamTrack;
    await client.publishTracks(
      new MockMediaStream([microphone, camera]) as unknown as MediaStream,
      "cam",
    );
    await client.publishTracks(
      new MockMediaStream([screenVideo]) as unknown as MediaStream,
      "screen",
    );
    client.voiceGW.emit("voice-ready", { tracks: [] });

    expect(transport.sourceTracks).toEqual(
      new Map([
        ["cam-audio-local-participant", [microphone]],
        ["cam-video-local-participant", [camera]],
        ["screen-video-local-participant", [screenVideo]],
      ]),
    );
    expect(onVoiceReconnected).not.toHaveBeenCalled();
  });

  it("registers local publication before replayed remote pulls", () => {
    const transport = new TestPartyTracksTransport();
    const client = new SFUClient("test-room", {
      createPartyTracksTransport: vi.fn(() => transport),
    });
    vi.spyOn(client.voiceGW, "connectVoice").mockImplementation(() => {});
    const microphone = new MockMediaStreamTrack(
      "audio",
    ) as unknown as MediaStreamTrack;
    const localStream = new MockMediaStream([
      microphone,
    ]) as unknown as MediaStream;
    const remoteOffer: TrackInfo = {
      participant_id: "remote-participant",
      track_name: "cam-audio-remote-participant",
      sfu_track_name: "opaque-remote-audio",
      session_id: "remote-session-capability",
      kind: "audio",
    };
    client.on("voice-reconnected", () => {
      void client.publishTracks(localStream, "cam");
    });

    emitMediaReady(client);
    client.roomGW.emit("ready", {
      participantId: "local-participant",
      sessionId: "local-participant",
      iceServers: FIRST_ICE_SERVERS,
      voiceToken: "voice-token",
      tracksToQueue: [remoteOffer],
      participants: [],
    });
    client.voiceGW.emit("voice-ready", { tracks: [remoteOffer] });

    expect(transport.operationOrder).toEqual([
      "push:cam-audio-local-participant",
      "pull:cam-audio-remote-participant",
    ]);
    client.disconnect("component-unmount");
  });

  it("starts replayed pulls after VoiceReady when there is no local publication", () => {
    const transport = new TestPartyTracksTransport();
    const client = new SFUClient("test-room", {
      createPartyTracksTransport: vi.fn(() => transport),
    });
    vi.spyOn(client.voiceGW, "connectVoice").mockImplementation(() => {});
    const remoteOffer: TrackInfo = {
      participant_id: "remote-participant",
      track_name: "cam-audio-remote-participant",
      sfu_track_name: "opaque-remote-audio",
      session_id: "remote-session-capability",
      kind: "audio",
    };

    emitMediaReady(client);
    client.roomGW.emit("ready", {
      participantId: "local-participant",
      sessionId: "local-participant",
      iceServers: FIRST_ICE_SERVERS,
      voiceToken: "voice-token",
      tracksToQueue: [remoteOffer],
      participants: [],
    });
    expect(transport.operationOrder).toEqual([]);

    client.voiceGW.emit("voice-ready", { tracks: [remoteOffer] });

    expect(transport.operationOrder).toEqual([
      "pull:cam-audio-remote-participant",
    ]);
    client.disconnect("component-unmount");
  });

  it("starts incremental TrackOffered pulls immediately", () => {
    const transport = new TestPartyTracksTransport();
    const client = new SFUClient("test-room", {
      createPartyTracksTransport: vi.fn(() => transport),
    });
    vi.spyOn(client.voiceGW, "connectVoice").mockImplementation(() => {});
    const remoteOffer: TrackInfo = {
      participant_id: "remote-participant",
      track_name: "cam-audio-remote-participant",
      sfu_track_name: "opaque-remote-audio",
      session_id: "remote-session-capability",
      kind: "audio",
    };

    emitMediaReady(client);
    client.voiceGW.emit("voice-ready", { tracks: [] });
    client.voiceGW.emit("track-offered", remoteOffer);

    expect(transport.operationOrder).toEqual([
      "pull:cam-audio-remote-participant",
    ]);
    client.disconnect("component-unmount");
  });

  it("uses one PartyTracks transport for immediate publication, remote pulls, replacement, and leave", async () => {
    const transport = new TestPartyTracksTransport();
    const createPartyTracksTransport = vi.fn(() => transport);
    const options: SFUClientOptions = { createPartyTracksTransport };
    const client = new SFUClient("test-room", options);
    vi.spyOn(client.voiceGW, "connectVoice").mockImplementation(() => {});
    const send = vi.spyOn(client.voiceGW, "send");
    const onRemoteTrack = vi.fn();
    client.on("remote-track", onRemoteTrack);

    client.roomGW.emit("media-ready", {
      participantId: "local-participant",
      voiceToken: "voice-token",
      iceServers: [{ urls: ["stun:example.test"] }],
    });

    expect(createPartyTracksTransport).toHaveBeenCalledOnce();
    const microphone = new MockMediaStreamTrack(
      "audio",
    ) as unknown as MediaStreamTrack;
    await client.publishTracks(
      new MockMediaStream([microphone]) as unknown as MediaStream,
      "cam",
    );
    expect(transport.sourceTracks.get("cam-audio-local-participant")).toEqual([
      microphone,
    ]);

    const publication: TrackInfo = {
      participant_id: "local-participant",
      track_name: "cam-audio-local-participant",
      sfu_track_name: "opaque-local-audio",
      session_id: "local-session-capability",
      kind: "audio",
    };
    transport.publicationMetadata
      .get(publication.track_name)
      ?.next(publication);
    expect(send).toHaveBeenCalledWith({
      op: 12,
      d: { tracks: [publication] },
    });

    const remoteOffer: TrackInfo = {
      participant_id: "remote-participant",
      track_name: "cam-audio-remote-participant",
      sfu_track_name: "opaque-remote-audio",
      session_id: "remote-session-capability-1",
      kind: "audio",
    };
    client.voiceGW.emit("voice-ready", { tracks: [remoteOffer] });
    expect(transport.pullMetadata.get(remoteOffer.track_name)).toEqual([
      remoteOffer,
    ]);
    expect(
      send.mock.calls.some(([message]) =>
        FORBIDDEN_BROWSER_NATIVE_SIGNALING_OPCODES.has(message.op),
      ),
    ).toBe(false);
    const remoteAudio = new MockMediaStreamTrack(
      "audio",
    ) as unknown as MediaStreamTrack;
    transport.remoteTracks.get(remoteOffer.track_name)?.next(remoteAudio);
    expect(onRemoteTrack).toHaveBeenCalledWith({
      participantId: "remote-participant",
      track: remoteAudio,
      trackInfo: remoteOffer,
      action: "add",
    });

    client.voiceGW.emit("track-offered", {
      ...remoteOffer,
      session_id: "remote-session-capability-2",
    });
    expect(transport.pullMetadata.get(remoteOffer.track_name)).toHaveLength(2);

    client.voiceGW.emit("stop-tracks", {
      track_names: [remoteOffer.track_name],
      tracks: [
        {
          ...remoteOffer,
          session_id: "remote-session-capability-2",
        },
      ],
    });
    expect(remoteAudio.stop).toHaveBeenCalledOnce();
    expect(
      send.mock.calls.some(([message]) =>
        FORBIDDEN_BROWSER_NATIVE_SIGNALING_OPCODES.has(message.op),
      ),
    ).toBe(false);

    const replacement = new MockMediaStreamTrack(
      "audio",
    ) as unknown as MediaStreamTrack;
    await expect(
      client.replaceTrack(publication.track_name, replacement),
    ).resolves.toBe(true);
    expect(transport.sourceTracks.get(publication.track_name)).toEqual([
      microphone,
      replacement,
    ]);

    client.disconnect("user-leave");
    expect(transport.dispose).toHaveBeenCalledOnce();
    expect(client.getParticipantId()).toBeNull();
  });

  it("drops stale legacy pull descriptors without allocating browser peer connections or signaling", async () => {
    const transport = new TestPartyTracksTransport();
    const client = new SFUClient("test-room", {
      createPartyTracksTransport: vi.fn(() => transport),
    });
    vi.spyOn(client.voiceGW, "connectVoice").mockImplementation(() => {});
    vi.spyOn(client.voiceGW, "isReady", "get").mockReturnValue(true);
    const send = vi.spyOn(client.voiceGW, "send");
    const originalPeerConnection = globalThis.RTCPeerConnection;
    const createPeerConnection = vi.fn(
      function createPeerConnection(): RTCPeerConnection {
        return new MockRTCPeerConnection() as unknown as RTCPeerConnection;
      },
    );
    vi.stubGlobal("RTCPeerConnection", createPeerConnection);
    client.roomGW.emit("media-ready", {
      participantId: "local-participant",
      voiceToken: "voice-token",
      iceServers: [{ urls: ["stun:example.test"] }],
    });
    const legacyTrack = (trackName: string): TrackInfo => ({
      participant_id: "stale-participant",
      track_name: trackName,
      session_id: "stale-legacy-session",
      kind: "audio",
    });

    try {
      client.pullTracks([legacyTrack("legacy-direct")]);
      client.voiceGW.emit("voice-ready", {
        tracks: [legacyTrack("legacy-voice-ready")],
      });
      client.voiceGW.emit("track-offered", legacyTrack("legacy-track-offered"));
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(
        send.mock.calls
          .map(([message]) => message.op)
          .filter((opcode) =>
            FORBIDDEN_BROWSER_NATIVE_SIGNALING_OPCODES.has(opcode),
          ),
      ).toEqual([]);
      expect(createPeerConnection).not.toHaveBeenCalled();
      expect(transport.pullMetadata.size).toBe(0);
    } finally {
      client.disconnect("component-unmount");
      vi.stubGlobal("RTCPeerConnection", originalPeerConnection);
    }
  });
});
