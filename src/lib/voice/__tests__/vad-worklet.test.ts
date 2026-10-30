// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SpeakingFlags } from "../../types";
import { VoiceActivityDetector } from "../vad";
import { VadCore, windowRms } from "../vad-processor.worklet.js";

describe("VadCore (shared hysteresis)", () => {
  it("turns on at the first loud window and off after 300 ms below threshold", () => {
    const core = new VadCore({ threshold: 3 });
    expect(core.update(1, 0)).toEqual([]);
    expect(core.update(5, 50)).toEqual([{ type: "speaking", value: true }]);
    expect(core.update(5, 100)).toEqual([]);
    // silence starts at 150; off at >= 450
    for (const t of [150, 200, 250, 300, 350, 400]) {
      expect(core.update(1, t)).toEqual([]);
    }
    expect(core.update(1, 450)).toEqual([{ type: "speaking", value: false }]);
  });

  it("a loud window inside the silence delay keeps speaking on", () => {
    const core = new VadCore({ threshold: 3, speaking: true });
    core.update(1, 0);
    core.update(1, 250);
    core.update(9, 280);
    expect(core.update(1, 300)).toEqual([]);
    expect(core.update(1, 590)).toEqual([]);
    expect(core.update(1, 600)).toEqual([{ type: "speaking", value: false }]);
  });

  it("reports a stall after 5 s of exact digital silence and its recovery", () => {
    const core = new VadCore({ threshold: 3 });
    expect(core.update(0, 0)).toEqual([]);
    expect(core.update(0, 4950)).toEqual([]);
    expect(core.update(0, 5000)).toEqual([{ type: "stalled", value: true }]);
    expect(core.update(0, 9000)).toEqual([]);
    expect(core.update(0.5, 9050)).toEqual([{ type: "stalled", value: false }]);
  });

  it("matches the analyser RMS maths (mean-centred, 0..100)", () => {
    const data = new Float32Array([0.5, -0.5, 0.5, -0.5]);
    expect(windowRms(data)).toBeCloseTo(50);
    expect(windowRms(new Float32Array([0.2, 0.2, 0.2]))).toBe(0);
  });
});

describe("rm-vad AudioWorklet processor", () => {
  type Processor = {
    port: { postMessage: (m: unknown) => void; onmessage: unknown };
    process: (inputs: Float32Array[][]) => boolean;
  };
  let registered: (new (options: unknown) => Processor) | null = null;
  const posted: unknown[] = [];

  beforeEach(async () => {
    posted.length = 0;
    class FakeAudioWorkletProcessor {
      port = {
        postMessage: (message: unknown) => posted.push(message),
        onmessage: null as unknown,
      };
    }
    vi.stubGlobal("AudioWorkletProcessor", FakeAudioWorkletProcessor);
    vi.stubGlobal("sampleRate", 48000);
    vi.stubGlobal("currentFrame", 0);
    vi.stubGlobal(
      "registerProcessor",
      (name: string, ctor: new (options: unknown) => Processor) => {
        if (name === "rm-vad") registered = ctor;
      },
    );
    vi.resetModules();
    await import("../vad-processor.worklet.js");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    registered = null;
  });

  function run(processor: Processor, seconds: number, amplitude: number) {
    const quanta = Math.round((48000 * seconds) / 128);
    let frame = (globalThis as unknown as { currentFrame: number })
      .currentFrame;
    for (let q = 0; q < quanta; q++) {
      const block = new Float32Array(128);
      for (let i = 0; i < 128; i++) {
        block[i] =
          amplitude * Math.sin(((frame + i) / 48000) * 2 * Math.PI * 220);
      }
      vi.stubGlobal("currentFrame", frame);
      processor.process([[block]]);
      frame += 128;
    }
    vi.stubGlobal("currentFrame", frame);
  }

  it("posts only transitions to the main thread", () => {
    expect(registered).not.toBeNull();
    const processor = new registered!({
      processorOptions: { threshold: 3 },
    });
    run(processor, 2, 0.001); // quiet room noise: below threshold
    expect(posted).toEqual([]);
    run(processor, 1, 0.3); // talking
    expect(posted).toEqual([
      expect.objectContaining({ type: "speaking", value: true }),
    ]);
    run(processor, 3, 0.3); // still talking: no traffic
    expect(posted).toHaveLength(1);
    run(processor, 1, 0.001); // stop
    expect(posted).toEqual([
      expect.objectContaining({ type: "speaking", value: true }),
      expect.objectContaining({ type: "speaking", value: false }),
    ]);
  });

  it("follows threshold messages from the main thread", () => {
    const processor = new registered!({
      processorOptions: { threshold: 3 },
    });
    (processor.port.onmessage as (e: { data: unknown }) => void)({
      data: { type: "threshold", value: 90 },
    });
    run(processor, 1, 0.3);
    expect(posted).toEqual([]);
  });
});

describe("VoiceActivityDetector on the worklet path", () => {
  class TestMediaStream {
    constructor(private readonly tracks: MediaStreamTrack[]) {}
    getAudioTracks() {
      return this.tracks;
    }
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("MediaStream", TestMediaStream);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("hands detection to the worklet, stops the timer and applies transitions", async () => {
    const analyser = {
      connect: vi.fn(),
      disconnect: vi.fn(),
      fftSize: 0,
      frequencyBinCount: 256,
      getFloatTimeDomainData: vi.fn((data: Float32Array) => data.fill(0.001)),
      smoothingTimeConstant: 0,
    };
    const gain = { connect: vi.fn(), disconnect: vi.fn(), gain: { value: 1 } };
    const source = { connect: vi.fn(), disconnect: vi.fn() };
    const addModule = vi.fn().mockResolvedValue(undefined);
    const context = {
      addEventListener: vi.fn(),
      audioWorklet: { addModule },
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
    const nodes: Array<{
      port: {
        postMessage: ReturnType<typeof vi.fn>;
        onmessage: ((e: { data: unknown }) => void) | null;
      };
      connect: ReturnType<typeof vi.fn>;
      disconnect: ReturnType<typeof vi.fn>;
      options: unknown;
    }> = [];
    vi.stubGlobal(
      "AudioWorkletNode",
      vi.fn(function (_ctx: unknown, name: string, options: unknown) {
        expect(name).toBe("rm-vad");
        const node = {
          port: { postMessage: vi.fn(), onmessage: null },
          connect: vi.fn(),
          disconnect: vi.fn(),
          options,
        };
        nodes.push(node);
        return node;
      }),
    );

    const track = {
      clone: vi.fn(() => track),
      stop: vi.fn(),
    } as unknown as MediaStreamTrack;
    const onSpeakingChange = vi.fn();
    const sendSpeaking = vi.fn();
    const gate = { setGated: vi.fn() };
    const detector = new VoiceActivityDetector({
      getParticipantId: () => "participant",
      onSpeakingChange,
      sendSpeaking,
      getAudioGate: () => gate,
    });

    expect(
      detector.start(new TestMediaStream([track]) as unknown as MediaStream),
    ).toBe(true);
    await vi.advanceTimersByTimeAsync(0);

    expect(addModule).toHaveBeenCalledWith(
      expect.stringContaining("vad-processor.worklet"),
    );
    expect(nodes).toHaveLength(1);
    expect(detector.isUsingAudioWorklet()).toBe(true);
    expect(source.connect).toHaveBeenCalledWith(nodes[0]);
    expect(nodes[0].connect).toHaveBeenCalledWith(gain);

    // The 50 ms analyser timer is gone: a minute of silence costs no ticks.
    analyser.getFloatTimeDomainData.mockClear();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(analyser.getFloatTimeDomainData).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);

    // Transitions from the audio thread drive the same callbacks.
    nodes[0].port.onmessage?.({
      data: { type: "speaking", value: true, rms: 12 },
    });
    expect(onSpeakingChange).toHaveBeenLastCalledWith(
      true,
      SpeakingFlags.MICROPHONE,
    );
    expect(sendSpeaking).toHaveBeenLastCalledWith(SpeakingFlags.MICROPHONE);
    expect(gate.setGated).toHaveBeenLastCalledWith(false);
    expect(detector.getCurrentRMS()).toBe(12);

    nodes[0].port.onmessage?.({
      data: { type: "speaking", value: false, rms: 1 },
    });
    expect(onSpeakingChange).toHaveBeenLastCalledWith(
      false,
      SpeakingFlags.NONE,
    );
    expect(gate.setGated).toHaveBeenLastCalledWith(true);

    detector.setThreshold(42);
    expect(nodes[0].port.postMessage).toHaveBeenCalledWith({
      type: "threshold",
      value: 42,
    });

    detector.stop();
    expect(nodes[0].disconnect).toHaveBeenCalled();
    expect(nodes[0].port.postMessage).toHaveBeenLastCalledWith({
      type: "stop",
    });
    // Late messages from a stopped node are ignored.
    onSpeakingChange.mockClear();
    nodes[0].port.onmessage?.({ data: { type: "speaking", value: true } });
    expect(onSpeakingChange).not.toHaveBeenCalled();
  });

  it("keeps the analyser timer when the worklet module cannot load", async () => {
    const analyser = {
      connect: vi.fn(),
      disconnect: vi.fn(),
      fftSize: 0,
      frequencyBinCount: 256,
      getFloatTimeDomainData: vi.fn((data: Float32Array) => data.fill(0.001)),
      smoothingTimeConstant: 0,
    };
    const context = {
      addEventListener: vi.fn(),
      audioWorklet: {
        addModule: vi.fn().mockRejectedValue(new Error("blocked")),
      },
      close: vi.fn().mockResolvedValue(undefined),
      createAnalyser: vi.fn(() => analyser),
      createGain: vi.fn(() => ({
        connect: vi.fn(),
        disconnect: vi.fn(),
        gain: { value: 1 },
      })),
      createMediaStreamSource: vi.fn(() => ({
        connect: vi.fn(),
        disconnect: vi.fn(),
      })),
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
    vi.stubGlobal("AudioWorkletNode", vi.fn());
    const track = {
      clone: vi.fn(() => track),
      stop: vi.fn(),
    } as unknown as MediaStreamTrack;
    const detector = new VoiceActivityDetector({
      getParticipantId: () => "participant",
      onSpeakingChange: vi.fn(),
      sendSpeaking: vi.fn(),
    });
    detector.start(new TestMediaStream([track]) as unknown as MediaStream);
    await vi.advanceTimersByTimeAsync(500);
    expect(detector.isUsingAudioWorklet()).toBe(false);
    expect(analyser.getFloatTimeDomainData).toHaveBeenCalled();
    detector.stop();
  });
});
