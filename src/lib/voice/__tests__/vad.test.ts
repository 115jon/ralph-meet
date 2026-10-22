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

  it("applies threshold changes to the next pre-gate audio sample", () => {
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
    const source = { connect: vi.fn(), disconnect: vi.fn() };
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

    const rawTrack = {
      clone: vi.fn(),
      stop: vi.fn(),
    } as unknown as MediaStreamTrack;
    const preGateTrack = {
      clone: vi.fn(() => preGateTrack),
      stop: vi.fn(),
    } as unknown as MediaStreamTrack;
    const preGateStream = new TestMediaStream([preGateTrack]);
    const onSpeakingChange = vi.fn();
    const detector = new VoiceActivityDetector({
      getAudioTransceiver: () => undefined,
      getParticipantId: () => "participant",
      onSpeakingChange,
      sendSpeaking: vi.fn(),
    });

    detector.setThreshold(20);
    detector.start(preGateStream as unknown as MediaStream);
    expect(preGateTrack.clone).toHaveBeenCalled();
    expect(rawTrack.clone).not.toHaveBeenCalled();
    vi.advanceTimersByTime(50);
    expect(detector.getCurrentRMS()).toBeCloseTo(17.19, 1);
    expect(onSpeakingChange).not.toHaveBeenCalled();

    detector.setThreshold(10);
    vi.advanceTimersByTime(50);
    expect(onSpeakingChange).toHaveBeenCalledWith(
      true,
      SpeakingFlags.MICROPHONE,
    );

    detector.stop();
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

  it("gates source audio without changing the sender or RTP parameters", async () => {
    let microphoneSample = 128;
    const analyser = {
      connect: vi.fn(),
      disconnect: vi.fn(),
      fftSize: 0,
      frequencyBinCount: 256,
      getByteTimeDomainData: vi.fn((data: Uint8Array) =>
        data.fill(microphoneSample),
      ),
      getFloatFrequencyData: vi.fn((data: Float32Array) => data.fill(-100)),
      smoothingTimeConstant: 0,
    };
    const gain = {
      connect: vi.fn(),
      disconnect: vi.fn(),
      gain: { value: 1 },
    };
    const source = { connect: vi.fn(), disconnect: vi.fn() };
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

    const publishedTrack = { enabled: true } as MediaStreamTrack;
    const silenceGate = { setGated: vi.fn() };
    let activeSenderTrack = publishedTrack;
    const transceiver = {
      sender: {
        getParameters: vi.fn(() => ({ encodings: [{}] })),
        setParameters: vi.fn().mockResolvedValue(undefined),
        get track() {
          return activeSenderTrack;
        },
      },
    } as unknown as RTCRtpTransceiver;
    const track = {
      clone: vi.fn(() => track),
      stop: vi.fn(),
    } as unknown as MediaStreamTrack;
    const detector = new VoiceActivityDetector({
      getAudioTransceiver: () => transceiver,
      getParticipantId: () => "participant",
      onSpeakingChange: vi.fn(),
      sendSpeaking: vi.fn(),
      getAudioGate: () => silenceGate,
    });

    detector.setThreshold(20);
    detector.start(new TestMediaStream([track]) as unknown as MediaStream);
    await Promise.resolve();
    detector.onTransceiverReady();
    expect(silenceGate.setGated).toHaveBeenCalledWith(true);
    silenceGate.setGated.mockClear();
    vi.advanceTimersByTime(50 * 81);
    expect(detector.getCurrentRMS()).toBeCloseTo(0, 5);
    expect(publishedTrack.enabled).toBe(true);
    expect(silenceGate.setGated).not.toHaveBeenCalled();
    expect(transceiver.sender.setParameters).not.toHaveBeenCalled();

    const replacementTrack = { enabled: true } as MediaStreamTrack;
    activeSenderTrack = replacementTrack;
    const replacementGate = { setGated: vi.fn() };
    detector.setGateController(replacementGate);
    expect(detector.getThreshold()).toBe(20);
    microphoneSample = 160;
    vi.advanceTimersByTime(50);
    expect(detector.getCurrentRMS()).toBeGreaterThan(20);
    expect(replacementTrack.enabled).toBe(true);
    expect(replacementGate.setGated).toHaveBeenLastCalledWith(false);

    detector.stop();
  });

  it("keeps manual mute separate from VAD source gating", async () => {
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
    const source = { connect: vi.fn(), disconnect: vi.fn() };
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

    const publishedTrack = { enabled: true } as MediaStreamTrack;
    const gate = { setGated: vi.fn() };
    const getParameters = vi.fn(() => ({ encodings: [{}] }));
    const setParameters = vi.fn().mockResolvedValue(undefined);
    const transceiver = {
      sender: { getParameters, setParameters, track: publishedTrack },
    } as unknown as RTCRtpTransceiver;
    const track = {
      clone: vi.fn(() => track),
      stop: vi.fn(),
    } as unknown as MediaStreamTrack;
    const detector = new VoiceActivityDetector({
      getAudioTransceiver: () => transceiver,
      getParticipantId: () => "participant",
      onSpeakingChange: vi.fn(),
      sendSpeaking: vi.fn(),
      getAudioGate: () => gate,
    });

    detector.enableNoiseGate();
    detector.start(new TestMediaStream([track]) as unknown as MediaStream);
    await Promise.resolve();
    detector.onTransceiverReady();
    expect(publishedTrack.enabled).toBe(true);
    expect(gate.setGated).toHaveBeenCalledWith(true);
    expect(setParameters).not.toHaveBeenCalled();

    detector.disableNoiseGate();
    expect(gate.setGated).toHaveBeenLastCalledWith(false);
    expect(publishedTrack.enabled).toBe(true);
    detector.enableNoiseGate();
    expect(gate.setGated).toHaveBeenLastCalledWith(true);
    detector.setMicrophoneEnabled(false);
    publishedTrack.enabled = true;
    detector.reapplyGate();
    expect(publishedTrack.enabled).toBe(true);
    expect(setParameters).not.toHaveBeenCalled();

    detector.stop();
  });

  it("fails open for an enabled microphone while VAD restarts", () => {
    const gate = { setGated: vi.fn() };
    const detector = new VoiceActivityDetector({
      getAudioTransceiver: () => undefined,
      getAudioGate: () => gate,
      getParticipantId: () => "participant",
      onSpeakingChange: vi.fn(),
      sendSpeaking: vi.fn(),
    });

    detector.enableNoiseGate();
    detector.setGateController(gate);
    detector.start(
      new TestMediaStream([
        { clone: vi.fn(), stop: vi.fn() } as unknown as MediaStreamTrack,
      ]) as unknown as MediaStream,
    );
    return Promise.resolve().then(() => {
      detector.setMicrophoneEnabled(false);
      detector.setMicrophoneEnabled(true);
      gate.setGated.mockClear();
      detector.stop();

      expect(gate.setGated).toHaveBeenCalledWith(false);
    });
  });
});
