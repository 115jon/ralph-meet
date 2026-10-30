// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MicTestWidget } from "../MicTestWidget";

const mocks = vi.hoisted(() => ({
  createLocalAudioProcessor: vi.fn(),
  resolveCaptureAudioProcessing: vi.fn(() => ({
    noiseSuppression: true,
    echoCancellation: true,
    autoGainControl: true,
  })),
}));

vi.mock("@/lib/voice/noise-reduction", () => ({
  createLocalAudioProcessor: mocks.createLocalAudioProcessor,
  resolveCaptureAudioProcessing: mocks.resolveCaptureAudioProcessing,
}));

class TestMediaStream {
  constructor(private readonly tracks: MediaStreamTrack[]) {}

  getAudioTracks(): MediaStreamTrack[] {
    return this.tracks;
  }

  getTracks(): MediaStreamTrack[] {
    return this.tracks;
  }
}

function createTrack(id: string): MediaStreamTrack {
  return {
    clone: vi.fn(() => createTrack(`${id}-clone`)),
    kind: "audio",
    readyState: "live",
    stop: vi.fn(),
  } as unknown as MediaStreamTrack;
}

function createAudioContext() {
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
    close: vi.fn().mockResolvedValue(undefined),
    createAnalyser: vi.fn(() => analyser),
    createGain: vi.fn(() => gain),
    createMediaStreamSource: vi.fn(() => source),
    destination: {},
    resume: vi.fn().mockResolvedValue(undefined),
  } as unknown as AudioContext;

  return { analyser, context, gain, source };
}

describe("MicTestWidget", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("MediaStream", TestMediaStream);
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn(() => 1),
    );
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
  });

  it("analyses and plays the processed monitor stream through a silent sink", async () => {
    const rawStream = new TestMediaStream([createTrack("raw")]);
    const processedMonitorStream = new TestMediaStream([
      createTrack("processed-monitor"),
    ]);
    const { analyser, context, gain } = createAudioContext();
    const previewAudio = {
      autoplay: false,
      muted: true,
      pause: vi.fn(),
      play: vi.fn().mockResolvedValue(undefined),
      setSinkId: vi.fn().mockResolvedValue(undefined),
      srcObject: null,
    } as unknown as HTMLAudioElement;
    const getUserMedia = vi.fn().mockResolvedValue(rawStream);
    const processing = {
      noiseSuppression: true,
      echoCancellation: true,
      autoSensitivity: false,
      streamHighFidelity: false,
      noiseReductionEnabled: true,
      noiseReductionProvider: "rnnoise" as const,
    };
    const audioContextConstructor = vi.fn(function () {
      return context;
    });

    vi.stubGlobal("AudioContext", audioContextConstructor);
    vi.stubGlobal(
      "Audio",
      vi.fn(function () {
        return previewAudio;
      }),
    );
    vi.stubGlobal("navigator", {
      mediaDevices: { getUserMedia },
    });
    mocks.createLocalAudioProcessor.mockResolvedValue({
      createMonitorStream: vi.fn(() => processedMonitorStream),
      destroy: vi.fn(),
      gateController: {
        resume: vi.fn(),
        setGated: vi.fn(),
      },
      mode: "rnnoise",
      preGateStream: processedMonitorStream,
      publicationStream: processedMonitorStream,
      resume: vi.fn(),
    });

    const view = (sensitivity: number) => (
      <MicTestWidget
        sensitivity={sensitivity}
        autoSensitivity={false}
        inputDeviceId="default"
        outputDeviceId="default"
        processing={processing}
      />
    );
    const { rerender } = render(view(-50));

    fireEvent.click(screen.getByRole("button", { name: "Test mic" }));

    await waitFor(() => expect(previewAudio.play).toHaveBeenCalled());
    rerender(view(-20));
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(audioContextConstructor).toHaveBeenCalledTimes(1);
    expect(context.createMediaStreamSource).toHaveBeenCalledWith(
      processedMonitorStream,
    );
    expect(analyser.connect).toHaveBeenCalledWith(gain);
    expect(gain.gain.value).toBe(0);
    expect(gain.connect).toHaveBeenCalledWith(context.destination);
    expect(previewAudio.srcObject).toBe(processedMonitorStream);
  });

  it("cleans detached capture resources when analyser setup fails", async () => {
    const rawTrack = createTrack("raw-failure");
    const rawStream = new TestMediaStream([rawTrack]);
    const context = {
      close: vi.fn().mockResolvedValue(undefined),
      createAnalyser: vi.fn(() => {
        throw new Error("analyser unavailable");
      }),
    } as unknown as AudioContext;
    const getUserMedia = vi.fn().mockResolvedValue(rawStream);

    vi.stubGlobal(
      "AudioContext",
      vi.fn(function () {
        return context;
      }),
    );
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });

    render(
      <MicTestWidget
        sensitivity={-50}
        autoSensitivity={false}
        inputDeviceId="default"
        outputDeviceId="default"
        processing={{
          noiseSuppression: true,
          echoCancellation: true,
          autoSensitivity: false,
          streamHighFidelity: false,
          noiseReductionEnabled: false,
          noiseReductionProvider: "rnnoise",
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Test mic" }));

    await waitFor(() => expect(context.close).toHaveBeenCalled());
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(rawTrack.stop).toHaveBeenCalled();
  });
});
