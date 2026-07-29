import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  closeLocalAudioGateContext,
  createLocalAudioGate,
  createLocalAudioProcessor,
  resolveCaptureAudioProcessing,
  resolveLocalAudioProcessingMode,
  type VoiceAudioProcessingSettings,
} from "./noise-reduction";

class TestMediaStream {
  constructor(private readonly tracks: MediaStreamTrack[]) {}

  getAudioTracks(): MediaStreamTrack[] {
    return this.tracks;
  }
}

function makeSettings(
  overrides: Partial<VoiceAudioProcessingSettings> = {},
): VoiceAudioProcessingSettings {
  return {
    noiseSuppression: true,
    echoCancellation: true,
    autoSensitivity: true,
    streamHighFidelity: false,
    noiseReductionEnabled: false,
    noiseReductionProvider: "rnnoise",
    ...overrides,
  };
}

describe("noise reduction helpers", () => {
  beforeEach(() => {
    vi.stubGlobal("MediaStream", TestMediaStream);
  });

  it("creates a continuous output track whose gain can be gated", () => {
    const inputTrack = {
      clone: vi.fn(() => inputTrack),
      getSettings: vi.fn(() => ({ channelCount: 1 })),
      kind: "audio",
      stop: vi.fn(),
    } as unknown as MediaStreamTrack;
    const outputTrack = {
      contentHint: "",
      kind: "audio",
      stop: vi.fn(),
    } as unknown as MediaStreamTrack;
    const gain = {
      connect: vi.fn(),
      disconnect: vi.fn(),
      gain: { value: 1 },
    };
    const source = {
      connect: vi.fn(),
      disconnect: vi.fn(),
    };
    const destination = {
      channelCount: 0,
      channelCountMode: "max",
      channelInterpretation: "speakers",
      stream: new TestMediaStream([outputTrack]),
    };
    const context = {
      close: vi.fn().mockResolvedValue(undefined),
      createGain: vi.fn(() => gain),
      createMediaStreamDestination: vi.fn(() => destination),
      createMediaStreamSource: vi.fn(() => source),
      resume: vi.fn().mockResolvedValue(undefined),
    };
    vi.stubGlobal(
      "AudioContext",
      vi.fn(function () {
        return context;
      }),
    );

    const gate = createLocalAudioGate(
      new TestMediaStream([inputTrack]) as unknown as MediaStream,
    );

    expect(gate?.outputStream.getAudioTracks()).toEqual([outputTrack]);
    expect(gain.gain.value).toBe(1);
    gate?.gateController.setGated(true);
    expect(gain.gain.value).toBe(0);
    gate?.gateController.setGated(false);
    expect(gain.gain.value).toBe(1);
    gate?.destroy();
    closeLocalAudioGateContext();
    expect(outputTrack.stop).toHaveBeenCalledOnce();
    expect(inputTrack.stop).toHaveBeenCalledOnce();
    expect(context.close).toHaveBeenCalledOnce();
  });

  it("keeps passthrough fallback analysis before its single publication gate", async () => {
    const inputTrack = {
      clone: vi.fn(() => inputTrack),
      getSettings: vi.fn(() => ({ channelCount: 2 })),
      kind: "audio",
      stop: vi.fn(),
    } as unknown as MediaStreamTrack;
    const preGateTrack = {
      contentHint: "",
      kind: "audio",
      stop: vi.fn(),
    } as unknown as MediaStreamTrack;
    const publicationTrack = {
      contentHint: "",
      kind: "audio",
      stop: vi.fn(),
    } as unknown as MediaStreamTrack;
    const source = {
      channelCount: 0,
      channelCountMode: "max",
      channelInterpretation: "speakers",
      connect: vi.fn(),
      disconnect: vi.fn(),
    };
    const gain = {
      connect: vi.fn(),
      disconnect: vi.fn(),
      gain: { value: 1 },
    };
    const preGateDestination = {
      channelCount: 0,
      channelCountMode: "max",
      channelInterpretation: "speakers",
      stream: new TestMediaStream([preGateTrack]),
    };
    const publicationDestination = {
      channelCount: 0,
      channelCountMode: "max",
      channelInterpretation: "speakers",
      stream: new TestMediaStream([publicationTrack]),
    };
    const context = {
      close: vi.fn().mockResolvedValue(undefined),
      createGain: vi.fn(() => gain),
      createMediaStreamDestination: vi
        .fn()
        .mockReturnValueOnce(preGateDestination)
        .mockReturnValueOnce(publicationDestination),
      createMediaStreamSource: vi.fn(() => source),
      resume: vi.fn().mockResolvedValue(undefined),
      state: "running",
    };
    vi.stubGlobal(
      "AudioContext",
      vi.fn(function () {
        return context;
      }),
    );

    const processor = await createLocalAudioProcessor(
      new TestMediaStream([inputTrack]) as unknown as MediaStream,
      makeSettings({ noiseReductionEnabled: true }),
    );

    expect(processor?.mode).toBe("passthrough");
    expect(processor?.preGateStream.getAudioTracks()).toEqual([preGateTrack]);
    expect(processor?.publicationStream.getAudioTracks()).toEqual([
      publicationTrack,
    ]);
    expect(processor?.preGateStream).not.toBe(processor?.publicationStream);
    expect(source.connect).toHaveBeenCalledWith(preGateDestination);
    expect(source.connect).toHaveBeenCalledWith(gain);
    expect(gain.connect).toHaveBeenCalledWith(publicationDestination);

    processor?.gateController.setGated(true);
    expect(gain.gain.value).toBe(0);
    processor?.gateController.setGated(false);
    expect(gain.gain.value).toBe(1);
    processor?.destroy();
    expect(preGateTrack.stop).toHaveBeenCalledOnce();
    expect(publicationTrack.stop).toHaveBeenCalledOnce();
  });

  it("prefers rnnoise mode over high-fidelity pass-through when cleanup is enabled", () => {
    expect(
      resolveLocalAudioProcessingMode(
        makeSettings({
          noiseReductionEnabled: true,
          streamHighFidelity: true,
        }),
      ),
    ).toBe("rnnoise");
  });

  it("disables browser noise suppression while keeping capture echo cancellation and agc", () => {
    expect(
      resolveCaptureAudioProcessing(
        makeSettings({
          noiseReductionEnabled: true,
        }),
      ),
    ).toEqual({
      noiseSuppression: false,
      echoCancellation: true,
      autoGainControl: true,
    });
  });

  it("turns off all browser capture processing in high-fidelity mode", () => {
    expect(
      resolveCaptureAudioProcessing(
        makeSettings({
          streamHighFidelity: true,
          noiseReductionEnabled: false,
        }),
      ),
    ).toEqual({
      noiseSuppression: false,
      echoCancellation: false,
      autoGainControl: false,
    });
  });
});
