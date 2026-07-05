import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SFUClient } from '../sfu-client';
import { RoomGateway } from '../voice/gateways/room-gateway';
import { VoiceGateway } from '../voice/gateways/voice-gateway';

import { MockMediaStream, MockMediaStreamTrack, MockRTCPeerConnection, setupWebRTCMocks } from './webrtc-mocks';

setupWebRTCMocks();


describe('SFUClient Baseline Tests', () => {
  let client: SFUClient;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new SFUClient('test-room');

    // Force set private properties for testing
    (client as any).participantId = 'p123';
    (client as any).voiceToken = 'token123';
    (client as any).negotiator.camPushPC = new MockRTCPeerConnection();

    // Mock the VoiceGateway socket to not actually send things.
    (client as any).voiceGW.isIdentified = true;
    (client as any).voiceGW.ws = {
      readyState: 1, // OPEN
      send: vi.fn()
    };

    // Resolve the internal readiness promises so queue flows instantly
    (client as any).voiceReadyPromise = Promise.resolve();
    (client as any).pcReadyPromise = Promise.resolve();

    // Mock the wait helpers to return instantly during tests
    vi.spyOn(client as any, 'waitForPushNegotiationDone').mockResolvedValue(undefined);
    vi.spyOn(client as any, 'waitForPushAnswer').mockResolvedValue(undefined);
    (client as any).negotiator.config.waitForPushNegotiationDone = vi.fn().mockResolvedValue(undefined);
    (client as any).negotiator.config.waitForPushAnswer = vi.fn().mockResolvedValue(undefined);
  });

  it('can be instantiated', () => {
    const client = new SFUClient('test-room');
    expect(client).toBeDefined();
  });

  it('uses an injected RTC transport instead of constructing its own split gateways', () => {
    const control = new RoomGateway();
    const media = new VoiceGateway();
    const transport = {
      topology: 'split',
      controlGateway: control,
      mediaGateway: media,
      connectControl: vi.fn(),
      syncMediaSession: vi.fn(),
      disconnect: vi.fn(),
      forceReconnect: vi.fn(),
    };

    const injectedClient = new SFUClient('test-room', transport as any);
    injectedClient.connect('Guest');

    expect(injectedClient.roomGW).toBe(control);
    expect(injectedClient.voiceGW).toBe(media);
    expect((injectedClient as any).rtcTransport).toBe(transport);
    expect(transport.connectControl).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Guest',
      roomSlug: 'test-room',
    }));
  });

  describe('publishTracks', () => {
    it('should add transceivers and create an offer for audio and video', async () => {
      const audioTrack = new MockMediaStreamTrack('audio');
      const videoTrack = new MockMediaStreamTrack('video');
      const stream = new MockMediaStream([audioTrack, videoTrack]);

      const pushPC = (client as any).negotiator.camPushPC as MockRTCPeerConnection;

      await client.publishTracks(stream as any, 'cam');

      // Verify transceivers were added
      expect(pushPC.addTransceiver).toHaveBeenCalledTimes(2);

      // Audio transceiver check (128kbps for cam voice audio)
      expect(pushPC.addTransceiver).toHaveBeenNthCalledWith(1, expect.objectContaining({ kind: 'audio' }), expect.objectContaining({
        direction: 'sendonly',
        sendEncodings: expect.arrayContaining([{ maxBitrate: 128000, priority: 'high', networkPriority: 'high' }])
      }));

      // Video transceiver check (simulcast layers for cam)
      expect(pushPC.addTransceiver).toHaveBeenNthCalledWith(2, videoTrack, expect.objectContaining({
        direction: 'sendonly',
        sendEncodings: expect.arrayContaining([
          { rid: 'h', maxBitrate: 1200000, priority: 'high' },
          { rid: 'm', maxBitrate: 400000, scaleResolutionDownBy: 2, priority: 'medium' },
          { rid: 'l', maxBitrate: 100000, scaleResolutionDownBy: 4, priority: 'low' }
        ])
      }));

      // Verify offer was created and set
      expect(pushPC.createOffer).toHaveBeenCalledTimes(1);
      expect(pushPC.setLocalDescription).toHaveBeenCalledTimes(1);
      expect(pushPC.localDescription).toEqual(expect.objectContaining({ type: 'offer' }));

      // Verify WS message sent
      expect((client as any).voiceGW.ws.send).toHaveBeenCalledTimes(2);

      // Parse WS calls to verify correctly shaped messages
      const calls = ((client as any).voiceGW.ws.send as any).mock.calls.map((c: any) => JSON.parse(c[0]));

      const selectProtocolCall = calls.find((c: any) => c.op === 1);
      expect(selectProtocolCall).toBeDefined();
      expect(selectProtocolCall.d.push_tracks).toHaveLength(2);
      expect(selectProtocolCall.d.push_tracks[0].track_name).toBe('cam-audio-p123');
      expect(selectProtocolCall.d.push_tracks[1].track_name).toBe('cam-video-p123');

      const tracksReadyCall = calls.find((c: any) => c.op === 102);
      expect(tracksReadyCall).toBeDefined();
      expect(tracksReadyCall.d.track_names).toEqual(['cam-audio-p123', 'cam-video-p123']);
    });

    it('should configure single stream for screen share video with initial sender parameters', async () => {
      const videoTrack = new MockMediaStreamTrack('video');
      const stream = new MockMediaStream([videoTrack]);

      // Screen tracks go to screenPushPC, which must exist
      (client as any).negotiator.screenPushPC = new MockRTCPeerConnection();
      const screenPC = (client as any).negotiator.screenPushPC as MockRTCPeerConnection;

      await client.publishTracks(stream as any, 'screen');

      // Video transceiver check (NO simulcast layers for screen)
      expect(screenPC.addTransceiver).toHaveBeenCalledTimes(1);
      const [, init] = screenPC.addTransceiver.mock.calls[0];
      expect(screenPC.addTransceiver).toHaveBeenCalledWith(videoTrack, expect.objectContaining({
        direction: 'sendonly',
        sendEncodings: expect.arrayContaining([
          { maxBitrate: 24_000_000, scaleResolutionDownBy: 1, priority: 'high', networkPriority: 'high' },
        ]),
      }));
      expect(init.sendEncodings).toEqual([
        { maxBitrate: 24_000_000, scaleResolutionDownBy: 1, priority: 'high', networkPriority: 'high' },
      ]);
      expect(screenPC.transceivers[0].sender.setParameters).toHaveBeenCalledWith(
        expect.objectContaining({
          encodings: init.sendEncodings,
          degradationPreference: 'maintain-resolution',
        }),
      );
    });

    it('should reuse existing transceivers when re-published directly', async () => {
      const videoTrack = new MockMediaStreamTrack('video');
      const stream = new MockMediaStream([videoTrack]);
      const pushPC = (client as any).negotiator.camPushPC as MockRTCPeerConnection;

      // First publish
      await client.publishTracks(stream as any, 'cam');
      expect(pushPC.addTransceiver).toHaveBeenCalledTimes(1);

      const newVideoTrack = new MockMediaStreamTrack('video');
      const newStream = new MockMediaStream([newVideoTrack]);

      // Second publish
      await client.publishTracks(newStream as any, 'cam');

      // Transceiver shouldn't be added again
      expect(pushPC.addTransceiver).toHaveBeenCalledTimes(1);
      // It should replace the track on the existing sender
      expect(pushPC.transceivers[0].sender.replaceTrack).toHaveBeenCalledWith(newVideoTrack);
    });
  });

  describe('handleSessionDescription', () => {
    it('should process push answer and complete negotiation', async () => {
      const pushPC = (client as any).negotiator.camPushPC as MockRTCPeerConnection;
      // Simulate cam PC waiting for answer
      (pushPC as any).signalingState = 'have-local-offer';

      const payload = {
        sdp: 'mock-answer-sdp',
        sdp_type: 'answer' as const,
        session_id: 'push-session-1',
        tracks: []
      };

      await (client as any).negotiator.handleSessionDescription(payload, 'push', 'cam');

      expect(pushPC.setRemoteDescription).toHaveBeenCalledWith({
        type: 'answer',
        sdp: 'mock-answer-sdp'
      });
      // Should not create answer for an answer
      expect(pushPC.createAnswer).not.toHaveBeenCalled();
    });

    it('should process pull offer and create answer', async () => {
      // Force initialization of pullPC
      (client as any).negotiator.pullPC = new MockRTCPeerConnection();
      const pullPC = (client as any).negotiator.pullPC as MockRTCPeerConnection;

      const payload = {
        sdp: 'mock-pull-offer-sdp',
        sdp_type: 'offer' as const,
        session_id: 'pull-session-1',
        tracks: []
      };

      await (client as any).negotiator.handleSessionDescription(payload, 'pull');

      expect(pullPC.setRemoteDescription).toHaveBeenCalledWith({
        type: 'offer',
        sdp: 'mock-pull-offer-sdp'
      });
      expect(pullPC.createAnswer).toHaveBeenCalledTimes(1);
      expect(pullPC.setLocalDescription).toHaveBeenCalledTimes(1);

      // Verify the answer was sent back over WS
      const calls = ((client as any).voiceGW.ws.send as any).mock.calls.map((c: any) => JSON.parse(c[0]));
      const answerCall = calls.find((c: any) => c.op === 14); // VoiceOpcode.Answer
      expect(answerCall).toBeDefined();
      expect(answerCall.d.sdp).toBe('v=0\r\no=- 0 0 IN IP4 0.0.0.0\r\n');
    });
  });

  describe('pullTracks', () => {
    it('tags pull SelectProtocol messages with a request id', async () => {
      vi.spyOn(client as any, 'waitForPullOffer').mockResolvedValue(undefined);
      vi.spyOn(client as any, 'waitForPullNegotiationDone').mockResolvedValue(undefined);
      (client as any).negotiator.pullPC = new MockRTCPeerConnection();

      await client.pullTracks([{
        participant_id: 'remote-a',
        track_name: 'cam-audio-remote-a',
        session_id: 'session-a',
        kind: 'audio',
      }]);
      await (client as any).pullQueue;

      const calls = ((client as any).voiceGW.ws.send as any).mock.calls.map((c: any) => JSON.parse(c[0]));
      const selectProtocolCall = calls.find((c: any) => c.op === 1 && c.d.pull_tracks.length === 1);

      expect(selectProtocolCall).toBeDefined();
      expect(selectProtocolCall.d.request_id).toMatch(/^pull-/);
    });

    it('retries failed pull tracks when pull-retry arrives immediately after the offer', async () => {
      vi.useFakeTimers();
      try {
        const existingTrack = {
          participant_id: 'remote-a',
          track_name: 'cam-audio-remote-a',
          session_id: 'stale-session',
          kind: 'audio' as const,
        };
        const requestedTrack = {
          ...existingTrack,
          session_id: 'fresh-session',
        };

        (client as any).negotiator.pullPC = new MockRTCPeerConnection();
        (client as any).negotiator.pulledTracks = [{ ...existingTrack }];
        vi.spyOn((client as any).negotiator, 'handleSessionDescription').mockResolvedValue(undefined);

        const originalPullTracks = client.pullTracks.bind(client);
        let pullInvocationCount = 0;
        const pullTracksSpy = vi.spyOn(client, 'pullTracks').mockImplementation((tracks: any) => {
          pullInvocationCount += 1;
          if (pullInvocationCount === 1) {
            return originalPullTracks(tracks);
          }
          return Promise.resolve();
        });

        const initialPull = client.pullTracks([requestedTrack]);
        await Promise.resolve();

        const firstSelectProtocol = ((client as any).voiceGW.ws.send as any).mock.calls
          .map((call: any) => JSON.parse(call[0]))
          .find((message: any) => message.op === 1 && message.d.pull_tracks.some((track: any) => track.track_name === requestedTrack.track_name));

        expect(firstSelectProtocol).toBeDefined();

        (client as any).voiceGW.emit('session-description', {
          sdp: 'mock-pull-offer-sdp',
          session_id: 'pull-session-1',
          tracks: [],
          sdp_type: 'offer',
          request_id: firstSelectProtocol.d.request_id,
          operation: 'pull',
        });
        (client as any).voiceGW.emit('error', {
          message: `pull-retry:${JSON.stringify([requestedTrack.track_name])}`,
          request_id: firstSelectProtocol.d.request_id,
          operation: 'pull',
        });

        await initialPull;
        await vi.advanceTimersByTimeAsync(1000);

        expect(pullTracksSpy).toHaveBeenCalledTimes(2);
        expect(pullTracksSpy).toHaveBeenLastCalledWith([
          expect.objectContaining({
            track_name: requestedTrack.track_name,
            session_id: requestedTrack.session_id,
          }),
        ]);
      } finally {
        vi.useRealTimers();
      }
    });

    it('suppresses a repeatedly empty track session until the publisher session changes', async () => {
      const track = {
        participant_id: 'remote-a',
        track_name: 'screen-video-remote-a',
        session_id: 'session-a',
        kind: 'video' as const,
      };

      for (let attempt = 0; attempt < 4; attempt += 1) {
        expect((client as any).noteEmptyTrackRetry(track)).toBe(true);
      }
      expect((client as any).noteEmptyTrackRetry(track)).toBe(false);
      expect((client as any).isSuppressedPullTrack(track)).toBe(true);

      vi.spyOn(client as any, 'waitForPullOffer').mockResolvedValue(undefined);
      vi.spyOn(client as any, 'waitForPullNegotiationDone').mockResolvedValue(undefined);
      (client as any).negotiator.pullPC = new MockRTCPeerConnection();

      await client.pullTracks([track]);
      await (client as any).pullQueue;

      const callsAfterSuppression = ((client as any).voiceGW.ws.send as any).mock.calls
        .map((call: any) => JSON.parse(call[0]))
        .filter((message: any) => message.op === 1 && message.d.pull_tracks.some((pullTrack: any) => pullTrack.track_name === track.track_name));

      expect(callsAfterSuppression).toEqual([]);

      (client as any).rememberRemoteTracks([{ ...track, session_id: 'session-b' }]);
      expect((client as any).isSuppressedPullTrack({ ...track, session_id: 'session-b' })).toBe(false);
    });
  });

  describe('setRemoteTrackSubscription', () => {
    it('re-pulls a remembered remote track when re-subscribing after a local stop', async () => {
      vi.useFakeTimers();
      try {
        vi.spyOn(client as any, 'waitForPullOffer').mockResolvedValue(undefined);
        vi.spyOn(client as any, 'waitForPullNegotiationDone').mockResolvedValue(undefined);

        const pullPC = new MockRTCPeerConnection();
        (client as any).negotiator.pullPC = pullPC;
        pullPC.transceivers.push({
          mid: 'audio-mid',
          receiver: {
            track: {
              kind: 'audio',
              readyState: 'live',
              stop: vi.fn(),
            },
          },
        });

        const track = {
          participant_id: 'remote-a',
          track_name: 'cam-audio-remote-a',
          session_id: 'session-a',
          kind: 'audio' as const,
        };

        (client as any).knownRemoteTracks.set(track.track_name, track);
        (client as any).negotiator.pulledTracks = [{ ...track, mid: 'audio-mid' }];

        client.setRemoteTrackSubscription('remote-a', track.track_name, false);
        await vi.advanceTimersByTimeAsync(1000);

        expect((client as any).negotiator.pulledTracks).toEqual([]);

        client.setRemoteTrackSubscription('remote-a', track.track_name, true);
        await (client as any).pullQueue;

        const calls = ((client as any).voiceGW.ws.send as any).mock.calls.map((c: any) => JSON.parse(c[0]));
        const stopTracksCall = calls.find((c: any) => c.op === 13);
        const selectProtocolCall = calls.find((c: any) => c.op === 1 && c.d.pull_tracks.some((track: any) => track.track_name === 'cam-audio-remote-a'));

        expect(stopTracksCall).toBeDefined();
        expect(selectProtocolCall).toBeDefined();
      } finally {
        vi.useRealTimers();
      }
    });

    it('sends TrackUpdate when the preferred simulcast rid changes for a live remote video track', () => {
      const pullPC = new MockRTCPeerConnection();
      pullPC.iceConnectionState = 'connected';
      (client as any).negotiator.pullPC = pullPC;
      pullPC.transceivers.push({
        mid: 'video-mid',
        receiver: {
          track: {
            kind: 'video',
            readyState: 'live',
          },
        },
      });

      const track = {
        participant_id: 'remote-a',
        track_name: 'cam-video-remote-a',
        session_id: 'session-a',
        mid: 'video-mid',
        kind: 'video' as const,
      };

      (client as any).negotiator.pulledTracks = [track];
      (client as any).trackRids.set(track.track_name, 'l');

      const pullSpy = vi.spyOn(client, 'pullTracks').mockResolvedValue(undefined);

      client.setRemoteTrackSubscription('remote-a', track.track_name, true, 'h');

      const calls = ((client as any).voiceGW.ws.send as any).mock.calls.map((c: any) => JSON.parse(c[0]));
      const trackUpdateCall = calls.find((c: any) => c.op === 103);

      expect(trackUpdateCall).toBeDefined();
      expect(trackUpdateCall.d.tracks).toEqual([{
        track_name: 'cam-video-remote-a',
        session_id: 'session-a',
        mid: 'video-mid',
        rid: 'h',
      }]);
      expect(pullSpy).not.toHaveBeenCalled();
    });
  });

  describe('resetPullSession', () => {
    it('should close existing pullPC and clear state', () => {
      // Force initialization of pullPC
      (client as any).negotiator.pullPC = new MockRTCPeerConnection();
      const oldPullPC = (client as any).negotiator.pullPC as MockRTCPeerConnection;

      (client as any).negotiator.resetPullSession();

      // Should close old PC
      expect(oldPullPC.close).toHaveBeenCalledTimes(1);

      // Should clear state
      expect((client as any).negotiator.pullSessionId).toBeNull();
      expect((client as any).negotiator.pullPC).toBeNull();
    });
  });

  describe('VoiceReady pull reconciliation', () => {
    it('keeps a fresh new pull PC and uses it for the initial pull', () => {
      const pullPC = new MockRTCPeerConnection();
      pullPC.iceConnectionState = 'new';
      pullPC.connectionState = 'new';

      (client as any).negotiator.pullPC = pullPC;
      (client as any).negotiator.pulledTracks = [];

      const resetSpy = vi.spyOn((client as any).rtcSessionManager, 'resetPullSession');
      const pullSpy = vi.spyOn(client, 'pullTracks').mockResolvedValue(undefined);

      (client as any).voiceGW.emit('voice-ready', {
        tracks: [{
          participant_id: 'remote-a',
          track_name: 'cam-audio-remote-a',
          session_id: 'session-a',
          kind: 'audio'
        }]
      });

      expect(resetSpy).not.toHaveBeenCalled();
      expect(pullSpy).toHaveBeenCalledWith(expect.arrayContaining([
        expect.objectContaining({ track_name: 'cam-audio-remote-a' })
      ]));
    });

    it('keeps a connected pull PC when expected receivers are live', () => {
      const pullPC = new MockRTCPeerConnection();
      pullPC.iceConnectionState = 'connected';
      pullPC.connectionState = 'connected';
      pullPC.transceivers.push({
        mid: 'audio-mid',
        receiver: { track: { kind: 'audio', readyState: 'live' } }
      });

      (client as any).negotiator.pullPC = pullPC;
      (client as any).negotiator.pulledTracks = [{
        participant_id: 'remote-a',
        track_name: 'cam-audio-remote-a',
        session_id: 'session-a',
        mid: 'audio-mid',
        kind: 'audio'
      }];

      const resetSpy = vi.spyOn(client as any, 'resetPullAndRepull').mockImplementation(() => {});
      const pullSpy = vi.spyOn(client, 'pullTracks').mockResolvedValue(undefined);

      (client as any).voiceGW.emit('voice-ready', {
        tracks: [{
          participant_id: 'remote-a',
          track_name: 'cam-audio-remote-a',
          session_id: 'session-a',
          mid: 'audio-mid',
          kind: 'audio'
        }]
      });

      expect(resetSpy).not.toHaveBeenCalled();
      expect(pullSpy).not.toHaveBeenCalled();
      expect((client as any).pendingPullTracks).toEqual([]);
    });

    it('rebuilds the pull session when server state exists but the receiver is missing', () => {
      const pullPC = new MockRTCPeerConnection();
      pullPC.iceConnectionState = 'connected';
      pullPC.connectionState = 'connected';

      (client as any).negotiator.pullPC = pullPC;
      (client as any).negotiator.pulledTracks = [{
        participant_id: 'remote-a',
        track_name: 'cam-audio-remote-a',
        session_id: 'session-a',
        mid: 'missing-mid',
        kind: 'audio'
      }];

      const resetSpy = vi.spyOn(client as any, 'resetPullAndRepull').mockImplementation(() => {});

      (client as any).voiceGW.emit('voice-ready', {
        tracks: [{
          participant_id: 'remote-a',
          track_name: 'cam-audio-remote-a',
          session_id: 'session-a',
          mid: 'missing-mid',
          kind: 'audio'
        }]
      });

      expect(resetSpy).toHaveBeenCalledWith(expect.arrayContaining([
        expect.objectContaining({ track_name: 'cam-audio-remote-a' })
      ]));
    });

    it('does not evict locally pulled tracks from a non-transferred partial snapshot', () => {
      const pullPC = new MockRTCPeerConnection();
      pullPC.iceConnectionState = 'connected';
      pullPC.connectionState = 'connected';
      pullPC.transceivers.push({
        mid: 'audio-mid',
        receiver: { track: { kind: 'audio', readyState: 'live' } }
      });
      pullPC.transceivers.push({
        mid: 'video-mid',
        receiver: { track: { kind: 'video', readyState: 'live' } }
      });

      (client as any).negotiator.pullPC = pullPC;
      (client as any).negotiator.pulledTracks = [{
        participant_id: 'remote-a',
        track_name: 'cam-audio-remote-a',
        session_id: 'session-a',
        mid: 'audio-mid',
        kind: 'audio'
      }, {
        participant_id: 'remote-a',
        track_name: 'cam-video-remote-a',
        session_id: 'session-b',
        mid: 'video-mid',
        kind: 'video'
      }];

      const stopSpy = vi.spyOn(client as any, 'handleStopTracks').mockImplementation(() => {});

      (client as any).voiceGW.emit('voice-ready', {
        tracks: [{
          participant_id: 'remote-a',
          track_name: 'cam-audio-remote-a',
          session_id: 'session-a',
          mid: 'audio-mid',
          kind: 'audio'
        }],
        sfu_session_transferred: false,
      });

      expect(stopSpy).not.toHaveBeenCalled();
    });

    it('rebuilds the pull session when reconnect state returns empty and local receivers are stale', () => {
      const pullPC = new MockRTCPeerConnection();
      pullPC.iceConnectionState = 'connected';
      pullPC.connectionState = 'connected';

      (client as any).negotiator.pullPC = pullPC;
      (client as any).negotiator.pulledTracks = [{
        participant_id: 'remote-a',
        track_name: 'cam-audio-remote-a',
        session_id: 'session-a',
        mid: 'missing-mid',
        kind: 'audio'
      }];

      const resetSpy = vi.spyOn(client as any, 'resetPullAndRepull').mockImplementation(() => {});

      (client as any).voiceGW.emit('voice-ready', {
        tracks: [],
        sfu_session_transferred: false,
      });

      expect(resetSpy).toHaveBeenCalledWith(expect.arrayContaining([
        expect.objectContaining({ track_name: 'cam-audio-remote-a' })
      ]));
    });
  });

  describe('room/media transport coordination', () => {
    it('does not restart an in-flight media reconnect on room resume for the same session', () => {
      const disconnectSpy = vi.spyOn(client.voiceGW, 'disconnect').mockImplementation(() => {});
      const connectVoiceSpy = vi.spyOn(client.voiceGW, 'connectVoice').mockImplementation(() => {});

      (client.voiceGW as any).ws = { readyState: WebSocket.CONNECTING };
      (client as any).voiceToken = 'token123';

      (client as any).roomGW.emit('ready', {
        participantId: 'p123',
        sessionId: 'p123',
        iceServers: [],
        voiceToken: 'token123',
        tracksToQueue: [],
        participants: [],
      });

      disconnectSpy.mockClear();
      connectVoiceSpy.mockClear();

      (client as any).roomGW.emit('resumed', {
        voiceToken: 'token123',
        participants: [],
      });

      expect(disconnectSpy).not.toHaveBeenCalled();
      expect(connectVoiceSpy).not.toHaveBeenCalled();
    });

    it('cleans up participants missing from a resumed snapshot like a participant-left event', () => {
      const participantLeftSpy = vi.fn();
      const removeParticipantVolumeSpy = vi.spyOn(client.audio, 'removeParticipantVolume');
      vi.spyOn(client.voiceGW, 'connectVoice').mockImplementation(() => {});

      client.on('participant-left', participantLeftSpy);
      (client as any).negotiator.pulledTracks = [{
        participant_id: 'remote-a',
        track_name: 'cam-audio-remote-a',
        session_id: 'session-a',
        kind: 'audio',
      }];
      (client as any).remoteSpeakingUntil.set('remote-a', Date.now() + 10_000);

      (client as any).roomGW.emit('ready', {
        participantId: 'p123',
        sessionId: 'p123',
        iceServers: [],
        voiceToken: 'token123',
        tracksToQueue: [],
        participants: [
          { id: 'p123', tracks: [] },
          { id: 'remote-a', tracks: [] },
        ],
      });

      (client as any).roomGW.emit('resumed', {
        voiceToken: 'token123',
        participants: [
          { id: 'p123', tracks: [] },
        ],
      });

      expect(removeParticipantVolumeSpy).toHaveBeenCalledWith('remote-a');
      expect((client as any).negotiator.pulledTracks).toEqual([]);
      expect((client as any).remoteSpeakingUntil.has('remote-a')).toBe(false);
      expect(participantLeftSpy).toHaveBeenCalledWith({ participantId: 'remote-a' });
    });
  });

  describe('scoped publisher-session recovery', () => {
    it('rebuilds the cam push side when the server expires push_cam', () => {
      const resetCamPushSpy = vi.spyOn(client as any, 'resetCamPush').mockImplementation(() => {});
      const resetScreenPushSpy = vi.spyOn(client as any, 'resetScreenPush').mockImplementation(() => {});
      const resetPullSpy = vi.spyOn(client as any, 'resetPullAndRepull').mockImplementation(() => {});

      (client as any).voiceGW.emit('error', {
        message: 'publisher-session-expired',
        session_type: 'push_cam',
      });

      expect(resetCamPushSpy).toHaveBeenCalledTimes(1);
      expect(resetScreenPushSpy).not.toHaveBeenCalled();
      expect(resetPullSpy).not.toHaveBeenCalled();
      expect((client as any).consumeReconnectRepublishTarget()).toBe('cam');
      expect((client as any).consumeReconnectRepublishTarget()).toBeNull();
    });

    it('rebuilds the screen push side when the server expires push_screen', () => {
      const resetCamPushSpy = vi.spyOn(client as any, 'resetCamPush').mockImplementation(() => {});
      const resetScreenPushSpy = vi.spyOn(client as any, 'resetScreenPush').mockImplementation(() => {});
      const resetPullSpy = vi.spyOn(client as any, 'resetPullAndRepull').mockImplementation(() => {});

      (client as any).voiceGW.emit('error', {
        message: 'publisher-session-expired',
        session_type: 'push_screen',
      });

      expect(resetScreenPushSpy).toHaveBeenCalledTimes(1);
      expect(resetCamPushSpy).not.toHaveBeenCalled();
      expect(resetPullSpy).not.toHaveBeenCalled();
      expect((client as any).consumeReconnectRepublishTarget()).toBe('screen');
    });
  });
});
