import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SFUClient } from '../sfu-client';

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

    it('should configure single stream for screen share video', async () => {
      const videoTrack = new MockMediaStreamTrack('video');
      const stream = new MockMediaStream([videoTrack]);

      // Screen tracks go to screenPushPC, which must exist
      (client as any).negotiator.screenPushPC = new MockRTCPeerConnection();
      const screenPC = (client as any).negotiator.screenPushPC as MockRTCPeerConnection;

      await client.publishTracks(stream as any, 'screen');

      // Video transceiver check (NO simulcast layers for screen)
      expect(screenPC.addTransceiver).toHaveBeenCalledTimes(1);
      expect(screenPC.addTransceiver).toHaveBeenCalledWith(videoTrack, expect.objectContaining({
        direction: 'sendonly',
        sendEncodings: [{ maxBitrate: 24000000, scaleResolutionDownBy: 1, priority: 'high', networkPriority: 'high' }]
      }));
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
});
