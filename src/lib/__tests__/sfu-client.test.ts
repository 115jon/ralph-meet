import { beforeEach, describe, expect, it, vi } from "vitest";

const { logInfo } = vi.hoisted(() => ({ logInfo: vi.fn() }));

vi.mock("@/lib/console-logger", () => ({
  clog: () => ({
    debug: vi.fn(),
    info: logInfo,
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { SFUClient } from "../sfu-client";

import {
  MockMediaStream,
  MockMediaStreamTrack,
  MockRTCPeerConnection,
  setupWebRTCMocks,
} from "./webrtc-mocks";

setupWebRTCMocks();

describe("SFUClient Baseline Tests", () => {
  let client: SFUClient;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new SFUClient("test-room");

    // Force set private properties for testing
    (client as any).participantId = "p123";
    (client as any).voiceToken = "token123";
    (client as any).negotiator.camPushPC = new MockRTCPeerConnection();

    // Mock the VoiceGateway socket to not actually send things.
    (client as any).roomGW.isIdentified = true;
    (client as any).roomGW.ws = {
      readyState: 1, // OPEN
      send: vi.fn(),
    };
    (client as any).voiceGW.isIdentified = true;
    (client as any).voiceGW.ws = {
      readyState: 1, // OPEN
      send: vi.fn(),
    };

    // Resolve the internal readiness promises so queue flows instantly
    (client as any).voiceReadyPromise = Promise.resolve();
    (client as any).pcReadyPromise = Promise.resolve();

    // Mock the wait helpers to return instantly during tests
    vi.spyOn(client as any, "waitForPushNegotiationDone").mockResolvedValue(
      undefined,
    );
    vi.spyOn(client as any, "waitForPushAnswer").mockResolvedValue(undefined);
    (client as any).negotiator.config.waitForPushNegotiationDone = vi
      .fn()
      .mockResolvedValue(undefined);
    (client as any).negotiator.config.waitForPushAnswer = vi
      .fn()
      .mockResolvedValue(undefined);
  });

  it("can be instantiated", () => {
    const client = new SFUClient("test-room");
    expect(client).toBeDefined();
  });

  it("starts RoomGW and VoiceGW preparation in the same initial connect turn", () => {
    const roomConnect = vi.spyOn(client.roomGW, "connectRoom");
    const voicePrepare = vi.spyOn(client.voiceGW, "prepareVoice");

    client.connect("Ada", undefined, "clerk-user", "ada", "Ada", null, {
      channelId: "channel-1",
      serverId: "server-1",
    });

    expect(roomConnect).toHaveBeenCalledOnce();
    expect(voicePrepare).toHaveBeenCalledOnce();
    expect(roomConnect.mock.invocationCallOrder[0]).toBeLessThan(
      voicePrepare.mock.invocationCallOrder[0]!,
    );
  });

  describe("getConnectionState", () => {
    it("treats joined sessions without inbound media as connected", () => {
      (
        (client as any).negotiator.camPushPC as MockRTCPeerConnection
      ).connectionState = "connected";
      (client as any).negotiator.pullPC = new MockRTCPeerConnection();
      (
        (client as any).negotiator.pullPC as MockRTCPeerConnection
      ).connectionState = "disconnected";
      (client as any).pendingPullTracks = [];
      (client as any).negotiator.pulledTracks = [];

      expect(client.getPublishConnectionState()).toBe("connected");
      expect(client.getSubscribeConnectionState()).toBe("idle");
      expect(client.getConnectionState()).toBe("connected");
    });
  });

  it("refreshes voice credentials before the one-hour token expires", async () => {
    vi.useFakeTimers();
    const send = (client.roomGW as any).ws.send as ReturnType<typeof vi.fn>;

    (client as any).scheduleCredentialRefresh();
    await vi.advanceTimersByTimeAsync(45 * 60 * 1000 - 1);
    expect(send).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(JSON.parse(send.mock.calls[0]?.[0] as string)).toEqual({
      op: 40,
      d: {},
    });
    vi.useRealTimers();
  });

  describe("disconnect", () => {
    it("logs the caller's teardown reason before closing the session", () => {
      client.disconnect("component-unmount");

      expect(logInfo).toHaveBeenCalledWith(
        "Disconnecting SFU client",
        expect.objectContaining({
          reason: "component-unmount",
          roomSlug: "test-room",
          participantId: "p123",
        }),
      );
    });

    it("turns a remote voice-gateway disconnect into speaking-off", () => {
      const onSpeaking = vi.fn();
      client.on("speaking", onSpeaking);

      (client.voiceGW as any).handleMessage({
        op: 11,
        d: { participant_id: "remote-participant" },
      });

      expect(onSpeaking).toHaveBeenCalledWith({
        participantId: "remote-participant",
        speaking: 0,
      });
    });
  });

  describe("publishTracks", () => {
    it("starts and stops outbound audio monitoring with cam publication", async () => {
      const audioTrack = new MockMediaStreamTrack("audio");
      const start = vi.spyOn(client.outboundAudioSentinel, "start");
      const stop = vi.spyOn(client.outboundAudioSentinel, "stop");

      await client.publishTracks(
        new MockMediaStream([audioTrack]) as any,
        "cam",
      );

      expect(start).toHaveBeenCalledOnce();
      client.disconnect();
      expect(stop).toHaveBeenCalledOnce();
    });

    it("does not start microphone VAD for a video-only publication", async () => {
      const videoTrack = new MockMediaStreamTrack("video");
      const startVad = vi.spyOn(client.vad, "start");

      await client.publishTracks(
        new MockMediaStream([videoTrack]) as any,
        "cam",
      );

      expect(startVad).not.toHaveBeenCalled();
    });

    it("should add transceivers and create an offer for audio and video", async () => {
      const audioTrack = new MockMediaStreamTrack("audio");
      const videoTrack = new MockMediaStreamTrack("video");
      const stream = new MockMediaStream([audioTrack, videoTrack]);

      const pushPC = (client as any).negotiator
        .camPushPC as MockRTCPeerConnection;

      await client.publishTracks(stream as any, "cam");

      // Verify transceivers were added
      expect(pushPC.addTransceiver).toHaveBeenCalledTimes(2);

      // Audio transceiver check (128kbps for cam voice audio)
      expect(pushPC.addTransceiver).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ kind: "audio" }),
        expect.objectContaining({
          direction: "sendonly",
          sendEncodings: expect.arrayContaining([
            { maxBitrate: 128000, priority: "high", networkPriority: "high" },
          ]),
        }),
      );

      // Video transceiver check (simulcast layers for cam)
      expect(pushPC.addTransceiver).toHaveBeenNthCalledWith(
        2,
        videoTrack,
        expect.objectContaining({
          direction: "sendonly",
          sendEncodings: expect.arrayContaining([
            { rid: "h", maxBitrate: 1200000, priority: "high" },
            {
              rid: "m",
              maxBitrate: 400000,
              scaleResolutionDownBy: 2,
              priority: "medium",
            },
            {
              rid: "l",
              maxBitrate: 100000,
              scaleResolutionDownBy: 4,
              priority: "low",
            },
          ]),
        }),
      );

      // Verify offer was created and set
      expect(pushPC.createOffer).toHaveBeenCalledTimes(1);
      expect(pushPC.setLocalDescription).toHaveBeenCalledTimes(1);
      expect(pushPC.localDescription).toEqual(
        expect.objectContaining({ type: "offer" }),
      );

      // Verify WS message sent
      expect((client as any).voiceGW.ws.send).toHaveBeenCalledTimes(2);

      // Parse WS calls to verify correctly shaped messages
      const calls = ((client as any).voiceGW.ws.send as any).mock.calls.map(
        (c: any) => JSON.parse(c[0]),
      );

      const selectProtocolCall = calls.find((c: any) => c.op === 1);
      expect(selectProtocolCall).toBeDefined();
      expect(selectProtocolCall.d.push_tracks).toHaveLength(2);
      expect(selectProtocolCall.d.push_tracks[0].track_name).toBe(
        "cam-audio-p123",
      );
      expect(selectProtocolCall.d.push_tracks[1].track_name).toBe(
        "cam-video-p123",
      );

      const tracksReadyCall = calls.find((c: any) => c.op === 102);
      expect(tracksReadyCall).toBeDefined();
      expect(tracksReadyCall.d.track_names).toEqual([
        "cam-audio-p123",
        "cam-video-p123",
      ]);
    });

    it("should configure single stream for screen share video", async () => {
      const videoTrack = new MockMediaStreamTrack("video");
      const stream = new MockMediaStream([videoTrack]);

      // Screen tracks go to screenPushPC, which must exist
      (client as any).negotiator.screenPushPC = new MockRTCPeerConnection();
      const screenPC = (client as any).negotiator
        .screenPushPC as MockRTCPeerConnection;

      await client.publishTracks(stream as any, "screen");

      // Video transceiver check (NO simulcast layers for screen)
      const publishedTrack = screenPC.addTransceiver.mock.calls[0][0];
      expect(screenPC.addTransceiver).toHaveBeenCalledTimes(1);
      expect(publishedTrack).not.toBe(videoTrack);
      expect(publishedTrack).toMatchObject({
        kind: "video",
        label: videoTrack.label,
      });
      expect(screenPC.addTransceiver).toHaveBeenCalledWith(
        publishedTrack,
        expect.objectContaining({
          direction: "sendonly",
          sendEncodings: [
            {
              maxBitrate: 24000000,
              scaleResolutionDownBy: 1,
              priority: "high",
              networkPriority: "high",
            },
          ],
        }),
      );
    });

    it("should reuse existing transceivers when re-published directly", async () => {
      const videoTrack = new MockMediaStreamTrack("video");
      const stream = new MockMediaStream([videoTrack]);
      const pushPC = (client as any).negotiator
        .camPushPC as MockRTCPeerConnection;

      // First publish
      await client.publishTracks(stream as any, "cam");
      expect(pushPC.addTransceiver).toHaveBeenCalledTimes(1);

      const newVideoTrack = new MockMediaStreamTrack("video");
      const newStream = new MockMediaStream([newVideoTrack]);

      // Second publish
      await client.publishTracks(newStream as any, "cam");

      // Transceiver shouldn't be added again
      expect(pushPC.addTransceiver).toHaveBeenCalledTimes(1);
      // It should replace the track on the existing sender
      expect(pushPC.transceivers[0].sender.replaceTrack).toHaveBeenCalledWith(
        newVideoTrack,
      );
    });

    it("replaces audio with a sender clone and reapplies the VAD gate", async () => {
      const initialTrack = new MockMediaStreamTrack("audio");
      await client.publishTracks(
        new MockMediaStream([initialTrack]) as any,
        "cam",
      );
      const transceiver = (client as any).negotiator.camPushPC.transceivers[0];
      const previousSenderTrack = transceiver.sender.track;
      expect(previousSenderTrack).not.toBe(initialTrack);
      expect(initialTrack.stop).not.toHaveBeenCalled();
      const reapplyGate = vi.spyOn(client.vad, "reapplyGate");
      const replacementTrack = new MockMediaStreamTrack("audio");

      await expect(
        client.replaceTrack(
          "cam-audio-p123",
          replacementTrack as unknown as MediaStreamTrack,
        ),
      ).resolves.toBe(true);

      expect(transceiver.sender.track).not.toBe(replacementTrack);
      expect(transceiver.sender.track).not.toBe(previousSenderTrack);
      expect(previousSenderTrack.stop).toHaveBeenCalledOnce();
      expect(reapplyGate).toHaveBeenCalledOnce();
    });

    it("restores the previous audio sender when replacement changes then rejects", async () => {
      const initialTrack = new MockMediaStreamTrack("audio");
      await client.publishTracks(
        new MockMediaStream([initialTrack]) as any,
        "cam",
      );
      const transceiver = (client as any).negotiator.camPushPC.transceivers[0];
      const previousSenderTrack = transceiver.sender.track;
      const replacementTrack = new MockMediaStreamTrack("audio");
      transceiver.sender.replaceTrack.mockImplementationOnce(
        async (track: MediaStreamTrack) => {
          transceiver.sender.track = track;
          throw new Error("replacement failed after sender update");
        },
      );

      await expect(
        client.replaceTrack(
          "cam-audio-p123",
          replacementTrack as unknown as MediaStreamTrack,
        ),
      ).rejects.toThrow("replacement failed after sender update");

      expect(transceiver.sender.track).toBe(previousSenderTrack);
      expect(replacementTrack.stop).not.toHaveBeenCalled();
    });

    it("rejects a conditional audio replacement after ownership changes", async () => {
      const initialTrack = new MockMediaStreamTrack("audio");
      await client.publishTracks(
        new MockMediaStream([initialTrack]) as any,
        "cam",
      );
      const transceiver = (client as any).negotiator.camPushPC.transceivers[0];
      const expectedTrack = transceiver.sender.track;
      const newerTrack = new MockMediaStreamTrack("audio");
      await client.replaceTrack(
        "cam-audio-p123",
        newerTrack as unknown as MediaStreamTrack,
      );
      const attemptedTrack = new MockMediaStreamTrack("audio");

      await expect(
        client.replaceTrackIfCurrent(
          "cam-audio-p123",
          expectedTrack,
          attemptedTrack as unknown as MediaStreamTrack,
        ),
      ).resolves.toBe(false);
      expect(transceiver.sender.track).not.toBe(attemptedTrack);
    });
  });

  describe("handleSessionDescription", () => {
    it("should process push answer and complete negotiation", async () => {
      const pushPC = (client as any).negotiator
        .camPushPC as MockRTCPeerConnection;
      // Simulate cam PC waiting for answer
      (pushPC as any).signalingState = "have-local-offer";

      const payload = {
        sdp: "mock-answer-sdp",
        sdp_type: "answer" as const,
        session_id: "push-session-1",
        tracks: [],
      };

      await (client as any).negotiator.handleSessionDescription(
        payload,
        "push",
        "cam",
      );

      expect(pushPC.setRemoteDescription).toHaveBeenCalledWith({
        type: "answer",
        sdp: "mock-answer-sdp",
      });
      // Should not create answer for an answer
      expect(pushPC.createAnswer).not.toHaveBeenCalled();
    });

    it("should process pull offer and create answer", async () => {
      // Force initialization of pullPC
      (client as any).negotiator.pullPC = new MockRTCPeerConnection();
      const pullPC = (client as any).negotiator.pullPC as MockRTCPeerConnection;

      const payload = {
        sdp: "mock-pull-offer-sdp",
        sdp_type: "offer" as const,
        session_id: "pull-session-1",
        tracks: [],
      };

      await (client as any).negotiator.handleSessionDescription(
        payload,
        "pull",
      );

      expect(pullPC.setRemoteDescription).toHaveBeenCalledWith({
        type: "offer",
        sdp: "mock-pull-offer-sdp",
      });
      expect(pullPC.createAnswer).toHaveBeenCalledTimes(1);
      expect(pullPC.setLocalDescription).toHaveBeenCalledTimes(1);

      // Verify the answer was sent back over WS
      const calls = ((client as any).voiceGW.ws.send as any).mock.calls.map(
        (c: any) => JSON.parse(c[0]),
      );
      const answerCall = calls.find((c: any) => c.op === 14); // VoiceOpcode.Answer
      expect(answerCall).toBeDefined();
      expect(answerCall.d.sdp).toBe("v=0\r\no=- 0 0 IN IP4 0.0.0.0\r\n");
    });
  });

  describe("pullTracks", () => {
    it("tags pull SelectProtocol messages with a request id", async () => {
      vi.spyOn(client as any, "waitForPullOffer").mockResolvedValue(undefined);
      vi.spyOn(client as any, "waitForPullNegotiationDone").mockResolvedValue(
        undefined,
      );
      (client as any).negotiator.pullPC = new MockRTCPeerConnection();

      await client.pullTracks([
        {
          participant_id: "remote-a",
          track_name: "cam-audio-remote-a",
          session_id: "session-a",
          kind: "audio",
        },
      ]);
      await (client as any).pullQueue;

      const calls = ((client as any).voiceGW.ws.send as any).mock.calls.map(
        (c: any) => JSON.parse(c[0]),
      );
      const selectProtocolCall = calls.find(
        (c: any) => c.op === 1 && c.d.pull_tracks.length === 1,
      );

      expect(selectProtocolCall).toBeDefined();
      expect(selectProtocolCall.d.request_id).toMatch(/^pull-/);
    });

    it("maps a synchronous ontrack event without the metadata retry delay", async () => {
      (client as any).negotiator.pullPC = null;
      (client as any).createPeerConnections();
      const pullPC = (client as any).negotiator.pullPC as MockRTCPeerConnection;
      const pullPCWithTrackHandler = pullPC as MockRTCPeerConnection & {
        ontrack?: (event: RTCTrackEvent) => void;
      };
      const remoteTrack = new MockMediaStreamTrack("audio");
      const onRemoteTrack = vi.fn();
      client.on("remote-track", onRemoteTrack);

      pullPC.setRemoteDescription.mockImplementationOnce(async () => {
        pullPCWithTrackHandler.ontrack?.({
          track: remoteTrack,
          transceiver: { mid: "0" },
        } as unknown as RTCTrackEvent);
      });
      (client as any).negotiator.pulledTracks = [
        {
          participant_id: "remote-a",
          track_name: "cam-audio-remote-a",
          session_id: "session-a",
          kind: "audio",
        },
      ];

      await (client as any).negotiator.handleSessionDescription(
        {
          sdp: "mock-pull-offer-sdp",
          sdp_type: "offer",
          session_id: "pull-session-a",
          request_id: "pull-request-a",
          tracks: [
            {
              participant_id: "remote-a",
              track_name: "cam-audio-remote-a",
              session_id: "session-a",
              mid: "0",
              kind: "audio",
            },
          ],
        },
        "pull",
      );

      expect(onRemoteTrack).toHaveBeenCalledWith(
        expect.objectContaining({
          participantId: "remote-a",
          track: remoteTrack,
          action: "add",
        }),
      );

      const replacementTrack = new MockMediaStreamTrack("audio");
      pullPC.setRemoteDescription.mockImplementationOnce(async () => {
        pullPCWithTrackHandler.ontrack?.({
          track: replacementTrack,
          transceiver: { mid: "0" },
        } as unknown as RTCTrackEvent);
      });
      (client as any).negotiator.pulledTracks = [
        {
          participant_id: "remote-a",
          track_name: "cam-audio-remote-a",
          session_id: "session-a",
          mid: "0",
          kind: "audio",
        },
        {
          participant_id: "remote-b",
          track_name: "cam-audio-remote-b",
          session_id: "session-b",
          kind: "audio",
        },
      ];

      await (client as any).negotiator.handleSessionDescription(
        {
          sdp: "mock-pull-offer-sdp",
          sdp_type: "offer",
          session_id: "pull-session-b",
          request_id: "pull-request-b",
          tracks: [
            {
              participant_id: "remote-b",
              track_name: "cam-audio-remote-b",
              session_id: "session-b",
              mid: "0",
              kind: "audio",
            },
          ],
        },
        "pull",
      );

      expect(onRemoteTrack).toHaveBeenCalledTimes(2);
      expect(onRemoteTrack).toHaveBeenLastCalledWith(
        expect.objectContaining({
          participantId: "remote-b",
          track: replacementTrack,
          action: "add",
        }),
      );
    });

    it("does not publish a remote track when pull answer creation fails", async () => {
      (client as any).negotiator.pullPC = null;
      (client as any).createPeerConnections();
      const pullPC = (client as any).negotiator.pullPC as MockRTCPeerConnection;
      const pullPCWithTrackHandler = pullPC as MockRTCPeerConnection & {
        ontrack?: (event: RTCTrackEvent) => void;
      };
      const remoteTrack = new MockMediaStreamTrack("audio");
      const onRemoteTrack = vi.fn();
      client.on("remote-track", onRemoteTrack);

      pullPC.setRemoteDescription.mockImplementationOnce(async () => {
        pullPCWithTrackHandler.ontrack?.({
          track: remoteTrack,
          transceiver: { mid: "0" },
        } as unknown as RTCTrackEvent);
      });
      pullPC.createAnswer.mockRejectedValueOnce(
        new Error("pull answer failed"),
      );
      (client as any).negotiator.pulledTracks = [
        {
          participant_id: "remote-a",
          track_name: "cam-audio-remote-a",
          session_id: "session-a",
          kind: "audio",
        },
      ];

      await expect(
        (client as any).negotiator.handleSessionDescription(
          {
            sdp: "mock-pull-offer-sdp",
            sdp_type: "offer",
            session_id: "pull-session-a",
            request_id: "pull-request-a",
            tracks: [
              {
                participant_id: "remote-a",
                track_name: "cam-audio-remote-a",
                session_id: "session-a",
                mid: "0",
                kind: "audio",
              },
            ],
          },
          "pull",
        ),
      ).rejects.toThrow("pull answer failed");
      expect(onRemoteTrack).not.toHaveBeenCalled();
    });

    it("re-emits a track after the pull PC is rebuilt", async () => {
      (client as any).negotiator.pullPC = null;
      (client as any).createPeerConnections();
      const firstPC = (client as any).negotiator
        .pullPC as MockRTCPeerConnection;
      const firstTrack = new MockMediaStreamTrack("audio");
      const onRemoteTrack = vi.fn();
      client.on("remote-track", onRemoteTrack);

      const setTrackEvent = (
        pc: MockRTCPeerConnection,
        track: MockMediaStreamTrack,
      ) => {
        const withHandler = pc as MockRTCPeerConnection & {
          ontrack?: (event: RTCTrackEvent) => void;
        };
        pc.setRemoteDescription.mockImplementationOnce(async () => {
          withHandler.ontrack?.({
            track,
            transceiver: { mid: "0" },
          } as unknown as RTCTrackEvent);
        });
      };

      const offer = {
        sdp: "mock-pull-offer-sdp",
        sdp_type: "offer" as const,
        session_id: "pull-session-a",
        request_id: "pull-request-a",
        tracks: [
          {
            participant_id: "remote-a",
            track_name: "cam-audio-remote-a",
            session_id: "session-a",
            mid: "0",
            kind: "audio" as const,
          },
        ],
      };
      (client as any).negotiator.pulledTracks = [
        {
          participant_id: "remote-a",
          track_name: "cam-audio-remote-a",
          session_id: "session-a",
          kind: "audio",
        },
      ];
      setTrackEvent(firstPC, firstTrack);
      await (client as any).negotiator.handleSessionDescription(offer, "pull");

      vi.spyOn(client, "pullTracks").mockResolvedValue(undefined);
      (client as any).resetPullAndRepull([
        {
          participant_id: "remote-a",
          track_name: "cam-audio-remote-a",
          session_id: "session-a",
          kind: "audio",
        },
      ]);
      expect((client as any).emittedTrackKeys.size).toBe(0);
      const secondPC = (client as any).negotiator
        .pullPC as MockRTCPeerConnection;
      (client as any).negotiator.pulledTracks = [
        {
          participant_id: "remote-a",
          track_name: "cam-audio-remote-a",
          session_id: "session-a",
          kind: "audio",
        },
      ];
      expect(
        (secondPC as MockRTCPeerConnection & { ontrack?: unknown }).ontrack,
      ).toBeDefined();
      setTrackEvent(secondPC, new MockMediaStreamTrack("audio"));
      await (client as any).negotiator.handleSessionDescription(offer, "pull");

      expect(secondPC.setRemoteDescription).toHaveBeenCalledOnce();
      expect(onRemoteTrack).toHaveBeenCalledTimes(2);
    });

    it("ignores delayed metadata from a retired pull PC", async () => {
      (client as any).negotiator.pullPC = null;
      (client as any).createPeerConnections();
      const oldPC = (client as any).negotiator.pullPC as MockRTCPeerConnection;
      const oldHandler = oldPC as MockRTCPeerConnection & {
        ontrack?: (event: RTCTrackEvent) => void;
      };
      const onRemoteTrack = vi.fn();
      client.on("remote-track", onRemoteTrack);
      vi.spyOn(client, "pullTracks").mockResolvedValue(undefined);

      oldHandler.ontrack?.({
        track: new MockMediaStreamTrack("audio"),
        transceiver: { mid: "0" },
      } as unknown as RTCTrackEvent);
      (client as any).resetPullAndRepull([]);

      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(onRemoteTrack).not.toHaveBeenCalled();
    });

    it("allows the same track session to return after participant leave", () => {
      (client as any).negotiator.pulledTracks = [
        {
          participant_id: "remote-a",
          track_name: "cam-audio-remote-a",
          session_id: "session-a",
          mid: "0",
          kind: "audio",
        },
      ];
      (client as any).emittedTrackKeys.add("cam-audio-remote-a:session-a");

      (client as any).roomGW.emit("participant-left", {
        participantId: "remote-a",
      });

      expect((client as any).emittedTrackKeys).not.toContain(
        "cam-audio-remote-a:session-a",
      );
    });
  });

  describe("resetPullSession", () => {
    it("should close existing pullPC and clear state", () => {
      // Force initialization of pullPC
      (client as any).negotiator.pullPC = new MockRTCPeerConnection();
      const oldPullPC = (client as any).negotiator
        .pullPC as MockRTCPeerConnection;

      (client as any).negotiator.resetPullSession();

      // Should close old PC
      expect(oldPullPC.close).toHaveBeenCalledTimes(1);

      // Should clear state
      expect((client as any).negotiator.pullSessionId).toBeNull();
      expect((client as any).negotiator.pullPC).toBeNull();
    });
  });

  describe("VoiceReady pull reconciliation", () => {
    it("rebuilds media when RoomGW creates a fresh participant generation", () => {
      const oldCamPC = new MockRTCPeerConnection();
      const oldPullPC = new MockRTCPeerConnection();
      (client as any).participantId = "old-participant";
      (client as any).negotiator.camPushPC = oldCamPC;
      (client as any).negotiator.pullPC = oldPullPC;

      const mediaReconnect = vi.fn();
      client.on("voice-reconnected", mediaReconnect);
      vi.spyOn(client.voiceGW, "disconnect").mockImplementation(() => {});
      vi.spyOn(client.voiceGW, "connectVoice").mockImplementation(() => {});

      client.roomGW.emit("ready", {
        participantId: "new-participant",
        sessionId: "new-participant",
        iceServers: [],
        voiceToken: "voice-token",
        tracksToQueue: [],
        participants: [],
      });
      client.voiceGW.emit("voice-ready", { tracks: [] });

      expect(oldCamPC.close).toHaveBeenCalledOnce();
      expect(oldPullPC.close).toHaveBeenCalledOnce();
      expect(mediaReconnect).toHaveBeenCalledOnce();
    });

    it("rebuilds established media when VoiceGW cannot transfer the SFU session", () => {
      const oldPullPC = new MockRTCPeerConnection();
      oldPullPC.iceConnectionState = "connected";
      (client as any).negotiator.pullPC = oldPullPC;

      const mediaReconnect = vi.fn();
      client.on("voice-reconnected", mediaReconnect);

      client.voiceGW.emit("voice-ready", {
        tracks: [],
        sfu_session_transferred: false,
      });

      expect(oldPullPC.close).toHaveBeenCalledOnce();
      expect(mediaReconnect).toHaveBeenCalledOnce();
    });

    it("pulls remote VoiceReady tracks during a fresh local SFU rebuild", () => {
      const pullSpy = vi
        .spyOn(client, "pullTracks")
        .mockResolvedValue(undefined);
      const oldPullPC = new MockRTCPeerConnection();
      oldPullPC.iceConnectionState = "connected";
      (client as any).negotiator.pullPC = oldPullPC;

      vi.spyOn(client.voiceGW, "disconnect").mockImplementation(() => {});
      vi.spyOn(client.voiceGW, "connectVoice").mockImplementation(() => {});
      client.on("voice-reconnected", () => {});

      client.voiceGW.emit("voice-ready", {
        sfu_session_transferred: false,
        tracks: [
          {
            participant_id: "remote-a",
            track_name: "cam-audio-remote-a",
            session_id: "dead-session",
            kind: "audio",
          },
        ],
      });

      expect(pullSpy).toHaveBeenCalledWith([
        expect.objectContaining({ track_name: "cam-audio-remote-a" }),
      ]);
    });

    it("sends a real pull operation for remote tracks after fresh VoiceReady", async () => {
      const send = (client.voiceGW as any).ws.send as ReturnType<typeof vi.fn>;
      const pullPC = new MockRTCPeerConnection();
      pullPC.iceConnectionState = "new";
      (client as any).negotiator.pullPC = pullPC;
      vi.spyOn(client as any, "waitForPullOffer").mockResolvedValue(undefined);
      vi.spyOn(client as any, "waitForPullNegotiationDone").mockResolvedValue(
        undefined,
      );

      client.voiceGW.emit("voice-ready", {
        sfu_session_transferred: false,
        tracks: [
          {
            participant_id: "remote-a",
            track_name: "cam-audio-remote-a",
            session_id: "remote-session",
            kind: "audio",
          },
        ],
      });

      await vi.waitFor(() => {
        const payload = JSON.parse(send.mock.calls[0]?.[0] as string);
        expect(payload.op).toBe(1);
        expect(payload.d.pull_tracks).toEqual([
          expect.objectContaining({ track_name: "cam-audio-remote-a" }),
        ]);
      });
    });

    it("isolates a correlated pull error from an active push publication", () => {
      const pushRejector = vi.fn();
      const pullRejector = vi.fn();
      (client as any).camPushRejector = pushRejector;
      (client as any).pullRejector = pullRejector;
      (client as any).activePullRequestId = "pull-1";

      client.voiceGW.emit("error", {
        message: "Requested track is not available",
        code: 4000,
        request_id: "pull-1",
        operation: "pull",
      });

      expect(pullRejector).toHaveBeenCalledOnce();
      expect(pushRejector).not.toHaveBeenCalled();
    });

    it("does not run stale PC recovery after media generation reset", async () => {
      let resolveOldVoiceReady!: () => void;
      (client as any).voiceReadyPromise = new Promise<void>((resolve) => {
        resolveOldVoiceReady = resolve;
      });
      (client as any).voiceReadyResolve = resolveOldVoiceReady;
      (client as any).participantId = "old-participant";
      vi.spyOn(client.voiceGW, "disconnect").mockImplementation(() => {});
      vi.spyOn(client.voiceGW, "connectVoice").mockImplementation(() => {});
      const forceReconnect = vi.spyOn(client.voiceGW, "forceReconnect");

      const recovery = (
        client as any
      ).runVoiceGWReconnectRecovery() as Promise<void>;
      client.roomGW.emit("ready", {
        participantId: "new-participant",
        sessionId: "new-participant",
        iceServers: [],
        voiceToken: "voice-token",
        tracksToQueue: [],
        participants: [],
      });
      client.voiceGW.emit("voice-ready", { tracks: [] });
      const freshCamPC = (client as any).negotiator.camPushPC;

      await recovery;

      expect(freshCamPC.close).not.toHaveBeenCalled();
      expect(forceReconnect).not.toHaveBeenCalled();
    });

    it("keeps a fresh new pull PC and uses it for the initial pull", () => {
      const pullPC = new MockRTCPeerConnection();
      pullPC.iceConnectionState = "new";
      pullPC.connectionState = "new";

      (client as any).negotiator.pullPC = pullPC;
      (client as any).negotiator.pulledTracks = [];

      const resetSpy = vi.spyOn(
        (client as any).rtcSessionManager,
        "resetPullSession",
      );
      const pullSpy = vi
        .spyOn(client, "pullTracks")
        .mockResolvedValue(undefined);

      (client as any).voiceGW.emit("voice-ready", {
        tracks: [
          {
            participant_id: "remote-a",
            track_name: "cam-audio-remote-a",
            session_id: "session-a",
            kind: "audio",
          },
        ],
        sfu_session_transferred: true,
      });

      expect(resetSpy).not.toHaveBeenCalled();
      expect(pullSpy).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ track_name: "cam-audio-remote-a" }),
        ]),
      );
    });

    it("keeps a connected pull PC when expected receivers are live", () => {
      const pullPC = new MockRTCPeerConnection();
      pullPC.iceConnectionState = "connected";
      pullPC.connectionState = "connected";
      pullPC.transceivers.push({
        mid: "audio-mid",
        receiver: { track: { kind: "audio", readyState: "live" } },
      });

      (client as any).negotiator.pullPC = pullPC;
      (client as any).negotiator.pulledTracks = [
        {
          participant_id: "remote-a",
          track_name: "cam-audio-remote-a",
          session_id: "session-a",
          mid: "audio-mid",
          kind: "audio",
        },
      ];

      const resetSpy = vi
        .spyOn(client as any, "resetPullAndRepull")
        .mockImplementation(() => {});
      const pullSpy = vi
        .spyOn(client, "pullTracks")
        .mockResolvedValue(undefined);

      (client as any).voiceGW.emit("voice-ready", {
        tracks: [
          {
            participant_id: "remote-a",
            track_name: "cam-audio-remote-a",
            session_id: "session-a",
            mid: "audio-mid",
            kind: "audio",
          },
        ],
        sfu_session_transferred: true,
      });

      expect(resetSpy).not.toHaveBeenCalled();
      expect(pullSpy).not.toHaveBeenCalled();
      expect((client as any).pendingPullTracks).toEqual([]);
    });

    it("rebuilds the pull session when server state exists but the receiver is missing", () => {
      const pullPC = new MockRTCPeerConnection();
      pullPC.iceConnectionState = "connected";
      pullPC.connectionState = "connected";

      (client as any).negotiator.pullPC = pullPC;
      (client as any).negotiator.pulledTracks = [
        {
          participant_id: "remote-a",
          track_name: "cam-audio-remote-a",
          session_id: "session-a",
          mid: "missing-mid",
          kind: "audio",
        },
      ];

      const resetSpy = vi
        .spyOn(client as any, "resetPullAndRepull")
        .mockImplementation(() => {});

      (client as any).voiceGW.emit("voice-ready", {
        tracks: [
          {
            participant_id: "remote-a",
            track_name: "cam-audio-remote-a",
            session_id: "session-a",
            mid: "missing-mid",
            kind: "audio",
          },
        ],
      });

      expect(resetSpy).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ track_name: "cam-audio-remote-a" }),
        ]),
      );
    });
  });
});
