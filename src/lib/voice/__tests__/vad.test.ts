// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { SpeakingFlags } from "../../types";
import { VoiceActivityDetector } from "../vad";

class TestMediaStream {
  constructor(private readonly tracks: MediaStreamTrack[]) {}

  getAudioTracks() {
    return this.tracks;
  }
}

describe("VoiceActivityDetector", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("MediaStream", TestMediaStream);
  });

  it("renders the analyser graph through a silent output sink", () => {
    const analyser = {
      connect: vi.fn(),
      disconnect: vi.fn(),
      fftSize: 0,
      frequencyBinCount: 256,
      getByteTimeDomainData: vi.fn((data: Uint8Array) => data.fill(150)),
      smoothingTimeConstant: 0,
    };
    const gain = {
      connect: vi.fn(),
      disconnect: vi.fn(),
      gain: { value: 1 },
    };
    const source = {
      connect: vi.fn(),
      disconnect: vi.fn(),
    };
    const context = {
      addEventListener: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
      createAnalyser: vi.fn(() => analyser),
      createGain: vi.fn(() => gain),
      createMediaStreamSource: vi.fn(() => source),
      destination: {},
      resume: vi.fn().mockResolvedValue(undefined),
      state: "running",
    };
    vi.stubGlobal(
      "AudioContext",
      vi.fn(function () {
        return context;
      }),
    );

    const track = {
      clone: vi.fn(() => track),
      stop: vi.fn(),
    } as unknown as MediaStreamTrack;
    const onSpeakingChange = vi.fn();
    const sendSpeaking = vi.fn();
    const detector = new VoiceActivityDetector({
      getAudioTransceiver: () => undefined,
      getParticipantId: () => "participant",
      onSpeakingChange,
      sendSpeaking,
    });

    detector.start(new TestMediaStream([track]) as unknown as MediaStream);

    expect(analyser.connect).toHaveBeenCalledWith(gain);
    expect(gain.gain.value).toBe(0);
    expect(gain.connect).toHaveBeenCalledWith(context.destination);

    vi.advanceTimersByTime(50);

    expect(onSpeakingChange).toHaveBeenCalledWith(
      true,
      SpeakingFlags.MICROPHONE,
    );
    expect(sendSpeaking).toHaveBeenCalledWith(SpeakingFlags.MICROPHONE);

    detector.stop();

    expect(analyser.disconnect).toHaveBeenCalled();
    expect(gain.disconnect).toHaveBeenCalled();
  });
});
