import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MockMediaStream, MockMediaStreamTrack, MockRTCPeerConnection, setupWebRTCMocks } from '../../__tests__/webrtc-mocks';
import { TrackNegotiator, TrackNegotiatorConfig } from '../track-negotiator';

setupWebRTCMocks();

describe('TrackNegotiator', () => {
  let negotiator: TrackNegotiator;
  let mockConfig: TrackNegotiatorConfig;

  beforeEach(() => {
    vi.clearAllMocks();

    mockConfig = {
      getParticipantId: vi.fn().mockReturnValue('p123'),
      sendWS: vi.fn(),
      emit: vi.fn(),
      getUnsubscribedMids: vi.fn().mockReturnValue(new Set()),
      getUnsubscribedNames: vi.fn().mockReturnValue(new Set()),
      pcReadyPromise: vi.fn().mockReturnValue(Promise.resolve()),
      waitForPushNegotiationDone: vi.fn().mockResolvedValue(undefined),
      waitForPushAnswer: vi.fn().mockResolvedValue(undefined)
    };

    negotiator = new TrackNegotiator(mockConfig);
    negotiator.camPushPC = new MockRTCPeerConnection() as any;
  });

  describe('publishTracks', () => {
    it('should add transceivers and create an offer for audio and video', async () => {
      const audioTrack = new MockMediaStreamTrack('audio');
      const videoTrack = new MockMediaStreamTrack('video');
      const stream = new MockMediaStream([audioTrack, videoTrack]);

      const pushPC = negotiator.camPushPC as any as MockRTCPeerConnection;

      await negotiator.publishTracks(stream as any, 'cam');

      expect(pushPC.addTransceiver).toHaveBeenCalledTimes(2);

      expect(pushPC.addTransceiver).toHaveBeenNthCalledWith(1, expect.objectContaining({ kind: 'audio' }), expect.objectContaining({
        direction: 'sendonly',
        sendEncodings: expect.arrayContaining([{ maxBitrate: 128000, priority: 'high', networkPriority: 'high' }])
      }));

      expect(pushPC.addTransceiver).toHaveBeenNthCalledWith(2, videoTrack, expect.objectContaining({
        direction: 'sendonly',
        sendEncodings: expect.arrayContaining([
          { rid: 'h', maxBitrate: 1200000, priority: 'high' },
          { rid: 'm', maxBitrate: 400000, scaleResolutionDownBy: 2, priority: 'medium' },
          { rid: 'l', maxBitrate: 100000, scaleResolutionDownBy: 4, priority: 'low' }
        ])
      }));

      expect(pushPC.createOffer).toHaveBeenCalledTimes(1);
      expect(pushPC.setLocalDescription).toHaveBeenCalledTimes(1);

      expect(mockConfig.sendWS).toHaveBeenCalledTimes(2);

      const selectProtocolCall = (mockConfig.sendWS as any).mock.calls.find((c: any) => c[0].op === 1);
      expect(selectProtocolCall).toBeDefined();
      expect(selectProtocolCall[0].d.push_tracks).toHaveLength(2);

      const tracksReadyCall = (mockConfig.sendWS as any).mock.calls.find((c: any) => c[0].op === 102);
      expect(tracksReadyCall).toBeDefined();
    });

    it('should configure single stream for screen share video', async () => {
      const videoTrack = new MockMediaStreamTrack('video');
      const stream = new MockMediaStream([videoTrack]);

      // Screen tracks go to screenPushPC
      negotiator.screenPushPC = new MockRTCPeerConnection() as any;
      const pushPC = negotiator.screenPushPC as any as MockRTCPeerConnection;

      await negotiator.publishTracks(stream as any, 'screen');

      expect(pushPC.addTransceiver).toHaveBeenCalledTimes(1);
      expect(pushPC.addTransceiver).toHaveBeenCalledWith(videoTrack, expect.objectContaining({
        direction: 'sendonly',
        sendEncodings: [{ maxBitrate: 24000000, scaleResolutionDownBy: 1, priority: 'high', networkPriority: 'high' }]
      }));
    });

    it('should reuse existing transceivers when re-published directly', async () => {
      const videoTrack = new MockMediaStreamTrack('video');
      const stream = new MockMediaStream([videoTrack]);
      const pushPC = negotiator.camPushPC as any as MockRTCPeerConnection;

      await negotiator.publishTracks(stream as any, 'cam');
      expect(pushPC.addTransceiver).toHaveBeenCalledTimes(1);

      const newVideoTrack = new MockMediaStreamTrack('video');
      const newStream = new MockMediaStream([newVideoTrack]);

      await negotiator.publishTracks(newStream as any, 'cam');

      expect(pushPC.addTransceiver).toHaveBeenCalledTimes(1);
      expect(pushPC.transceivers[0].sender.replaceTrack).toHaveBeenCalledWith(newVideoTrack);
    });

    it('should assign mids to track descriptors after creating offer', async () => {
      const audioTrack = new MockMediaStreamTrack('audio');
      const stream = new MockMediaStream([audioTrack]);

      await negotiator.publishTracks(stream as any, 'cam');

      const calls = (mockConfig.sendWS as any).mock.calls.map((c: any) => c[0]);
      const selectProtocolCall = calls.find((c: any) => c.op === 1);

      expect(selectProtocolCall).toBeDefined();
      expect(selectProtocolCall.d.push_tracks).toHaveLength(1);

      expect(selectProtocolCall.d.push_tracks[0].track_name).toBe('cam-audio-p123');
      expect(selectProtocolCall.d.push_tracks[0].mid).toBe('mock-mid-0');
    });

    it('retries addTransceiver without unsupported RTP parameters', async () => {
      const videoTrack = new MockMediaStreamTrack('video');
      const stream = new MockMediaStream([videoTrack]);
      const pushPC = negotiator.camPushPC as any as MockRTCPeerConnection;
      const originalAddTransceiver = pushPC.addTransceiver.getMockImplementation();

      pushPC.addTransceiver.mockImplementationOnce(() => {
        throw new DOMException(
          "Attempted to set an unimplemented parameter of RtpParameters.",
          "OperationError",
        );
      });
      pushPC.addTransceiver.mockImplementation(originalAddTransceiver!);

      await negotiator.publishTracks(stream as any, 'cam');

      expect(pushPC.addTransceiver).toHaveBeenCalledTimes(2);
      expect(pushPC.addTransceiver).toHaveBeenNthCalledWith(2, videoTrack, expect.objectContaining({
        direction: 'sendonly',
        sendEncodings: [
          { rid: 'h', maxBitrate: 1200000 },
          { rid: 'm', maxBitrate: 400000, scaleResolutionDownBy: 2 },
          { rid: 'l', maxBitrate: 100000, scaleResolutionDownBy: 4 },
        ],
      }));
      expect(pushPC.createOffer).toHaveBeenCalledTimes(1);
    });
  });

  describe('handleSessionDescription', () => {
    it('should process push answer and complete negotiation', async () => {
      const pushPC = negotiator.camPushPC as any as MockRTCPeerConnection;
      // Simulate the PC being in have-local-offer state
      (pushPC as any).signalingState = 'have-local-offer';

      const payload = {
        sdp: 'mock-answer-sdp',
        sdp_type: 'answer' as const,
        session_id: 'push-session-1',
        tracks: []
      };

      await negotiator.handleSessionDescription(payload, 'push', 'cam');

      expect(pushPC.setRemoteDescription).toHaveBeenCalledWith({
        type: 'answer',
        sdp: 'mock-answer-sdp'
      });
      expect(pushPC.createAnswer).not.toHaveBeenCalled();
    });

    it('should process pull offer and create answer', async () => {
      negotiator.pullPC = new MockRTCPeerConnection() as any;
      const pullPC = negotiator.pullPC as any as MockRTCPeerConnection;

      const payload = {
        sdp: 'mock-pull-offer-sdp',
        sdp_type: 'offer' as const,
        session_id: 'pull-session-1',
        tracks: []
      };

      await negotiator.handleSessionDescription(payload, 'pull');

      expect(pullPC.setRemoteDescription).toHaveBeenCalledWith({
        type: 'offer',
        sdp: 'mock-pull-offer-sdp'
      });
      expect(pullPC.createAnswer).toHaveBeenCalledTimes(1);
      expect(pullPC.setLocalDescription).toHaveBeenCalledTimes(1);

      const answerCall = (mockConfig.sendWS as any).mock.calls.find((c: any) => c[0].op === 14);
      expect(answerCall).toBeDefined();
    });

    it('should leave pulled track metadata unchanged when pull offer SDP fails', async () => {
      negotiator.pullPC = new MockRTCPeerConnection() as any;
      const pullPC = negotiator.pullPC as any as MockRTCPeerConnection;
      const existingTrack = {
        participant_id: 'remote-a',
        track_name: 'cam-audio-remote-a',
        session_id: 'remote-session-a',
        mid: '0',
        kind: 'audio' as const,
      };
      negotiator.pulledTracks = [existingTrack];
      pullPC.setRemoteDescription.mockRejectedValueOnce(
        new DOMException('The order of m-lines in subsequent offer does not match', 'InvalidAccessError'),
      );

      const payload = {
        sdp: 'bad-pull-offer-sdp',
        sdp_type: 'offer' as const,
        session_id: 'pull-session-1',
        tracks: [
          {
            participant_id: 'remote-b',
            track_name: 'cam-audio-remote-b',
            session_id: 'remote-session-b',
            mid: '0',
            kind: 'audio' as const,
          },
        ],
      };

      await expect(negotiator.handleSessionDescription(payload, 'pull')).rejects.toThrow('m-lines');

      expect(negotiator.pulledTracks).toEqual([existingTrack]);
      expect(mockConfig.sendWS).not.toHaveBeenCalledWith(expect.objectContaining({ op: 14 }));
    });
  });

  describe('resetPullSession', () => {
    it('should close existing pullPC and clear state', () => {
      negotiator.pullPC = new MockRTCPeerConnection() as any;
      const oldPullPC = negotiator.pullPC as any as MockRTCPeerConnection;

      negotiator.resetPullSession();

      expect(oldPullPC.close).toHaveBeenCalledTimes(1);
      expect(negotiator.pullSessionId).toBeNull();
      expect(negotiator.pullPC).toBeNull();
    });
  });
});
