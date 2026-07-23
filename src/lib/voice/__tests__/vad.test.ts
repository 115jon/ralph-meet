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

  it("signals soundboard-only activity without starting microphone VAD", () => {
    const onSpeakingChange = vi.fn();
    const sendSpeaking = vi.fn();
    const detector = new VoiceActivityDetector({
      getAudioTransceiver: () => undefined,
      getParticipantId: () => "participant",
      onSpeakingChange,
      sendSpeaking,
    });

    detector.setSoundboardSpeaking(true);

    expect(onSpeakingChange).toHaveBeenCalledTimes(1);
    expect(onSpeakingChange).toHaveBeenCalledWith(
      true,
      SpeakingFlags.SOUNDSHARE,
    );
    expect(sendSpeaking).toHaveBeenCalledWith(SpeakingFlags.SOUNDSHARE);

    detector.stop();

    expect(onSpeakingChange).toHaveBeenCalledTimes(1);
    expect(sendSpeaking).toHaveBeenCalledTimes(1);

    detector.setSoundboardSpeaking(false);

    expect(onSpeakingChange).toHaveBeenLastCalledWith(
      false,
      SpeakingFlags.NONE,
    );
    expect(sendSpeaking).toHaveBeenLastCalledWith(SpeakingFlags.NONE);
  });

  it("preserves both speaking bits while microphone and soundboard overlap", () => {
    let microphoneAudio = true;
    const analyser = {
      connect: vi.fn(),
      disconnect: vi.fn(),
      fftSize: 0,
      frequencyBinCount: 256,
      getByteTimeDomainData: vi.fn((data: Uint8Array) =>
        data.fill(microphoneAudio ? 150 : 128),
      ),
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
    vi.advanceTimersByTime(50);
    detector.setSoundboardSpeaking(true);

    expect(sendSpeaking.mock.calls.map(([flags]) => flags)).toEqual([
      SpeakingFlags.MICROPHONE,
      SpeakingFlags.MICROPHONE | SpeakingFlags.SOUNDSHARE,
    ]);
    expect(onSpeakingChange).toHaveBeenCalledTimes(1);

    microphoneAudio = false;
    vi.advanceTimersByTime(350);
    expect(sendSpeaking).toHaveBeenLastCalledWith(SpeakingFlags.SOUNDSHARE);
    expect(onSpeakingChange).toHaveBeenCalledTimes(1);

    detector.stop();

    expect(sendSpeaking).toHaveBeenLastCalledWith(SpeakingFlags.SOUNDSHARE);
    expect(onSpeakingChange).toHaveBeenCalledTimes(1);

    detector.setSoundboardSpeaking(false);

    expect(onSpeakingChange).toHaveBeenLastCalledWith(
      false,
      SpeakingFlags.NONE,
    );
    expect(sendSpeaking).toHaveBeenLastCalledWith(SpeakingFlags.NONE);
  });

  it("ignores stale AudioContext callbacks after a rapid restart", async () => {
    const resumeResolvers: Array<() => void> = [];
    const contexts: Array<{
      addEventListener: ReturnType<typeof vi.fn>;
      close: ReturnType<typeof vi.fn>;
      createAnalyser: ReturnType<typeof vi.fn>;
      createGain: ReturnType<typeof vi.fn>;
      createMediaStreamSource: ReturnType<typeof vi.fn>;
      destination: object;
      resume: ReturnType<typeof vi.fn>;
      state: string;
    }> = [];
    vi.stubGlobal(
      "AudioContext",
      vi.fn(function () {
        const analyser = {
          connect: vi.fn(),
          disconnect: vi.fn(),
          fftSize: 0,
          frequencyBinCount: 256,
          getByteTimeDomainData: vi.fn((data: Uint8Array) => data.fill(128)),
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
          resume: vi.fn(
            () =>
              new Promise<void>((resolve) => {
                resumeResolvers.push(resolve);
              }),
          ),
          state: "suspended",
        };
        contexts.push(context);
        return context;
      }),
    );

    const track = {
      clone: vi.fn(() => track),
      stop: vi.fn(),
    } as unknown as MediaStreamTrack;
    const getAudioTransceiver = vi.fn(
      () => ({}) as unknown as RTCRtpTransceiver,
    );
    const detector = new VoiceActivityDetector({
      getAudioTransceiver,
      getParticipantId: () => "participant",
      onSpeakingChange: vi.fn(),
      sendSpeaking: vi.fn(),
    });

    detector.enableNoiseGate();
    detector.start(new TestMediaStream([track]) as unknown as MediaStream);
    detector.stop();
    detector.start(new TestMediaStream([track]) as unknown as MediaStream);

    const staleContext = contexts[0];
    const currentContext = contexts[1];
    if (!staleContext || !currentContext) throw new Error("Missing context");

    detector.onTransceiverReady();
    const transceiverCallsBeforeStaleCallback =
      getAudioTransceiver.mock.calls.length;
    staleContext.state = "running";
    currentContext.state = "running";
    staleContext.addEventListener.mock.calls[0]?.[1]?.();
    resumeResolvers[0]?.();
    await Promise.resolve();

    expect(getAudioTransceiver).toHaveBeenCalledTimes(
      transceiverCallsBeforeStaleCallback,
    );
  });
});
