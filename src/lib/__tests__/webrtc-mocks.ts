import { vi } from 'vitest';

export class MockRTCPeerConnection {
  connectionState = 'new';
  iceConnectionState = 'new';
  signalingState = 'stable';
  localDescription: any = null;
  remoteDescription: any = null;

  transceivers: any[] = [];

  addTransceiver = vi.fn((trackOrKind, init) => {
    const transceiver = {
      mid: `mock-mid-${this.transceivers.length}`,
      direction: init?.direction || 'sendrecv',
      sender: {
        track: typeof trackOrKind !== 'string' ? trackOrKind : null,
        replaceTrack: vi.fn(),
        getParameters: vi.fn(() => ({ encodings: init?.sendEncodings || [] })),
        setParameters: vi.fn().mockResolvedValue(undefined)
      },
      receiver: {
        track: { kind: typeof trackOrKind === 'string' ? trackOrKind : trackOrKind.kind }
      },
      setCodecPreferences: vi.fn(),
      stop: vi.fn()
    };

    // Add a dummy catch to the sender so replacing track mock rejection gets caught
    transceiver.sender.replaceTrack.mockReturnValue({ catch: vi.fn() } as any);

    this.transceivers.push(transceiver);
    return transceiver;
  });

  getTransceivers = vi.fn(() => this.transceivers);

  createOffer = vi.fn().mockResolvedValue({ type: 'offer', sdp: 'v=0\r\no=- 0 0 IN IP4 0.0.0.0\r\n' });
  createAnswer = vi.fn().mockResolvedValue({ type: 'answer', sdp: 'v=0\r\no=- 0 0 IN IP4 0.0.0.0\r\n' });

  setLocalDescription = vi.fn(async (desc) => {
    this.localDescription = desc;
  });

  setRemoteDescription = vi.fn(async (desc) => {
    this.remoteDescription = desc;
  });

  close = vi.fn();

  addEventListener = vi.fn((event, handler) => {
    // Simulate immediate connection for both ice and connection state changes
    if (event === 'iceconnectionstatechange') {
      this.iceConnectionState = 'connected';
      handler();
    }
    if (event === 'connectionstatechange') {
      this.connectionState = 'connected';
      handler();
    }
  });

  removeEventListener = vi.fn();
}

export class MockMediaStreamTrack {
  kind: string;
  id: string;
  label: string;
  constructor(kind: string) {
    this.kind = kind;
    this.id = `mock-${kind}-${Math.random()}`;
    this.label = `mock-${kind}-label`;
  }
}

export class MockMediaStream {
  tracks: any[] = [];
  constructor(tracks: any[]) {
    this.tracks = tracks;
  }
  getTracks() {
    return this.tracks;
  }
}

export function setupWebRTCMocks() {
  vi.stubGlobal('RTCPeerConnection', MockRTCPeerConnection);
  vi.stubGlobal('MediaStreamTrack', MockMediaStreamTrack);
  vi.stubGlobal('MediaStream', MockMediaStream);
  vi.stubGlobal('RTCRtpSender', {
    getCapabilities: vi.fn(() => ({
      codecs: [
        { mimeType: 'audio/opus', clockRate: 48000, channels: 2 },
        { mimeType: 'audio/PCMU', clockRate: 8000, channels: 1 }
      ]
    }))
  });
}
