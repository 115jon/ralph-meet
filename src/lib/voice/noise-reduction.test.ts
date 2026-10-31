import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getLocalAudioDiagnostics,
  resetCaptureAudioContextForTests,
} from "./capture-audio-context";
import {
  createLocalAudioProcessor,
  resolveCaptureAudioProcessing,
  resolveLocalAudioProcessingMode,
  resolveLocalAudioPublicationMode,
  type VoiceAudioProcessingSettings,
} from "./noise-reduction";
import type { VoiceGateEvent } from "./vad";

class TestMediaStream {
  constructor(private readonly tracks: MediaStreamTrack[]) {}

  getAudioTracks(): MediaStreamTrack[] {
    return this.tracks;
  }

  getTracks(): MediaStreamTrack[] {
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

function outputTrack(): MediaStreamTrack {
  return {
    clone: vi.fn(() => outputTrack()),
    contentHint: "",
    kind: "audio",
    stop: vi.fn(),
  } as unknown as MediaStreamTrack;
}

function destination() {
  const track = outputTrack();
  return {
    channelCount: 0,
    channelCountMode: "max",
    channelInterpretation: "speakers",
    disconnect: vi.fn(),
    stream: new TestMediaStream([track]),
    track,
  };
}

type FakeGateNode = {
  name: string;
  options: { processorOptions: Record<string, unknown> };
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  port: {
    postMessage: ReturnType<typeof vi.fn>;
    onmessage: ((event: { data: unknown }) => void) | null;
  };
};

function installAudio(state: AudioContextState = "running") {
  const source = {
    channelCount: 0,
    channelCountMode: "max",
    channelInterpretation: "speakers",
    connect: vi.fn(),
    disconnect: vi.fn(),
  };
  const destinations: ReturnType<typeof destination>[] = [];
  const addModule = vi.fn().mockResolvedValue(undefined);
  const context = {
    addEventListener: vi.fn(),
    audioWorklet: { addModule },
    close: vi.fn().mockResolvedValue(undefined),
    createMediaStreamDestination: vi.fn(() => {
      const next = destination();
      destinations.push(next);
      return next;
    }),
    createMediaStreamSource: vi.fn(() => source),
    resume: vi.fn(() =>
      state === "running" ? Promise.resolve() : new Promise<void>(() => {}),
    ),
    state,
  };
  const AudioContextMock = vi.fn(function () {
    return context;
  });
  vi.stubGlobal("AudioContext", AudioContextMock);
  const nodes: FakeGateNode[] = [];
  vi.stubGlobal(
    "AudioWorkletNode",
    vi.fn(function (_context: unknown, name: string, options: unknown) {
      const node = {
        name,
        options,
        connect: vi.fn(),
        disconnect: vi.fn(),
        port: { postMessage: vi.fn(), onmessage: null },
      } as FakeGateNode;
      nodes.push(node);
      return node;
    }),
  );
  return {
    AudioContextMock,
    addModule,
    context,
    destinations,
    nodes,
    source,
  };
}

function inputStream(channelCount = 1) {
  const inputTrack = {
    clone: vi.fn(() => inputTrack),
    getSettings: vi.fn(() => ({ channelCount })),
    kind: "audio",
    stop: vi.fn(),
  } as unknown as MediaStreamTrack;
  return {
    inputTrack,
    stream: new TestMediaStream([inputTrack]) as unknown as MediaStream,
  };
}

describe("outbound audio processor", () => {
  beforeEach(() => {
    resetCaptureAudioContextForTests();
    vi.stubGlobal("MediaStream", TestMediaStream);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    resetCaptureAudioContextForTests();
  });

  it("gates the publication in-graph with lookahead, after the pre-gate monitor tap", async () => {
    const audio = installAudio();
    const { stream } = inputStream(2);

    const processor = await createLocalAudioProcessor(stream, makeSettings());

    expect(audio.AudioContextMock).toHaveBeenCalledWith({
      latencyHint: "interactive",
      sampleRate: 48_000,
    });
    expect(audio.addModule).toHaveBeenCalledWith(
      expect.stringContaining("vad-processor.worklet"),
    );
    expect(audio.nodes).toHaveLength(1);
    const gateNode = audio.nodes[0]!;
    expect(gateNode.name).toBe("rm-voice-gate");
    expect(gateNode.options).toMatchObject({
      outputChannelCount: [2],
      processorOptions: {
        channels: 2,
        lookaheadMs: 20,
        mode: "auto",
        silenceDelayMs: 300,
      },
    });
    const [preGate, publication] = audio.destinations;
    expect(audio.source.connect).toHaveBeenCalledWith(preGate);
    expect(audio.source.connect).toHaveBeenCalledWith(gateNode);
    expect(gateNode.connect).toHaveBeenCalledWith(publication);
    expect(processor?.mode).toBe("passthrough");
    expect(processor?.gateLookaheadMs).toBe(20);
    expect(processor?.preGateStream.getAudioTracks()).toEqual([preGate?.track]);
    expect(processor?.publicationStream.getAudioTracks()).toEqual([
      publication?.track,
    ]);

    processor?.destroy();
    expect(gateNode.port.postMessage).toHaveBeenCalledWith({ type: "stop" });
    expect(preGate?.track.stop).toHaveBeenCalledOnce();
    expect(publication?.track.stop).toHaveBeenCalledOnce();
    expect(audio.context.close).toHaveBeenCalledOnce();
  });

  it("drives the in-graph gate by mode and relays its transitions", async () => {
    const audio = installAudio();
    const processor = await createLocalAudioProcessor(
      inputStream().stream,
      makeSettings(),
    );
    const gate = processor?.gateController.inGraph;
    const port = audio.nodes[0]!.port;
    if (!gate) throw new Error("expected an in-graph gate");

    gate.setMode("closed");
    gate.setMode("closed");
    gate.setThreshold(10);
    expect(port.postMessage.mock.calls).toEqual([
      [{ type: "mode", value: "closed" }],
      [{ type: "threshold", value: 10 }],
    ]);
    processor?.gateController.setGated(false);
    expect(port.postMessage).toHaveBeenLastCalledWith({
      type: "mode",
      value: "open",
    });

    port.onmessage?.({ data: { type: "speaking", value: true, rms: 12 } });
    const seen: VoiceGateEvent[] = [];
    const unsubscribe = gate.subscribe((event) => seen.push(event));
    // A late subscriber learns the current state first.
    expect(seen).toEqual([
      { type: "stalled", value: false, rms: 12 },
      { type: "speaking", value: true, rms: 12 },
    ]);
    port.onmessage?.({ data: { type: "speaking", value: false, rms: 1 } });
    expect(seen.at(-1)).toEqual({ type: "speaking", value: false, rms: 1 });
    unsubscribe();
    port.onmessage?.({ data: { type: "speaking", value: true, rms: 9 } });
    expect(seen).toHaveLength(3);
    processor?.destroy();
  });

  it("opens the gate without lookahead when the sensitivity gate is off", async () => {
    const audio = installAudio();
    const processor = await createLocalAudioProcessor(
      inputStream().stream,
      makeSettings({ voiceGateEnabled: false }),
    );
    expect(audio.nodes[0]?.options.processorOptions).toMatchObject({
      lookaheadMs: 0,
      mode: "open",
    });
    expect(processor?.gateLookaheadMs).toBe(0);
    processor?.destroy();
  });

  it("shares one capture context and closes it with the last processor", async () => {
    const audio = installAudio();
    const first = await createLocalAudioProcessor(
      inputStream().stream,
      makeSettings(),
    );
    const second = await createLocalAudioProcessor(
      inputStream().stream,
      makeSettings(),
    );
    expect(audio.AudioContextMock).toHaveBeenCalledOnce();
    // Loaded once per context.
    expect(audio.addModule).toHaveBeenCalledOnce();
    first?.destroy();
    expect(audio.context.close).not.toHaveBeenCalled();
    second?.destroy();
    expect(audio.context.close).toHaveBeenCalledOnce();
  });

  it("reports a capture context that cannot start without a gesture", async () => {
    vi.useFakeTimers();
    const audio = installAudio("suspended");
    const pending = createLocalAudioProcessor(
      inputStream().stream,
      makeSettings(),
    );
    await vi.advanceTimersByTimeAsync(300);
    const processor = await pending;

    // Still published gated (never raw); a gesture resumes it.
    expect(processor?.gateController.inGraph).toBeDefined();
    expect(
      getLocalAudioDiagnostics().issues["capture-context-suspended"],
    ).toEqual({ count: 1, detail: "suspended" });
    audio.context.resume.mockClear();
    processor?.resume();
    expect(audio.context.resume).toHaveBeenCalledOnce();
    processor?.destroy();
  });

  it("returns null and reports when the gate worklet cannot load", async () => {
    const audio = installAudio();
    audio.addModule.mockRejectedValue(new Error("blocked"));
    const processor = await createLocalAudioProcessor(
      inputStream().stream,
      makeSettings(),
    );
    expect(processor).toBeNull();
    const { issues } = getLocalAudioDiagnostics();
    expect(issues["gate-unavailable"]?.count).toBe(1);
    expect(issues["processor-unavailable"]?.count).toBe(1);
    expect(audio.context.close).toHaveBeenCalledOnce();
  });
});

describe("noise reduction helpers", () => {
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

  it("publishes directly only without the gate and without RNNoise", () => {
    expect(resolveLocalAudioPublicationMode(makeSettings())).toBe(
      "passthrough",
    );
    expect(
      resolveLocalAudioPublicationMode(
        makeSettings({ streamHighFidelity: true }),
      ),
    ).toBe("true-stereo");
    expect(
      resolveLocalAudioPublicationMode(
        makeSettings({ voiceGateEnabled: false }),
      ),
    ).toBe("direct");
    expect(
      resolveLocalAudioPublicationMode(
        makeSettings({ voiceGateEnabled: false, streamHighFidelity: true }),
      ),
    ).toBe("direct");
    expect(
      resolveLocalAudioPublicationMode(
        makeSettings({ voiceGateEnabled: false, noiseReductionEnabled: true }),
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
